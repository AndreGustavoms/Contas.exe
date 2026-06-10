// Multi-user accounts (the people who log in), kept separate from the credential
// vault. Each user has a role: "admin" sees and manages every group; "member"
// only sees the groups they own.
//
// Passwords are never stored in clear text: we keep a scrypt hash with a random
// per-user salt. Verification is constant-time.
//
// Storage: storage/users.json (git-ignored via storage/*). On first run, if no
// users exist, a bootstrap admin is seeded from APP_AUTH_USER / APP_AUTH_PASSWORD
// (the legacy single-login env vars) so existing deployments keep working and the
// admin can then create the rest of the team from the UI.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { decryptField, encryptField } from "./crypto.mjs";
import {
  generateRecoveryCodes,
  generateSecret,
  otpauthUri,
  verifyTotp,
} from "./totp.mjs";

// Serialize read-modify-write of users.json (same rationale as sessions.mjs):
// 2FA setup/enable/disable add concurrent writers, and an interleaved write could
// otherwise lose a change. All mutating ops below go through this.
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const ISSUER = "Contas_exe"; // shown in the authenticator app

const scryptAsync = promisify(scrypt);

// scrypt parameters. N=2^15 is a sensible interactive cost; keyLen 64 bytes.
// scrypt needs ~128*N*r bytes (~32 MB here), which exceeds Node's default
// maxmem (32 MB) and throws — so we raise maxmem to 64 MB explicitly.
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: SCRYPT_MAXMEM };

export const ROLES = new Set(["admin", "member"]);

// --- Password hashing (scrypt) ---

// Returns "scrypt:N:r:p:saltHex:hashHex" so the verifier is self-describing and
// future parameter changes don't break old hashes.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(
    password,
    salt,
    SCRYPT_KEYLEN,
    SCRYPT_PARAMS,
  );
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt:${N}:${r}:${p}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

function isHex(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  // Fail closed on any malformed hash. An empty or non-hex hashHex would decode
  // to a zero-length buffer, and comparing two empty buffers would wrongly pass —
  // so a corrupted/hand-edited users.json could otherwise accept any password.
  if (!isHex(saltHex) || !isHex(hashHex)) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const derived = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  });
  // timingSafeEqual needs equal lengths; expected.length drives the derivation.
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

// --- Store ---

function userStoreFile(storageDir) {
  return process.env.CONTAS_FLOW_USERS_DB ?? join(storageDir, "users.json");
}

// The 2FA secret and recovery-code hashes are encrypted at rest, the same way the
// vault secrets are (idempotent enc:v1: format; no-op without CONTAS_FLOW_ENC_KEY).
// passwordHash stays as a plain scrypt hash (it's already non-reversible). These
// transforms run only at the I/O boundary so the rest of the code sees plaintext.
function transformUserSecrets(user, transform) {
  const tf = user?.twoFactor;
  if (!tf) return user;
  const next = { ...tf };
  if (next.secret != null) next.secret = transform(next.secret);
  if (Array.isArray(next.recoveryCodes)) {
    next.recoveryCodes = next.recoveryCodes.map((rc) => ({
      ...rc,
      hash: rc.hash != null ? transform(rc.hash) : rc.hash,
    }));
  }
  return { ...user, twoFactor: next };
}

async function readUsersFile(storageDir) {
  try {
    const raw = await readFile(userStoreFile(storageDir), "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.users) ? parsed.users : [];
    return list.map((user) => transformUserSecrets(user, decryptField));
  } catch {
    return [];
  }
}

async function writeUsersFile(storageDir, users) {
  await mkdir(storageDir, { recursive: true });
  const encrypted = users.map((user) => transformUserSecrets(user, encryptField));
  await writeFile(
    userStoreFile(storageDir),
    `${JSON.stringify({ users: encrypted }, null, 2)}\n`,
    "utf8",
  );
}

function normalizeUsername(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

// Public view of a user (never leaks the password hash, the 2FA secret, or the
// recovery-code hashes — only whether 2FA is on).
export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    twoFactorEnabled: Boolean(user.twoFactor?.enabled),
  };
}

// --- High-level operations ---

// Seeds a bootstrap admin from the legacy env vars when the store is empty, so an
// existing single-login deployment transparently becomes a one-admin multi-user
// setup. Returns the (possibly unchanged) user list.
export async function ensureSeedAdmin(storageDir) {
  const users = await readUsersFile(storageDir);
  if (users.length > 0) return users;

  const seedUser = normalizeUsername(process.env.APP_AUTH_USER);
  const seedPass = process.env.APP_AUTH_PASSWORD ?? "";
  if (!seedUser || !seedPass) return users; // nothing to seed; admin must be created another way

  const admin = {
    id: randomUUID(),
    username: seedUser,
    role: "admin",
    passwordHash: await hashPassword(seedPass),
    createdAt: new Date().toISOString(),
  };
  await writeUsersFile(storageDir, [admin]);
  return [admin];
}

export async function listUsers(storageDir) {
  const users = await readUsersFile(storageDir);
  return users.map(publicUser);
}

export async function findByUsername(storageDir, username) {
  const target = normalizeUsername(username);
  if (!target) return null;
  const users = await readUsersFile(storageDir);
  return users.find((user) => user.username === target) ?? null;
}

export async function findById(storageDir, id) {
  const users = await readUsersFile(storageDir);
  return users.find((user) => user.id === id) ?? null;
}

// Creates a user. Throws Error("username_taken") / Error("invalid") on bad input.
export function createUser(storageDir, { username, password, role }) {
  return withLock(async () => {
    const name = normalizeUsername(username);
    if (!name || !password || !ROLES.has(role)) {
      throw new Error("invalid");
    }
    const users = await readUsersFile(storageDir);
    if (users.some((user) => user.username === name)) {
      throw new Error("username_taken");
    }
    const user = {
      id: randomUUID(),
      username: name,
      role,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await writeUsersFile(storageDir, users);
    return publicUser(user);
  });
}

// Deletes a user by id. Refuses to remove the last remaining admin so the team is
// never locked out. Returns the deleted user's public view, or null if missing.
export function deleteUser(storageDir, id) {
  return withLock(async () => {
    const users = await readUsersFile(storageDir);
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) return null;

    const target = users[index];
    if (target.role === "admin") {
      const admins = users.filter((user) => user.role === "admin");
      if (admins.length <= 1) throw new Error("last_admin");
    }

    users.splice(index, 1);
    await writeUsersFile(storageDir, users);
    return publicUser(target);
  });
}

// Resets a user's password (admin action). Returns true if the user existed.
export function setPassword(storageDir, id, password) {
  return withLock(async () => {
    if (!password) throw new Error("invalid");
    const users = await readUsersFile(storageDir);
    const user = users.find((item) => item.id === id);
    if (!user) return false;
    user.passwordHash = await hashPassword(password);
    await writeUsersFile(storageDir, users);
    return true;
  });
}

// --- Two-factor (TOTP) ---

// Begins 2FA setup: generates a fresh secret and stashes it as PENDING (not yet
// enabled) on the user, so /enable can verify a code against it. Returns the
// secret + otpauth URI for the QR. A second call regenerates (overwrites pending).
export function startTwoFactorSetup(storageDir, userId) {
  return withLock(async () => {
    const users = await readUsersFile(storageDir);
    const user = users.find((u) => u.id === userId);
    if (!user) return null;
    const secret = generateSecret();
    user.twoFactor = {
      enabled: false,
      secret,
      recoveryCodes: [],
      pending: true,
    };
    await writeUsersFile(storageDir, users);
    return {
      secret,
      otpauthUri: otpauthUri({ secret, label: user.username, issuer: ISSUER }),
    };
  });
}

// Confirms setup: verifies `code` against the pending secret and, on success,
// enables 2FA and returns fresh recovery codes IN CLEAR (shown once). Throws
// "no_pending" if setup wasn't started, "invalid_code" on a bad code.
export function enableTwoFactor(storageDir, userId, code) {
  return withLock(async () => {
    const users = await readUsersFile(storageDir);
    const user = users.find((u) => u.id === userId);
    if (!user) return null;
    const tf = user.twoFactor;
    if (!tf?.pending || !tf.secret) throw new Error("no_pending");
    if (!verifyTotp(tf.secret, code)) throw new Error("invalid_code");

    const codes = generateRecoveryCodes(8);
    user.twoFactor = {
      enabled: true,
      secret: tf.secret,
      recoveryCodes: await Promise.all(
        codes.map(async (c) => ({ hash: await hashPassword(c), usedAt: null })),
      ),
      enabledAt: new Date().toISOString(),
    };
    await writeUsersFile(storageDir, users);
    return { recoveryCodes: codes };
  });
}

// Turns 2FA off, clearing the secret and recovery codes. Verifies a TOTP code OR a
// recovery code first (caller passes whatever the user typed). Returns true if it
// was on and the code matched; throws "invalid_code" otherwise.
export function disableTwoFactor(storageDir, userId, code) {
  return withLock(async () => {
    const users = await readUsersFile(storageDir);
    const user = users.find((u) => u.id === userId);
    if (!user?.twoFactor?.enabled) return false;

    const ok =
      verifyTotp(user.twoFactor.secret, code) ||
      (await matchRecoveryCode(user.twoFactor, code)) !== -1;
    if (!ok) throw new Error("invalid_code");

    delete user.twoFactor;
    await writeUsersFile(storageDir, users);
    return true;
  });
}

// Admin reset: force-disables a user's 2FA (no code needed). For when someone
// loses both their authenticator and recovery codes. Returns true if changed.
export function resetTwoFactor(storageDir, userId) {
  return withLock(async () => {
    const users = await readUsersFile(storageDir);
    const user = users.find((u) => u.id === userId);
    if (!user?.twoFactor) return false;
    delete user.twoFactor;
    await writeUsersFile(storageDir, users);
    return true;
  });
}

// Regenerates recovery codes (invalidating the old ones). Returns the new codes in
// clear (shown once), or null if 2FA isn't enabled.
export function regenerateRecoveryCodes(storageDir, userId) {
  return withLock(async () => {
    const users = await readUsersFile(storageDir);
    const user = users.find((u) => u.id === userId);
    if (!user?.twoFactor?.enabled) return null;
    const codes = generateRecoveryCodes(8);
    user.twoFactor.recoveryCodes = await Promise.all(
      codes.map(async (c) => ({ hash: await hashPassword(c), usedAt: null })),
    );
    await writeUsersFile(storageDir, users);
    return { recoveryCodes: codes };
  });
}

// Finds an unused recovery code matching `code`, returning its index or -1. Does
// NOT consume it (see consumeRecoveryCode). Constant-time-ish via verifyPassword.
async function matchRecoveryCode(twoFactor, code) {
  const cleaned = String(code ?? "").trim().toLowerCase();
  if (!cleaned) return -1;
  const list = twoFactor.recoveryCodes ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].usedAt) continue;
    if (await verifyPassword(cleaned, list[i].hash)) return i;
  }
  return -1;
}

// Marks a matching unused recovery code as used (single-use). Returns true if one
// was consumed. Used during 2FA login when the user can't produce a TOTP code.
export function consumeRecoveryCode(storageDir, userId, code) {
  return withLock(async () => {
    const users = await readUsersFile(storageDir);
    const user = users.find((u) => u.id === userId);
    if (!user?.twoFactor?.enabled) return false;
    const idx = await matchRecoveryCode(user.twoFactor, code);
    if (idx === -1) return false;
    user.twoFactor.recoveryCodes[idx].usedAt = new Date().toISOString();
    await writeUsersFile(storageDir, users);
    return true;
  });
}

// Verifies a TOTP code for an already-enabled user (used at login). Pure check,
// no state change.
export function verifyUserTotp(user, code) {
  if (!user?.twoFactor?.enabled || !user.twoFactor.secret) return false;
  return verifyTotp(user.twoFactor.secret, code);
}

// Count of unused recovery codes, for the account UI.
export function recoveryCodesRemaining(user) {
  return (user?.twoFactor?.recoveryCodes ?? []).filter((rc) => !rc.usedAt).length;
}
