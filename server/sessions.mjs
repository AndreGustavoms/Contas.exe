// Server-side session store. The session cookie carries an opaque token; the
// real session state lives here, on disk, so sessions survive a redeploy and —
// crucially — can be revoked server-side (an admin "log out this device" or
// "log out everywhere" actually invalidates the token, not just the client UI).
//
// Two independent expirations are enforced (OWASP session management):
//   - IDLE: SESSION_IDLE_MS since the last real activity (lastSeenAt). A tab left
//     open in the background does NOT renew this on its own — only an authenticated
//     request bumps lastSeenAt (see touchSession), and the client must not poll.
//   - ABSOLUTE: SESSION_ABSOLUTE_MS since login (expiresAt). This ceiling never
//     extends, so even daily use forces a fresh login after 3 days.
//
// Storage: PostgreSQL in production and multi-instance deployments. The
// explicit local fallback keeps storage/sessions.json (git-ignored via
// storage/*), with the same encryption guarantees for identifying metadata.
// The raw IP is only ever surfaced in the admin panels (see publicSession's
// includeIp).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import geoip from "fast-geoip";
import { decryptField, encryptField } from "./crypto.mjs";
import { isConnected, query } from "./db.mjs";
import { hashIp } from "./ip-hash.mjs";

export const SESSION_IDLE_MS = 3 * 60 * 60 * 1000; // 3h sem uso = logout
export const SESSION_ABSOLUTE_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias = relogar
// How long a successful re-auth (typing the password again) unlocks the critical
// actions — reveal/copy a stored password, export a backup, change passwords,
// create/remove an admin, delete a group. Short window: confirm once, act for a
// few minutes, then it expires.
export const REAUTH_WINDOW_MS = 5 * 60 * 1000; // 5 min

// --- Write serialization ---
// Every mutating op is read-modify-write on sessions.json with awaits in between.
// Node is single-threaded but async, so two concurrent requests could both read,
// both mutate their own copy, and both write — last writer wins, silently losing
// a just-created session or resurrecting a just-revoked one. We serialize all
// session access through a single in-process promise chain so each critical
// section sees the previous one's committed state. (Single instance only; that's
// the current deployment model.)
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  // Keep the chain alive even if fn rejects, but don't swallow the result for
  // the caller (they await `run`).
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// --- Store ---

function sessionStoreFile(storageDir) {
  return (
    process.env.CONTAS_FLOW_SESSIONS_DB ?? join(storageDir, "sessions.json")
  );
}

async function readSessionsFile(storageDir) {
  try {
    const raw = await readFile(sessionStoreFile(storageDir), "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    // Decrypt the at-rest metadata so callers work with plaintext in memory.
    return list.map((session) => ({
      ...session,
      ipHash:
        session.ipHash != null ? decryptField(session.ipHash) : session.ipHash,
      userAgent:
        session.userAgent != null
          ? decryptField(session.userAgent)
          : session.userAgent,
      location:
        session.location != null
          ? decryptField(session.location)
          : session.location,
      ip: session.ip != null ? decryptField(session.ip) : session.ip,
    }));
  } catch {
    return [];
  }
}

async function writeSessionsFile(storageDir, sessions) {
  await mkdir(storageDir, { recursive: true });
  // Encrypt the user-identifying metadata on the way out (idempotent, like the
  // vault), keeping the in-memory copies plaintext for the caller.
  const encrypted = sessions.map((session) => ({
    ...session,
    ipHash:
      session.ipHash != null ? encryptField(session.ipHash) : session.ipHash,
    userAgent:
      session.userAgent != null
        ? encryptField(session.userAgent)
        : session.userAgent,
    location:
      session.location != null
        ? encryptField(session.location)
        : session.location,
    ip: session.ip != null ? encryptField(session.ip) : session.ip,
  }));
  await writeFile(
    sessionStoreFile(storageDir),
    `${JSON.stringify({ sessions: encrypted }, null, 2)}\n`,
    "utf8",
  );
}

// Truncate the user-agent for display and to bound stored size.
function clampUserAgent(userAgent) {
  return typeof userAgent === "string" ? userAgent.slice(0, 256) : "";
}

// --- Approximate location ---
// We deliberately keep the no-raw-IP principle: the IP is used ONCE, at login, to
// derive an approximate "City, CC" string (offline GeoIP), and only that coarse
// string is stored (encrypted at rest). The raw IP is never persisted.

// Private/loopback ranges carry no useful geo — skip the lookup for them.
function isPrivateIp(ip) {
  const v4 = ip.replace(/^::ffff:/i, "");
  return (
    ip === "::1" ||
    v4.startsWith("127.") ||
    v4.startsWith("10.") ||
    v4.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^(fe80:|fc00:|fd)/i.test(ip)
  );
}

async function resolveLocation(ip) {
  if (!ip || typeof ip !== "string" || ip === "unknown") return null;
  if (isPrivateIp(ip)) return null;
  try {
    const geo = await geoip.lookup(ip.replace(/^::ffff:/i, ""));
    if (!geo) return null;
    const city = typeof geo.city === "string" ? geo.city.trim() : "";
    const region = typeof geo.region === "string" ? geo.region.trim() : "";
    const country = typeof geo.country === "string" ? geo.country.trim() : "";
    // Preferimos "Cidade, Estado" (o que aparece nos dispositivos do usuário).
    if (city && region) return `${city}, ${region}`;
    if (city && country) return `${city}, ${country}`;
    if (region && country) return `${region}, ${country}`;
    return country || null;
  } catch {
    return null;
  }
}

// Normaliza o IP para armazenamento (admin-only): remove o prefixo IPv4-mapped e
// limita o tamanho. NUNCA é exposto para o proprio usuário, so nos paineis de admin.
function clampIp(ip) {
  if (typeof ip !== "string" || !ip || ip === "unknown") return null;
  return ip.replace(/^::ffff:/i, "").slice(0, 64);
}

// --- Expiration helpers ---

// A session is dead if revoked, past its absolute ceiling, or idle for too long.
function isExpired(session, now = Date.now()) {
  if (session.revokedAt) return true;
  if (now > session.expiresAt) return true;
  if (now - session.lastSeenAt > SESSION_IDLE_MS) return true;
  return false;
}

// Whether this session re-authenticated within the last REAUTH_WINDOW_MS. Pure
// check on a session already resolved by resolveAndTouch (which carries reauthAt).
export function hasRecentReauth(session, now = Date.now()) {
  return (
    Boolean(session?.reauthAt) && now - session.reauthAt <= REAUTH_WINDOW_MS
  );
}

// Public view of a session. The raw IP is included ONLY when includeIp is set
// (admin panels). The user's own device list never receives it.
function publicSession(session, currentSessionId, { includeIp = false } = {}) {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    userAgent: session.userAgent ?? "",
    location: session.location ?? null,
    ...(includeIp ? { ip: session.ip ?? null } : {}),
    current: session.sessionId === currentSessionId,
  };
}

// --- High-level operations ---

// Creates a session and returns its opaque token (sessionId). The token uses the
// same hard-to-guess shape as before (two UUIDs concatenated).
export async function createSession(storageDir, { userId, ip, userAgent }) {
  const now = Date.now();
  const sessionId = randomUUID() + randomUUID().replaceAll("-", "");
  const location = await resolveLocation(ip);
  const ua = clampUserAgent(userAgent);
  const rawIp = clampIp(ip);
  const ipHash = hashIp(ip);

  if (isConnected()) {
    await query(
      `INSERT INTO sessions (session_id, user_id, created_at, last_seen_at, expires_at,
       ip_enc, ip_hash, user_agent_enc, location_enc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sessionId,
        userId,
        now,
        now,
        now + SESSION_ABSOLUTE_MS,
        rawIp ? encryptField(rawIp) : null,
        ipHash,
        ua ? encryptField(ua) : null,
        location ? encryptField(location) : null,
      ],
    );
    return sessionId;
  }

  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const session = {
      sessionId,
      userId,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: now,
      expiresAt: now + SESSION_ABSOLUTE_MS,
      userAgent: ua,
      location,
      ip: rawIp,
      ipHash,
      revokedAt: null,
      reauthAt: null,
    };
    const pruned = sessions.filter((item) => !isExpired(item, now));
    pruned.push(session);
    await writeSessionsFile(storageDir, pruned);
    return sessionId;
  });
}

// Resolves a token to its live session and, if valid, renews lastSeenAt — all in
// ONE serialized read-modify-write so a concurrent revoke can't be lost (and a
// just-revoked session can't be resurrected by a stale touch). Returns the
// session (with the bumped lastSeenAt) or null if missing/revoked/expired.
//
// Every authenticated request goes through here, so this is what counts as "real
// activity"; an idle tab does NOT renew (the client must not poll). The absolute
// ceiling (expiresAt) is intentionally never extended. Expired sessions are
// marked revoked (lazy cleanup) so the token can't be reused.
export function resolveAndTouch(storageDir, sessionId) {
  if (!sessionId) return Promise.resolve(null);

  if (isConnected()) {
    return (async () => {
      const now = Date.now();
      const result = await query(
        `SELECT session_id AS "sessionId", user_id AS "userId",
         created_at AS "createdAt", last_seen_at AS "lastSeenAt",
         expires_at AS "expiresAt", revoked_at AS "revokedAt", reauth_at AS "reauthAt",
         ip_enc, ip_hash AS "ipHash", user_agent_enc, location_enc
         FROM sessions WHERE session_id = $1`,
        [sessionId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      const session = {
        sessionId: row.sessionId,
        userId: row.userId,
        createdAt: row.createdAt,
        lastSeenAt: Number(row.lastSeenAt),
        expiresAt: Number(row.expiresAt),
        revokedAt: row.revokedAt ?? null,
        reauthAt: row.reauthAt ? Number(row.reauthAt) : null,
        ip: row.ip_enc ? decryptField(row.ip_enc) : null,
        ipHash: row.ipHash,
        userAgent: row.user_agent_enc ? decryptField(row.user_agent_enc) : "",
        location: row.location_enc ? decryptField(row.location_enc) : null,
      };

      if (isExpired(session, now)) {
        if (!session.revokedAt) {
          await query(
            "UPDATE sessions SET revoked_at = NOW() WHERE session_id = $1",
            [sessionId],
          );
        }
        return null;
      }

      await query(
        "UPDATE sessions SET last_seen_at = $1 WHERE session_id = $2",
        [now, sessionId],
      );
      session.lastSeenAt = now;
      return session;
    })();
  }

  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session) return null;
    const now = Date.now();
    if (isExpired(session, now)) {
      if (!session.revokedAt) {
        session.revokedAt = new Date(now).toISOString();
        await writeSessionsFile(storageDir, sessions);
      }
      return null;
    }
    session.lastSeenAt = now;
    await writeSessionsFile(storageDir, sessions);
    return session;
  });
}

// Records a successful re-authentication (the user re-typed their password),
// unlocking critical actions for REAUTH_WINDOW_MS. Serialized like the other
// writers. No-ops on an invalid/expired session. Returns true if it marked one.
export function markReauth(storageDir, sessionId) {
  if (!sessionId) return Promise.resolve(false);

  if (isConnected()) {
    return (async () => {
      const now = Date.now();
      const res = await query(
        `UPDATE sessions SET reauth_at = $1
         WHERE session_id = $2 AND revoked_at IS NULL AND expires_at > $3
           AND last_seen_at > $4
         RETURNING session_id`,
        [now, sessionId, now, now - SESSION_IDLE_MS],
      );
      return res.rowCount > 0;
    })();
  }

  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session || isExpired(session)) return false;
    session.reauthAt = Date.now();
    await writeSessionsFile(storageDir, sessions);
    return true;
  });
}

export function revokeSession(storageDir, sessionId) {
  if (!sessionId) return Promise.resolve(false);

  if (isConnected()) {
    return query(
      "UPDATE sessions SET revoked_at = NOW() WHERE session_id = $1 AND revoked_at IS NULL RETURNING session_id",
      [sessionId],
    ).then((r) => r.rowCount > 0);
  }

  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session || session.revokedAt) return false;
    session.revokedAt = new Date().toISOString();
    await writeSessionsFile(storageDir, sessions);
    return true;
  });
}

export function revokeAllForUser(storageDir, userId, exceptSessionId = null) {
  if (isConnected()) {
    if (exceptSessionId) {
      return query(
        "UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND session_id != $2 AND revoked_at IS NULL",
        [userId, exceptSessionId],
      ).then((r) => r.rowCount);
    }
    return query(
      "UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    ).then((r) => r.rowCount);
  }

  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const now = new Date().toISOString();
    let count = 0;
    for (const session of sessions) {
      if (
        session.userId === userId &&
        !session.revokedAt &&
        session.sessionId !== exceptSessionId
      ) {
        session.revokedAt = now;
        count += 1;
      }
    }
    if (count > 0) await writeSessionsFile(storageDir, sessions);
    return count;
  });
}

function rowToSession(row) {
  return {
    sessionId: row.sessionId ?? row.session_id,
    userId: row.userId ?? row.user_id,
    createdAt: row.createdAt ?? row.created_at,
    lastSeenAt: Number(row.lastSeenAt ?? row.last_seen_at),
    expiresAt: Number(row.expiresAt ?? row.expires_at),
    revokedAt: row.revokedAt ?? row.revoked_at ?? null,
    reauthAt:
      (row.reauthAt ?? row.reauth_at)
        ? Number(row.reauthAt ?? row.reauth_at)
        : null,
    userAgent: row.user_agent_enc
      ? decryptField(row.user_agent_enc)
      : (row.userAgent ?? ""),
    location: row.location_enc
      ? decryptField(row.location_enc)
      : (row.location ?? null),
    ip: row.ip_enc ? decryptField(row.ip_enc) : (row.ip ?? null),
    ipHash: row.ipHash ?? row.ip_hash,
  };
}

export async function listSessionsForUser(
  storageDir,
  userId,
  currentSessionId,
) {
  if (isConnected()) {
    const now = Date.now();
    const result = await query(
      `SELECT session_id AS "sessionId", user_id AS "userId",
       created_at AS "createdAt", last_seen_at AS "lastSeenAt",
       expires_at AS "expiresAt", revoked_at AS "revokedAt", reauth_at AS "reauthAt",
       user_agent_enc, location_enc
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 AND last_seen_at > $3`,
      [userId, now, now - SESSION_IDLE_MS],
    );
    return result.rows.map((row) =>
      publicSession(rowToSession(row), currentSessionId),
    );
  }

  const sessions = await readSessionsFile(storageDir);
  const now = Date.now();
  return sessions
    .filter((item) => item.userId === userId && !isExpired(item, now))
    .map((item) => publicSession(item, currentSessionId));
}

export async function listAllSessions(storageDir, currentSessionId) {
  if (isConnected()) {
    const now = Date.now();
    const result = await query(
      `SELECT session_id AS "sessionId", user_id AS "userId",
       created_at AS "createdAt", last_seen_at AS "lastSeenAt",
       expires_at AS "expiresAt", revoked_at AS "revokedAt", reauth_at AS "reauthAt",
       ip_enc, ip_hash AS "ipHash", user_agent_enc, location_enc
       FROM sessions
       WHERE revoked_at IS NULL AND expires_at > $1 AND last_seen_at > $2`,
      [now, now - SESSION_IDLE_MS],
    );
    return result.rows.map((row) =>
      publicSession(rowToSession(row), currentSessionId, { includeIp: true }),
    );
  }

  const sessions = await readSessionsFile(storageDir);
  const now = Date.now();
  return sessions
    .filter((item) => !isExpired(item, now))
    .map((item) => publicSession(item, currentSessionId, { includeIp: true }));
}

export function pruneSessions(storageDir) {
  if (isConnected()) {
    const now = Date.now();
    return query(
      "DELETE FROM sessions WHERE revoked_at IS NOT NULL OR expires_at < $1 OR last_seen_at < $2",
      [now, now - SESSION_IDLE_MS],
    ).then((r) => r.rowCount);
  }

  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const now = Date.now();
    const kept = sessions.filter((item) => !isExpired(item, now));
    if (kept.length !== sessions.length)
      await writeSessionsFile(storageDir, kept);
    return sessions.length - kept.length;
  });
}
