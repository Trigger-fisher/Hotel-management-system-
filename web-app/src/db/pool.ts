import "server-only";
// The only file (with db/index.ts) that touches the `pg` package in the app. ONE shared pool for the whole process (default 20 connections),
// logged in as hms_app. A request becomes a hotel only inside withHotel (SET LOCAL ROLE + search_path), so there is no pool per hotel.
// Settings that matter for correctness (docs/DATABASE.md "PostgreSQL rules"):
//   * UTC everywhere: every connection starts with timezone=UTC (the roles have it too);
//   * bigint and numeric come back as TEXT, date and time as text, timestamptz as a Date: see db/convert.ts;
//   * statement, lock and idle-in-transaction time limits are set on the hms_app role by db/scripts/pg-setup.ts.
import pg from "pg";
import type { ClientPool, PooledClient } from "./withHotel";

const DATE_OID = 1082;
const TIME_OID = 1083;

/** Parsers: a calendar date and a time of day stay text (a day has no zone); everything else keeps the driver's default (bigint and numeric are text). */
export const pgTypes = {
  getTypeParser(oid: number, format?: "text" | "binary"): (value: string) => unknown {
    if (oid === DATE_OID || oid === TIME_OID) return (value: string) => value;
    return (pg.types.getTypeParser as (oid: number, format?: "text" | "binary") => (value: string) => unknown)(oid, format);
  },
};

interface PoolConfig {
  /** DATABASE_URL: the hms_app login. */
  databaseUrl: string;
  /** Connections in the shared pool. Default 20. */
  max?: number;
  /** Connections kept open between bursts. Default 4 (0 on serverless: a connection at or below `min` gets no idle timer and would never be closed). */
  min?: number;
  /** Seconds an idle connection is kept. Default 600. */
  idleSeconds?: number;
  /** Through a transaction pooler: no startup options (a pooler refuses them); the hms_app role carries timezone=UTC, so nothing is lost. */
  pooled?: boolean;
}

export interface SharedPool extends ClientPool {
  end(): Promise<void>;
  /** What this pool was built with (diagnostics and tests). */
  readonly settings: { readonly max: number; readonly min: number; readonly idleSeconds: number; readonly pooled: boolean };
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

/**
 * Encrypt the connection to a hosted database (3 Nov 2026: Supabase began refusing hms_app without SSL, "ESSLREQUIRED", and every sign-in failed). A local database
 * (127.0.0.1, localhost) stays plain; a URL that already says what it wants (`sslmode=...`) is left to the driver; `DB_SSL=off` switches it off, `DB_SSL=verify` checks
 * the certificate chain (needs the provider's CA in NODE_EXTRA_CA_CERTS). Otherwise encrypted without chain checking, as the setup scripts connect to the same server.
 */
export function sslOptionFor(url: string, dbSsl: string | undefined = process.env.DB_SSL): false | true | { rejectUnauthorized: boolean } | undefined {
  if (dbSsl === "off") return undefined;
  if (/[?&]sslmode=/i.test(url)) return undefined;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return undefined;
  return dbSsl === "verify" ? true : { rejectUnauthorized: false };
}

/**
 * One connection runs one query at a time. A service that starts several reads on the same client with Promise.all made the driver queue them itself and warn
 * "Calling client.query() when the client is already executing a query" (removed in pg 9). Here the calls wait for each other in the order they were made, so the
 * result is the same and the driver never sees an overlap. A failed query does not stop the ones behind it.
 */
export function oneAtATime<T extends Pick<PooledClient, "query">>(client: T): T {
  const run = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
  let tail: Promise<unknown> = Promise.resolve();
  (client as { query: unknown }).query = (...args: unknown[]) => {
    const next = tail.then(() => run(...args));
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return client;
}

export interface NotificationListener {
  /** True while the LISTEN connection is open. */
  readonly up: boolean;
  close(): Promise<void>;
}

/**
 * One dedicated connection that LISTENs on a channel (never through a transaction pooler: LISTEN needs a session). A lost connection is opened again with a growing wait
 * (2 s to 60 s); `onState` hears every change, so the caller knows when to deliver on its own.
 */
export function createNotificationListener(config: { databaseUrl: string; channel: string; onPayload: (payload: string) => void; onState?: (up: boolean) => void }): NotificationListener {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(config.channel)) throw new Error("listener channel must be a plain lower-case name");
  const ssl = sslOptionFor(config.databaseUrl);
  let client: pg.Client | null = null;
  let up = false;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const setUp = (next: boolean) => {
    if (up === next) return;
    up = next;
    config.onState?.(next);
  };
  const again = () => {
    setUp(false);
    const c = client;
    client = null;
    if (c) void c.end().catch(() => undefined);
    if (closed || timer) return;
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, Math.min(60_000, 2000 * 2 ** Math.min(attempt - 1, 5)));
  };
  const open = async (): Promise<void> => {
    if (closed) return;
    const c = new pg.Client({ connectionString: config.databaseUrl, ...(ssl !== undefined ? { ssl } : {}), keepAlive: true, keepAliveInitialDelayMillis: 10_000, connectionTimeoutMillis: 5000 });
    client = c;
    c.on("error", () => client === c && again());
    c.on("end", () => client === c && again());
    c.on("notification", (n) => {
      if (n.channel === config.channel && typeof n.payload === "string") config.onPayload(n.payload);
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${config.channel}`);
      if (closed) return void (await c.end().catch(() => undefined));
      attempt = 0;
      setUp(true);
    } catch {
      if (client === c) again();
    }
  };
  void open();
  return {
    get up() {
      return up;
    },
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      setUp(false);
      const c = client;
      client = null;
      if (c) await c.end().catch(() => undefined);
    },
  };
}

export function createSharedPool(config: PoolConfig): SharedPool {
  const ssl = sslOptionFor(config.databaseUrl);
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ...(ssl !== undefined ? { ssl } : {}),
    max: config.max ?? 20,
    // a few connections stay open between bursts: opening one costs a password exchange (about 80 ms here), paid by the first request after a quiet spell
    min: Math.min(config.min ?? 4, config.max ?? 20),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: (config.idleSeconds ?? 600) * 1000,
    keepAlive: true,
    // the kept connection sends a TCP keep-alive after 10 quiet seconds, so a pooler or a NAT between does not drop it unnoticed during the long idle time
    keepAliveInitialDelayMillis: 10_000,
    types: pgTypes,
    // a transaction pooler refuses startup options: the login role (hms_app) carries timezone=UTC itself (db/scripts/pg-setup.ts)
    ...(config.pooled ? {} : { options: "-c timezone=UTC" }),
  });
  // an idle connection that the server drops must not crash the process
  pool.on("error", () => undefined);
  return {
    settings: { max: config.max ?? 20, min: Math.min(config.min ?? 4, config.max ?? 20), idleSeconds: config.idleSeconds ?? 600, pooled: config.pooled === true },
    connect: async () => oneAtATime((await pool.connect()) as unknown as PooledClient),
    end: () => pool.end(),
    get totalCount() {
      return pool.totalCount;
    },
    get idleCount() {
      return pool.idleCount;
    },
    get waitingCount() {
      return pool.waitingCount;
    },
  };
}
