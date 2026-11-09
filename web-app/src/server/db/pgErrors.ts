import "server-only";
// What a PostgreSQL error means to the app, decided by its SQLSTATE code, never by its text. Repositories catch what they expect (a duplicate,
// a missing parent) through this; everything else stays a bug and becomes SERVER_ERROR. The message of a driver error can carry row values,
// so nothing here reads it: the violated constraint's NAME comes from the driver's own `constraint` field.

type PgErrorKind =
  | "unique" // 23505: a UNIQUE or PRIMARY key already has the value
  | "foreign_key" // 23503, 23001 (RESTRICT): a child still points at the row, or the parent is missing
  | "check" // 23514: a CHECK constraint, or a trigger that raises one (version steps)
  | "not_null" // 23502: a required column got no value
  | "data_too_long" // 22001, 22003, 22P02: a value does not fit or is not of the type
  | "lock_timeout" // 55P03: waited for a lock too long
  | "deadlock" // 40P01: the server picked this transaction as the victim
  | "serialization" // 40001
  | "timeout" // 57014: the statement ran past statement_timeout (or was cancelled): the caller may try again later
  | "role_missing" // 22023: SET ROLE named a role that does not exist, so there is no such hotel
  | "forbidden" // 42501: a privilege is missing (or the table is insert-only)
  | "connection_lost" // 08xxx, 57P01, 57P02, 57P03, 53300 or a socket error: the connection is gone
  | "unknown";

interface PgErrorInfo {
  kind: PgErrorKind;
  sqlState: string | null;
  /** The constraint named by the server (a schema name, not a value), when there is one. */
  constraint: string | null;
}

const CONNECTION_CODES = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"]);

function field(error: unknown, name: string): unknown {
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>)[name] : undefined;
}

export function classifyPgError(error: unknown): PgErrorInfo {
  const raw = field(error, "code");
  const code = typeof raw === "string" ? raw : null;
  const sqlState = code !== null && /^[0-9A-Z]{5}$/.test(code) ? code : null;
  const constraint = field(error, "constraint");
  let kind: PgErrorKind = "unknown";
  if (sqlState === "23505") kind = "unique";
  else if ((sqlState === "23503" || sqlState === "23001")) kind = "foreign_key";
  else if (sqlState === "23514") kind = "check";
  else if (sqlState === "23502") kind = "not_null";
  else if (sqlState === "22001" || sqlState === "22003" || sqlState === "22P02") kind = "data_too_long";
  else if (sqlState === "55P03") kind = "lock_timeout";
  else if (sqlState === "40P01") kind = "deadlock";
  else if (sqlState === "40001") kind = "serialization";
  else if (sqlState === "57014") kind = "timeout";
  else if (sqlState === "22023") kind = "role_missing";
  else if (sqlState === "42501") kind = "forbidden";
  else if ((sqlState !== null && (sqlState.startsWith("08") || sqlState === "57P01" || sqlState === "57P02" || sqlState === "57P03" || sqlState === "53300")) || (code !== null && CONNECTION_CODES.has(code))) kind = "connection_lost";
  return { kind, sqlState, constraint: typeof constraint === "string" ? constraint : null };
}

/** A deadlock or serialization victim, or a lock wait that timed out, can be tried again once, but only when the whole unit of work is plain DML. */
export function isRetryable(error: unknown): boolean {
  const { kind } = classifyPgError(error);
  return kind === "deadlock" || kind === "serialization" || kind === "lock_timeout";
}

/** True when the error says the connection can no longer be trusted: the pool must destroy it, not give it back. */
export function isConnectionBroken(error: unknown): boolean {
  return classifyPgError(error).kind === "connection_lost";
}
