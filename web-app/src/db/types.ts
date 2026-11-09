import "server-only";
// The smallest database-client shape the data layer needs. A node-postgres client (through db/pool.ts) fits it, and so does the fake used in
// tests, so the SQL logic can be tested without a database.
//
// What comes back from PostgreSQL (db/pool.ts sets the parsers): uuid, text, boolean and jsonb as the natural JS values; bigint and numeric as
// TEXT (nothing is ever rounded by a driver guess); timestamptz as a Date; date as "YYYY-MM-DD" text. Convert with db/convert.ts at the
// repository edge, never ad hoc.

export interface SqlResult {
  /** The rows of a SELECT, or of an INSERT/UPDATE/DELETE with RETURNING; empty otherwise. */
  rows: Record<string, unknown>[];
  /** How many rows an INSERT, UPDATE or DELETE changed (0 for a SELECT). */
  affectedRows: number;
}

export interface SqlClient {
  query(text: string, params?: readonly unknown[]): Promise<SqlResult>;
}

declare const inTransaction: unique symbol;

/**
 * A client that is inside BEGIN ... COMMIT, acting as that hotel's own role with the hotel's schema first on search_path. Code that takes a
 * TxClient (for example nextEntryNo, which takes a transaction-level advisory lock) cannot be handed a bare client by mistake: only
 * `withHotel` makes one, through assumeTransaction below.
 */
export interface TxClient extends SqlClient {
  readonly [inTransaction]: true;
  /** The hotel's schema name (hotel_<32 hex>): a name for logs, never for building SQL. */
  readonly schema: string;
}

/** For withHotel (and tests) only: marks a client as being inside a transaction. Calling this elsewhere defeats the type. */
export function assumeTransaction(client: SqlClient, schema: string): TxClient {
  return Object.assign(Object.create(null) as object, { query: client.query.bind(client), schema }) as unknown as TxClient;
}
