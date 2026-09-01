// Password-reset token store: PostgreSQL in production/multi-instance mode;
// storage/password-reset.json is retained only for the explicit local fallback.
// Each token is stored as a scrypt hash so a DB leak doesn't hand out valid links.
// Tokens expire after RESET_TTL_MS (15 min) and are single-use.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./users.mjs";
import { getClient, isConnected, query } from "./db.mjs";

function tokenHash(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

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

export async function createResetToken(storageDir, userId) {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  if (isConnected()) {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `contas:reset-token:${userId}`,
      ]);
      await client.query(
        "DELETE FROM password_reset_tokens WHERE user_id = $1",
        [userId],
      );
      await client.query(
        `INSERT INTO password_reset_tokens (token, user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [tokenHash(raw), userId, expiresAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return raw;
  }

  const hash = await hashPassword(raw);
  const tokens = (await readTokens(storageDir)).filter(
    (t) => t.userId !== userId,
  );
  tokens.push({
    userId,
    hash,
    expiresAt: expiresAt.toISOString(),
    used: false,
  });
  await writeTokens(storageDir, tokens);
  return raw;
}

export async function validateResetToken(storageDir, raw) {
  if (!raw) return null;

  if (isConnected()) {
    const result = await query(
      `SELECT user_id FROM password_reset_tokens
       WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
      [tokenHash(raw)],
    );
    return result.rows.length > 0 ? result.rows[0].user_id : null;
  }

  const tokens = await readTokens(storageDir);
  const now = Date.now();
  for (const entry of tokens) {
    if (entry.used || new Date(entry.expiresAt).getTime() <= now) continue;
    const match = await verifyPassword(raw, entry.hash);
    if (match) return entry.userId;
  }
  return null;
}

export async function consumeResetToken(storageDir, raw) {
  if (isConnected()) {
    await query(
      "UPDATE password_reset_tokens SET consumed_at = NOW() WHERE token = $1 AND consumed_at IS NULL",
      [tokenHash(raw)],
    );
    return;
  }

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

export async function pruneResetTokens(storageDir) {
  if (isConnected()) {
    await query(
      "DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR consumed_at IS NOT NULL",
    );
    return;
  }

  const tokens = await readTokens(storageDir);
  const now = Date.now();
  const fresh = tokens.filter(
    (t) => !t.used && new Date(t.expiresAt).getTime() > now,
  );
  if (fresh.length !== tokens.length) await writeTokens(storageDir, fresh);
}
