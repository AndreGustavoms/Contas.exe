// Audit trail: an append-only record of who did what and when, for the security-
// sensitive actions (login, re-auth, viewing a stored password, exporting a
// backup, changing a password, creating/removing a user, deleting a group,
// revoking sessions). Lets an admin answer "who saw/changed this account, and
// when" — which is also a concrete LGPD control (information about access).
//
// What is NEVER logged: passwords, the copied/revealed value, tokens, or any
// account secret. Only ids, a short non-sensitive target label, the action name,
// and a hash of the IP. The raw IP is never stored.
//
// Storage: storage/audit.json (git-ignored via storage/*), same idioms as
// sessions.mjs/users.mjs. Writes are serialized through an in-process promise
// chain so concurrent requests can't lose an appended event.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Cap so the file can't grow without bound; we keep the most recent events.
const MAX_EVENTS = 5000;

// --- Write serialization (see sessions.mjs for the rationale) ---
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function auditStoreFile(storageDir) {
  return process.env.CONTAS_FLOW_AUDIT_DB ?? join(storageDir, "audit.json");
}

async function readEventsFile(storageDir) {
  try {
    const raw = await readFile(auditStoreFile(storageDir), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

async function writeEventsFile(storageDir, events) {
  await mkdir(storageDir, { recursive: true });
  await writeFile(
    auditStoreFile(storageDir),
    `${JSON.stringify({ events }, null, 2)}\n`,
    "utf8",
  );
}

// SHA-256 of the client IP (never the raw IP), matching the sessions store.
function hashIp(ip) {
  return createHash("sha256")
    .update(String(ip ?? "unknown"))
    .digest("hex");
}

// Appends one event. `action` is a stable code (e.g. "secret_viewed"); `target`
// is a short non-sensitive label (e.g. "account:<id>", "group:<id>", "user:<id>")
// or null. Best-effort: a failure to write the audit log must NEVER break the
// actual request — and callers fire-and-forget with `void logEvent(...)`, so we
// swallow our own errors here. An unhandled rejection would otherwise crash the
// process (Node's default), letting an audit write hiccup take the server down.
export function logEvent(storageDir, { userId, username, action, target, ip }) {
  return withLock(async () => {
    const events = await readEventsFile(storageDir);
    events.push({
      ts: new Date().toISOString(),
      userId: userId ?? null,
      username: username ?? null,
      action,
      target: target ?? null,
      ipHash: hashIp(ip),
    });
    // Keep only the most recent MAX_EVENTS.
    const trimmed =
      events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
    await writeEventsFile(storageDir, trimmed);
  }).catch((error) => {
    console.error("audit_log_failed:", error);
  });
}

// Returns the most recent events (newest first) for the admin panel, capped.
export async function listEvents(storageDir, { limit = 200 } = {}) {
  const events = await readEventsFile(storageDir);
  return events.slice(-limit).reverse();
}
