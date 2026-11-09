// The only place the `pg` package is touched by the PostgreSQL database scripts. It is loaded when a command actually connects, resolved from
// web-app/node_modules (the scripts live outside the web app's folder). Everything above this file sees one minimal client: `query(text, params)` returning `{ rows, affectedRows }`, and `end()`. Placeholders are PostgreSQL's own ($1, $2).
//
// Settings that matter for correctness (Backend Review/08-POSTGRES-FINAL.md): the session time zone is UTC; BIGINT comes back as TEXT (pg's default
// for int8) and is converted by one helper; an `error` listener is always attached (an unhandled pool/client error would crash the process).
import { createRequire } from "node:module";
import path from "node:path";

export interface DbResult {
  rows: Record<string, unknown>[];
  affectedRows: number;
}

/** The minimal client every database script uses: query(text, params) with $1 placeholders, and end(). */
export interface DbClient {
  query(text: string, params?: readonly unknown[]): Promise<DbResult>;
  end(): Promise<void>;
}

interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): void;
}

interface PgModule {
  Client: new (config: Record<string, unknown>) => PgClient;
}

export function loadPg(): PgModule {
  // Two places to look, in order: the web app's own folder (the Next server runs with it as the working directory; there the bundler rewrites __dirname
  // to a virtual path, so __dirname cannot be trusted), then web-app/ relative to this script (tsx and the CLI).
  const roots = [path.join(process.cwd(), "package.json"), path.join(__dirname, "..", "..", "..", "web-app", "package.json")];
  let last: unknown;
  for (const root of roots) {
    try {
      return createRequire(root)("pg") as PgModule;
    } catch (error) {
      last = error;
    }
  }
  throw new Error('The "pg" package could not be loaded (run npm install in web-app)', { cause: last });
}

/** A postgres:// URL as the pg client's connection settings. The password is URL-decoded; nothing here prints it. */
export function pgOptionsFromUrl(url: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("A PostgreSQL connection string must start with postgres://");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ...(database === "" ? {} : { database }),
    connectionTimeoutMillis: 10_000,
    // a hosted database (Supabase) is reached over TLS: sslmode=require|verify-ca|verify-full in the URL turns it on (it was dropped before)
    ...(["require", "verify-ca", "verify-full"].includes(parsed.searchParams.get("sslmode") ?? "") ? { ssl: true } : {}), // certificate verified (stricter than libpq's "require", which does not verify)
    ...overrides,
  };
}

/** A postgres:// URL for the HMS instance (127.0.0.1:5433 unless told otherwise). */
export function pgUrl(args: { user: string; password: string; host?: string; port?: number; database?: string }): string {
  return `postgres://${encodeURIComponent(args.user)}:${encodeURIComponent(args.password)}@${args.host ?? "127.0.0.1"}:${args.port ?? 5433}/${args.database ?? "postgres"}`;
}

export function pgWithDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

export async function connectPg(url: string, overrides: Record<string, unknown> = {}): Promise<DbClient> {
  const { Client } = loadPg();
  const client = new Client(pgOptionsFromUrl(url, overrides));
  // a dropped connection must not crash the process: the next query reports it
  client.on("error", () => undefined);
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return {
    async query(text, params = []): Promise<DbResult> {
      const result = await client.query(text, params);
      return { rows: result.rows ?? [], affectedRows: result.rowCount ?? 0 };
    },
    end: () => client.end(),
  };
}
