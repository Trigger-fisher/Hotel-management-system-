import "server-only";
// The encrypted values in HMS: an integration password the system itself must use later (the mail server's). AES-256-GCM with HMS_SECRET_KEY (32 bytes, base64), a fresh 12-byte IV per seal, and a context bound in as additional
// data (the hotel id), so a sealed value copied into another hotel's row does not open. Stored as "v1.<iv>.<tag>.<ciphertext>", base64url.
// Nothing here logs; a failure says only that the value could not be opened.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { CryptoError } from "./errors";

const VERSION = "v1";

/** HMS_SECRET_KEY: base64 of exactly 32 bytes. Throws without echoing the value. */
export function parseSecretKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed) ? Buffer.from(trimmed, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new CryptoError("BAD_KEY", "HMS_SECRET_KEY must be base64 of exactly 32 bytes");
  return key;
}

export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`hms:${context}`, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(key: Buffer, sealed: string, context: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new CryptoError("BAD_INPUT", "The saved value could not be opened");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAAD(Buffer.from(`hms:${context}`, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("BAD_INPUT", "The saved value could not be opened");
  }
}
