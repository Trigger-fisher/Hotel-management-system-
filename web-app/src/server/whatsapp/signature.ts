import "server-only";
// Meta signs every webhook call: X-Hub-Signature-256 is "sha256=" and the hex HMAC-SHA256 of the RAW body made with the app secret. The check is made on the bytes as received (before any
// parsing), in constant time, and a call without a valid signature is refused before anything is read from it (plan part 9).
import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(appSecret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

export function signatureMatches(appSecret: string, rawBody: string, header: string | null | undefined): boolean {
  if (typeof header !== "string" || !/^sha256=[0-9a-fA-F]{64}$/.test(header.trim())) return false;
  const given = Buffer.from(header.trim().slice(7).toLowerCase(), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}
