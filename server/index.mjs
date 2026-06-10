import "dotenv/config";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildAuthUrl,
  handleOAuthCallback,
  listConnectedChannels,
  // uploadVideo: intentionally not imported — the upload endpoint is disabled
  // (see /api/youtube/upload). The function stays in youtube.mjs for later.
} from "./youtube.mjs";
import {
  consumeRecoveryCode,
  createUser,
  deleteUser,
  disableTwoFactor,
  enableTwoFactor,
  ensureSeedAdmin,
  findById,
  findByUsername,
  listUsers,
  recoveryCodesRemaining,
  regenerateRecoveryCodes,
  resetTwoFactor,
  setPassword,
  startTwoFactorSetup,
  verifyPassword,
  verifyUserTotp,
} from "./users.mjs";
import { decryptField, encryptField, encryptionEnabled } from "./crypto.mjs";
import {
  createSession,
  hasRecentReauth,
  listAllSessions,
  markReauth,
  pruneSessions,
  resolveAndTouch,
  revokeAllForUser,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "./sessions.mjs";
import { listEvents, logEvent } from "./audit.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
// In production set CONTAS_FLOW_STORAGE_DIR to a persistent volume (e.g. /data
// on Railway) so groups.json survives restarts and deploys.
const storageDir =
  process.env.CONTAS_FLOW_STORAGE_DIR ?? join(rootDir, "storage");
const dbFile = process.env.CONTAS_FLOW_DB ?? join(storageDir, "groups.json");
const legacyDbFile =
  process.env.CONTAS_FLOW_LEGACY_DB ?? join(storageDir, "accounts.json");
const port = Number(process.env.PORT ?? 8787);
// Bind to 0.0.0.0 in hosted environments (Railway, etc.); stay on loopback
// locally unless HOST is set explicitly.
const host = process.env.HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

// CORS: the API and the UI are served from the same origin in every deployment,
// so cross-origin browser access is never needed. We echo a single allowed
// origin (CONTAS_FLOW_ALLOWED_ORIGIN) when set, otherwise same-origin only.
// Wide-open "*" is intentionally gone now that the API serves real secrets.
const allowedOrigin = process.env.CONTAS_FLOW_ALLOWED_ORIGIN ?? "";

// A fixed valid scrypt hash used only to spend comparable time on logins for
// non-existent users, so response timing doesn't reveal whether a username
// exists. The password "x" never matches anything real.
const DUMMY_HASH =
  "scrypt:32768:8:1:00000000000000000000000000000000:" +
  "b9c8f0d4e1a2b3c4d5e6f70819202122232425262728292a2b2c2d2e2f303132" +
  "333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152";

// ----- Session auth (server-side gate) -----
// The real access control. The frontend "login" only drives UX: it POSTs the
// credentials here, the server validates them against the user store (scrypt
// hashes in users.json) and issues an HttpOnly session cookie carrying the
// user id. Every /api/* request (except /api/health and /api/auth/*) must carry
// a valid session cookie, so the data is never reachable from the browser
// without logging in. The static UI bundle is public (it holds no secrets); it
// just renders the login screen until the cookie is set.
//
// Auth is always on now that we have a user store: if no users exist yet, the
// only thing you can do is fail to log in (the admin is seeded from APP_AUTH_*
// at startup; see ensureSeedAdmin).

const SESSION_COOKIE = "contas_session";
// Session state lives server-side in storage/sessions.json (see sessions.mjs):
// it survives redeploys and, more importantly, is revocable. The cookie only
// carries the opaque token. Two expirations are enforced there: 3h idle and a
// 3-day absolute ceiling.

function parseCookies(request) {
  const header = request.headers.cookie ?? "";
  const jar = {};
  for (const part of header.split(";")) {
    const sep = part.indexOf("=");
    if (sep === -1) continue;
    const key = part.slice(0, sep).trim();
    if (key) jar[key] = decodeURIComponent(part.slice(sep + 1).trim());
  }
  return jar;
}

// Drops expired login-attempt buckets so the rate-limit map can't grow unbounded
// from one-off IPs that never return.
function pruneLoginAttempts() {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (entry.resetAt <= now) loginAttempts.delete(ip);
  }
}

function sessionToken(request) {
  return parseCookies(request)[SESSION_COOKIE] ?? null;
}

// Resolves the request to a stored user, or null when unauthenticated, when the
// session is invalid/expired/revoked, or when the user behind the session no
// longer exists (e.g. deleted by an admin). On a valid session this also renews
// lastSeenAt: every authenticated request counts as real activity (which is why
// the client must NOT poll /api/auth/status on a timer — that would keep an idle
// tab alive). The absolute 3-day ceiling is never extended.
// Resolves both the session record and the user for a request. Returns
// { session, user } or { session: null, user: null }. The session is needed
// (beyond the user) so reauth-gated handlers can check `reauthAt` without
// re-reading the store.
async function getSessionContext(request) {
  const token = sessionToken(request);
  // One serialized read-modify-write: validate + renew lastSeenAt together, so a
  // concurrent revoke can't be clobbered by a stale touch.
  const session = await resolveAndTouch(storageDir, token);
  if (!session) return { session: null, user: null };
  const user = await findById(storageDir, session.userId);
  if (!user) return { session: null, user: null };
  return { session, user };
}

// Thin wrapper for the public status route, which only needs the user.
async function getSessionUser(request) {
  return (await getSessionContext(request)).user;
}

// Secure is required in production (HTTPS) but breaks login over plain http on
// localhost, where browsers drop Secure cookies. Hosted deployments set PORT
// (Railway et al.) and sit behind HTTPS, so key Secure off that. Override with
// CONTAS_FLOW_COOKIE_SECURE=0/1 if needed.
const cookieSecure =
  process.env.CONTAS_FLOW_COOKIE_SECURE != null
    ? process.env.CONTAS_FLOW_COOKIE_SECURE === "1"
    : Boolean(process.env.PORT);

function sessionCookie(value, maxAge) {
  const flags = ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAge}`];
  if (cookieSecure) flags.splice(1, 0, "Secure");
  return `${SESSION_COOKIE}=${value}; ${flags.join("; ")}`;
}

function setSessionCookie(response, token) {
  // Cookie lifetime tracks the absolute session ceiling (3 days). The server still
  // enforces the 3h idle timeout independently, so the cookie outliving an idle
  // session is fine — the token just stops validating server-side.
  response.setHeader(
    "Set-Cookie",
    sessionCookie(token, Math.floor(SESSION_ABSOLUTE_MS / 1000)),
  );
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", sessionCookie("", 0));
}

// ----- Login rate limiting -----
// Bounds brute-force attempts against /api/auth/login. In-memory sliding window
// keyed by client IP; fine for this small single-instance service. Successful
// logins reset the counter so a legitimate user isn't penalized.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 1000 * 60 * 10; // 10 min
const loginAttempts = new Map(); // ip -> { count, resetAt }

function clientIp(request) {
  // The rate limiter must key off an IP the client can't forge. The socket
  // address is always trustworthy. X-Forwarded-For is client-settable, so we only
  // consult it when a proxy is explicitly declared via CONTAS_FLOW_TRUSTED_PROXIES
  // (the number of trusted hops in front of us — Railway = 1). In that case the
  // real client IP is that many entries from the RIGHT (proxies append, so the
  // rightmost are added by infrastructure we trust). Taking the first/left entry
  // would let an attacker rotate XFF per request and bypass the limit.
  const trusted = Number(process.env.CONTAS_FLOW_TRUSTED_PROXIES ?? 0);
  if (trusted > 0) {
    const xff = request.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      const parts = xff
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      // Pick the entry `trusted` hops from the right (the IP the outermost
      // trusted proxy observed). Clamp to the leftmost if XFF is shorter.
      const idx = Math.max(0, parts.length - trusted);
      if (parts[idx]) return parts[idx];
    }
  }
  return request.socket?.remoteAddress ?? "unknown";
}

// Returns true if this IP is over the limit (request should be refused). Records
// the attempt and prunes the window. Does not count successes (see resetLoginRate).
function loginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

function resetLoginRate(ip) {
  loginAttempts.delete(ip);
}

// /api/* paths reachable without a session: the auth endpoints themselves, and
// the YouTube OAuth callback (Google redirects the browser here with no cookie).
function isPublicApi(pathname) {
  return (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/login/totp" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/status" ||
    pathname === "/api/auth/reauth" ||
    pathname === "/api/youtube/callback"
  );
}

// Resolves the authenticated context ({ session, user }) for a protected request.
// On failure it writes a 401 and returns null, and the caller must stop handling
// the request.
async function requireContext(request, response) {
  const ctx = await getSessionContext(request);
  if (ctx.user) return ctx;
  response.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ error: "unauthorized" }));
  return null;
}

// Guard for critical actions: requires a recent re-auth on this session. Writes a
// 403 reauth_required and returns false when the window has lapsed; the caller
// must stop. `session` is the one already resolved by requireContext.
function requireRecentReauth(session, response) {
  if (hasRecentReauth(session)) return true;
  sendJson(response, 403, { error: "reauth_required" });
  return false;
}

const DEFAULT_GROUP_NAME = "Vitissouls";
const statuses = new Set(["active", "review", "archived", "inactive"]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function ensureStorage() {
  await mkdir(storageDir, { recursive: true });
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeRecord(input = {}, existing = {}) {
  const status = statuses.has(input.status) ? input.status : "active";

  return {
    id: asString(existing.id || input.id) || randomUUID(),
    platform: asString(input.platform).trim() || "Outra",
    role: asString(input.role).trim() || "Outra",
    owner: asString(input.owner).trim() || "Andre",
    label: asString(input.label).trim(),
    email: asString(input.email).trim(),
    username: asString(input.username).trim(),
    password: asString(input.password),
    recoveryEmail: asString(input.recoveryEmail).trim(),
    phone: asString(input.phone).trim(),
    status,
    twoFactor: Boolean(input.twoFactor),
    postDay: asString(input.postDay).trim(),
    niche: asString(input.niche).trim(),
    notes: asString(input.notes).trim(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeGroup(input = {}) {
  const accounts = Array.isArray(input.accounts)
    ? input.accounts.map((record) => normalizeRecord(record, record))
    : [];

  return {
    id: asString(input.id) || randomUUID(),
    name: asString(input.name).trim() || "Grupo",
    // Owner of the group. May be "" on legacy data; backfillOwners() assigns
    // those to the bootstrap admin at startup.
    ownerId: asString(input.ownerId),
    accounts,
  };
}

function emptyDb() {
  return { groups: [] };
}

// Strips the password out of an account before sending it to the browser. The
// listing must not carry the secret: the client fetches it on demand from the
// reauth-gated /secret endpoint when the user explicitly reveals/copies it. We
// keep a `hasPassword` flag so the UI can show whether one is set. (Other
// sensitive fields stay as-is for now; the password is the high-value target.)
function maskAccount(account) {
  const { password, ...rest } = account;
  return { ...rest, password: "", hasPassword: Boolean(password) };
}

// Account fields that hold secrets / sensitive PII and are encrypted at rest.
// Everything else (email, username, label, niche, ...) stays readable in the
// JSON for backups and debugging. See server/crypto.mjs.
const ENCRYPTED_ACCOUNT_FIELDS = [
  "password",
  "recoveryEmail",
  "phone",
  "notes",
];

// In-place transform of a db object's sensitive fields. `transform` is
// encryptField (on write) or decryptField (on read). Both are idempotent, so a
// store written before encryption was enabled migrates transparently on the next
// write. Returns the same object for convenience.
function transformDbSecrets(db, transform) {
  for (const group of db.groups ?? []) {
    for (const account of group.accounts ?? []) {
      for (const field of ENCRYPTED_ACCOUNT_FIELDS) {
        if (account[field] != null) {
          account[field] = transform(account[field]);
        }
      }
    }
  }
  return db;
}

// Reads the database, decrypting sensitive fields so the rest of the server works
// with plaintext in memory. On first run, migrates a legacy accounts.json array
// into a single "Vitissouls" group so existing accounts are preserved.
//
// IMPORTANT: only a *missing* file (ENOENT) triggers the migrate-and-write path.
// Any other failure — corrupt JSON, or (critically) a decrypt error because
// CONTAS_FLOW_ENC_KEY was changed/lost — must NOT fall through to writing an
// empty store, which would silently destroy the real data. We rethrow instead so
// the operator notices and can fix the key/file before anything is overwritten.
async function readDb() {
  await ensureStorage();

  let raw;
  try {
    raw = await readFile(dbFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      // No groups file yet: migrate the legacy accounts.json (or start empty).
      const migrated = await migrateLegacy();
      await writeDb(migrated);
      return migrated;
    }
    throw error; // permission error, etc. — don't clobber the file
  }

  // The file exists: a parse/decrypt failure here means corruption or a wrong
  // encryption key. Surface it loudly; never overwrite the existing data.
  try {
    return transformDbSecrets(normalizeDb(JSON.parse(raw)), decryptField);
  } catch (error) {
    throw new Error(
      `Falha ao ler ${dbFile}: dados ilegiveis (JSON corrompido ou ` +
        `CONTAS_FLOW_ENC_KEY incorreta/ausente). O arquivo NAO foi alterado. ` +
        `Causa: ${error instanceof Error ? error.message : "desconhecida"}`,
    );
  }
}

// The active group is now per-user client state (each browser remembers its own
// selection), so the server only stores the groups themselves.
function normalizeDb(parsed) {
  const groups = Array.isArray(parsed?.groups)
    ? parsed.groups.map(normalizeGroup)
    : [];

  return { groups };
}

async function migrateLegacy() {
  try {
    const raw = await readFile(legacyDbFile, "utf8");
    const parsed = JSON.parse(raw);
    const accounts = Array.isArray(parsed) ? parsed : [];

    // Owner is backfilled to the admin at startup (backfillOwners).
    const group = normalizeGroup({ name: DEFAULT_GROUP_NAME, accounts });
    return { groups: [group] };
  } catch {
    return emptyDb();
  }
}

// Assigns any ownerless group (legacy data, or migrated accounts.json) to the
// given admin id, so pre-multiuser data stays visible to the admin. Writes only
// when something changed. Safe to call on every startup.
async function backfillOwners(adminId) {
  if (!adminId) return;
  const db = await readDb();
  let changed = false;
  for (const group of db.groups) {
    if (!group.ownerId) {
      group.ownerId = adminId;
      changed = true;
    }
  }
  if (changed) await writeDb(db);
}

// Re-homes every group owned by `fromUserId` to `toUserId`. Called when a user is
// deleted so their groups don't become orphaned (a dangling ownerId would hide
// them from all members, leaving them reachable only via the admin bypass and
// never reassignable). Writes only when something changed.
async function reassignGroups(fromUserId, toUserId) {
  const db = await readDb();
  let changed = false;
  for (const group of db.groups) {
    if (group.ownerId === fromUserId) {
      group.ownerId = toUserId;
      changed = true;
    }
  }
  if (changed) await writeDb(db);
}

async function writeDb(db) {
  await ensureStorage();
  // Encrypt sensitive fields on a deep copy so the in-memory db (used by the
  // calling handler) keeps its plaintext values.
  const encrypted = transformDbSecrets(structuredClone(db), encryptField);
  await writeFile(dbFile, `${JSON.stringify(encrypted, null, 2)}\n`, "utf8");
}

function groupSummary(group) {
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    count: group.accounts.length,
  };
}

// Ownership: admins see and manage every group; members only their own.
function canSeeGroup(user, group) {
  return user.role === "admin" || group.ownerId === user.id;
}

function visibleGroups(user, groups) {
  return groups.filter((group) => canSeeGroup(user, group));
}

// Max accepted request body. Account records are tiny; 1 MB is generous and
// still bounds memory use so a giant POST can't exhaust the process.
const MAX_BODY_BYTES = 1024 * 1024;

// Thrown when a request body exceeds MAX_BODY_BYTES; the dispatcher maps it to a
// 413 instead of letting the connection buffer unbounded data.
class PayloadTooLargeError extends Error {}

// Consumes and discards a request body. Used when a handler answers a POST/PUT
// without parsing the body (e.g. the disabled upload endpoint), so the socket
// closes cleanly instead of resetting on the unread body. Bounded by the same
// cap as readBody.
async function drainBody(request) {
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.pause();
      return;
    }
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      // Stop buffering and let the dispatcher answer 413. We pause the stream
      // rather than destroy() it so the response can still be written cleanly
      // (destroying mid-request resets the socket -> the client sees ECONNRESET
      // instead of the 413).
      request.pause();
      throw new PayloadTooLargeError("payload_too_large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// Sets baseline security headers on every response. Done via setHeader at the
// start of the request so they apply uniformly to JSON, static files, HTML and
// error responses (writeHead later merges these in). The app is self-contained
// (no external scripts/styles/fonts), so a strict CSP doesn't break anything;
// 'unsafe-inline' on style-src covers the inline styles React/Tailwind emit.
function applySecurityHeaders(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  // HSTS only makes sense over HTTPS; gate it on the same signal as Secure
  // cookies so local http isn't told to force TLS.
  if (cookieSecure) {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
}

// CORS headers, only emitted when an explicit allowed origin is configured.
// Same-origin requests (the normal case) need none of this.
function corsHeaders() {
  if (!allowedOrigin) return {};
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
  };
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function notFound(response) {
  sendJson(response, 404, { error: "not_found" });
}

function badRequest(response, message) {
  sendJson(response, 400, { error: message ?? "bad_request" });
}

// `user`/`session` are the authenticated user and their session record for
// protected routes (resolved by the dispatcher), or null for the public
// auth/OAuth-callback routes handled first. `session` carries reauthAt so
// critical handlers can gate on a recent re-auth (requireRecentReauth).
async function handleApi(request, response, url, user, session) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  // ----- Auth (public: these gate the rest) -----

  // Validate credentials against the user store and issue a session cookie.
  // Wrong user or wrong password -> the same 401 (no account enumeration).
  // Rate limited per IP to bound brute-force attempts.
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    pruneLoginAttempts(); // sweep stale per-IP buckets so the map stays bounded
    const ip = clientIp(request);
    if (loginRateLimited(ip)) {
      await drainBody(request);
      sendJson(response, 429, { error: "too_many_attempts" });
      return;
    }

    const body = await readBody(request);
    const name = asString(body.name);
    const password = asString(body.password);

    const account = await findByUsername(storageDir, name);
    // Always run a verify so a missing user and a wrong password take a similar
    // path (the dummy hash makes the timing comparable).
    const ok = account
      ? await verifyPassword(password, account.passwordHash)
      : await verifyPassword(password, DUMMY_HASH);

    if (account && ok) {
      // If 2FA is on, don't issue a session yet: tell the client to collect a
      // code and finish at /api/auth/login/totp. The password was correct, so we
      // clear the rate-limit penalty here too.
      if (account.twoFactor?.enabled) {
        resetLoginRate(ip);
        sendJson(response, 200, { twoFactorRequired: true });
        return;
      }
      resetLoginRate(ip); // don't penalize a user who just logged in
      const token = await createSession(storageDir, {
        userId: account.id,
        ip,
        userAgent: request.headers["user-agent"],
      });
      setSessionCookie(response, token);
      void logEvent(storageDir, {
        userId: account.id,
        username: account.username,
        action: "login_ok",
        target: null,
        ip,
      });
      sendJson(response, 200, {
        authenticated: true,
        user: { username: account.username, role: account.role },
      });
      return;
    }
    void logEvent(storageDir, {
      userId: null,
      username: name || null,
      action: "login_fail",
      target: null,
      ip,
    });
    sendJson(response, 401, { error: "invalid_credentials" });
    return;
  }

  // Second step of 2FA login: re-validate password AND a TOTP (or recovery) code,
  // then issue the session. Public + rate-limited like login (bounds code
  // brute-force). The client resends name+password (it has them) so we don't need
  // a separate pending-login store.
  if (url.pathname === "/api/auth/login/totp" && request.method === "POST") {
    pruneLoginAttempts();
    const ip = clientIp(request);
    if (loginRateLimited(ip)) {
      await drainBody(request);
      sendJson(response, 429, { error: "too_many_attempts" });
      return;
    }

    const body = await readBody(request);
    const name = asString(body.name);
    const password = asString(body.password);
    const code = asString(body.code);

    const account = await findByUsername(storageDir, name);
    const passwordOk = account
      ? await verifyPassword(password, account.passwordHash)
      : await verifyPassword(password, DUMMY_HASH);

    if (!account || !passwordOk || !account.twoFactor?.enabled) {
      sendJson(response, 401, { error: "invalid_credentials" });
      return;
    }

    // Accept either a current TOTP code or a single-use recovery code.
    const totpOk = verifyUserTotp(account, code);
    const recoveryOk = totpOk
      ? false
      : await consumeRecoveryCode(storageDir, account.id, code);

    if (!totpOk && !recoveryOk) {
      void logEvent(storageDir, {
        userId: account.id,
        username: account.username,
        action: "login_2fa_fail",
        target: null,
        ip,
      });
      sendJson(response, 401, { error: "invalid_code" });
      return;
    }

    resetLoginRate(ip);
    const token = await createSession(storageDir, {
      userId: account.id,
      ip,
      userAgent: request.headers["user-agent"],
    });
    setSessionCookie(response, token);
    void logEvent(storageDir, {
      userId: account.id,
      username: account.username,
      action: recoveryOk ? "recovery_code_used" : "login_2fa_ok",
      target: null,
      ip,
    });
    sendJson(response, 200, {
      authenticated: true,
      user: { username: account.username, role: account.role },
    });
    return;
  }

  // Re-authentication: the user re-types their password to unlock critical
  // actions for a short window (REAUTH_WINDOW_MS). Only valid on an authenticated
  // session; rate-limited per IP like login to bound brute-force. NOTE: this is a
  // public route (no requireContext upstream), so we resolve the session here.
  if (url.pathname === "/api/auth/reauth" && request.method === "POST") {
    pruneLoginAttempts();
    const ip = clientIp(request);
    if (loginRateLimited(ip)) {
      await drainBody(request);
      sendJson(response, 429, { error: "too_many_attempts" });
      return;
    }
    const token = sessionToken(request);
    const current = await resolveAndTouch(storageDir, token);
    if (!current) {
      await drainBody(request);
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    const account = await findById(storageDir, current.userId);
    const body = await readBody(request);
    const password = asString(body.password);
    const ok = account
      ? await verifyPassword(password, account.passwordHash)
      : await verifyPassword(password, DUMMY_HASH);

    if (account && ok) {
      resetLoginRate(ip);
      await markReauth(storageDir, token);
      void logEvent(storageDir, {
        userId: account.id,
        username: account.username,
        action: "reauth_ok",
        target: null,
        ip,
      });
      sendJson(response, 200, { ok: true });
      return;
    }
    void logEvent(storageDir, {
      userId: account?.id ?? null,
      username: account?.username ?? null,
      action: "reauth_fail",
      target: null,
      ip,
    });
    sendJson(response, 401, { error: "invalid_credentials" });
    return;
  }

  // Drop the session: revoke it server-side AND clear the cookie.
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = sessionToken(request);
    if (token) await revokeSession(storageDir, token);
    clearSessionCookie(response);
    sendJson(response, 200, { authenticated: false });
    return;
  }

  // Report whether the caller has a valid session (drives the login screen) and,
  // if so, who they are (username + role drive the UI's admin features). When the
  // session has expired (idle/absolute) or was revoked, clear the now-stale cookie
  // so the browser stops sending it and the UI falls back to the login screen.
  if (url.pathname === "/api/auth/status" && request.method === "GET") {
    const current = await getSessionUser(request);
    if (!current && sessionToken(request)) {
      clearSessionCookie(response);
    }
    sendJson(response, 200, {
      authenticated: Boolean(current),
      user: current ? { username: current.username, role: current.role } : null,
    });
    return;
  }

  // ----- Two-factor: the user manages their OWN 2FA (derives from session). -----

  // Current status (no secrets).
  if (url.pathname === "/api/account/2fa" && request.method === "GET") {
    sendJson(response, 200, {
      enabled: Boolean(user.twoFactor?.enabled),
      recoveryCodesRemaining: recoveryCodesRemaining(user),
    });
    return;
  }

  // Begin setup: returns the secret + otpauth URI for the QR. Reauth required.
  if (url.pathname === "/api/account/2fa/setup" && request.method === "POST") {
    if (!requireRecentReauth(session, response)) return;
    const result = await startTwoFactorSetup(storageDir, user.id);
    sendJson(response, 200, result ?? { error: "not_found" });
    return;
  }

  // Confirm setup with a code -> enable + return recovery codes (shown once).
  if (url.pathname === "/api/account/2fa/enable" && request.method === "POST") {
    if (!requireRecentReauth(session, response)) return;
    const body = await readBody(request);
    try {
      const result = await enableTwoFactor(
        storageDir,
        user.id,
        asString(body.code),
      );
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "2fa_enabled",
        target: null,
        ip: clientIp(request),
      });
      sendJson(response, 200, result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_code";
      sendJson(response, 400, { error: code });
    }
    return;
  }

  // Disable, verifying a TOTP or recovery code. Reauth required.
  if (url.pathname === "/api/account/2fa/disable" && request.method === "POST") {
    if (!requireRecentReauth(session, response)) return;
    const body = await readBody(request);
    try {
      const ok = await disableTwoFactor(storageDir, user.id, asString(body.code));
      if (!ok) {
        sendJson(response, 400, { error: "not_enabled" });
        return;
      }
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "2fa_disabled",
        target: null,
        ip: clientIp(request),
      });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_code";
      sendJson(response, 400, { error: code });
    }
    return;
  }

  // Regenerate recovery codes (invalidates the old set). Reauth required.
  if (
    url.pathname === "/api/account/2fa/recovery-codes" &&
    request.method === "POST"
  ) {
    if (!requireRecentReauth(session, response)) return;
    const result = await regenerateRecoveryCodes(storageDir, user.id);
    if (!result) {
      sendJson(response, 400, { error: "not_enabled" });
      return;
    }
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "recovery_codes_regenerated",
      target: null,
      ip: clientIp(request),
    });
    sendJson(response, 200, result);
    return;
  }

  // ----- Backup (admin only) -----
  // Full export of all groups and accounts (decrypted plaintext, so the backup
  // is actually usable) plus the user roster WITHOUT password hashes (restoring
  // people means re-setting their passwords; we don't ship hashes in a download).
  // Downloaded as a dated JSON attachment for the admin to store off-platform.
  if (url.pathname === "/api/admin/backup" && request.method === "GET") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (!requireRecentReauth(session, response)) return;
    const db = await readDb();
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      users: await listUsers(storageDir), // id, username, role, createdAt (no hash)
      groups: db.groups,
    };
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "backup_exported",
      target: null,
      ip: clientIp(request),
    });
    const date = new Date().toISOString().slice(0, 10);
    response.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="contas-backup-${date}.json"`,
    });
    response.end(JSON.stringify(backup, null, 2));
    return;
  }

  // ----- Users (admin only) -----

  if (url.pathname === "/api/users") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, { users: await listUsers(storageDir) });
      return;
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const role = body.role === "admin" ? "admin" : "member";
      // Creating an admin is a privileged action: require a recent re-auth.
      if (role === "admin" && !requireRecentReauth(session, response)) return;
      try {
        const created = await createUser(storageDir, {
          username: body.username,
          password: body.password,
          role,
        });
        void logEvent(storageDir, {
          userId: user.id,
          username: user.username,
          action: "user_created",
          target: `user:${created.id}`,
          ip: clientIp(request),
        });
        sendJson(response, 201, created);
      } catch (error) {
        const code = error instanceof Error ? error.message : "invalid";
        badRequest(response, code);
      }
      return;
    }
    notFound(response);
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch) {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    const targetId = decodeURIComponent(userMatch[1]);

    if (request.method === "DELETE") {
      // Removing an admin is privileged: require a recent re-auth. (Check the
      // target's role before deleting.)
      const target = await findById(storageDir, targetId);
      if (target?.role === "admin" && !requireRecentReauth(session, response)) {
        return;
      }
      try {
        const removed = await deleteUser(storageDir, targetId);
        if (!removed) {
          notFound(response);
          return;
        }
        // Re-home the deleted user's groups to the acting admin so their data
        // stays visible and manageable instead of becoming orphaned.
        await reassignGroups(targetId, user.id);
        void logEvent(storageDir, {
          userId: user.id,
          username: user.username,
          action: "user_deleted",
          target: `user:${targetId}`,
          ip: clientIp(request),
        });
        sendJson(response, 200, { ok: true });
      } catch (error) {
        const code = error instanceof Error ? error.message : "invalid";
        badRequest(response, code);
      }
      return;
    }
    notFound(response);
    return;
  }

  const userPwMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/password$/);
  if (userPwMatch && request.method === "PUT") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (!requireRecentReauth(session, response)) return;
    const body = await readBody(request);
    const password = asString(body.password);
    if (!password) {
      badRequest(response, "password_required");
      return;
    }
    const targetId = decodeURIComponent(userPwMatch[1]);
    const ok = await setPassword(storageDir, targetId, password);
    if (!ok) {
      notFound(response);
      return;
    }
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "password_changed",
      target: `user:${targetId}`,
      ip: clientIp(request),
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  // Admin force-resets another user's 2FA (safety net for someone locked out of
  // their authenticator and recovery codes). Admin only + reauth.
  const user2faResetMatch = url.pathname.match(
    /^\/api\/users\/([^/]+)\/2fa\/reset$/,
  );
  if (user2faResetMatch && request.method === "POST") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (!requireRecentReauth(session, response)) return;
    const targetId = decodeURIComponent(user2faResetMatch[1]);
    const ok = await resetTwoFactor(storageDir, targetId);
    if (ok) {
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "2fa_reset_by_admin",
        target: `user:${targetId}`,
        ip: clientIp(request),
      });
    }
    sendJson(response, 200, { ok });
    return;
  }

  // "Log out of all devices" for a user: revoke every active session they hold.
  // Admin only (same gate as the rest of /api/users) + recent re-auth (it can lock
  // people out, including the acting admin).
  const userSessionsMatch = url.pathname.match(
    /^\/api\/users\/([^/]+)\/sessions\/revoke$/,
  );
  if (userSessionsMatch && request.method === "POST") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (!requireRecentReauth(session, response)) return;
    const targetId = decodeURIComponent(userSessionsMatch[1]);
    const revoked = await revokeAllForUser(storageDir, targetId);
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "sessions_revoked_all",
      target: `user:${targetId}`,
      ip: clientIp(request),
    });
    sendJson(response, 200, { ok: true, revoked });
    return;
  }

  // ----- Sessions (admin: view & revoke) -----
  // Lets an admin see who is logged in and end specific sessions. The requester's
  // own session is flagged `current` so the UI can label "this device".
  if (url.pathname === "/api/sessions" && request.method === "GET") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    const sessions = await listAllSessions(storageDir, sessionToken(request));
    sendJson(response, 200, { sessions });
    return;
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch && request.method === "DELETE") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    const targetSid = decodeURIComponent(sessionMatch[1]);
    const revoked = await revokeSession(storageDir, targetSid);
    if (revoked) {
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "session_revoked",
        target: `session:${targetSid.slice(0, 8)}`,
        ip: clientIp(request),
      });
    }
    sendJson(response, 200, { ok: revoked });
    return;
  }

  // ----- Audit trail (admin only) -----
  // The recent security-relevant events (who did what, when). No secrets.
  if (url.pathname === "/api/audit" && request.method === "GET") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    const events = await listEvents(storageDir, { limit: 200 });
    sendJson(response, 200, { events });
    return;
  }

  // ----- YouTube (OAuth + upload) -----

  // Begin OAuth: redirect the browser to Google's consent screen.
  if (url.pathname === "/api/youtube/connect" && request.method === "GET") {
    try {
      response.writeHead(302, { Location: buildAuthUrl() });
      response.end();
    } catch (error) {
      sendJson(response, 500, {
        error: "youtube_config",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    return;
  }

  // OAuth callback: exchange code, save the channel, bounce back to the app.
  if (url.pathname === "/api/youtube/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");

    if (!code) {
      sendJson(response, 400, { error: "missing_code" });
      return;
    }

    try {
      const channel = await handleOAuthCallback(code);
      response.writeHead(302, {
        Location: `/?youtube=connected&channel=${encodeURIComponent(channel?.title ?? "")}`,
      });
      response.end();
    } catch (error) {
      sendJson(response, 500, {
        error: "youtube_oauth",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    return;
  }

  // List connected channels (no secrets).
  if (url.pathname === "/api/youtube/channels" && request.method === "GET") {
    sendJson(response, 200, { channels: await listConnectedChannels() });
    return;
  }

  // Upload is DISABLED while the YouTube integration is paused (Phase 0). The
  // old handler took an arbitrary `filePath` from the body and streamed it to
  // YouTube — that's arbitrary file read on the server. Until the feature is
  // resumed with a safe design (uploads confined to a dedicated directory, no
  // caller-controlled absolute paths), the endpoint returns 503. uploadVideo()
  // in youtube.mjs is kept intact for when it's re-enabled.
  if (url.pathname === "/api/youtube/upload" && request.method === "POST") {
    await drainBody(request);
    sendJson(response, 503, {
      error: "youtube_upload_disabled",
      message:
        "Upload temporariamente desativado enquanto a integração YouTube está em pausa.",
    });
    return;
  }

  // ----- Groups -----
  // Every group route below is ownership-scoped: a member only ever sees or
  // touches groups they own; an admin sees all. A group the caller can't see is
  // reported as 404 (not 403) so its existence isn't revealed.
  if (url.pathname === "/api/groups" && request.method === "GET") {
    const db = await readDb();
    sendJson(response, 200, {
      groups: visibleGroups(user, db.groups).map(groupSummary),
    });
    return;
  }

  if (url.pathname === "/api/groups" && request.method === "POST") {
    const body = await readBody(request);
    const db = await readDb();
    const group = normalizeGroup({
      name: asString(body.name).trim() || "Novo grupo",
      // New groups belong to their creator. (Admins create their own groups too;
      // they can still see everyone's.)
      ownerId: user.id,
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
    });

    db.groups.push(group);
    await writeDb(db);
    sendJson(response, 201, groupSummary(group));
    return;
  }

  const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch) {
    const db = await readDb();
    const id = decodeURIComponent(groupMatch[1]);
    const index = db.groups.findIndex((group) => group.id === id);

    if (index === -1 || !canSeeGroup(user, db.groups[index])) {
      notFound(response);
      return;
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      const name = asString(body.name).trim();

      if (!name) {
        badRequest(response, "name_required");
        return;
      }

      db.groups[index] = { ...db.groups[index], name };
      await writeDb(db);
      sendJson(response, 200, groupSummary(db.groups[index]));
      return;
    }

    if (request.method === "DELETE") {
      if (!requireRecentReauth(session, response)) return;
      db.groups.splice(index, 1);
      await writeDb(db);
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "group_deleted",
        target: `group:${id}`,
        ip: clientIp(request),
      });
      sendJson(response, 200, {
        groups: visibleGroups(user, db.groups).map(groupSummary),
      });
      return;
    }

    notFound(response);
    return;
  }

  // ----- Accounts within a group -----
  // Resolves a group the caller is allowed to touch, or writes 404 and returns
  // null. Centralizes the ownership check for all account routes.
  async function resolveOwnedGroup(db, rawId) {
    const groupId = decodeURIComponent(rawId);
    const group = db.groups.find((item) => item.id === groupId);
    if (!group || !canSeeGroup(user, group)) {
      notFound(response);
      return null;
    }
    return group;
  }

  const accountsMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts$/,
  );
  if (accountsMatch) {
    const db = await readDb();
    const group = await resolveOwnedGroup(db, accountsMatch[1]);
    if (!group) return;

    if (request.method === "GET") {
      sendJson(response, 200, group.accounts.map(maskAccount));
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const account = normalizeRecord(body);

      group.accounts.unshift(account);
      await writeDb(db);
      sendJson(response, 201, maskAccount(account));
      return;
    }

    notFound(response);
    return;
  }

  const importMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts\/import$/,
  );
  if (importMatch && request.method === "POST") {
    const body = await readBody(request);
    const db = await readDb();
    const group = await resolveOwnedGroup(db, importMatch[1]);
    if (!group) return;

    const imported = Array.isArray(body) ? body : body.accounts;
    group.accounts = Array.isArray(imported)
      ? imported.map((record) => normalizeRecord(record))
      : [];

    await writeDb(db);
    sendJson(response, 200, group.accounts.map(maskAccount));
    return;
  }

  // Fetch ONE account's password in clear text, on demand. Ownership-scoped and
  // gated by a recent re-auth; the reveal/copy is recorded in the audit trail.
  const secretMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts\/([^/]+)\/secret$/,
  );
  if (secretMatch && request.method === "GET") {
    const db = await readDb();
    const group = await resolveOwnedGroup(db, secretMatch[1]);
    if (!group) return;
    if (!requireRecentReauth(session, response)) return;

    const accountId = decodeURIComponent(secretMatch[2]);
    const account = group.accounts.find((item) => item.id === accountId);
    if (!account) {
      notFound(response);
      return;
    }
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "secret_viewed",
      target: `account:${accountId}`,
      ip: clientIp(request),
    });
    sendJson(response, 200, { password: account.password ?? "" });
    return;
  }

  const accountMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts\/([^/]+)$/,
  );
  if (accountMatch) {
    const db = await readDb();
    const group = await resolveOwnedGroup(db, accountMatch[1]);
    if (!group) return;

    const accountId = decodeURIComponent(accountMatch[2]);
    const index = group.accounts.findIndex(
      (account) => account.id === accountId,
    );

    if (index === -1) {
      notFound(response);
      return;
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      const existing = group.accounts[index];
      // The listing sends the password masked (""), so an edit that didn't touch
      // it would otherwise wipe the stored password. Treat an empty incoming
      // password as "unchanged" and keep the existing one. (Clearing a password
      // isn't a flow the UI offers; deleting the account is.)
      const incomingPassword = asString(body.password);
      const merged =
        incomingPassword === ""
          ? { ...body, password: existing.password }
          : body;
      const updated = normalizeRecord(merged, existing);

      group.accounts[index] = updated;
      await writeDb(db);
      sendJson(response, 200, maskAccount(updated));
      return;
    }

    if (request.method === "DELETE") {
      group.accounts.splice(index, 1);
      await writeDb(db);
      sendJson(response, 200, { ok: true });
      return;
    }

    notFound(response);
    return;
  }

  notFound(response);
}

async function serveStatic(request, response, url) {
  const distDir = join(rootDir, "dist");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(join(distDir, pathname));

  if (!filePath.startsWith(distDir)) {
    notFound(response);
    return;
  }

  try {
    await stat(filePath);
    response.writeHead(200, {
      "Content-Type":
        contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const indexPath = join(distDir, "index.html");

    try {
      await stat(indexPath);
      response.writeHead(200, { "Content-Type": contentTypes[".html"] });
      createReadStream(indexPath).pipe(response);
    } catch {
      sendJson(response, 200, {
        ok: true,
        api: "/api/groups",
        message: "run npm run local for the app UI",
      });
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    applySecurityHeaders(request, response);
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    // Health check stays open so the host's probe works without credentials.
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      // The auth endpoints (and the YouTube OAuth callback) are public — they're
      // how you obtain a session. Everything else under /api/ requires a valid
      // session: we resolve the user once here and pass it to the handler. The
      // static UI bundle below is intentionally public (no secrets) so the login
      // screen can load.
      let user = null;
      let session = null;
      if (!isPublicApi(url.pathname)) {
        const ctx = await requireContext(request, response);
        if (!ctx) return; // requireContext already wrote the 401
        ({ session, user } = ctx);
      }
      await handleApi(request, response, url, user, session);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    // Map known client-side failures to precise codes; never leak internal error
    // messages (paths, stack hints) to the client for anything else.
    if (error instanceof PayloadTooLargeError) {
      // The oversized body was left unread (we stopped buffering), so the
      // keep-alive socket can't be safely reused — close it after replying.
      response.setHeader("Connection", "close");
      sendJson(response, 413, { error: "payload_too_large" });
      return;
    }
    if (error instanceof SyntaxError) {
      // Malformed JSON body.
      sendJson(response, 400, { error: "invalid_json" });
      return;
    }
    console.error("server_error:", error);
    sendJson(response, 500, { error: "server_error" });
  }
});

// Startup: ensure storage exists and migrate legacy data, seed the bootstrap
// admin from APP_AUTH_* if the user store is empty, then assign any ownerless
// (pre-multiuser) groups to that admin so existing data stays visible.
await readDb();
const seededUsers = await ensureSeedAdmin(storageDir);
const seedAdmin = seededUsers.find((item) => item.role === "admin");
await backfillOwners(seedAdmin?.id);

// If encryption is on, proactively re-write the store so any pre-existing
// plaintext secrets get encrypted now rather than waiting for the next edit.
// readDb()->writeDb() round-trips through decrypt/encrypt; already-encrypted
// values are left untouched (idempotent).
if (encryptionEnabled) {
  await writeDb(await readDb());
}

// Drop revoked/expired sessions at startup, then periodically, so sessions.json
// doesn't accumulate dead records. unref() keeps the timer from holding the
// process open.
await pruneSessions(storageDir);
setInterval(() => {
  void pruneSessions(storageDir);
}, SESSION_IDLE_MS).unref();

server.listen(port, host, () => {
  console.log(`Contas_exe API: listening on ${host}:${port}`);
  if (seededUsers.length === 0) {
    console.log(
      "AVISO: nenhum usuario cadastrado. Defina APP_AUTH_USER e APP_AUTH_PASSWORD " +
        "para criar o admin inicial; depois gerencie a equipe pela UI.",
    );
  }
  if (!encryptionEnabled) {
    console.log(
      "AVISO: criptografia em repouso DESATIVADA (senhas ficam em texto plano). " +
        "Defina CONTAS_FLOW_ENC_KEY (32 bytes em hex/base64) em producao.",
    );
  }
});
