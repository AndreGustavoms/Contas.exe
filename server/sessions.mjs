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
// Storage: storage/sessions.json (git-ignored via storage/*), same shape/idioms
// as users.json. The user-identifying metadata (ipHash, userAgent) is encrypted
// at rest with the same crypto.mjs used for the vault, so a leaked file doesn't
// reveal who connected from where.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { decryptField, encryptField } from "./crypto.mjs";

export const SESSION_IDLE_MS = 3 * 60 * 60 * 1000; // 3h sem uso = logout
export const SESSION_ABSOLUTE_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias = relogar

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
  return process.env.CONTAS_FLOW_SESSIONS_DB ?? join(storageDir, "sessions.json");
}

async function readSessionsFile(storageDir) {
  try {
    const raw = await readFile(sessionStoreFile(storageDir), "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    // Decrypt the at-rest metadata so callers work with plaintext in memory.
    return list.map((session) => ({
      ...session,
      ipHash: session.ipHash != null ? decryptField(session.ipHash) : session.ipHash,
      userAgent:
        session.userAgent != null ? decryptField(session.userAgent) : session.userAgent,
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
    ipHash: session.ipHash != null ? encryptField(session.ipHash) : session.ipHash,
    userAgent:
      session.userAgent != null ? encryptField(session.userAgent) : session.userAgent,
  }));
  await writeFile(
    sessionStoreFile(storageDir),
    `${JSON.stringify({ sessions: encrypted }, null, 2)}\n`,
    "utf8",
  );
}

// SHA-256 of the client IP. We never store the raw IP: it's only needed to tell
// sessions apart in the admin panel, and a hash is enough for that.
function hashIp(ip) {
  return createHash("sha256")
    .update(String(ip ?? "unknown"))
    .digest("hex");
}

// Truncate the user-agent for display and to bound stored size.
function clampUserAgent(userAgent) {
  return typeof userAgent === "string" ? userAgent.slice(0, 256) : "";
}

// --- Expiration helpers ---

// A session is dead if revoked, past its absolute ceiling, or idle for too long.
function isExpired(session, now = Date.now()) {
  if (session.revokedAt) return true;
  if (now > session.expiresAt) return true;
  if (now - session.lastSeenAt > SESSION_IDLE_MS) return true;
  return false;
}

// Public view of a session for the admin panel (no ipHash, no raw metadata leak).
function publicSession(session, currentSessionId) {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    userAgent: session.userAgent ?? "",
    current: session.sessionId === currentSessionId,
  };
}

// --- High-level operations ---

// Creates a session and returns its opaque token (sessionId). The token uses the
// same hard-to-guess shape as before (two UUIDs concatenated).
export function createSession(storageDir, { userId, ip, userAgent }) {
  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const now = Date.now();
    const sessionId = randomUUID() + randomUUID().replaceAll("-", "");
    const session = {
      sessionId,
      userId,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: now,
      expiresAt: now + SESSION_ABSOLUTE_MS,
      userAgent: clampUserAgent(userAgent),
      ipHash: hashIp(ip),
      revokedAt: null,
    };
    // Opportunistically drop dead sessions so the file can't grow unbounded.
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

// Revokes a single session (logout, or admin "end this device"). Returns true if
// a matching, not-yet-revoked session existed.
export function revokeSession(storageDir, sessionId) {
  if (!sessionId) return Promise.resolve(false);
  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session || session.revokedAt) return false;
    session.revokedAt = new Date().toISOString();
    await writeSessionsFile(storageDir, sessions);
    return true;
  });
}

// Revokes every active session of a user ("log out of all devices"). Returns the
// number of sessions revoked.
export function revokeAllForUser(storageDir, userId) {
  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const now = new Date().toISOString();
    let count = 0;
    for (const session of sessions) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = now;
        count += 1;
      }
    }
    if (count > 0) await writeSessionsFile(storageDir, sessions);
    return count;
  });
}

// Lists the active (non-expired) sessions of one user. currentSessionId flags the
// requester's own session in the result.
export async function listSessionsForUser(storageDir, userId, currentSessionId) {
  const sessions = await readSessionsFile(storageDir);
  const now = Date.now();
  return sessions
    .filter((item) => item.userId === userId && !isExpired(item, now))
    .map((item) => publicSession(item, currentSessionId));
}

// Lists every active (non-expired) session across all users (admin view).
export async function listAllSessions(storageDir, currentSessionId) {
  const sessions = await readSessionsFile(storageDir);
  const now = Date.now();
  return sessions
    .filter((item) => !isExpired(item, now))
    .map((item) => publicSession(item, currentSessionId));
}

// Permanently removes sessions that are revoked or expired. Called at startup and
// periodically so the file doesn't accumulate dead records. Returns how many were
// dropped. Serialized like the other writers so a sweep can't clobber a
// concurrent login/touch.
export function pruneSessions(storageDir) {
  return withLock(async () => {
    const sessions = await readSessionsFile(storageDir);
    const now = Date.now();
    const kept = sessions.filter((item) => !isExpired(item, now));
    if (kept.length !== sessions.length) {
      await writeSessionsFile(storageDir, kept);
    }
    return sessions.length - kept.length;
  });
}
