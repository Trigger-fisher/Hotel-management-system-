import "server-only";
// The names a hotel's data lives under. The id comes from the verified session, never from a request, and is still checked here so a bug elsewhere cannot turn
// into an injected search_path (standard T2, T3, X5).
//   role:   hotel_<32 hex>_rw, from the id and never renamed (hotelRoleName): the only privileges on the hotel's schema; the isolation rests on it.
//   schema: named for the hotel since platform migration 0172 (<group>_<hotel>, or <hotel>), read from platform.hotels by db/schemaDirectory.ts and checked by
//           assertHotelSchemaName; hotelSchemaName() below is the OLD name (hotel_<32 hex>) that a database not renamed yet, and the tests with no database, still use.
//
// Two guards, on purpose: a strict UUID check, and an identifier check on the finished name.
import { AppError } from "../server/errors";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BARE_UUID = /^[0-9a-f]{32}$/;
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export const HOTEL_SCHEMA_PREFIX = "hotel_";

/** Parameterised and transaction-local: the third argument `true` undoes it at COMMIT or ROLLBACK. */
export const SET_SEARCH_PATH_SQL = "SELECT set_config('search_path', $1, true)";

/**
 * The whole prelude of a hotel transaction in ONE statement (one wait for the database instead of two or three): the hotel's role ($1, the validated name; `role`
 * is the setting behind SET ROLE, so an unknown role answers 22023 just as SET LOCAL ROLE does) and the search path ($2), both transaction-local. The scoped form
 * adds a portal account's record scope ($3, $4) for the row-level security policies (hotel migration 0035). Parameters only: no name ever sits in the text.
 */
export const HOTEL_PRELUDE_SQL = "SELECT set_config('role', $1, true), set_config('search_path', $2, true)";
export const HOTEL_PRELUDE_SCOPED_SQL = "SELECT set_config('role', $1, true), set_config('search_path', $2, true), set_config('hms.scope_kind', $3, true), set_config('hms.scope_id', $4, true)";

function invalidHotel(): AppError {
  // Deliberately says nothing about what was wrong with the id.
  return new AppError("FORBIDDEN", "Hotel is not available");
}

/** "0198…-…" (lowercase, dashed) or 32 lowercase hex characters -> "hotel_<32 hex>". Anything else throws FORBIDDEN. */
export function hotelSchemaName(hotelId: unknown): string {
  if (typeof hotelId !== "string") throw invalidHotel();
  let hex: string;
  if (CANONICAL_UUID.test(hotelId)) hex = hotelId.replaceAll("-", "");
  else if (BARE_UUID.test(hotelId)) hex = hotelId;
  else throw invalidHotel();
  const name = `${HOTEL_SCHEMA_PREFIX}${hex}`;
  assertSafeIdentifier(name);
  return name;
}

/** The value for search_path inside withHotel: the hotel schema and pg_catalog, never platform and never public. */
export function hotelSearchPath(hotelId: unknown): string {
  return `${hotelSchemaName(hotelId)}, pg_catalog`;
}

/** The same value for a schema name already read from platform.hotels (readable schemas, MJ 2 Nov 2026): checked first, so only a safe hotel schema name can ever reach search_path. */
export function searchPathOfSchema(schema: string): string {
  return `${assertHotelSchemaName(schema)}, pg_catalog`;
}

/**
 * A hotel's schema is named for the hotel (platform migration 0172: <group>_<hotel>, or <hotel>), so its shape is only "a safe lower-case identifier that is not a system
 * schema" (the same rule as the database's own CHECK). FORBIDDEN on anything else, so a bad row can never turn into an injected search_path.
 */
export function assertHotelSchemaName(name: unknown): string {
  if (typeof name !== "string" || !SAFE_IDENTIFIER.test(name) || RESERVED_SCHEMAS.has(name) || name.startsWith("pg_")) throw invalidHotel();
  return name;
}

const RESERVED_SCHEMAS = new Set(["platform", "public", "information_schema"]);

/** The 32 hex characters of a hotel id given either accepted spelling (the one place that checks it); FORBIDDEN on anything else. */
function hexOf(hotelId: unknown): string {
  if (typeof hotelId !== "string") throw invalidHotel();
  if (CANONICAL_UUID.test(hotelId)) return hotelId.replaceAll("-", "");
  if (BARE_UUID.test(hotelId)) return hotelId;
  throw invalidHotel();
}

/** The canonical lower-case dashed id of a hotel given either accepted spelling. FORBIDDEN on anything else. */
export function canonicalHotelId(hotelId: unknown): string {
  const hex = hexOf(hotelId);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER.test(name)) throw invalidHotel();
}

export const HOTEL_ROLE_SUFFIX = "_rw";

/**
 * The login-less role that holds ALL of one hotel's privileges: hotel_<32 hex>_rw, built from the hotel's ID and never renamed (the schema it guards is named for the
 * hotel since migration 0172, the role is not: platform.hotels.role_name is this same value). The app role hms_app has no privileges on any hotel schema; it can only
 * SET ROLE into one hotel's role, inside a transaction. It can only ever be built from a strict UUID.
 */
export function hotelRoleName(hotelId: unknown): string {
  const name = `${HOTEL_SCHEMA_PREFIX}${hexOf(hotelId)}${HOTEL_ROLE_SUFFIX}`;
  assertSafeIdentifier(name);
  return name;
}

/** Second guard for the few places a name has to sit inside SQL text (migration runner, create-hotel). */
export function quoteIdentifier(name: string): string {
  assertSafeIdentifier(name);
  return `"${name}"`;
}
