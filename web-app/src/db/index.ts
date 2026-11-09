import "server-only";
// Builds the app's database layer from the environment: ONE shared pool under a connection budget, and withHotel on top of it.
// Nothing here runs at import time: the first call to getDatabase() reads the config, so tests and the build never need a database.
import { loadConfig } from "../server/config/env";
import { createNotificationListener, createSharedPool, type NotificationListener, type SharedPool } from "./pool";
import { createSchemaDirectory } from "./schemaDirectory";
import { aiUrlName, aiUrlsFrom, createAiRouter, type AiRoute, type AiRouter, type AiScope } from "./aiRouter";
import { createShardRouter, shardUrlName, SHARD_URL_PREFIX } from "./shardRouter";
import { createWithHotel, type WithHotel } from "./withHotel";

/** The AI databases (migration 0176): which one serves a scope, and whether each can be reached. Nothing here calls an AI service. */
export interface AiAccess {
  readonly router: AiRouter<SharedPool>;
  /** Every AI database on the map: its key, status, whether this server has an address for it, and whether it answered. Never the address. */
  health(): Promise<{ key: string; status: string; configured: boolean; reachable: boolean; ms: number | null }[]>;
}

export interface Database {
  readonly withHotel: WithHotel;
  readonly pool: SharedPool;
  readonly ai: AiAccess;
  close(): Promise<void>;
}

export function createDatabase(config: { databaseUrl: string; totalConnections: number; minConnections?: number; idleSeconds?: number; pooled?: boolean; shardUrls?: Readonly<Record<string, string>>; aiUrls?: Readonly<Record<string, string>> }): Database {
  const settings = { max: config.totalConnections, min: config.minConnections, idleSeconds: config.idleSeconds, pooled: config.pooled };
  const pool = createSharedPool({ databaseUrl: config.databaseUrl, ...settings });
  // a hotel's schema is named for the hotel (migration 0172): read from platform.hotels on the main database, for the hotels of every shard
  const schemaOf = createSchemaDirectory(pool);
  const main = createWithHotel(pool, { schemaOf });
  // AI databases: a small pool each, made on first use; the AI map is read from the main database (platform.ai_routes)
  const aiUrls = config.aiUrls ?? {};
  const aiPools = new Map<string, SharedPool>();
  const aiPool = (key: string): SharedPool | null => {
    const url = aiUrls[aiUrlName(key)];
    if (!url) return null;
    let made = aiPools.get(key);
    if (!made) {
      made = createSharedPool({ databaseUrl: url, ...settings, max: Math.min(settings.max, 3), min: 0 });
      aiPools.set(key, made);
    }
    return made;
  };
  const aiLookup = async (scope: AiScope): Promise<AiRoute | null> => {
    const where = scope.kind === "hotel" ? "r.scope_kind = 'hotel' AND r.hotel_id = $1::uuid" : scope.kind === "group" ? "r.scope_kind = 'group' AND r.group_id = $1::uuid" : "r.scope_kind = 'platform' AND $1::text IS NULL";
    const arg = scope.kind === "hotel" ? scope.hotelId : scope.kind === "group" ? scope.groupId : null;
    const client = await pool.connect();
    try {
      const r = await client.query(`SELECT d.key, r.enabled, r.features, r.daily_request_limit, r.monthly_budget_paise FROM platform.ai_routes r JOIN platform.ai_databases d ON d.id = r.ai_database_id WHERE d.status <> 'retired' AND ${where}`, [arg]);
      const row = r.rows[0];
      return row ? { databaseKey: String(row.key), enabled: row.enabled === true, features: Array.isArray(row.features) ? row.features.map(String) : [], dailyRequestLimit: Number(row.daily_request_limit), monthlyBudgetPaise: Number(row.monthly_budget_paise) } : null;
    } finally {
      client.release();
    }
  };
  const aiRouter = createAiRouter<SharedPool>({ lookup: aiLookup, connect: aiPool });
  const ai: AiAccess = {
    router: aiRouter,
    async health() {
      const client = await pool.connect();
      let rows: Record<string, unknown>[];
      try {
        rows = (await client.query("SELECT key, status FROM platform.ai_databases ORDER BY key")).rows as Record<string, unknown>[];
      } finally {
        client.release();
      }
      return Promise.all(
        rows.map(async (row) => {
          const key = String(row.key);
          const target = aiPool(key);
          if (!target) return { key, status: String(row.status), configured: false, reachable: false, ms: null };
          const started = Date.now();
          try {
            const c = await target.connect();
            try {
              await c.query("SELECT 1");
            } finally {
              c.release();
            }
            return { key, status: String(row.status), configured: true, reachable: true, ms: Date.now() - started };
          } catch {
            return { key, status: String(row.status), configured: true, reachable: false, ms: null };
          }
        }),
      );
    },
  };
  const closeAi = (): Promise<unknown> => Promise.all([...aiPools.values()].map((p) => p.end()));
  const shardUrls = config.shardUrls ?? {};
  if (Object.keys(shardUrls).length === 0) return { withHotel: main, pool, ai, close: async () => void (await Promise.all([pool.end(), closeAi()])) };
  // Other shards: a pool each, made on first use. The hotel -> shard map is read from the main database.
  const shardPools = new Map<string, { pool: SharedPool; withHotel: WithHotel }>();
  const forShard = (key: string): WithHotel | null => {
    const url = shardUrls[shardUrlName(key)];
    if (!url) return null;
    let made = shardPools.get(key);
    if (!made) {
      const p = createSharedPool({ databaseUrl: url, ...settings });
      made = { pool: p, withHotel: createWithHotel(p, { schemaOf }) };
      shardPools.set(key, made);
    }
    return made.withHotel;
  };
  const lookup = async (hotelId: string): Promise<string | null> => {
    const client = await pool.connect();
    try {
      const r = await client.query("SELECT s.key FROM platform.hotel_shards hs JOIN platform.shards s ON s.id = hs.shard_id WHERE hs.hotel_id = $1", [hotelId]);
      return r.rows[0] ? String(r.rows[0].key) : null;
    } finally {
      client.release();
    }
  };
  return {
    withHotel: createShardRouter({ main, lookup, forShard }),
    pool,
    ai,
    close: async () => {
      await Promise.all([pool.end(), closeAi(), ...[...shardPools.values()].map((s) => s.pool.end())]);
    },
  };
}

/** The extra shard databases named in the environment, by variable name: DATABASE_URL_SHARD_EU_1=... serves the shard with key "eu-1". */
export function shardUrlsFrom(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (name.startsWith(SHARD_URL_PREFIX) && value) out[name] = value;
  return out;
}
// In development the module is re-evaluated on every hot reload; the pool lives on globalThis so a reload reuses it instead of leaving the old one
// open (that leak, times several dev servers, once used up every connection of the local PostgreSQL).
const globalForDb = globalThis as typeof globalThis & { __hmsDatabase?: Database };

/**
 * The pool settings: the environment's own values; else on a serverless host (VERCEL set) a small pool per function instance (3 connections, none kept for
 * ever, an idle one closed after 300 s: a new connection to the far-away pooler costs about 1.2 s, so a connection outlives the short gaps between a person's
 * requests, while many instances still share one database connection cap). `min` stays 0 there on purpose: pg-pool sets NO idle timer on a connection at or below
 * `min`, so a kept one would never be closed and, after the instance was suspended for minutes, could be a dead socket that hangs the first request; with
 * min 0 every connection carries a timer, and one overdue after a suspension fires on thaw, before the next request can reuse it. Else (outside production)
 * small self-cleaning ones for a developer's PC; else the app defaults (one long-lived server).
 */
export function poolSettingsFor(env: Readonly<Record<string, string | undefined>>, config: { DB_POOL_MAX: number; DB_POOL_MIN: number; DB_POOL_IDLE_SECONDS: number }): { max: number; min: number; idleSeconds: number } {
  const dev = env.NODE_ENV !== "production";
  const serverless = env.VERCEL !== undefined && env.VERCEL !== "";
  const set = (name: string) => env[name] !== undefined && env[name] !== "";
  return {
    max: set("DB_POOL_MAX") ? config.DB_POOL_MAX : serverless ? 3 : dev ? 5 : config.DB_POOL_MAX,
    min: set("DB_POOL_MIN") ? config.DB_POOL_MIN : serverless || dev ? 0 : config.DB_POOL_MIN,
    idleSeconds: set("DB_POOL_IDLE_SECONDS") ? config.DB_POOL_IDLE_SECONDS : serverless ? 300 : dev ? 30 : config.DB_POOL_IDLE_SECONDS,
  };
}

/**
 * A LISTEN connection on the main database, or null when there is no database or it is reached through a transaction pooler (DB_POOLED=1: a pooler cannot hold a LISTEN).
 * NOTIFY itself is sent on the shared pool by the caller.
 */
export function listenOn(channel: string, onPayload: (payload: string) => void, onState?: (up: boolean) => void, env: Readonly<Record<string, string | undefined>> = process.env): NotificationListener | null {
  const config = loadConfig(env);
  if (!config.DATABASE_URL || config.DB_POOLED === "1") return null;
  return createNotificationListener({ databaseUrl: config.DATABASE_URL, channel, onPayload, onState });
}

/** Closes the shared pool when one was made (graceful shutdown). Safe to call twice. */
export async function closeDatabase(): Promise<void> {
  const db = globalForDb.__hmsDatabase;
  globalForDb.__hmsDatabase = undefined;
  if (db) await db.close();
}

/** The process-wide database layer, made on first use. Throws a clear error (names only) when the environment is not set up. */
export function getDatabase(env: Readonly<Record<string, string | undefined>> = process.env): Database {
  if (globalForDb.__hmsDatabase) return globalForDb.__hmsDatabase;
  const config = loadConfig(env);
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required to reach the database (run: npm run db:cli -- setup)");
  const pool = poolSettingsFor(env, config);
  globalForDb.__hmsDatabase = createDatabase({ databaseUrl: config.DATABASE_URL, totalConnections: pool.max, minConnections: pool.min, idleSeconds: pool.idleSeconds, pooled: config.DB_POOLED === "1", shardUrls: shardUrlsFrom(env), aiUrls: aiUrlsFrom(env) });
  return globalForDb.__hmsDatabase;
}
