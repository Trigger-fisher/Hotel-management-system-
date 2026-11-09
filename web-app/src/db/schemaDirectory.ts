import "server-only";
// Which schema is a hotel's? (readable schemas, MJ 2 Nov 2026; platform migration 0172.) A hotel's schema is named for the hotel (<group>_<hotel>, or <hotel>), so it can no
// longer be worked out from the id: platform.hotels.schema_name holds it and this reads it. The answer is kept for a few seconds (a person's requests come in bursts, and the
// name changes only when the rename script runs), and is checked by withHotel before it is used. An unknown hotel is "not available", the same answer as a hotel whose role
// does not exist. The role (hotel_<hex>_rw) is NOT looked up: it never changes and is built from the id (schemaName.ts hotelRoleName).
import { AppError } from "../server/errors";
import { canonicalHotelId } from "./schemaName";
import type { ClientPool } from "./withHotel";

/** A few seconds: after the rename script an instance that still holds the old name is wrong for at most this long. */
export const SCHEMA_CACHE_MS = 5_000;
/** More than any real platform has hotels; a bound so the cache can never grow without end. */
const MAX_CACHED = 5_000;

export function createSchemaDirectory(pool: ClientPool, options: { ttlMs?: number; now?: () => number } = {}): (hotelId: string) => Promise<string> {
  const ttl = options.ttlMs ?? SCHEMA_CACHE_MS;
  const now = options.now ?? Date.now;
  const kept = new Map<string, { schema: string; until: number }>();
  return async (hotelId: string): Promise<string> => {
    const id = canonicalHotelId(hotelId);
    const hit = kept.get(id);
    if (hit && hit.until > now()) return hit.schema;
    const client = await pool.connect();
    let schema: string | undefined;
    try {
      const found = await client.query("SELECT schema_name FROM platform.hotels WHERE id = $1 AND deleted_at IS NULL", [id]);
      const value = found.rows[0]?.schema_name;
      if (typeof value === "string") schema = value;
    } finally {
      client.release();
    }
    if (schema === undefined) throw new AppError("FORBIDDEN", "Hotel is not available");
    if (kept.size >= MAX_CACHED) kept.clear();
    kept.set(id, { schema, until: now() + ttl });
    return schema;
  };
}
