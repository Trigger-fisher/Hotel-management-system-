import "server-only";
// Hashing for things that must never be stored in the clear (standard X2, X3).
//
//   * High-entropy secrets (a session token, a reset-link token: 256 random bits) only need a plain
//     SHA-256: nobody can guess them, so nobody can reverse the hash.
//   * LOW-entropy values cannot use a bare hash. A 6-digit emailed code has 10^6 possibilities, a username or mobile
//     number is guessable: if the table leaked, every row could be reversed in moments. They are hashed with HMAC-SHA256
//     under a server-side secret (HMS_HASH_KEY) that never reaches the database, so a leaked table alone is useless.
//     The message is built from length-prefixed parts, so ("ab", "c") and ("a", "bc") can never collide, and a domain
//     label keeps a code hash from ever equalling an identifier hash.
//
// Every function returns 64 lower-case hex characters, which is what the CHECK constraints in platform 0004 require.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CryptoError } from "./errors";
import { parseSecretKey } from "./keys";

export type CodePurpose = "login" | "reset" | "recheck";

const PURPOSES: ReadonlySet<string> = new Set<CodePurpose>(["login", "reset", "recheck"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_PART = 512;
// zero-width and byte-order-mark characters make two different strings look identical
const INVISIBLE = /[​-‍⁠﻿]/g;

export function parseHashKey(base64: string): Buffer {
  return parseSecretKey(base64, "HMS_HASH_KEY", { minBytes: 32 });
}

/** Plain SHA-256 for high-entropy tokens only. */
export function sha256Hex(token: string): string {
  if (token === "" || token.length > 4096) throw new CryptoError("BAD_INPUT");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** HMAC-SHA256 over length-prefixed parts, under a domain label. */
export function hmacHex(key: Buffer, domain: string, parts: readonly string[]): string {
  if (key.length < 32) throw new CryptoError("BAD_KEY");
  const mac = createHmac("sha256", key);
  const feed = (text: string): void => {
    if (text.length > MAX_PART) throw new CryptoError("BAD_INPUT");
    const bytes = Buffer.from(text, "utf8");
    mac.update(`${bytes.length}:`, "utf8");
    mac.update(bytes);
  };
  feed(domain);
  for (const part of parts) feed(part);
  return mac.digest("hex");
}

/** The hash stored for a one-time code: bound to its purpose and to the person it was issued to. */
export function hashAuthCode(key: Buffer, purpose: CodePurpose, userId: string, code: string): string {
  if (!PURPOSES.has(purpose) || !UUID.test(userId) || code === "") throw new CryptoError("BAD_INPUT");
  return hmacHex(key, "hms:auth-code:v1", [purpose, userId, code]);
}

/** The hash stored for an invitation link: the token is 256 random bits e-mailed once; only this keyed hash is kept (platform.invitation_links.token_hash). */
export function hashInviteToken(key: Buffer, token: string): string {
  if (token === "" || token.length > 200) throw new CryptoError("BAD_INPUT");
  return hmacHex(key, "hms:invite-token:v1", [token]);
}

/** Username, mobile or email as typed, made comparable: NFKC, invisible characters removed, trimmed, lower-case. */
export function normaliseIdentifier(value: string): string {
  return value.normalize("NFKC").replace(INVISIBLE, "").trim().toLowerCase();
}

/** The hash stored in login_attempts.identifier_hash. Normalised first, so "Asha " and "asha" count as one person. */
export function hashIdentifier(key: Buffer, identifier: string): string {
  const normalised = normaliseIdentifier(identifier);
  if (normalised === "") throw new CryptoError("BAD_INPUT");
  return hmacHex(key, "hms:identifier:v1", [normalised]);
}

/** Constant-time comparison of two hashes. False (never a throw) for anything that is not two 64-hex strings of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!HEX64.test(a) || !HEX64.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
