import "server-only";
// Sealed personal numbers (decision 74): Aadhaar, passport, PAN, licence and voter ID numbers, bank account numbers and IFSC codes are stored sealed, never as plain text.
// ONE place does it, so no service writes its own crypto.
//
//   * HMS_DATA_KEY (32 random bytes, base64) is the root. Two sub-keys are derived from it with HKDF, one to seal and one to build the search index, so a
//     weakness in one use can never reach the other. It is separate from HMS_SECRET_KEY (the vault and the saved Pathik password), so rotating one never breaks the other.
//   * seal: AES-256-GCM (secretBox.ts), a fresh IV every time, bound to the hotel AND the field name. A sealed value copied into another hotel's row, or into
//     another column, does not open.
//   * blindIndex: an HMAC of the cleaned number under the hotel and field, 64 hex. It finds "the same ID number again" (duplicate check, search by number)
//     without opening anything. It reveals nothing about the number without the key and is different in every hotel and every field.
//   * mask: only the last 4 characters, for lists, the guest portal and printed copies that do not need the whole number.
// Nothing here logs. A failure says only that the value could not be opened; no value ever appears in a message.
import { hkdfSync } from "node:crypto";
import { CryptoError } from "./errors";
import { hmacHex } from "./hash";
import { parseSecretKey } from "./keys";
import { open, seal } from "./secretBox";

const SEAL_INFO = "hms-field-seal-v1";
const INDEX_INFO = "hms-field-index-v1";
// "v1." + iv (12 bytes = 16 chars) + tag (16 bytes = 22 chars) + a body of at least 1 byte, all base64url: tells a sealed value from plain text, so a backfill can be run twice safely
const SEALED_SHAPE = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{2,}$/;
const MAX_NUMBER = 200;
const FIELD_NAME = /^[a-z][a-z0-9_.]{1,63}$/;
const HOTEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** HMS_DATA_KEY: base64 of exactly 32 bytes. The error names the variable, never the value. */
export function parseDataKey(base64: string): Buffer {
  return parseSecretKey(base64, "HMS_DATA_KEY", { exactBytes: 32 });
}

export interface FieldSeal {
  /** Seals one number for one field of one hotel. Empty or blank in, null out (nothing to hide). */
  seal(hotelId: string, field: string, plain: string | null | undefined): string | null;
  /** Opens a sealed value. A value that is not sealed (still plain) is refused, so a missed migration shows up instead of passing a ciphertext on as a number. */
  open(hotelId: string, field: string, sealed: string | null | undefined): string | null;
  /** The search index of a number (64 hex), or null for a blank. Same number, same hotel, same field = same index. Spaces, dashes and case do not matter. */
  blindIndex(hotelId: string, field: string, plain: string | null | undefined): string | null;
}

/** True when the text has the shape of a sealed value (used by the backfill to skip rows already done). */
export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && SEALED_SHAPE.test(value);
}

/** What a list, the guest portal or a printed copy may show: bullets and the last 4 characters. Fewer than 5 characters show only bullets. */
export function maskNumber(plain: string | null | undefined): string {
  const text = (plain ?? "").trim();
  if (text === "") return "";
  return text.length <= 4 ? "••••" : `••••${text.slice(-4)}`;
}

/** The number cleaned for the index: spaces, dashes and dots out, upper case. "1234 5678 9012" and "123456789012" are the same Aadhaar. */
export function cleanForIndex(plain: string): string {
  return plain.normalize("NFKC").replace(/[\s\-._/]+/g, "").toUpperCase();
}

function check(hotelId: string, field: string): void {
  if (!HOTEL_ID.test(hotelId) || !FIELD_NAME.test(field)) throw new CryptoError("BAD_INPUT");
}

export function createFieldSeal(dataKey: Buffer): FieldSeal {
  if (dataKey.length !== 32) throw new CryptoError("BAD_KEY", "HMS_DATA_KEY must decode to exactly 32 bytes");
  const sealKey = Buffer.from(hkdfSync("sha256", dataKey, Buffer.alloc(0), SEAL_INFO, 32));
  const indexKey = Buffer.from(hkdfSync("sha256", dataKey, Buffer.alloc(0), INDEX_INFO, 32));
  const context = (hotelId: string, field: string): string => `field:${hotelId}:${field}`;
  return {
    seal(hotelId, field, plain) {
      check(hotelId, field);
      if (plain === null || plain === undefined) return null;
      const text = plain.trim();
      if (text === "") return null;
      if (text.length > MAX_NUMBER) throw new CryptoError("BAD_INPUT");
      return seal(sealKey, text, context(hotelId, field));
    },
    open(hotelId, field, sealed) {
      check(hotelId, field);
      if (sealed === null || sealed === undefined || sealed === "") return null;
      if (!SEALED_SHAPE.test(sealed)) throw new CryptoError("BAD_INPUT", "The saved value could not be opened");
      return open(sealKey, sealed, context(hotelId, field));
    },
    blindIndex(hotelId, field, plain) {
      check(hotelId, field);
      if (plain === null || plain === undefined) return null;
      const cleaned = cleanForIndex(plain);
      if (cleaned === "") return null;
      if (cleaned.length > MAX_NUMBER) throw new CryptoError("BAD_INPUT");
      return hmacHex(indexKey, "field-index", [hotelId, field, cleaned]);
    },
  };
}
