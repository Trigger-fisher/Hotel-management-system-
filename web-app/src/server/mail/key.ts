import "server-only";
import { hkdfSync } from "node:crypto";
import { parseHashKey } from "../crypto/hash";
import { parseSecretKey } from "../crypto/secretBox";

// The key that seals the mail password (Platform settings > Mail, a hotel's Settings > Email). MJ's rule (17 Oct 2026): nothing extra to set up. When SMTP_SECRET_KEY is present
// (base64 of 32 bytes) it WINS (an optional override, e.g. to rotate it on its own); otherwise the key is DERIVED from the server secret HMS_HASH_KEY, which the app already
// requires: HKDF with SHA-256, an empty salt, the fixed info string "hms-smtp-v1", 32 bytes. The derived key is separate from the hash key itself (a different purpose gives a
// different key) and is the same on every start. A password sealed under a different key than the one now in use does not open: it is treated as unreadable (the sender falls back
// to the server's own settings and the settings page says so). No key at all (no HMS_HASH_KEY, a development machine without a database) = null.
export const SMTP_KEY_INFO = "hms-smtp-v1";

export function deriveSmtpKey(hashKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", hashKey, Buffer.alloc(0), SMTP_KEY_INFO, 32));
}

export function smtpSecretKeyOf(config: { SMTP_SECRET_KEY?: string; HMS_HASH_KEY?: string }): Buffer | null {
  if (config.SMTP_SECRET_KEY) return parseSecretKey(config.SMTP_SECRET_KEY);
  if (config.HMS_HASH_KEY) return deriveSmtpKey(parseHashKey(config.HMS_HASH_KEY));
  return null;
}