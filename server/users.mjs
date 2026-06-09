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

async function readUsersFile(storageDir) {
  try {
    const raw = await readFile(userStoreFile(storageDir), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

async function writeUsersFile(storageDir, users) {
  await mkdir(storageDir, { recursive: true });
  await writeFile(
    userStoreFile(storageDir),
    `${JSON.stringify({ users }, null, 2)}\n`,
    "utf8",
  );
}

function normalizeUsername(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

// Public view of a user (never leaks the password hash).
export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
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
export async function createUser(storageDir, { username, password, role }) {
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
}

// Deletes a user by id. Refuses to remove the last remaining admin so the team is
// never locked out. Returns the deleted user's public view, or null if missing.
export async function deleteUser(storageDir, id) {
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
}

// Resets a user's password (admin action). Returns true if the user existed.
export async function setPassword(storageDir, id, password) {
  if (!password) throw new Error("invalid");
  const users = await readUsersFile(storageDir);
  const user = users.find((item) => item.id === id);
  if (!user) return false;
  user.passwordHash = await hashPassword(password);
  await writeUsersFile(storageDir, users);
  return true;
}
