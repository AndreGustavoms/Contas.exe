// PostgreSQL-backed user store. Replaces the JSON-based users.mjs when
// DATABASE_URL is configured. Falls back to the legacy JSON implementation
// when PostgreSQL is unavailable (so existing deployments keep working).

import { randomUUID } from "node:crypto";
import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isConnected, query } from "./db.mjs";
import { decryptField, encryptField } from "./crypto.mjs";
import { generateSecret, generateRecoveryCodes, verifyTotp } from "./totp.mjs";

// Import the legacy JSON implementation as fallback
import * as jsonUsers from "./users.mjs";

const scryptAsync = promisify(scrypt);

// Scrypt parameters (same as the original): N=32768 (2^15), r=8, p=1
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 64;

// ==================== FALLBACK LOGIC ====================
// Every function checks isConnected() and delegates to the legacy JSON
// implementation when PostgreSQL is offline. This keeps the app working
// during migration and on installations that haven't set DATABASE_URL yet.

function useLegacy() {
  return !isConnected();
}

// ==================== PASSWORD HASHING ====================

const SCRYPT_MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password, salt) {
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return derived.toString("hex");
}

function encodeHash(salt, hash) {
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash}`;
}

function decodeHash(encoded) {
  const [alg, N, r, p, salt, hash] = encoded.split(":");
  if (alg !== "scrypt" || !salt || !hash) return null;
  return { N: Number(N), r: Number(r), p: Number(p), salt, hash };
}

export async function createPasswordHash(password) {
  const salt = randomUUID().replaceAll("-", "");
  const hash = await hashPassword(password, salt);
  return encodeHash(salt, hash);
}

export async function verifyPassword(password, encoded) {
  if (useLegacy()) return jsonUsers.verifyPassword(password, encoded);
  
  const parsed = decodeHash(encoded);
  if (!parsed) return false;
  const { salt, hash: storedHash } = parsed;
  const candidateHash = await hashPassword(password, salt);
  
  const storedBuf = Buffer.from(storedHash, "hex");
  const candidateBuf = Buffer.from(candidateHash, "hex");
  if (storedBuf.length !== candidateBuf.length) return false;
  
  return timingSafeEqual(storedBuf, candidateBuf);
}

// ==================== VALIDATION ====================

export function validateUsername(username) {
  if (useLegacy()) return jsonUsers.validateUsername(username);
  
  if (typeof username !== "string") return "invalid_username";
  const trimmed = username.trim();
  if (trimmed.length < 3) return "username_too_short";
  if (trimmed.length > 64) return "username_too_long";
  if (!/^[a-z0-9_.-]+$/i.test(trimmed)) return "invalid_username";
  return null;
}

export function validatePassword(password, username) {
  if (useLegacy()) return jsonUsers.validatePassword(password, username);
  
  if (typeof password !== "string") return "invalid";
  if (password.length < 8) return "password_too_short";
  if (password.length > 128) return "password_too_long";
  if (!/[A-Z]/.test(password)) return "password_no_uppercase";
  if (!/[a-z]/.test(password)) return "password_no_lowercase";
  if (!/\d/.test(password)) return "password_no_number";
  if (!/[^a-zA-Z0-9]/.test(password)) return "password_no_special";
  
  // Common weak passwords
  const weak = ["password", "12345678", "qwerty", "admin123"];
  if (weak.some((w) => password.toLowerCase().includes(w))) {
    return "password_too_common";
  }
  
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return "password_same_as_username";
  }
  
  return null;
}

// ==================== USER CRUD ====================

export async function createUser(storageDir, { username, password, role, email, fullName }) {
  if (useLegacy()) {
    return jsonUsers.createUser(storageDir, { username, password, role, email, fullName });
  }

  const trimmedUsername = username.trim();
  const usernameError = validateUsername(trimmedUsername);
  if (usernameError) throw new Error(usernameError);

  const passwordError = validatePassword(password, trimmedUsername);
  if (passwordError) throw new Error(passwordError);

  // Check if username or email already exists
  const existing = await query(
    "SELECT id FROM users WHERE username = $1 OR (email IS NOT NULL AND email = $2)",
    [trimmedUsername, email?.trim() || null]
  );
  if (existing.rows.length > 0) {
    throw new Error("username_taken");
  }

  const passwordHash = await createPasswordHash(password);
  const result = await query(
    `INSERT INTO users (username, email, full_name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, email, full_name AS "fullName", role, created_at AS "createdAt"`,
    [
      trimmedUsername,
      email?.trim() || null,
      fullName?.trim() || null,
      passwordHash,
      role,
    ]
  );

  return result.rows[0];
}

export async function findById(storageDir, userId) {
  if (useLegacy()) return jsonUsers.findById(storageDir, userId);

  const result = await query(
    `SELECT 
      id, username, email, full_name AS "fullName", role, avatar_url AS "avatarUrl",
      avatar_removed AS "avatarRemoved", password_hash AS "passwordHash",
      two_factor_enabled AS "twoFactorEnabled",
      two_factor_secret AS "twoFactorSecret",
      recovery_codes AS "recoveryCodes",
      google_id AS "googleId", google_email AS "googleEmail", google_picture AS "googlePicture",
      github_id AS "githubId", github_login AS "githubLogin", github_avatar AS "githubAvatar",
      created_at AS "createdAt"
    FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) return null;
  const user = result.rows[0];

  // Decrypt 2FA fields
  if (user.twoFactorSecret) {
    user.twoFactorSecret = decryptField(user.twoFactorSecret);
  }
  if (user.recoveryCodes) {
    user.recoveryCodes = user.recoveryCodes.map(decryptField);
  }

  // Reshape to match legacy format
  return {
    ...user,
    twoFactor: user.twoFactorEnabled
      ? {
          enabled: true,
          secret: user.twoFactorSecret,
          recoveryCodes: user.recoveryCodes || [],
        }
      : null,
    google: user.googleId
      ? {
          id: user.googleId,
          email: user.googleEmail,
          picture: user.googlePicture,
        }
      : null,
    github: user.githubId
      ? {
          id: user.githubId,
          login: user.githubLogin,
          avatar: user.githubAvatar,
        }
      : null,
  };
}

export async function findByUsernameOrEmail(storageDir, nameOrEmail) {
  if (useLegacy()) return jsonUsers.findByUsernameOrEmail(storageDir, nameOrEmail);

  const trimmed = nameOrEmail.trim();
  const result = await query(
    `SELECT 
      id, username, email, password_hash AS "passwordHash", role,
      two_factor_enabled AS "twoFactorEnabled",
      two_factor_secret AS "twoFactorSecret",
      recovery_codes AS "recoveryCodes"
    FROM users 
    WHERE username = $1 OR email = $1`,
    [trimmed]
  );

  if (result.rows.length === 0) return null;
  const user = result.rows[0];

  // Decrypt 2FA fields
  if (user.twoFactorSecret) {
    user.twoFactorSecret = decryptField(user.twoFactorSecret);
  }
  if (user.recoveryCodes) {
    user.recoveryCodes = user.recoveryCodes.map(decryptField);
  }

  return {
    ...user,
    twoFactor: user.twoFactorEnabled
      ? {
          enabled: true,
          secret: user.twoFactorSecret,
          recoveryCodes: user.recoveryCodes || [],
        }
      : null,
  };
}

export async function findByEmail(storageDir, email) {
  if (useLegacy()) return jsonUsers.findByEmail(storageDir, email);

  const result = await query(
    "SELECT id, username, email FROM users WHERE email = $1",
    [email.trim().toLowerCase()]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function listUsers(storageDir) {
  if (useLegacy()) return jsonUsers.listUsers(storageDir);

  const result = await query(
    `SELECT 
      id, username, email, full_name AS "fullName", role,
      two_factor_enabled AS "twoFactorEnabled",
      created_at AS "createdAt"
    FROM users
    ORDER BY created_at DESC`
  );

  return result.rows;
}

export async function deleteUser(storageDir, userId) {
  if (useLegacy()) return jsonUsers.deleteUser(storageDir, userId);

  const result = await query(
    "DELETE FROM users WHERE id = $1 RETURNING id",
    [userId]
  );

  return result.rows.length > 0;
}

export async function setPassword(storageDir, userId, newPassword) {
  if (useLegacy()) return jsonUsers.setPassword(storageDir, userId, newPassword);

  const passwordHash = await createPasswordHash(newPassword);
  const result = await query(
    "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id",
    [passwordHash, userId]
  );

  return result.rows.length > 0;
}

export async function setUsername(storageDir, userId, newUsername) {
  if (useLegacy()) return jsonUsers.setUsername(storageDir, userId, newUsername);

  const trimmed = newUsername.trim();
  const error = validateUsername(trimmed);
  if (error) throw new Error(error);

  // Check if new username is already taken
  const existing = await query(
    "SELECT id FROM users WHERE username = $1 AND id != $2",
    [trimmed, userId]
  );
  if (existing.rows.length > 0) {
    throw new Error("username_taken");
  }

  const result = await query(
    "UPDATE users SET username = $1 WHERE id = $2 RETURNING id",
    [trimmed, userId]
  );

  return result.rows.length > 0;
}

export async function setEmail(storageDir, userId, email) {
  if (useLegacy()) return jsonUsers.setEmail(storageDir, userId, email);

  const trimmed = email?.trim().toLowerCase() || null;
  await query(
    "UPDATE users SET email = $1 WHERE id = $2",
    [trimmed, userId]
  );
}

export async function setFullName(storageDir, userId, fullName) {
  if (useLegacy()) return jsonUsers.setFullName(storageDir, userId, fullName);

  await query(
    "UPDATE users SET full_name = $1 WHERE id = $2",
    [fullName?.trim() || null, userId]
  );
}

export async function setAvatarUrl(storageDir, userId, avatarUrl) {
  if (useLegacy()) return jsonUsers.setAvatarUrl(storageDir, userId, avatarUrl);

  await query(
    "UPDATE users SET avatar_url = $1, avatar_removed = $2 WHERE id = $3",
    [avatarUrl, avatarUrl === null, userId]
  );
}

// ==================== 2FA (TOTP) ====================

export async function startTwoFactorSetup(storageDir, userId) {
  if (useLegacy()) return jsonUsers.startTwoFactorSetup(storageDir, userId);

  const user = await findById(storageDir, userId);
  if (!user) return null;

  const secret = generateSecret();
  const otpauthUrl = `otpauth://totp/Contas:${encodeURIComponent(user.username)}?secret=${secret}&issuer=Contas`;

  return { secret, otpauthUrl };
}

export async function enableTwoFactor(storageDir, userId, code) {
  if (useLegacy()) return jsonUsers.enableTwoFactor(storageDir, userId, code);

  // The secret is passed in the request (from the setup step), not stored yet
  throw new Error("enableTwoFactor requires secret from setup step (not implemented in PG version yet)");
}

export async function disableTwoFactor(storageDir, userId, code) {
  if (useLegacy()) return jsonUsers.disableTwoFactor(storageDir, userId, code);

  const user = await findById(storageDir, userId);
  if (!user?.twoFactor?.enabled) return false;

  const totpOk = verifyTotp(user.twoFactor.secret, code);
  const recoveryOk = !totpOk && (await consumeRecoveryCode(storageDir, userId, code));

  if (!totpOk && !recoveryOk) {
    throw new Error("invalid_code");
  }

  await query(
    `UPDATE users 
     SET two_factor_enabled = false, two_factor_secret = NULL, recovery_codes = NULL 
     WHERE id = $1`,
    [userId]
  );

  return true;
}

export function verifyUserTotp(user, code) {
  return verifyTotp(user.twoFactor?.secret, code);
}

export async function consumeRecoveryCode(storageDir, userId, code) {
  if (useLegacy()) return jsonUsers.consumeRecoveryCode(storageDir, userId, code);

  const user = await findById(storageDir, userId);
  if (!user?.twoFactor?.recoveryCodes) return false;

  // Recovery codes are stored as hashed (like passwords)
  for (let i = 0; i < user.twoFactor.recoveryCodes.length; i++) {
    const valid = await verifyPassword(code, user.twoFactor.recoveryCodes[i]);
    if (valid) {
      // Remove the used code
      const updated = [...user.twoFactor.recoveryCodes];
      updated.splice(i, 1);
      
      await query(
        "UPDATE users SET recovery_codes = $1 WHERE id = $2",
        [updated.map(encryptField), userId]
      );
      
      return true;
    }
  }
  
  return false;
}

export function recoveryCodesRemaining(user) {
  return user?.twoFactor?.recoveryCodes?.length ?? 0;
}

export async function regenerateRecoveryCodes(storageDir, userId) {
  if (useLegacy()) return jsonUsers.regenerateRecoveryCodes(storageDir, userId);

  const user = await findById(storageDir, userId);
  if (!user?.twoFactor?.enabled) return null;

  const codes = generateRecoveryCodes();
  const hashed = await Promise.all(codes.map(createPasswordHash));

  await query(
    "UPDATE users SET recovery_codes = $1 WHERE id = $2",
    [hashed.map(encryptField), userId]
  );

  return { recoveryCodes: codes };
}

export async function resetTwoFactor(storageDir, userId) {
  if (useLegacy()) return jsonUsers.resetTwoFactor(storageDir, userId);

  const result = await query(
    `UPDATE users 
     SET two_factor_enabled = false, two_factor_secret = NULL, recovery_codes = NULL 
     WHERE id = $1 
     RETURNING id`,
    [userId]
  );

  return result.rows.length > 0;
}

// ==================== OAUTH PROVIDERS ====================

export async function findOrCreateGoogleUser(storageDir, profile) {
  if (useLegacy()) return jsonUsers.findOrCreateGoogleUser(storageDir, profile);

  // Check if Google account already linked
  let result = await query(
    "SELECT id, username, role FROM users WHERE google_id = $1",
    [profile.id]
  );

  if (result.rows.length > 0) {
    return { user: result.rows[0], created: false };
  }

  // Check if email already registered (but not linked to Google)
  result = await query(
    "SELECT id FROM users WHERE email = $1",
    [profile.email]
  );

  if (result.rows.length > 0) {
    throw new Error("google_email_already_registered");
  }

  // Create new user
  const username = profile.email.split("@")[0];
  const finalUsername = await ensureUniqueUsername(username);
  const passwordHash = await createPasswordHash(randomUUID());

  result = await query(
    `INSERT INTO users (
      username, email, full_name, password_hash, role,
      google_id, google_email, google_picture
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, username, role`,
    [
      finalUsername,
      profile.email,
      profile.name || null,
      passwordHash,
      "member",
      profile.id,
      profile.email,
      profile.picture || null,
    ]
  );

  return { user: result.rows[0], created: true };
}

export async function linkGoogleProvider(storageDir, userId, profile) {
  if (useLegacy()) return jsonUsers.linkGoogleProvider(storageDir, userId, profile);

  // Check if Google ID already linked to another user
  const existing = await query(
    "SELECT id FROM users WHERE google_id = $1 AND id != $2",
    [profile.id, userId]
  );

  if (existing.rows.length > 0) {
    throw new Error("google_already_linked");
  }

  await query(
    "UPDATE users SET google_id = $1, google_email = $2, google_picture = $3 WHERE id = $4",
    [profile.id, profile.email, profile.picture || null, userId]
  );

  return true;
}

export async function findOrCreateGithubUser(storageDir, profile) {
  if (useLegacy()) return jsonUsers.findOrCreateGithubUser(storageDir, profile);

  let result = await query(
    "SELECT id, username, role FROM users WHERE github_id = $1",
    [profile.id]
  );

  if (result.rows.length > 0) {
    return { user: result.rows[0], created: false };
  }

  if (profile.email) {
    result = await query(
      "SELECT id FROM users WHERE email = $1",
      [profile.email]
    );

    if (result.rows.length > 0) {
      throw new Error("github_email_already_registered");
    }
  }

  const username = profile.login;
  const finalUsername = await ensureUniqueUsername(username);
  const passwordHash = await createPasswordHash(randomUUID());

  result = await query(
    `INSERT INTO users (
      username, email, password_hash, role,
      github_id, github_login, github_avatar
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, username, role`,
    [
      finalUsername,
      profile.email || null,
      passwordHash,
      "member",
      profile.id,
      profile.login,
      profile.avatar_url || null,
    ]
  );

  return { user: result.rows[0], created: true };
}

export async function linkGithubProvider(storageDir, userId, profile) {
  if (useLegacy()) return jsonUsers.linkGithubProvider(storageDir, userId, profile);

  const existing = await query(
    "SELECT id FROM users WHERE github_id = $1 AND id != $2",
    [profile.id, userId]
  );

  if (existing.rows.length > 0) {
    throw new Error("github_already_linked");
  }

  await query(
    "UPDATE users SET github_id = $1, github_login = $2, github_avatar = $3 WHERE id = $4",
    [profile.id, profile.login, profile.avatar_url || null, userId]
  );

  return true;
}

// ==================== SUPERADMIN ====================

export async function ensureSeedAdmin(storageDir) {
  if (useLegacy()) return jsonUsers.ensureSeedAdmin(storageDir);

  const existingUsers = await query("SELECT id FROM users LIMIT 1");
  if (existingUsers.rows.length > 0) {
    return []; // Users already exist, skip seeding
  }

  const username = process.env.APP_AUTH_USER?.trim();
  const password = process.env.APP_AUTH_PASSWORD;

  if (!username || !password) {
    return [];
  }

  try {
    const user = await createUser(storageDir, {
      username,
      password,
      role: "admin",
    });
    return [user];
  } catch {
    return [];
  }
}

export async function ensureSuperadmin(storageDir) {
  if (useLegacy()) return jsonUsers.ensureSuperadmin(storageDir);

  const email = process.env.CONTAS_FLOW_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const username = process.env.CONTAS_FLOW_SUPERADMIN_USER?.trim();

  if (!email && !username) return null;

  const result = await query(
    `UPDATE users 
     SET role = 'superadmin' 
     WHERE (email = $1 OR username = $2) AND role != 'superadmin'
     RETURNING id, username, role`,
    [email || null, username || null]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function resetSuperadminPasswordFromEnv(storageDir) {
  if (useLegacy()) return jsonUsers.resetSuperadminPasswordFromEnv(storageDir);

  const password = process.env.CONTAS_FLOW_SUPERADMIN_PASSWORD;
  if (!password) return { owner: null, error: "no_password_env" };

  const result = await query(
    "SELECT id, username FROM users WHERE role = 'superadmin' LIMIT 1"
  );

  if (result.rows.length === 0) {
    return { owner: null, error: "no_superadmin" };
  }

  const owner = result.rows[0];
  await setPassword(storageDir, owner.id, password);

  return { owner, error: null };
}

export async function keepOnlySuperadmin(storageDir) {
  if (useLegacy()) return jsonUsers.keepOnlySuperadmin(storageDir);

  const isSingleOwner = process.env.CONTAS_FLOW_SINGLE_OWNER === "true";
  if (!isSingleOwner) return { removed: [] };

  const result = await query(
    `DELETE FROM users 
     WHERE role != 'superadmin'
     RETURNING id, username`
  );

  return { removed: result.rows };
}

// Helper: ensure username is unique by appending numbers if needed
async function ensureUniqueUsername(base) {
  let candidate = base;
  let suffix = 1;

  while (true) {
    const result = await query(
      "SELECT id FROM users WHERE username = $1",
      [candidate]
    );

    if (result.rows.length === 0) return candidate;
    
    candidate = `${base}${suffix}`;
    suffix++;
  }
}
