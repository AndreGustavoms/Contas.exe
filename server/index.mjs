import "dotenv/config";
import { initDb, isConnected, query, getClient } from "./db.mjs";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildGoogleAuthUrl,
  exchangeGoogleAuthCode,
  googleAuthConfigured,
} from "./google-auth.mjs";
import {
  buildGithubAuthUrl,
  exchangeGithubAuthCode,
  githubAuthConfigured,
} from "./github-auth.mjs";
import {
  buildAuthUrl,
  ensureUploadsDir,
  handleOAuthCallback,
  isYouTubeUploadError,
  listConnectedChannels,
  listUploadHistory,
  listUploadableFiles,
  MAX_STAGED_UPLOAD_BYTES,
  stageUpload,
  deleteVideo,
  updateVideo,
  uploadVideo,
  uploadsDirectory,
  YOUTUBE_MAX_UPLOAD_BYTES,
} from "./youtube.mjs";
import {
  consumeRecoveryCode,
  createUser,
  deleteUser,
  disableTwoFactor,
  enableTwoFactor,
  ensureSeedAdmin,
  ensureSuperadmin,
  findOrCreateGoogleUser,
  findOrCreateGithubUser,
  linkGoogleProvider,
  linkGithubProvider,
  findByEmail,
  findById,
  findByUsernameOrEmail,
  listUsers,
  keepOnlySuperadmin,
  recoveryCodesRemaining,
  regenerateRecoveryCodes,
  resetSuperadminPasswordFromEnv,
  resetTwoFactor,
  setAvatarUrl,
  setEmail,
  setFullName,
  setPassword,
  setUsername,
  startTwoFactorSetup,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifyUserTotp,
} from "./users-pg.mjs";
import { sendEmail } from "./email.mjs";
import { notifyIfNewIp } from "./login-notify.mjs";
import {
  consumeResetToken,
  createResetToken,
  pruneResetTokens,
  validateResetToken,
} from "./password-reset.mjs";
import { decryptField, encryptField, encryptionEnabled } from "./crypto.mjs";
import {
  createSession,
  hasRecentReauth,
  listAllSessions,
  listSessionsForUser,
  markReauth,
  pruneSessions,
  resolveAndTouch,
  revokeAllForUser,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "./sessions.mjs";
import { listEvents, logEvent } from "./audit.mjs";
import { recentLogs, recordLog } from "./server-logs.mjs";
import {
  checkRateLimit,
  clearFailures,
  ipKey,
  pruneRateLimits,
  recordFailure,
  userKey,
} from "./rate-limit.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
// In production set CONTAS_FLOW_STORAGE_DIR to a persistent volume (e.g. /data
// on Railway) so groups.json survives restarts and deploys.
const storageDir =
  process.env.CONTAS_FLOW_STORAGE_DIR ?? join(rootDir, "storage");
const dbFile = process.env.CONTAS_FLOW_DB ?? join(storageDir, "groups.json");
const legacyDbFile =
  process.env.CONTAS_FLOW_LEGACY_DB ?? join(storageDir, "accounts.json");
const vaultsDir = join(storageDir, "vaults");
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

// Secure is required on HTTPS, but breaks login over plain HTTP when the app is
// shared locally. Hosted deployments report HTTPS through X-Forwarded-Proto.
// CONTAS_FLOW_COOKIE_SECURE=0/1 remains an explicit override.
const cookieSecureOverride = process.env.CONTAS_FLOW_COOKIE_SECURE;

function requestProto(request) {
  const forwardedProto = request?.headers?.["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.length > 0) {
    return forwardedProto.split(",")[0].trim().toLowerCase();
  }
  return request?.socket?.encrypted ? "https" : "http";
}

function shouldUseSecureCookie(request) {
  if (cookieSecureOverride != null) return cookieSecureOverride === "1";
  return requestProto(request) === "https";
}

function appendSetCookie(response, cookie) {
  const existing = response.getHeader("Set-Cookie");
  if (!existing) {
    response.setHeader("Set-Cookie", cookie);
    return;
  }
  response.setHeader(
    "Set-Cookie",
    Array.isArray(existing) ? [...existing, cookie] : [existing, cookie],
  );
}

function sessionCookie(request, value, maxAge) {
  const flags = ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAge}`];
  if (shouldUseSecureCookie(request)) flags.splice(1, 0, "Secure");
  return `${SESSION_COOKIE}=${value}; ${flags.join("; ")}`;
}

function setSessionCookie(request, response, token) {
  // Cookie lifetime tracks the absolute session ceiling (3 days). The server still
  // enforces the 3h idle timeout independently, so the cookie outliving an idle
  // session is fine — the token just stops validating server-side.
  appendSetCookie(
    response,
    sessionCookie(request, token, Math.floor(SESSION_ABSOLUTE_MS / 1000)),
  );
}

function clearSessionCookie(request, response) {
  appendSetCookie(response, sessionCookie(request, "", 0));
}

const GOOGLE_OAUTH_STATE_COOKIE = "contas_google_oauth_state";

function googleOAuthStateCookie(request, value, maxAge) {
  const flags = [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/api/auth/google/callback",
    `Max-Age=${maxAge}`,
  ];
  if (shouldUseSecureCookie(request)) flags.splice(1, 0, "Secure");
  return `${GOOGLE_OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

function setGoogleOAuthStateCookie(request, response, state) {
  appendSetCookie(response, googleOAuthStateCookie(request, state, 10 * 60));
}

function clearGoogleOAuthStateCookie(request, response) {
  appendSetCookie(response, googleOAuthStateCookie(request, "", 0));
}

function stateMatches(actual, expected) {
  const actualBuffer = Buffer.from(String(actual ?? ""));
  const expectedBuffer = Buffer.from(String(expected ?? ""));
  return (
    actualBuffer.length > 0 &&
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function requestOrigin(request) {
  return `${requestProto(request)}://${request.headers.host}`;
}

function googleRedirectUri(request) {
  return (
    process.env.GOOGLE_AUTH_REDIRECT_URI ||
    `${requestOrigin(request)}/api/auth/google/callback`
  );
}

const GITHUB_OAUTH_STATE_COOKIE = "contas_github_oauth_state";

function githubOAuthStateCookie(request, value, maxAge) {
  const flags = [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/api/auth/github/callback",
    `Max-Age=${maxAge}`,
  ];
  if (shouldUseSecureCookie(request)) flags.splice(1, 0, "Secure");
  return `${GITHUB_OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

function setGithubOAuthStateCookie(request, response, state) {
  appendSetCookie(response, githubOAuthStateCookie(request, state, 10 * 60));
}

function clearGithubOAuthStateCookie(request, response) {
  appendSetCookie(response, githubOAuthStateCookie(request, "", 0));
}

function githubRedirectUri(request) {
  return (
    process.env.GITHUB_AUTH_REDIRECT_URI ||
    `${requestOrigin(request)}/api/auth/github/callback`
  );
}

const YOUTUBE_OAUTH_STATE_COOKIE = "contas_youtube_oauth_state";
const YOUTUBE_STATE_PREFIX = "yt";

function buildYoutubeOAuthState(userId) {
  return `${YOUTUBE_STATE_PREFIX}:${userId}:${randomBytes(32).toString("base64url")}`;
}

function youtubeOwnerFromState(state) {
  const parts = String(state ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== YOUTUBE_STATE_PREFIX || !parts[1]) {
    return null;
  }
  return parts[1];
}

function youtubeOAuthStateCookie(request, value, maxAge) {
  const flags = [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/api/youtube/callback",
    `Max-Age=${maxAge}`,
  ];
  if (shouldUseSecureCookie(request)) flags.splice(1, 0, "Secure");
  return `${YOUTUBE_OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

function setYoutubeOAuthStateCookie(request, response, state) {
  appendSetCookie(response, youtubeOAuthStateCookie(request, state, 10 * 60));
}

function clearYoutubeOAuthStateCookie(request, response) {
  appendSetCookie(response, youtubeOAuthStateCookie(request, "", 0));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

// ----- Login rate limiting -----
// Bloqueio progressivo de falhas de autenticação (ver rate-limit.mjs): chaves
// por conta (5/10/15 falhas -> 15min/1h/24h) e por IP (limiares mais altos).

function clientIp(request) {
  // The rate limiter must key off an IP the client can't forge. The socket
  // address is always trustworthy. X-Forwarded-For is client-settable, so we only
  // consult it when a proxy is explicitly declared via CONTAS_FLOW_TRUSTED_PROXIES
  // (the number of trusted hops in front of us — Railway = 1). In that case the
  // real client IP is that many entries from the RIGHT (proxies append, so the
  // rightmost are added by infrastructure we trust). Taking the first/left entry
  // would let an attacker rotate XFF per request and bypass the limit.
  const trustedRaw = Number(process.env.CONTAS_FLOW_TRUSTED_PROXIES ?? 0);
  const trusted = Number.isInteger(trustedRaw) && trustedRaw > 0 ? trustedRaw : 0;
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

// Responde 429 (com Retry-After) se alguma das chaves estiver bloqueada e
// retorna true — o handler deve parar. Os handlers leem o body ANTES desta
// checagem (o username compõe a chave), então não há stream pendente a drenar.
function rejectIfRateLimited(response, keys) {
  pruneRateLimits();
  const { blocked, retryAfterMs } = checkRateLimit(keys);
  if (!blocked) return false;
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  response.setHeader("Retry-After", String(retryAfterSeconds));
  sendJson(response, 429, { error: "too_many_attempts", retryAfterSeconds });
  return true;
}

// Registra a falha de autenticação e audita quando uma chave ACABOU de entrar
// em bloqueio (uma linha por lockout, não por tentativa).
function noteAuthFailure(keys, { userId = null, username = null, ip } = {}) {
  const { newlyBlocked } = recordFailure(keys);
  for (const key of newlyBlocked) {
    void logEvent(storageDir, {
      userId,
      username,
      action: "rate_limited",
      target: key.startsWith("ip:") ? "ip" : key,
      ip,
    });
  }
}

// /api/* paths reachable without a session: the auth endpoints themselves, and
// the YouTube OAuth callback (Google redirects the browser here with no cookie).
function isPublicApi(pathname) {
  return (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/login/totp" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/status" ||
    pathname === "/api/auth/providers" ||
    pathname === "/api/auth/google" ||
    pathname === "/api/auth/google/callback" ||
    pathname === "/api/auth/github" ||
    pathname === "/api/auth/github/callback" ||
    pathname === "/api/account/connections/google" ||
    pathname === "/api/account/connections/github" ||
    pathname === "/api/auth/reauth" ||
    pathname === "/api/auth/forgot-password" ||
    pathname === "/api/auth/reset-password" ||
    pathname === "/api/auth/register" ||
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

// Role helpers. "superadmin" (o dono) é tratado como ">= admin" em toda checagem
// de permissão, então herda tudo que um admin pode fazer e mais o painel /admin.
function isAdmin(user) {
  return user?.role === "admin" || user?.role === "superadmin";
}

function isSuperadmin(user) {
  return user?.role === "superadmin";
}

// Gate do painel superadmin. Para manter o painel SELADO (sem oráculo de
// existência), quem não é superadmin recebe 404 — a mesma resposta de uma rota
// inexistente — em vez de 403. Retorna false e já respondeu quando barra.
function requireSuperadmin(user, response) {
  if (isSuperadmin(user)) return true;
  notFound(response);
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

function isValidAvatarUrl(value) {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (value.length > 750_000) return false;
  const dataMatch =
    /^data:image\/(?:png|jpe?g|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(value);
  if (dataMatch) {
    try {
      const bytes = Buffer.from(dataMatch[1], "base64");
      return (
        bytes.length > 0 &&
        bytes.toString("base64").replace(/=+$/, "") ===
          dataMatch[1].replace(/=+$/, "")
      );
    } catch {
      return false;
    }
  }
  if (/^data:/i.test(value)) {
    return false;
  }
  if (value.length > 1000) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
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

function requiresAccountUpdateReauth(input = {}, existing = {}) {
  const incomingUsername = asString(input.username).trim();
  const currentUsername = asString(existing.username).trim();
  if (incomingUsername !== currentUsername) return true;

  const incomingPassword = asString(input.password);
  const currentPassword = asString(existing.password);
  return incomingPassword !== "" && incomingPassword !== currentPassword;
}

function normalizeGroup(input = {}) {
  const accounts = Array.isArray(input.accounts)
    ? input.accounts.map((record) => normalizeRecord(record, record))
    : [];

  return {
    id: asString(input.id) || randomUUID(),
    name: asString(input.name).trim() || "Grupo",
    ownerId: asString(input.ownerId),
    accounts,
  };
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

// The active group is now per-user client state (each browser remembers its own
// selection), so the server only stores the groups themselves.
function normalizeDb(parsed) {
  const groups = Array.isArray(parsed?.groups)
    ? parsed.groups.map(normalizeGroup)
    : [];

  return { groups };
}

// On first boot after introducing per-user vaults: if no vault files exist yet
// but the old groups.json does, distribute its groups into individual vault files
// keyed by ownerId. Ownerless groups fall to adminId. Safe to call on every
// startup — it's a no-op once any vault file exists.
async function migrateGroupsToVaults(adminId) {
  await ensureVaultsDir();
  let existingFiles;
  try {
    existingFiles = await readdir(vaultsDir);
  } catch {
    existingFiles = [];
  }
  if (existingFiles.some((f) => f.endsWith(".json"))) return; // already migrated

  // Try to read the old single-file store.
  let raw;
  try {
    raw = await readFile(dbFile, "utf8");
  } catch {
    return; // no legacy data — fresh install, nothing to migrate
  }
  let oldDb;
  try {
    oldDb = transformDbSecrets(normalizeDb(JSON.parse(raw)), decryptField);
  } catch {
    return; // corrupt file — skip rather than destroy anything
  }

  const byOwner = new Map();
  for (const group of oldDb.groups) {
    const uid = group.ownerId || adminId;
    if (!uid) continue;
    if (!byOwner.has(uid)) byOwner.set(uid, []);
    byOwner.get(uid).push({ ...group, ownerId: uid });
  }
  for (const [uid, groups] of byOwner) {
    await writeVault(uid, { groups });
  }
}

// Deletes a removed user's vault contents instead of moving them to the acting
// admin. User vaults are isolated; deletion must not transfer private accounts.
async function purgeUserVault(fromUserId) {
  if (isConnected()) {
    await query("DELETE FROM groups WHERE owner_id = $1", [fromUserId]);
    return;
  }
  await writeVault(fromUserId, { groups: [] });
}

// ---- Per-user vault storage ----
// Each user's credentials live in vaults/{userId}.json, fully isolated from
// other users at the filesystem level. Superadmin-only control-plane routes can
// read all vaults for backup and oversight.

async function ensureVaultsDir() {
  await mkdir(vaultsDir, { recursive: true });
}

// Sanitizes a user ID to a safe filename segment. User IDs are UUIDs from our
// own crypto.randomUUID() but we scrub anything unexpected to prevent path traversal.
function vaultPath(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("invalid_user_id");
  return join(vaultsDir, `${safe}.json`);
}

async function readVault(userId) {
  if (isConnected()) {
    const groupsRes = await query(
      "SELECT id, name FROM groups WHERE owner_id = $1 ORDER BY created_at",
      [userId]
    );
    const groups = [];
    for (const g of groupsRes.rows) {
      const acctRes = await query(
        `SELECT id, platform, role, owner, label, email, username,
         password_enc, recovery_email_enc, phone_enc, notes_enc,
         status, two_factor AS "twoFactor", post_day AS "postDay", niche,
         updated_at AS "updatedAt"
         FROM accounts WHERE group_id = $1 ORDER BY created_at`,
        [g.id]
      );
      const accounts = acctRes.rows.map((a) => ({
        id: a.id,
        platform: a.platform,
        role: a.role,
        owner: a.owner,
        label: a.label || "",
        email: a.email || "",
        username: a.username || "",
        password: a.password_enc ? decryptField(a.password_enc) : "",
        recoveryEmail: a.recovery_email_enc ? decryptField(a.recovery_email_enc) : "",
        phone: a.phone_enc ? decryptField(a.phone_enc) : "",
        notes: a.notes_enc ? decryptField(a.notes_enc) : "",
        status: a.status,
        twoFactor: a.twoFactor,
        postDay: a.postDay || "",
        niche: a.niche || "",
        updatedAt: a.updatedAt,
      }));
      groups.push({ id: g.id, name: g.name, ownerId: userId, accounts });
    }
    return { groups };
  }

  await ensureVaultsDir();
  let raw;
  try {
    raw = await readFile(vaultPath(userId), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { groups: [] };
    throw error;
  }
  try {
    return transformDbSecrets(normalizeDb(JSON.parse(raw)), decryptField);
  } catch (error) {
    throw new Error(
      `Falha ao ler cofre de ${userId}: dados ilegiveis (JSON corrompido ou ` +
        `CONTAS_FLOW_ENC_KEY incorreta/ausente). O arquivo NAO foi alterado. ` +
        `Causa: ${error instanceof Error ? error.message : "desconhecida"}`,
    );
  }
}

async function writeVault(userId, db) {
  if (isConnected()) {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const existingRes = await client.query(
        "SELECT id FROM groups WHERE owner_id = $1",
        [userId]
      );
      const existingIds = new Set(existingRes.rows.map((r) => r.id));
      const newIds = new Set(db.groups.map((g) => g.id));

      for (const id of existingIds) {
        if (!newIds.has(id)) {
          await client.query("DELETE FROM groups WHERE id = $1", [id]);
        }
      }

      for (const group of db.groups) {
        await client.query(
          `INSERT INTO groups (id, name, owner_id) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
          [group.id, group.name, userId]
        );

        const accountIds = group.accounts.map((a) => a.id);
        if (accountIds.length > 0) {
          await client.query(
            `DELETE FROM accounts WHERE group_id = $1 AND id != ALL($2::uuid[])`,
            [group.id, accountIds]
          );
        } else {
          await client.query("DELETE FROM accounts WHERE group_id = $1", [group.id]);
        }

        for (const acct of group.accounts) {
          await client.query(
            `INSERT INTO accounts (id, group_id, platform, role, owner, label, email, username,
             password_enc, recovery_email_enc, phone_enc, notes_enc,
             status, two_factor, post_day, niche, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (id) DO UPDATE SET
               platform=EXCLUDED.platform, role=EXCLUDED.role, owner=EXCLUDED.owner,
               label=EXCLUDED.label, email=EXCLUDED.email, username=EXCLUDED.username,
               password_enc=EXCLUDED.password_enc, recovery_email_enc=EXCLUDED.recovery_email_enc,
               phone_enc=EXCLUDED.phone_enc, notes_enc=EXCLUDED.notes_enc,
               status=EXCLUDED.status, two_factor=EXCLUDED.two_factor,
               post_day=EXCLUDED.post_day, niche=EXCLUDED.niche, updated_at=EXCLUDED.updated_at`,
            [
              acct.id, group.id, acct.platform, acct.role, acct.owner,
              acct.label || "", acct.email || "", acct.username || "",
              acct.password ? encryptField(acct.password) : null,
              acct.recoveryEmail ? encryptField(acct.recoveryEmail) : null,
              acct.phone ? encryptField(acct.phone) : null,
              acct.notes ? encryptField(acct.notes) : null,
              acct.status || "active", acct.twoFactor || false,
              acct.postDay || "", acct.niche || "",
              acct.updatedAt || new Date().toISOString(),
            ]
          );
        }
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return;
  }

  await ensureVaultsDir();
  const encrypted = transformDbSecrets(structuredClone(db), encryptField);
  await writeFile(
    vaultPath(userId),
    `${JSON.stringify(encrypted, null, 2)}\n`,
    "utf8",
  );
}

// Returns array of { userId, db } for every user that has a vault file.
async function readAllVaults() {
  await ensureVaultsDir();
  const users = await listUsers(storageDir);
  const result = [];
  for (const u of users) {
    const db = await readVault(u.id);
    result.push({ userId: u.id, db });
  }
  return result;
}

function groupSummary(group) {
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    count: group.accounts.length,
  };
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
  response.setHeader("X-DNS-Prefetch-Control", "off");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
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
      "upgrade-insecure-requests",
    ].join("; "),
  );
  // HSTS only makes sense over HTTPS; gate it on the same signal as Secure
  // cookies so local http isn't told to force TLS.
  if (shouldUseSecureCookie(request)) {
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

  if (url.pathname === "/api/auth/providers" && request.method === "GET") {
    sendJson(response, 200, {
      google: googleAuthConfigured(),
      github: githubAuthConfigured(),
    });
    return;
  }

  if (
    url.pathname === "/api/account/connections/google" &&
    request.method === "GET"
  ) {
    const current = await getSessionUser(request);
    if (!current) {
      redirect(response, "/?auth=login_required");
      return;
    }
    if (!googleAuthConfigured()) {
      redirect(response, "/?connection=google_unavailable");
      return;
    }

    const state = `link:${randomBytes(32).toString("base64url")}`;
    setGoogleOAuthStateCookie(request, response, state);
    try {
      redirect(
        response,
        buildGoogleAuthUrl({
          redirectUri: googleRedirectUri(request),
          state,
        }),
      );
    } catch {
      clearGoogleOAuthStateCookie(request, response);
      redirect(response, "/?connection=google_error");
    }
    return;
  }

  if (
    url.pathname === "/api/account/connections/github" &&
    request.method === "GET"
  ) {
    const current = await getSessionUser(request);
    if (!current) {
      redirect(response, "/?auth=login_required");
      return;
    }
    if (!githubAuthConfigured()) {
      redirect(response, "/?connection=github_unavailable");
      return;
    }

    const state = `link:${randomBytes(32).toString("base64url")}`;
    setGithubOAuthStateCookie(request, response, state);
    try {
      redirect(
        response,
        buildGithubAuthUrl({
          redirectUri: githubRedirectUri(request),
          state,
        }),
      );
    } catch {
      clearGithubOAuthStateCookie(request, response);
      redirect(response, "/?connection=github_error");
    }
    return;
  }

  if (url.pathname === "/api/auth/google" && request.method === "GET") {
    if (!googleAuthConfigured()) {
      redirect(response, "/?auth=google_error");
      return;
    }

    const state = randomBytes(32).toString("base64url");
    setGoogleOAuthStateCookie(request, response, state);
    try {
      redirect(
        response,
        buildGoogleAuthUrl({
          redirectUri: googleRedirectUri(request),
          state,
        }),
      );
    } catch (error) {
      clearGoogleOAuthStateCookie(request, response);
      redirect(response, "/?auth=google_error");
    }
    return;
  }

  if (
    url.pathname === "/api/auth/google/callback" &&
    request.method === "GET"
  ) {
    const expectedState = parseCookies(request)[GOOGLE_OAUTH_STATE_COOKIE];
    const actualState = url.searchParams.get("state");
    clearGoogleOAuthStateCookie(request, response);

    if (url.searchParams.get("error")) {
      redirect(response, "/?auth=google_error");
      return;
    }

    if (!stateMatches(actualState, expectedState)) {
      redirect(response, "/?auth=google_error");
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      redirect(response, "/?auth=google_error");
      return;
    }

    try {
      const profile = await exchangeGoogleAuthCode({
        code,
        redirectUri: googleRedirectUri(request),
      });
      if (String(actualState).startsWith("link:")) {
        const current = await getSessionUser(request);
        if (!current) {
          redirect(response, "/?auth=login_required");
          return;
        }
        const linked = await linkGoogleProvider(
          storageDir,
          current.id,
          profile,
        );
        if (!linked) {
          redirect(response, "/?connection=google_error");
          return;
        }
        void logEvent(storageDir, {
          userId: current.id,
          username: current.username,
          action: "link_google_ok",
          target: profile.email,
          ip: clientIp(request),
        });
        redirect(response, "/?connection=google_linked");
        return;
      }
      const result = await findOrCreateGoogleUser(storageDir, profile);
      const ip = clientIp(request);
      const token = await createSession(storageDir, {
        userId: result.user.id,
        ip,
        userAgent: request.headers["user-agent"],
      });

      await markReauth(storageDir, token);
      setSessionCookie(request, response, token);
      void notifyIfNewIp(
        storageDir,
        { ...result.user, email: profile.email },
        ip,
        request.headers["user-agent"],
      );
      void logEvent(storageDir, {
        userId: result.user.id,
        username: result.user.username,
        action: "login_google_ok",
        target: result.created ? "google:new_user" : "google",
        ip,
      });
      redirect(response, "/");
    } catch (error) {
      void logEvent(storageDir, {
        userId: null,
        username: null,
        action: "login_google_fail",
        target: null,
        ip: clientIp(request),
      });
      redirect(
        response,
        error instanceof Error && error.message === "google_already_linked"
          ? "/?connection=google_already_linked"
          : error instanceof Error &&
              error.message === "google_email_already_registered"
            ? "/?auth=google_email_exists"
            : "/?auth=google_error",
      );
    }
    return;
  }

  if (url.pathname === "/api/auth/github" && request.method === "GET") {
    if (!githubAuthConfigured()) {
      redirect(response, "/?auth=github_error");
      return;
    }

    const state = randomBytes(32).toString("base64url");
    setGithubOAuthStateCookie(request, response, state);
    try {
      redirect(
        response,
        buildGithubAuthUrl({
          redirectUri: githubRedirectUri(request),
          state,
        }),
      );
    } catch (error) {
      clearGithubOAuthStateCookie(request, response);
      redirect(response, "/?auth=github_error");
    }
    return;
  }

  if (
    url.pathname === "/api/auth/github/callback" &&
    request.method === "GET"
  ) {
    const expectedState = parseCookies(request)[GITHUB_OAUTH_STATE_COOKIE];
    const actualState = url.searchParams.get("state");
    clearGithubOAuthStateCookie(request, response);

    if (url.searchParams.get("error")) {
      redirect(response, "/?auth=github_error");
      return;
    }

    if (!stateMatches(actualState, expectedState)) {
      redirect(response, "/?auth=github_error");
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      redirect(response, "/?auth=github_error");
      return;
    }

    try {
      const profile = await exchangeGithubAuthCode({
        code,
        redirectUri: githubRedirectUri(request),
      });
      if (String(actualState).startsWith("link:")) {
        const current = await getSessionUser(request);
        if (!current) {
          redirect(response, "/?auth=login_required");
          return;
        }
        const linked = await linkGithubProvider(
          storageDir,
          current.id,
          profile,
        );
        if (!linked) {
          redirect(response, "/?connection=github_error");
          return;
        }
        void logEvent(storageDir, {
          userId: current.id,
          username: current.username,
          action: "link_github_ok",
          target: profile.email,
          ip: clientIp(request),
        });
        redirect(response, "/?connection=github_linked");
        return;
      }
      const result = await findOrCreateGithubUser(storageDir, profile);
      const ip = clientIp(request);
      const token = await createSession(storageDir, {
        userId: result.user.id,
        ip,
        userAgent: request.headers["user-agent"],
      });

      await markReauth(storageDir, token);
      setSessionCookie(request, response, token);
      void notifyIfNewIp(
        storageDir,
        { ...result.user, email: profile.email },
        ip,
        request.headers["user-agent"],
      );
      void logEvent(storageDir, {
        userId: result.user.id,
        username: result.user.username,
        action: "login_github_ok",
        target: result.created ? "github:new_user" : "github",
        ip,
      });
      redirect(response, "/");
    } catch (error) {
      void logEvent(storageDir, {
        userId: null,
        username: null,
        action: "login_github_fail",
        target: null,
        ip: clientIp(request),
      });
      redirect(
        response,
        error instanceof Error && error.message === "github_already_linked"
          ? "/?connection=github_already_linked"
          : error instanceof Error &&
              error.message === "github_email_already_registered"
            ? "/?auth=github_email_exists"
            : "/?auth=github_error",
      );
    }
    return;
  }

  // Validate credentials against the user store and issue a session cookie.
  // Wrong user or wrong password -> the same 401 (no account enumeration).
  // Rate limited per IP to bound brute-force attempts.
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const ip = clientIp(request);
    const body = await readBody(request);
    const name = asString(body.name);
    const password = asString(body.password);

    // Chave dupla: a conta alvo (bloqueia cedo) e o IP de origem (bloqueia
    // varredura de várias contas). Body lido antes — o username compõe a chave.
    const limitKeys = [ipKey(ip), userKey(name)];
    if (rejectIfRateLimited(response, limitKeys)) return;

    const account = await findByUsernameOrEmail(storageDir, name);
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
        clearFailures(limitKeys);
        sendJson(response, 200, { twoFactorRequired: true });
        return;
      }
      clearFailures(limitKeys); // don't penalize a user who just logged in
      const token = await createSession(storageDir, {
        userId: account.id,
        ip,
        userAgent: request.headers["user-agent"],
      });
      setSessionCookie(request, response, token);
      void notifyIfNewIp(storageDir, account, ip, request.headers["user-agent"]);
      void logEvent(storageDir, {
        userId: account.id,
        username: account.username,
        action: "login_ok",
        target: null,
        ip,
      });
      sendJson(response, 200, {
        authenticated: true,
        user: {
          id: account.id,
          username: account.username,
          role: account.role,
        },
      });
      return;
    }
    noteAuthFailure(limitKeys, { username: name || null, ip });
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
    const ip = clientIp(request);
    const body = await readBody(request);
    const name = asString(body.name);
    const password = asString(body.password);
    const code = asString(body.code);

    const limitKeys = [ipKey(ip), userKey(name)];
    if (rejectIfRateLimited(response, limitKeys)) return;

    const account = await findByUsernameOrEmail(storageDir, name);
    const passwordOk = account
      ? await verifyPassword(password, account.passwordHash)
      : await verifyPassword(password, DUMMY_HASH);

    if (!account || !passwordOk || !account.twoFactor?.enabled) {
      noteAuthFailure(limitKeys, { username: name || null, ip });
      sendJson(response, 401, { error: "invalid_credentials" });
      return;
    }

    // Accept either a current TOTP code or a single-use recovery code.
    const totpOk = verifyUserTotp(account, code);
    const recoveryOk = totpOk
      ? false
      : await consumeRecoveryCode(storageDir, account.id, code);

    if (!totpOk && !recoveryOk) {
      noteAuthFailure(limitKeys, {
        userId: account.id,
        username: account.username,
        ip,
      });
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

    clearFailures(limitKeys);
    const token = await createSession(storageDir, {
      userId: account.id,
      ip,
      userAgent: request.headers["user-agent"],
    });
    setSessionCookie(request, response, token);
    void notifyIfNewIp(storageDir, account, ip, request.headers["user-agent"]);
    void logEvent(storageDir, {
      userId: account.id,
      username: account.username,
      action: recoveryOk ? "recovery_code_used" : "login_2fa_ok",
      target: null,
      ip,
    });
    sendJson(response, 200, {
      authenticated: true,
      user: { id: account.id, username: account.username, role: account.role },
    });
    return;
  }

  // Re-authentication: the user re-types their password to unlock critical
  // actions for a short window (REAUTH_WINDOW_MS). Only valid on an authenticated
  // session; rate-limited per IP like login to bound brute-force. NOTE: this is a
  // public route (no requireContext upstream), so we resolve the session here.
  if (url.pathname === "/api/auth/reauth" && request.method === "POST") {
    const ip = clientIp(request);
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

    const limitKeys = [ipKey(ip), userKey(account?.username ?? "")];
    if (rejectIfRateLimited(response, limitKeys)) return;

    const ok = account
      ? await verifyPassword(password, account.passwordHash)
      : await verifyPassword(password, DUMMY_HASH);

    if (account && ok) {
      clearFailures(limitKeys);
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
    noteAuthFailure(limitKeys, {
      userId: account?.id ?? null,
      username: account?.username ?? null,
      ip,
    });
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

  // Request a password-reset link. Always returns 200 to avoid username/email
  // enumeration — the caller can't tell whether an account was found.
  // Rate-limited to prevent e-mail flood and Resend cost abuse.
  if (
    url.pathname === "/api/auth/forgot-password" &&
    request.method === "POST"
  ) {
    const ip = clientIp(request);
    const body = await readBody(request);
    const email = asString(body.email).trim().toLowerCase();

    // Cada pedido conta como "falha" na chave do IP: limita flood de e-mail e
    // custo do Resend (limiar de IP: 20 pedidos/30min antes do primeiro bloqueio).
    const limitKeys = [ipKey(ip)];
    if (rejectIfRateLimited(response, limitKeys)) return;
    noteAuthFailure(limitKeys, { ip });

    if (email) {
      const account = await findByEmail(storageDir, email);
      if (account) {
        const raw = await createResetToken(storageDir, account.id);
        const base = process.env.CONTAS_FLOW_BASE_URL?.replace(/\/$/, "") ?? "";
        const link = `${base}/reset-password?token=${raw}`;
        await sendEmail({
          to: email,
          subject: "Redefinir sua senha — Contas",
          html: `
<p>Olá, <strong>${account.username}</strong>.</p>
<p>Clique no link abaixo para redefinir sua senha. O link expira em 15 minutos.</p>
<p><a href="${link}">${link}</a></p>
<p>Se você não solicitou isso, ignore este e-mail.</p>
          `.trim(),
        });
        void logEvent(storageDir, {
          userId: account.id,
          username: account.username,
          action: "password_reset_requested",
          target: null,
          ip: clientIp(request),
        });
      }
    }

    sendJson(response, 200, { ok: true });
    return;
  }

  // Public self-registration. Creates a member account without requiring a session.
  // Rate-limited (same window as login) to prevent account-spam and brute-force
  // enumeration of existing usernames/emails via repeated register attempts.
  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    if (process.env.CONTAS_FLOW_REGISTRATIONS_OPEN !== "true") {
      await drainBody(request);
      sendJson(response, 403, { error: "registrations_closed" });
      return;
    }
    const ip = clientIp(request);
    const body = await readBody(request);

    // Cada tentativa de registro conta na chave do IP (limita spam de contas e
    // enumeração de usernames/e-mails existentes por tentativas repetidas).
    const limitKeys = [ipKey(ip)];
    if (rejectIfRateLimited(response, limitKeys)) return;
    noteAuthFailure(limitKeys, { ip });

    // Sanitize all inputs through asString so non-string values become "".
    const username = asString(body.username).trim();
    const password = asString(body.password);
    const email = asString(body.email).trim();
    const fullName = asString(body.fullName).trim();

    // Whitelist of error codes the client may receive. Any internal/unexpected
    // error is collapsed to "register_failed" so stack traces and unexpected
    // internal states never leak to the caller.
    const REGISTER_ALLOWED_ERRORS = new Set([
      "invalid",
      "username_taken",
      "email_taken",
      "username_too_short",
      "username_too_long",
      "invalid_username",
      "password_too_short",
      "password_too_long",
      "password_no_uppercase",
      "password_no_lowercase",
      "password_no_number",
      "password_no_special",
      "password_too_common",
      "password_same_as_username",
    ]);

    try {
      const created = await createUser(storageDir, {
        username,
        password,
        role: "member",
        email: email || undefined,
        fullName: fullName || undefined,
      });
      void logEvent(storageDir, {
        userId: created.id,
        username: created.username,
        action: "account_created",
        target: null,
        ip,
      });
      sendJson(response, 201, { user: created });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const code = REGISTER_ALLOWED_ERRORS.has(raw) ? raw : "register_failed";
      sendJson(response, 400, { error: code });
    }
    return;
  }

  // Consume a reset token and set a new password.
  if (
    url.pathname === "/api/auth/reset-password" &&
    request.method === "POST"
  ) {
    const ip = clientIp(request);
    const body = await readBody(request);
    const token = asString(body.token).trim();
    const password = asString(body.password);

    const limitKeys = [ipKey(ip)];
    if (rejectIfRateLimited(response, limitKeys)) return;

    if (!token || !password) {
      badRequest(response, "missing_fields");
      return;
    }

    const pwErr = validatePassword(password);
    if (pwErr) {
      badRequest(response, pwErr);
      return;
    }

    const userId = await validateResetToken(storageDir, token);
    if (!userId) {
      // Token inválido conta como falha: limita adivinhação de tokens por força bruta.
      noteAuthFailure(limitKeys, { ip });
      sendJson(response, 400, { error: "invalid_or_expired_token" });
      return;
    }

    await setPassword(storageDir, userId, password);
    await consumeResetToken(storageDir, token);
    // Revoke all active sessions so old sessions can't linger after a reset.
    await revokeAllForUser(storageDir, userId);

    const account = await findById(storageDir, userId);
    void logEvent(storageDir, {
      userId,
      username: account?.username ?? null,
      action: "password_reset_completed",
      target: null,
      ip: clientIp(request),
    });

    sendJson(response, 200, { ok: true });
    return;
  }

  // Drop the session: revoke it server-side AND clear the cookie.
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = sessionToken(request);
    if (token) await revokeSession(storageDir, token);
    clearSessionCookie(request, response);
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
      clearSessionCookie(request, response);
    }
    sendJson(response, 200, {
      authenticated: Boolean(current),
      user: current
        ? { id: current.id, username: current.username, role: current.role }
        : null,
    });
    return;
  }

  // ----- Account settings (authenticated user, self-service) -----

  // GET returns the current e-mail; PUT sets/clears it.
  if (url.pathname === "/api/account/email") {
    if (request.method === "GET") {
      sendJson(response, 200, { email: user.email ?? null });
      return;
    }
    if (request.method === "PUT") {
      const body = await readBody(request);
      const email = asString(body.email).trim();
      // Basic format check — a full RFC-5322 validator isn't worth the complexity here.
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        badRequest(response, "invalid_email");
        return;
      }
      await setEmail(storageDir, user.id, email || null);
      sendJson(response, 200, { ok: true, email: email || null });
      return;
    }
    notFound(response);
    return;
  }

  // Full profile of the authenticated user (read-only fields + linked providers).
  if (url.pathname === "/api/account/me" && request.method === "GET") {
    const full = await findById(storageDir, user.id);
    sendJson(response, 200, {
      id: user.id,
      username: user.username,
      fullName: full?.fullName ?? null,
      email: user.email ?? null,
      avatarUrl: full?.avatarRemoved
        ? null
        : (full?.avatarUrl ??
          full?.google?.picture ??
          full?.github?.avatar ??
          null),
      role: user.role,
      createdAt: full?.createdAt ?? null,
      linkedProviders: {
        google: Boolean(full?.google),
        github: Boolean(full?.github),
      },
    });
    return;
  }

  // Small profile payload for app chrome (navbar). Same avatar precedence as
  // /api/account/me, but without account/security details.
  if (url.pathname === "/api/account/profile" && request.method === "GET") {
    const full = await findById(storageDir, user.id);
    sendJson(response, 200, {
      fullName: full?.fullName ?? null,
      avatarUrl: full?.avatarRemoved
        ? null
        : (full?.avatarUrl ??
          full?.google?.picture ??
          full?.github?.avatar ??
          null),
    });
    return;
  }

  // Update own full name (no reauth — not security-sensitive).
  if (url.pathname === "/api/account/profile" && request.method === "PUT") {
    const body = await readBody(request);
    let fullName;
    if (Object.hasOwn(body, "fullName")) {
      fullName = asString(body.fullName).trim() || null;
      if (fullName && fullName.length > 120) {
        badRequest(response, "fullname_too_long");
        return;
      }
      await setFullName(storageDir, user.id, fullName);
    }

    let avatarUrl;
    if (Object.hasOwn(body, "avatarUrl")) {
      avatarUrl = asString(body.avatarUrl).trim() || null;
      if (!isValidAvatarUrl(avatarUrl)) {
        badRequest(response, "invalid_avatar");
        return;
      }
      await setAvatarUrl(storageDir, user.id, avatarUrl);
    }
    sendJson(response, 200, { ok: true, fullName, avatarUrl });
    return;
  }

  // Change own password (reauth required + rate-limited like login).
  if (url.pathname === "/api/account/password" && request.method === "PUT") {
    if (!requireRecentReauth(session, response)) return;
    const body = await readBody(request);
    const current = asString(body.current);
    const password = asString(body.password);

    const limitKeys = [ipKey(clientIp(request)), userKey(user.username)];
    if (rejectIfRateLimited(response, limitKeys)) return;

    const full = await findById(storageDir, user.id);
    if (!full) {
      notFound(response);
      return;
    }
    const valid = await verifyPassword(current, full.passwordHash);
    if (!valid) {
      noteAuthFailure(limitKeys, {
        userId: user.id,
        username: user.username,
        ip: clientIp(request),
      });
      badRequest(response, "invalid_current_password");
      return;
    }
    clearFailures(limitKeys);
    const pwErr = validatePassword(password, full.username);
    if (pwErr) {
      badRequest(response, pwErr);
      return;
    }
    await setPassword(storageDir, user.id, password);
    // A senha mudou: derruba toda sessão aberta em outros dispositivos. A sessão
    // atual sobrevive (foi ela que provou conhecer a senha nova via reauth).
    const revoked = await revokeAllForUser(
      storageDir,
      user.id,
      session.sessionId,
    );
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "password_changed",
      target: "self",
      ip: clientIp(request),
    });
    if (revoked > 0) {
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "sessions_revoked_all",
        target: `count:${revoked}`,
        ip: clientIp(request),
      });
    }
    sendJson(response, 200, { ok: true, revokedSessions: revoked });
    return;
  }

  // Change own username (reauth required).
  if (url.pathname === "/api/account/username" && request.method === "PUT") {
    if (!requireRecentReauth(session, response)) return;
    const body = await readBody(request);
    const username = asString(body.username).trim();
    try {
      await setUsername(storageDir, user.id, username);
    } catch (err) {
      badRequest(response, err instanceof Error ? err.message : "invalid");
      return;
    }
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "username_changed",
      target: username,
      ip: clientIp(request),
    });
    sendJson(response, 200, { ok: true, username });
    return;
  }

  // Delete own account (reauth required; last admin is blocked).
  if (url.pathname === "/api/account" && request.method === "DELETE") {
    if (!requireRecentReauth(session, response)) return;
    // O dono (superadmin) não pode apagar a própria conta — sumiria o único
    // acesso ao painel e não há como recriar o papel pela UI.
    if (isSuperadmin(user)) {
      badRequest(response, "cannot_delete_superadmin");
      return;
    }
    if (isAdmin(user)) {
      const allUsers = await listUsers(storageDir);
      if (allUsers.filter((u) => u.role === "admin").length <= 1) {
        badRequest(response, "last_admin");
        return;
      }
    }
    const removed = await deleteUser(storageDir, user.id);
    if (!removed) {
      notFound(response);
      return;
    }
    await revokeAllForUser(storageDir, user.id);
    clearSessionCookie(request, response);
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "account_deleted",
      target: "self",
      ip: clientIp(request),
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  // List own active sessions.
  if (url.pathname === "/api/account/sessions" && request.method === "GET") {
    const sessions = await listSessionsForUser(
      storageDir,
      user.id,
      session.sessionId,
    );
    sendJson(response, 200, { sessions });
    return;
  }

  // Revoke ALL own sessions except the current one ("sair dos outros
  // dispositivos") in a single atomic call, instead of N DELETEs do front.
  if (url.pathname === "/api/account/sessions" && request.method === "DELETE") {
    const revoked = await revokeAllForUser(
      storageDir,
      user.id,
      session.sessionId,
    );
    if (revoked > 0) {
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "sessions_revoked_all",
        target: `count:${revoked}`,
        ip: clientIp(request),
      });
    }
    sendJson(response, 200, { ok: true, revoked });
    return;
  }

  // Revoke a specific own session by ID.
  const ownSessionMatch = url.pathname.match(
    /^\/api\/account\/sessions\/([^/]+)$/,
  );
  if (ownSessionMatch && request.method === "DELETE") {
    const sid = decodeURIComponent(ownSessionMatch[1]);
    const userSessions = await listSessionsForUser(
      storageDir,
      user.id,
      session.sessionId,
    );
    if (!userSessions.some((s) => s.sessionId === sid)) {
      notFound(response);
      return;
    }
    await revokeSession(storageDir, sid);
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "session_revoked",
      target: "self",
      ip: clientIp(request),
    });
    sendJson(response, 200, { ok: true });
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
  if (
    url.pathname === "/api/account/2fa/disable" &&
    request.method === "POST"
  ) {
    if (!requireRecentReauth(session, response)) return;
    const body = await readBody(request);
    try {
      const ok = await disableTwoFactor(
        storageDir,
        user.id,
        asString(body.code),
      );
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

  // ----- Backup (superadmin only) -----
  // Full export of all groups and accounts (decrypted plaintext, so the backup
  // is actually usable) plus the user roster WITHOUT password hashes (restoring
  // people means re-setting their passwords; we don't ship hashes in a download).
  // Downloaded as a dated JSON attachment for the admin to store off-platform.
  if (url.pathname === "/api/admin/backup" && request.method === "GET") {
    if (!isSuperadmin(user)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (!requireRecentReauth(session, response)) return;
    const allVaults = await readAllVaults();
    const allGroups = allVaults.flatMap(({ db }) => db.groups);
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      users: await listUsers(storageDir), // id, username, role, createdAt (no hash)
      groups: allGroups,
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

  // ----- Users (superadmin only) -----

  if (url.pathname === "/api/users") {
    if (!isSuperadmin(user)) {
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
          email: body.email,
          fullName: body.fullName,
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
    if (!isSuperadmin(user)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    const targetId = decodeURIComponent(userMatch[1]);

    if (request.method === "DELETE") {
      // Removing an admin is privileged: require a recent re-auth. (Check the
      // target's role before deleting.)
      const target = await findById(storageDir, targetId);
      // O dono (superadmin) é intocável por qualquer admin. 404 mantém o painel
      // selado (não confirma que a conta-alvo é o superadmin).
      if (target?.role === "superadmin") {
        notFound(response);
        return;
      }
      if (target?.role === "admin" && !requireRecentReauth(session, response)) {
        return;
      }
      try {
        const removed = await deleteUser(storageDir, targetId);
        if (!removed) {
          notFound(response);
          return;
        }
        await purgeUserVault(targetId);
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
    if (!isSuperadmin(user)) {
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
    const pwErr = validatePassword(password);
    if (pwErr) {
      badRequest(response, pwErr);
      return;
    }
    const targetId = decodeURIComponent(userPwMatch[1]);
    const pwTarget = await findById(storageDir, targetId);
    // O dono é intocável por rotas de admin; ele gerencia a própria senha pelo
    // autosserviço. 404 mantém o painel selado.
    if (pwTarget?.role === "superadmin") {
      notFound(response);
      return;
    }
    const ok = await setPassword(storageDir, targetId, password);
    if (!ok) {
      notFound(response);
      return;
    }
    // Reset feito pelo admin: o dono da conta precisa logar de novo em TODOS os
    // dispositivos (inclusive onde quer que a senha antiga estivesse em uso).
    const revoked = await revokeAllForUser(storageDir, targetId);
    void logEvent(storageDir, {
      userId: user.id,
      username: user.username,
      action: "password_changed",
      target: `user:${targetId}`,
      ip: clientIp(request),
    });
    if (revoked > 0) {
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "sessions_revoked_all",
        target: `user:${targetId}`,
        ip: clientIp(request),
      });
    }
    sendJson(response, 200, { ok: true, revokedSessions: revoked });
    return;
  }

  // Superadmin force-resets another user's 2FA (safety net for someone locked
  // out of their authenticator and recovery codes). Superadmin only + reauth.
  const user2faResetMatch = url.pathname.match(
    /^\/api\/users\/([^/]+)\/2fa\/reset$/,
  );
  if (user2faResetMatch && request.method === "POST") {
    if (!isSuperadmin(user)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (!requireRecentReauth(session, response)) return;
    const targetId = decodeURIComponent(user2faResetMatch[1]);
    const twoFaTarget = await findById(storageDir, targetId);
    if (twoFaTarget?.role === "superadmin") {
      notFound(response);
      return;
    }
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
  // Superadmin only (same gate as the rest of /api/users) + recent re-auth (it
  // can lock people out, including the acting superadmin).
  const userSessionsMatch = url.pathname.match(
    /^\/api\/users\/([^/]+)\/sessions\/revoke$/,
  );
  if (userSessionsMatch && request.method === "POST") {
    if (!isSuperadmin(user)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (!requireRecentReauth(session, response)) return;
    const targetId = decodeURIComponent(userSessionsMatch[1]);
    const sessTarget = await findById(storageDir, targetId);
    if (sessTarget?.role === "superadmin") {
      notFound(response);
      return;
    }
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

  // ----- Sessions (superadmin: view & revoke) -----
  // Lets a superadmin see who is logged in and end specific sessions. The
  // requester's own session is flagged `current` so the UI can label
  // "this device".
  if (url.pathname === "/api/sessions" && request.method === "GET") {
    if (!isSuperadmin(user)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    const sessions = await listAllSessions(storageDir, sessionToken(request));
    sendJson(response, 200, { sessions });
    return;
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch && request.method === "DELETE") {
    if (!isSuperadmin(user)) {
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

  // ----- Audit trail (superadmin only) -----
  // The recent security-relevant events (who did what, when). No secrets.
  // Query params: limit (<=500), offset, action, username, from, to, q.
  if (url.pathname === "/api/audit" && request.method === "GET") {
    if (!isSuperadmin(user)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    const qp = url.searchParams;
    const limit = Math.min(Math.max(Number(qp.get("limit")) || 50, 1), 500);
    const offset = Math.max(Number(qp.get("offset")) || 0, 0);
    const { events, total } = await listEvents(storageDir, {
      limit,
      offset,
      action: qp.get("action") || undefined,
      username: qp.get("username") || undefined,
      from: qp.get("from") || undefined,
      to: qp.get("to") || undefined,
      q: qp.get("q") || undefined,
    });
    sendJson(response, 200, { events, total, limit, offset });
    return;
  }

  // ----- Painel superadmin (/admin) -----
  // SELADO. Toda rota deste namespace exige, em ordem: sessão válida (já
  // resolvida pelo dispatcher) + papel superadmin (senão 404, sem revelar que o
  // painel existe) + reauth recente. Aqui é SÓ LEITURA: as mutações (criar/editar
  // /apagar usuários, grupos, contas) reusam as rotas admin existentes, que o
  // superadmin herda; revelar uma senha passa pelo /secret auditado. Concentrar o
  // gate num único ponto evita que uma rota nova escape da proteção.
  if (url.pathname.startsWith("/api/admin-panel/")) {
    if (!requireSuperadmin(user, response)) return;
    if (!requireRecentReauth(session, response)) return;

    // Métricas e status do site para a aba "Visão geral".
    if (
      url.pathname === "/api/admin-panel/overview" &&
      request.method === "GET"
    ) {
      const allUsers = await listUsers(storageDir);
      const allVaults = await readAllVaults();
      const groups = allVaults.flatMap(({ db }) => db.groups);
      const accountCount = groups.reduce((n, g) => n + g.accounts.length, 0);
      const sessions = await listAllSessions(storageDir, sessionToken(request));
      const audit = await listEvents(storageDir, { limit: 500 });
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent24h = audit.events.filter(
        (e) => new Date(e.ts).getTime() >= dayAgo,
      ).length;

      sendJson(response, 200, {
        users: {
          total: allUsers.length,
          superadmins: allUsers.filter((u) => u.role === "superadmin").length,
          admins: allUsers.filter((u) => u.role === "admin").length,
          members: allUsers.filter((u) => u.role === "member").length,
          withTwoFactor: allUsers.filter((u) => u.twoFactorEnabled).length,
        },
        vaults: { groups: groups.length, accounts: accountCount },
        sessions: { active: sessions.length },
        audit: { total: audit.total, recent24h },
        system: {
          encryptionEnabled,
          registrationsOpen:
            process.env.CONTAS_FLOW_REGISTRATIONS_OPEN === "true",
          providers: {
            google: googleAuthConfigured(),
            github: githubAuthConfigured(),
          },
          serverLogs: recentLogs({ limit: 1 }).total,
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
        },
      });
      return;
    }

    // Navegador de dados armazenados para a aba "Dados". Usuários (sem hash/2FA
    // secret) + todos os cofres com as contas MASCARADAS (senha nunca sai daqui;
    // revelar é via /secret, sob reauth e auditado).
    if (url.pathname === "/api/admin-panel/data" && request.method === "GET") {
      const usersList = await listUsers(storageDir);
      const byId = new Map(usersList.map((u) => [u.id, u]));
      const allVaults = await readAllVaults();
      const vaults = allVaults.map(({ userId, db }) => ({
        userId,
        username: byId.get(userId)?.username ?? userId,
        role: byId.get(userId)?.role ?? "member",
        groups: db.groups.map((g) => ({
          id: g.id,
          name: g.name,
          ownerId: g.ownerId,
          accounts: g.accounts.map(maskAccount),
        })),
      }));
      sendJson(response, 200, { users: usersList, vaults });
      return;
    }

    // Logs operacionais do servidor (in-memory, voláteis) para a aba "Logs".
    if (url.pathname === "/api/admin-panel/logs" && request.method === "GET") {
      const qp = url.searchParams;
      sendJson(
        response,
        200,
        recentLogs({
          limit: Number(qp.get("limit")) || 200,
          level: qp.get("level") || undefined,
        }),
      );
      return;
    }

    notFound(response);
    return;
  }

  // ----- YouTube (OAuth + upload) -----

  // Begin OAuth: redirect the browser to Google's consent screen.
  // Generates a CSRF state cookie (same pattern as Google/GitHub OAuth).
  if (url.pathname === "/api/youtube/connect" && request.method === "GET") {
    const state = buildYoutubeOAuthState(user.id);
    setYoutubeOAuthStateCookie(request, response, state);
    try {
      response.writeHead(302, { Location: buildAuthUrl(state) });
      response.end();
    } catch (error) {
      clearYoutubeOAuthStateCookie(request, response);
      sendJson(response, 500, {
        error: "youtube_config",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    return;
  }

  // OAuth callback: validates CSRF state, exchanges code, saves the channel.
  if (url.pathname === "/api/youtube/callback" && request.method === "GET") {
    const expectedState = parseCookies(request)[YOUTUBE_OAUTH_STATE_COOKIE];
    const actualState = url.searchParams.get("state");
    clearYoutubeOAuthStateCookie(request, response);

    if (url.searchParams.get("error")) {
      redirect(response, "/?youtube=error");
      return;
    }

    if (!stateMatches(actualState, expectedState)) {
      redirect(response, "/?youtube=error");
      return;
    }

    const ownerId = youtubeOwnerFromState(expectedState);
    if (!ownerId || !(await findById(storageDir, ownerId))) {
      redirect(response, "/?youtube=error");
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      redirect(response, "/?youtube=error");
      return;
    }

    try {
      await handleOAuthCallback(code, ownerId);
      redirect(response, "/?youtube=connected");
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
    sendJson(response, 200, { channels: await listConnectedChannels(user.id) });
    return;
  }

  // Upload history (metadata only — the video itself is never stored).
  if (url.pathname === "/api/youtube/history" && request.method === "GET") {
    sendJson(response, 200, { items: await listUploadHistory(user.id) });
    return;
  }

  // List the video files staged for upload. Videos are far larger than the 1 MB
  // body cap, so the flow is: drop the file into this directory on the server,
  // then reference it by name in POST /api/youtube/upload.
  if (url.pathname === "/api/youtube/uploads" && request.method === "GET") {
    sendJson(response, 200, {
      directory: uploadsDirectory(user.id),
      files: await listUploadableFiles(user.id),
    });
    return;
  }

  // Browser upload: stream the raw request body straight to a staged file on the
  // server (bypasses the 1 MB JSON cap — videos are far larger). The original
  // file name comes in the X-Upload-Filename header (sanitized server-side). The
  // returned `name` is then passed to POST /api/youtube/upload to publish.
  if (url.pathname === "/api/youtube/uploads" && request.method === "POST") {
    try {
      let originalName = asString(request.headers["x-upload-filename"]);
      try {
        originalName = decodeURIComponent(originalName);
      } catch {
        /* keep raw if it isn't valid percent-encoding */
      }
      const staged = await stageUpload(originalName, request, user.id);
      sendJson(response, 200, staged);
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown";
      if (code === "file_too_large") {
        response.setHeader("Connection", "close");
        const source =
          MAX_STAGED_UPLOAD_BYTES < YOUTUBE_MAX_UPLOAD_BYTES
            ? "local"
            : "youtube";
        sendJson(response, 413, {
          error: "file_too_large",
          source,
          limitBytes: MAX_STAGED_UPLOAD_BYTES,
          message:
            source === "youtube"
              ? "O YouTube aceita videos de ate 256 GB."
              : "Este servidor esta configurado para aceitar videos menores que o limite do YouTube.",
          userMessage:
            source === "youtube"
              ? "O arquivo passou do tamanho maximo aceito pelo YouTube: 256 GB."
              : "O arquivo passou do limite configurado neste servidor. Use um arquivo menor ou aumente YOUTUBE_MAX_STAGING_BYTES.",
        });
      } else if (code === "invalid_file") {
        sendJson(response, 400, {
          error: "invalid_file",
          source: "local",
          message: "Nome de arquivo invalido.",
          userMessage: "Renomeie o arquivo usando apenas o nome, sem pastas.",
        });
      } else {
        recordLog("error", `youtube: falha ao receber upload (${code})`);
        sendJson(response, 500, {
          error: "upload_failed",
          source: "local",
          message: "Falha ao receber o arquivo.",
          userMessage:
            "Nao consegui preparar o video no servidor antes de enviar ao YouTube. Tente novamente.",
        });
      }
    }
    return;
  }

  // Upload (optionally scheduled via publishAt). The body carries only a bare
  // file NAME, which youtube.mjs resolves inside the uploads directory — never a
  // caller-supplied absolute path, so this can't be used to read arbitrary
  // files off the server (the reason the endpoint was previously disabled).
  if (url.pathname === "/api/youtube/upload" && request.method === "POST") {
    const body = await readBody(request);
    const file = typeof body.file === "string" ? body.file.trim() : "";
    const channelId =
      typeof body.channelId === "string" ? body.channelId.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!channelId || !file || !title) {
      sendJson(response, 400, {
        error: "invalid_request",
        message: "channelId, file e title são obrigatórios.",
      });
      return;
    }

    try {
      const result = await uploadVideo({
        ownerId: user.id,
        channelId,
        file,
        title,
        description:
          typeof body.description === "string" ? body.description : "",
        tags: Array.isArray(body.tags)
          ? body.tags.filter((tag) => typeof tag === "string")
          : [],
        publishAt:
          typeof body.publishAt === "string" && body.publishAt.trim()
            ? body.publishAt.trim()
            : undefined,
        privacyStatus:
          typeof body.privacyStatus === "string"
            ? body.privacyStatus.trim()
            : undefined,
      });
      recordLog(
        "info",
        `youtube: upload de "${result.title}" (${result.videoId})`,
      );
      sendJson(response, 200, result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown";
      if (code === "invalid_file") {
        sendJson(response, 400, {
          error: "invalid_file",
          message: "Nome de arquivo inválido (use só o nome, sem caminho).",
        });
      } else if (code === "file_not_found") {
        sendJson(response, 404, {
          error: "file_not_found",
          message: "Arquivo não encontrado na pasta de uploads do YouTube.",
        });
      } else if (code === "empty_file") {
        sendJson(response, 400, {
          error: "empty_file",
          source: "local",
          message: "Arquivo vazio.",
          userMessage:
            "O arquivo selecionado esta vazio. Escolha o video novamente.",
        });
      } else if (code === "youtube_file_too_large") {
        sendJson(response, 413, {
          error: "file_too_large",
          source: "youtube",
          limitBytes: YOUTUBE_MAX_UPLOAD_BYTES,
          message: "O YouTube aceita videos de ate 256 GB.",
          userMessage:
            "O arquivo passou do tamanho maximo aceito pelo YouTube: 256 GB.",
        });
      } else if (code === "channel_not_connected") {
        sendJson(response, 404, {
          error: "channel_not_connected",
          message: "Canal não conectado. Use /api/youtube/connect primeiro.",
        });
      } else if (code.startsWith("missing_env:")) {
        sendJson(response, 500, { error: "youtube_config", message: code });
      } else if (isYouTubeUploadError(error)) {
        const details = error.details ?? {};
        const status =
          Number.isFinite(details.status) &&
          details.status >= 400 &&
          details.status < 600
            ? details.status
            : 502;
        recordLog(
          "error",
          `youtube: upload recusado pelo YouTube (${details.reason || details.status || "unknown"})`,
        );
        sendJson(response, status, {
          error: "youtube_upload",
          ...details,
        });
      } else {
        recordLog("error", `youtube: falha no upload (${code})`);
        sendJson(response, 500, { error: "youtube_upload", message: code });
      }
    }
    return;
  }

  // DELETE /api/youtube/video — apaga o vídeo do YouTube e remove do histórico.
  if (url.pathname === "/api/youtube/video" && request.method === "DELETE") {
    const body = await readBody(request);
    const channelId =
      typeof body.channelId === "string" ? body.channelId.trim() : "";
    const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
    if (!channelId || !videoId) {
      sendJson(response, 400, {
        error: "invalid_request",
        message: "channelId e videoId são obrigatórios.",
      });
      return;
    }
    try {
      await deleteVideo(channelId, videoId, user.id);
      sendJson(response, 200, { ok: true });
    } catch (err) {
      const code = err?.message ?? "unknown";
      if (code === "channel_not_connected") {
        sendJson(response, 404, { error: "channel_not_connected" });
      } else {
        recordLog(
          "error",
          `youtube: falha ao deletar vídeo ${videoId} (${code})`,
        );
        sendJson(response, 500, { error: "youtube_delete", message: code });
      }
    }
    return;
  }

  // PATCH /api/youtube/video — edita título/descrição/privacidade de um vídeo
  // já postado e reflete no histórico.
  if (url.pathname === "/api/youtube/video" && request.method === "PATCH") {
    const body = await readBody(request);
    const channelId =
      typeof body.channelId === "string" ? body.channelId.trim() : "";
    const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
    if (!channelId || !videoId) {
      sendJson(response, 400, {
        error: "invalid_request",
        message: "channelId e videoId são obrigatórios.",
      });
      return;
    }
    try {
      const result = await updateVideo({
        channelId,
        videoId,
        ownerId: user.id,
        title: typeof body.title === "string" ? body.title : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        privacyStatus:
          typeof body.privacyStatus === "string"
            ? body.privacyStatus.trim()
            : undefined,
      });
      sendJson(response, 200, result);
    } catch (err) {
      const code = err?.message ?? "unknown";
      if (code === "channel_not_connected") {
        sendJson(response, 404, { error: "channel_not_connected" });
      } else if (code === "video_not_found") {
        sendJson(response, 404, { error: "video_not_found" });
      } else {
        recordLog(
          "error",
          `youtube: falha ao editar vídeo ${videoId} (${code})`,
        );
        sendJson(response, 500, { error: "youtube_update", message: code });
      }
    }
    return;
  }

  // ----- Groups -----
  // Every group route is vault-scoped: each user's groups live in their own
  // vaults/{userId}.json. The caller only looks in their own vault. A group the
  // caller can't reach is reported as 404 to avoid leaking whether it exists.

  // Resolves the current user's vault and group entry for a given group ID.
  // Returns { db, index, vaultUserId } or writes 404 and returns null.
  async function resolveGroupEntry(rawGroupId) {
    const groupId = decodeURIComponent(rawGroupId);
    const db = await readVault(user.id);
    const index = db.groups.findIndex((g) => g.id === groupId);
    if (index === -1) {
      notFound(response);
      return null;
    }
    return { db, index, vaultUserId: user.id };
  }

  // Global search across all groups. Returns up to 40 masked accounts with
  // their groupId and groupName so the client can navigate directly.
  if (url.pathname === "/api/search" && request.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) {
      sendJson(response, 200, { results: [] });
      return;
    }
    const db = await readVault(user.id);
    const results = [];
    for (const group of db.groups) {
      for (const account of group.accounts) {
        const hay = [
          account.name,
          account.username,
          account.email,
          account.url,
          account.role,
          account.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (hay.includes(q)) {
          results.push({
            ...maskAccount(account),
            groupId: group.id,
            groupName: group.name,
          });
        }
      }
    }
    sendJson(response, 200, { results: results.slice(0, 40) });
    return;
  }

  if (url.pathname === "/api/groups" && request.method === "GET") {
    const db = await readVault(user.id);
    // Primeiro acesso: cria grupo padrão automaticamente.
    if (db.groups.length === 0) {
      const defaultGroup = normalizeGroup({
        name: "Geral",
        ownerId: user.id,
        accounts: [],
      });
      db.groups.push(defaultGroup);
      await writeVault(user.id, db);
    }
    sendJson(response, 200, { groups: db.groups.map(groupSummary) });
    return;
  }

  if (url.pathname === "/api/groups" && request.method === "POST") {
    const body = await readBody(request);
    const db = await readVault(user.id);
    const group = normalizeGroup({
      name: asString(body.name).trim() || "Novo grupo",
      ownerId: user.id,
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
    });
    db.groups.push(group);
    await writeVault(user.id, db);
    sendJson(response, 201, groupSummary(group));
    return;
  }

  const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch) {
    const entry = await resolveGroupEntry(groupMatch[1]);
    if (!entry) return;
    const { db, index, vaultUserId } = entry;

    if (request.method === "PUT") {
      const body = await readBody(request);
      const name = asString(body.name).trim();
      if (!name) {
        badRequest(response, "name_required");
        return;
      }
      db.groups[index] = { ...db.groups[index], name };
      await writeVault(vaultUserId, db);
      sendJson(response, 200, groupSummary(db.groups[index]));
      return;
    }

    if (request.method === "DELETE") {
      if (!requireRecentReauth(session, response)) return;
      const deletedId = db.groups[index].id;
      db.groups.splice(index, 1);
      await writeVault(vaultUserId, db);
      void logEvent(storageDir, {
        userId: user.id,
        username: user.username,
        action: "group_deleted",
        target: `group:${deletedId}`,
        ip: clientIp(request),
      });
      sendJson(response, 200, { groups: db.groups.map(groupSummary) });
      return;
    }

    notFound(response);
    return;
  }

  // ----- Accounts within a group -----

  const accountsMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts$/,
  );
  if (accountsMatch) {
    const entry = await resolveGroupEntry(accountsMatch[1]);
    if (!entry) return;
    const { db, index, vaultUserId } = entry;
    const group = db.groups[index];

    if (request.method === "GET") {
      sendJson(response, 200, group.accounts.map(maskAccount));
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const account = normalizeRecord(body);
      group.accounts.unshift(account);
      await writeVault(vaultUserId, db);
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
    const entry = await resolveGroupEntry(importMatch[1]);
    if (!entry) return;
    // Importar substitui TODAS as contas do grupo (destrutivo), então exige
    // reauth recente como as outras ações que apagam dados (deletar grupo, ver
    // segredo).
    if (!requireRecentReauth(session, response)) return;
    const { db, index, vaultUserId } = entry;
    const group = db.groups[index];

    const imported = Array.isArray(body) ? body : body.accounts;
    group.accounts = Array.isArray(imported)
      ? imported.map((record) => normalizeRecord(record))
      : [];

    await writeVault(vaultUserId, db);
    sendJson(response, 200, group.accounts.map(maskAccount));
    return;
  }

  // Fetch ONE account's password in clear text, on demand. Vault-scoped and
  // gated by a recent re-auth; the reveal/copy is recorded in the audit trail.
  const secretMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts\/([^/]+)\/secret$/,
  );
  if (secretMatch && request.method === "GET") {
    const entry = await resolveGroupEntry(secretMatch[1]);
    if (!entry) return;
    if (!requireRecentReauth(session, response)) return;
    const { db, index } = entry;
    const group = db.groups[index];

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
    const entry = await resolveGroupEntry(accountMatch[1]);
    if (!entry) return;
    const { db, index, vaultUserId } = entry;
    const group = db.groups[index];

    const accountId = decodeURIComponent(accountMatch[2]);
    const accountIndex = group.accounts.findIndex(
      (account) => account.id === accountId,
    );

    if (accountIndex === -1) {
      notFound(response);
      return;
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      const existing = group.accounts[accountIndex];
      if (
        requiresAccountUpdateReauth(body, existing) &&
        !requireRecentReauth(session, response)
      ) {
        return;
      }
      // The listing sends the password masked (""), so an edit that didn't touch
      // it would otherwise wipe the stored password. Treat an empty incoming
      // password as "unchanged" and keep the existing one.
      const incomingPassword = asString(body.password);
      const merged =
        incomingPassword === ""
          ? { ...body, password: existing.password }
          : body;
      const updated = normalizeRecord(merged, existing);
      group.accounts[accountIndex] = updated;
      await writeVault(vaultUserId, db);
      sendJson(response, 200, maskAccount(updated));
      return;
    }

    if (request.method === "DELETE") {
      // Excluir conta de rede social do cofre NÃO exige reauth (item do
      // gerenciador, não a conta do usuário). A confirmação no front já basta.
      group.accounts.splice(accountIndex, 1);
      await writeVault(vaultUserId, db);
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
    // Sem segredos: só a classe do erro, para a aba de logs do painel. Detalhes
    // completos ficam no stdout do host (console.error acima).
    recordLog(
      "error",
      `500 ${request.method} ${request.url} — ${error instanceof Error ? error.name : "erro"}`,
    );
    sendJson(response, 500, { error: "server_error" });
  }
});

// Startup: try to connect to PostgreSQL (DATABASE_URL). Falls back to JSON
// storage automatically when the env var is absent or the connection fails.
await initDb();

// Startup: seed the bootstrap admin from APP_AUTH_* if the user store is empty,
// then migrate any legacy groups.json into per-user vault files. On subsequent
// boots the migration is a fast no-op (vault files already exist).
const seededUsers = await ensureSeedAdmin(storageDir);
const seedAdmin = seededUsers.find((item) => item.role === "admin" || item.role === "superadmin");
await migrateGroupsToVaults(seedAdmin?.id);

// Make sure the YouTube uploads staging directory exists so the user has a
// place to drop videos before calling POST /api/youtube/upload.
await ensureUploadsDir();

// Promote the owner account to "superadmin" (the only door to the /admin panel).
// Identified by CONTAS_FLOW_SUPERADMIN_EMAIL / _USER. No-op when unset or when
// the account doesn't exist yet.
const superadmin = await ensureSuperadmin(storageDir);
const superadminPasswordReset =
  await resetSuperadminPasswordFromEnv(storageDir);
if (superadminPasswordReset?.owner && !superadminPasswordReset.error) {
  await revokeAllForUser(storageDir, superadminPasswordReset.owner.id);
  recordLog(
    "warn",
    `senha do superadmin redefinida via env: ${superadminPasswordReset.owner.username}`,
  );
} else if (superadminPasswordReset?.error) {
  console.log(
    `AVISO: CONTAS_FLOW_SUPERADMIN_PASSWORD nao aplicada (${superadminPasswordReset.error}).`,
  );
  recordLog(
    "warn",
    `senha do superadmin via env nao aplicada: ${superadminPasswordReset.error}`,
  );
}
const ownerCleanup = await keepOnlySuperadmin(storageDir);
if (ownerCleanup?.removed?.length) {
  for (const removed of ownerCleanup.removed) {
    await revokeAllForUser(storageDir, removed.id);
  }
  recordLog(
    "warn",
    `limpeza single-owner removeu ${ownerCleanup.removed.length} usuario(s)`,
  );
}

// If encryption is on and using JSON storage, proactively re-encrypt all vault
// files so any pre-existing plaintext secrets get encrypted now. With PostgreSQL,
// encryption happens at write time in writeVault — no need to re-encrypt on boot.
if (encryptionEnabled && !isConnected()) {
  const allUsers = await listUsers(storageDir);
  for (const u of allUsers) {
    await writeVault(u.id, await readVault(u.id));
  }
}

// Drop revoked/expired sessions at startup, then periodically, so sessions.json
// doesn't accumulate dead records. unref() keeps the timer from holding the
// process open.
await pruneResetTokens(storageDir);
await pruneSessions(storageDir);
setInterval(() => {
  void pruneSessions(storageDir);
}, SESSION_IDLE_MS).unref();

server.listen(port, host, () => {
  console.log(`Contas API: listening on ${host}:${port}`);
  recordLog("info", `servidor no ar em ${host}:${port}`);
  if (seededUsers.length === 0) {
    console.log(
      "AVISO: nenhum usuario cadastrado. Defina APP_AUTH_USER e APP_AUTH_PASSWORD " +
        "para criar o admin inicial; depois gerencie a equipe pela UI.",
    );
  }
  if (superadmin) {
    console.log(`Superadmin (painel /admin): ${superadmin.username}`);
    recordLog("info", `superadmin ativo: ${superadmin.username}`);
  } else if (
    process.env.CONTAS_FLOW_SUPERADMIN_EMAIL ||
    process.env.CONTAS_FLOW_SUPERADMIN_USER
  ) {
    console.log(
      "AVISO: CONTAS_FLOW_SUPERADMIN_* setado, mas a conta dona ainda nao existe. " +
        "Crie/loge a conta uma vez e reinicie para promove-la a superadmin.",
    );
    recordLog("warn", "superadmin configurado mas conta dona ainda nao existe");
  } else {
    console.log(
      "AVISO: painel /admin desativado — defina CONTAS_FLOW_SUPERADMIN_EMAIL " +
        "(ou _USER) para habilitar o superadmin.",
    );
  }
  if (!encryptionEnabled) {
    console.log(
      "AVISO: criptografia em repouso DESATIVADA (senhas ficam em texto plano). " +
        "Defina CONTAS_FLOW_ENC_KEY (32 bytes em hex/base64) em producao.",
    );
    recordLog("warn", "criptografia em repouso DESATIVADA");
  }
});
