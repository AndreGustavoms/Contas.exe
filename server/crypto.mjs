// Encryption at rest for the sensitive fields of the vault (passwords, recovery
// emails, phones, notes) and YouTube refresh tokens.
//
// Algorithm: AES-256-GCM (authenticated: tampering is detected on decrypt).
// Key: 32 bytes from CONTAS_FLOW_ENC_KEY, given as 64 hex chars or base64.
// Stored format: "enc:v1:<base64(iv | authTag | ciphertext)>" — the version
// prefix lets us rotate the scheme later and makes encryption idempotent (we can
// tell an already-encrypted value from a plaintext one).
//
// If no key is configured, encryption is DISABLED: values are read and written as
// plaintext, exactly like before. This keeps local use friction-free; production
// sets the key. The server logs a warning at startup when the key is missing.
//
// IMPORTANT: the key is the only thing that can decrypt the data. If it is lost,
// the encrypted fields are unrecoverable. Back it up alongside (but never inside)
// the data volume.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12; // GCM standard nonce size
const TAG_BYTES = 16;

// Parses CONTAS_FLOW_ENC_KEY into a 32-byte Buffer, or returns null when unset.
// Accepts 64 hex chars or 44-char base64 (both decode to 32 bytes). Throws on a
// present-but-malformed key so misconfiguration fails loudly at startup rather
// than silently writing plaintext.
function loadKey() {
  const raw = process.env.CONTAS_FLOW_ENC_KEY;
  if (!raw) return null;

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== 32) {
    throw new Error(
      "CONTAS_FLOW_ENC_KEY invalida: precisa ser 32 bytes (64 hex ou base64). " +
        "Gere uma com: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return key;
}

const key = loadKey();

export const encryptionEnabled = key !== null;

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

// Encrypts a string field. No-ops on empty strings (nothing to hide), on values
// already encrypted (idempotent), and when no key is configured.
export function encryptField(value) {
  if (!key) return value;
  if (typeof value !== "string" || value === "") return value;
  if (isEncrypted(value)) return value;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `${PREFIX}${packed}`;
}

// Decrypts a field. Plaintext (un-prefixed) values pass through unchanged, which
// is what makes migrating an existing plaintext store transparent. When no key is
// configured, encrypted values cannot be read and are returned as-is (the caller
// will at least not crash); this only happens if the key is removed after data
// was encrypted, which is a misconfiguration.
export function decryptField(value) {
  if (!isEncrypted(value)) return value;
  if (!key) return value;

  const packed = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
