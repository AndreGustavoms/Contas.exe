// Password-reset token store (storage/password-reset.json).
// Each token is stored as a scrypt hash so a DB leak doesn't hand out valid links.
// Tokens expire after RESET_TTL_MS (15 min) and are single-use.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./users.mjs";

const RESET_TTL_MS = 15 * 60 * 1000;

function storeFile(storageDir) {
  return join(storageDir, "password-reset.json");
}

async function readTokens(storageDir) {
  try {
    const raw = await readFile(storeFile(storageDir), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeTokens(storageDir, tokens) {
  await mkdir(storageDir, { recursive: true });
  await writeFile(
    storeFile(storageDir),
    `${JSON.stringify(tokens, null, 2)}\n`,
    "utf8",
  );
}

// Creates a reset token for `userId`. Invalidates any previous token for that user.
// Returns the raw token string (to be e-mailed; never stored in clear text).
export async function createResetToken(storageDir, userId) {
  const raw = randomBytes(32).toString("hex");
  const hash = await hashPassword(raw);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

  const tokens = (await readTokens(storageDir)).filter(
    (t) => t.userId !== userId,
  );
  tokens.push({ userId, hash, expiresAt, used: false });
  await writeTokens(storageDir, tokens);
  return raw;
}

// Validates a raw token. Returns the userId it belongs to, or null on failure.
// Does NOT consume the token — call consumeResetToken after the password is changed.
export async function validateResetToken(storageDir, raw) {
  if (!raw) return null;
  const tokens = await readTokens(storageDir);
  const now = Date.now();

  for (const entry of tokens) {
    if (entry.used) continue;
    if (new Date(entry.expiresAt).getTime() <= now) continue;
    const match = await verifyPassword(raw, entry.hash);
    if (match) return entry.userId;
  }
  return null;
}

// Marks the token as used (single-use). Call after successful password change.
export async function consumeResetToken(storageDir, raw) {
  const tokens = await readTokens(storageDir);
  const now = Date.now();
  let changed = false;

  for (const entry of tokens) {
    if (entry.used || new Date(entry.expiresAt).getTime() <= now) continue;
    const match = await verifyPassword(raw, entry.hash);
    if (match) {
      entry.used = true;
      changed = true;
      break;
    }
  }

  if (changed) await writeTokens(storageDir, tokens);
}

// Prune expired / used tokens. Call occasionally (e.g. at startup).
export async function pruneResetTokens(storageDir) {
  const tokens = await readTokens(storageDir);
  const now = Date.now();
  const fresh = tokens.filter(
    (t) => !t.used && new Date(t.expiresAt).getTime() > now,
  );
  if (fresh.length !== tokens.length) await writeTokens(storageDir, fresh);
}
