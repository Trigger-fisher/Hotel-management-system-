import "server-only";
// Ids in the database are uuid columns (PostgreSQL gives them DEFAULT uuidv7()); the driver hands them over as lower-case dashed text, so an
// id is a string everywhere in the app. The app can also make ids itself (a child row that needs its parent's id before the insert), in order
// of time, the same way.
import { randomBytes } from "node:crypto";

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let lastMs = 0;
let sequence = 0;

/**
 * A UUID version 7: 48 bits of Unix milliseconds, then 12 bits that count up inside one millisecond (so ids made by one process are
 * strictly increasing, and a primary key on them inserts at the end of the index), then random bits. Lower-case, dashed.
 */
export function newId(now: number = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    ms = lastMs;
    sequence += 1;
    if (sequence > 0xfff) {
      ms += 1;
      sequence = 0;
    }
  } else {
    sequence = 0;
  }
  lastMs = ms;
  const bytes = randomBytes(16);
  bytes.writeUIntBE(ms, 0, 6);
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL.test(value);
}

/** The OLD schema name of a hotel: hotel_<32 hex> from its id (strictly checked: anything else throws). Since platform migration 0172 a hotel's schema is named for the hotel and read from platform.hotels (db/schemaDirectory.ts); this is only what a hotel not renamed yet has. */
export function hotelSchemaOf(hotelId: string): string {
  if (!isUuid(hotelId)) throw new TypeError("Not a hotel id");
  return `hotel_${hotelId.replaceAll("-", "")}`;
}
