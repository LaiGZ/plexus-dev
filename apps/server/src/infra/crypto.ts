import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64 } as const;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}
/** Ambiguous characters (0/O, 1/l/I) are intentionally absent. */
const PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+";

/**
 * Password hashing with scrypt (built into Node, no native dependency).
 * Format: `scrypt$N$r$p$saltBase64$hashBase64`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  if (!n || !r || !p || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Opaque token for sessions and API credentials. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Stable hash for storing tokens; never store the token itself. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Password for the generated admin account. Guarantees 4 character classes. */
export function generatePassword(length = 20): string {
  const pick = () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]!;
  const required = ["a", "A", "3", "!"];
  const rest = Array.from({ length: Math.max(0, length - required.length) }, pick);
  const all = [...required, ...rest];
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.join("");
}

/**
 * Encrypt a JSON value with AES-256-GCM under the instance data key.
 * Format: `v1:{iv}:{tag}:{ciphertext}` (base64url segments).
 */
export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.subarray(0, 32), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/** Returns null when the payload is malformed or was encrypted with another key. */
export function decryptJson<T = unknown>(payload: string, key: Buffer): T | null {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, ivB64, tagB64, ctB64] = parts;
  if (!ivB64 || !tagB64 || !ctB64) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.subarray(0, 32),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}
