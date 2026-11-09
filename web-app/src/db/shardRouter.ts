import "server-only";
// Picks the database a hotel lives on (decision 72: about 300 hotels per shard, the central tables stay on the main database). The map is platform.hotel_shards on the main database;
// a hotel on shard "main" (every hotel today) uses the main database, another shard uses its own database from DATABASE_URL_SHARD_<KEY>. No shard URL set = the main database
// answers, so a single-database set-up behaves exactly as before.
import type { VerifiedSession, WithHotel } from "./withHotel";

export const SHARD_URL_PREFIX = "DATABASE_URL_SHARD_";
const MAIN = "main";

/** The environment variable that holds the database URL of a shard key ("eu-1" -> DATABASE_URL_SHARD_EU_1). */
export const shardUrlName = (key: string): string => `${SHARD_URL_PREFIX}${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export interface ShardRouterOptions {
  /** withHotel on the main database. */
  main: WithHotel;
  /** The shard key of a hotel from the map on the main database; null when the hotel is not on the map. */
  lookup: (hotelId: string) => Promise<string | null>;
  /** withHotel for a shard other than main; null when that shard has no database configured here. */
  forShard: (key: string) => WithHotel | null;
  /** How long a hotel's shard is remembered (ms). A hotel moves rarely; default 60 s. */
  ttlMs?: number;
  now?: () => number;
}

export function createShardRouter(options: ShardRouterOptions): WithHotel {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  const seen = new Map<string, { key: string; at: number }>();
  const keyOf = async (hotelId: string): Promise<string> => {
    const hit = seen.get(hotelId);
    if (hit && now() - hit.at < ttl) return hit.key;
    let key = MAIN;
    try {
      key = (await options.lookup(hotelId)) ?? MAIN;
    } catch {
      // the map could not be read: the main database answers, as it did before shards existed
    }
    if (seen.size > 5000) seen.clear();
    seen.set(hotelId, { key, at: now() });
    return key;
  };
  return async <T>(session: VerifiedSession, work: Parameters<WithHotel>[1], run?: Parameters<WithHotel>[2]): Promise<T> => {
    const key = await keyOf(session.hotelId);
    const target = key === MAIN ? options.main : (options.forShard(key) ?? options.main);
    return target(session, work, run) as Promise<T>;
  };
}
