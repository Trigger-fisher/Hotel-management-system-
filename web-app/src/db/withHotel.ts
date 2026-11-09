import "server-only";
// withHotel: the one door to a hotel's data. Standard T2, T3, T4 and the per-hotel role.
//
// Inside one transaction on a pooled connection, one prelude statement (schemaName.ts HOTEL_PRELUDE_SQL):
//   SELECT set_config('role', 'hotel_<hex>_rw', true),                       the hotel's own role: the ONLY privileges on its schema (the setting behind SET LOCAL ROLE)
//          set_config('search_path', 'hotel_<hex>, pg_catalog', true)        so unqualified names mean this hotel's tables
// Both are transaction-local, so COMMIT or ROLLBACK returns the connection to hms_app and a pooled connection never carries a hotel from one
// request to the next. BEGIN stays its own statement: the extended protocol takes one statement per query, and the single-statement guard below
// refuses stacked text. The hotel id comes from the verified session object, never from a request, and is validated before a connection is
// taken. Even if the search_path were wrong or SQL were injected, a table in another hotel's schema answers "permission denied", because
// hms_app holds no privilege on any hotel schema and the hotel role holds privileges on one schema only.
//
// A broken connection (A1): a checked-out client has an `error` listener for the whole time it is ours, because an EventEmitter with no
// listener turns an `error` event into an uncaught exception and kills the Node process when PostgreSQL drops a backend mid-transaction.
// Every statement also has a timeout. A client that errored, timed out or could not ROLLBACK is destroyed (release(true)), never handed back.
import { classifyPgError } from "../server/db/pgErrors";
import { AppError } from "../server/errors";
import { hasStackedStatements } from "./singleStatement";
import { HOTEL_PRELUDE_SCOPED_SQL, HOTEL_PRELUDE_SQL, assertHotelSchemaName, hotelRoleName, hotelSchemaName, searchPathOfSchema } from "./schemaName";
import { assumeTransaction, type SqlClient, type SqlResult, type TxClient } from "./types";

/** A connection checked out of the pool (node-postgres' PoolClient fits). `release(true)` destroys a connection that may be broken. */
export interface PooledClient {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(destroy?: boolean): void;
  on(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
}

export interface ClientPool {
  connect(): Promise<PooledClient>;
}

/** What the sign-in layer produces after verifying a session. The hotel id here is the only source withHotel accepts. */
export interface VerifiedSession {
  readonly hotelId: string;
  /** Platform staff looking inside a hotel (Enter hotel): the whole transaction is READ ONLY, so the database itself refuses any write (BACKEND.md 14.7). */
  readonly readOnly?: boolean;
  /**
   * A guest or company account's record scope (T8): set per transaction as hms.scope_kind and hms.scope_id, which the row-level security policies of
   * hotel migration 0035 read, so the database itself hides every bill, stay, reservation, advance, charge, request, customer and company that is not
   * theirs. Absent for hotel staff, platform visits and the workers: the policies then pass every row.
   */
  readonly scope?: { readonly kind: "guest" | "company"; readonly id: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WithHotelOptions {
  /** Longest a single statement may take on the client before the connection is given up on. Default 20 s (the role's statement_timeout is 15 s). */
  queryTimeoutMs?: number;
  /**
   * The hotel's schema name as platform.hotels holds it (readable schemas, migration 0172: <group>_<hotel> or <hotel>); db/schemaDirectory.ts makes it, with a short cache.
   * Without it the old rule applies (hotel_<32 hex>), which is what the tests and a database not yet renamed have. The answer is checked before it is used.
   */
  schemaOf?: (hotelId: string) => Promise<string>;
}

export interface RunOptions {
  /**
   * Run the whole unit again, once, when PostgreSQL picks it as a deadlock or serialization victim (40P01, 40001). Only for a unit of plain
   * database work: anything with an effect outside the database (a mail, a payment) must not be repeated.
   */
  retryOnDeadlock?: boolean;
}

export type WithHotel = <T>(session: VerifiedSession, work: (tx: TxClient) => Promise<T>, options?: RunOptions) => Promise<T>;

export const DEFAULT_QUERY_TIMEOUT_MS = 20_000;

export function createWithHotel(pool: ClientPool, options: WithHotelOptions = {}): WithHotel {
  const timeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  return async <T>(session: VerifiedSession, work: (tx: TxClient) => Promise<T>, run: RunOptions = {}): Promise<T> => {
    // validate BEFORE taking a connection: a bad id never reaches the database
    const role = hotelRoleName(session.hotelId);
    const schema = options.schemaOf ? assertHotelSchemaName(await options.schemaOf(session.hotelId)) : hotelSchemaName(session.hotelId);
    const searchPath = searchPathOfSchema(schema);
    const scope = session.scope;
    if (scope && (!UUID.test(scope.id) || (scope.kind !== "guest" && scope.kind !== "company"))) throw new AppError("FORBIDDEN", "Record scope is not valid");
    const client = await pool.connect();
    let broken = false;
    let connectionError: Error | undefined;
    // without this listener an `error` event on the client would crash the process
    const onError = (error: Error): void => {
      broken = true;
      connectionError ??= error;
    };
    client.on("error", onError);

    const guarded: SqlClient = {
      query(text: string, params?: readonly unknown[]): Promise<SqlResult> {
        if (connectionError) return Promise.reject(connectionError);
        // one statement per query: an injected `...; SET ROLE another_hotel` is refused here, before the server sees it
        if (hasStackedStatements(text)) return Promise.reject(new AppError("SERVER_ERROR", "A query must hold exactly one statement"));
        return new Promise<SqlResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            broken = true;
            reject(new AppError("SERVER_ERROR", "A database statement timed out"));
          }, timeoutMs);
          client.query(text, params as unknown[] | undefined).then(
            (result) => {
              clearTimeout(timer);
              resolve({ rows: result.rows, affectedRows: result.rowCount ?? 0 });
            },
            (error: unknown) => {
              clearTimeout(timer);
              if (classifyPgError(error).kind === "connection_lost") broken = true;
              reject(error);
            },
          );
        });
      },
    };

    const attempt = async (): Promise<T> => {
      await guarded.query(session.readOnly === true ? "BEGIN READ ONLY" : "BEGIN");
      try {
        // the role, the search path and (a portal account) the scope for the row-level security policies (0035), in one statement before any of the work's;
        // a role that does not exist (22023) means there is no such hotel: say that, never the server's text
        const prelude = scope ? guarded.query(HOTEL_PRELUDE_SCOPED_SQL, [role, searchPath, scope.kind, scope.id.toLowerCase()]) : guarded.query(HOTEL_PRELUDE_SQL, [role, searchPath]);
        await prelude.catch((error: unknown) => {
          if ((error as { code?: unknown }).code === "22023") throw new AppError("FORBIDDEN", "Hotel is not available");
          throw error;
        });
        const result = await work(assumeTransaction(guarded, schema));
        await guarded.query("COMMIT");
        return result;
      } catch (error) {
        if (!broken) {
          try {
            await guarded.query("ROLLBACK");
          } catch {
            broken = true; // the connection cannot be trusted: do not hand it back to the pool
          }
        }
        throw error;
      }
    };

    try {
      try {
        return await attempt();
      } catch (error) {
        const kind = classifyPgError(error).kind;
        if (run.retryOnDeadlock === true && !broken && (kind === "deadlock" || kind === "serialization")) return await attempt();
        throw error;
      }
    } finally {
      client.removeListener("error", onError);
      client.release(broken);
    }
  };
}
