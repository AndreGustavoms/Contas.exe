// TOTP (RFC 6238) and recovery codes for optional two-factor auth. Implemented
// with Node's built-in crypto (HMAC-SHA1), no external dependency — authenticator
// apps (Google Authenticator, Authy, etc.) interop with the standard algorithm.
//
// The shared secret is a Base32 string (RFC 4648), which is what the apps and the
// otpauth:// URI expect. The server stores it encrypted at rest (see users.mjs);
// this module only deals with the algorithm.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30; // standard TOTP time step
const DIGITS = 6; // standard code length
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648 base32

// --- Base32 (RFC 4648, no padding) ---

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(input) {
  // Tolerant: ignore spaces/padding/case, as users may paste a formatted key.
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// --- Secret ---

// A fresh Base32 secret (160 bits, the RFC-recommended size for SHA-1).
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

// --- TOTP ---

// HOTP/TOTP for a given counter (the time step). Returns the zero-padded code.
function hotp(secretBuffer, counter) {
  const counterBuf = Buffer.alloc(8);
  // 64-bit big-endian counter. Bit shifts overflow 32 bits, so write hi/lo halves.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", secretBuffer).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

// The current TOTP code for a Base32 secret (optionally at a given time, for tests).
export function totp(secret, { time = Date.now() } = {}) {
  const counter = Math.floor(time / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secret), counter);
}

// Verifies a user-supplied code against the secret, allowing ±`window` steps to
// tolerate clock drift between the server and the authenticator app. Comparison is
// constant-time. Returns true on match.
export function verifyTotp(secret, code, { window = 1, time = Date.now() } = {}) {
  const cleaned = String(code ?? "").replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return false;
  const secretBuffer = base32Decode(secret);
  if (secretBuffer.length === 0) return false;

  const counter = Math.floor(time / 1000 / STEP_SECONDS);
  const candidate = Buffer.from(cleaned);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(hotp(secretBuffer, counter + offset));
    if (
      expected.length === candidate.length &&
      timingSafeEqual(expected, candidate)
    ) {
      return true;
    }
  }
  return false;
}

// The otpauth:// URI an authenticator app reads from a QR code. label/issuer are
// shown to the user in their app.
export function otpauthUri({ secret, label, issuer }) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  const account = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${account}?${params.toString()}`;
}

// --- Recovery codes ---

// Generates `n` single-use recovery codes as readable "xxxx-xxxx" strings (no
// ambiguous chars). Returned in clear text ONCE; the caller stores only hashes.
export function generateRecoveryCodes(n = 8) {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz"; // no 0/o/1/l/i
  const codes = [];
  for (let i = 0; i < n; i += 1) {
    const bytes = randomBytes(8);
    let s = "";
    for (let k = 0; k < 8; k += 1) {
      s += alphabet[bytes[k] % alphabet.length];
      if (k === 3) s += "-";
    }
    codes.push(s);
  }
  return codes;
}
