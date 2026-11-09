// What a hotel's schema and role are called (readable schemas, MJ 2 Nov 2026; platform migration 0172). One place for the rule the scripts share, so migrate, create-hotel,
// hotel-data and the rename script cannot disagree. web-app/src/db/schemaName.ts holds the same rule for the app (a test keeps the two equal).
//   schema: named for the hotel (<group>_<hotel> or <hotel>), made by platform.hotel_schema_name_for(); any safe lower-case identifier that is not a system schema is a hotel schema
//   role:   hotel_<32 hex>_rw from the hotel's id, never renamed (platform.hotels.role_name is this same value)

const SCHEMA_SHAPE = /^[a-z_][a-z0-9_]{0,62}$/;
const SYSTEM_SCHEMAS = new Set(["platform", "public", "information_schema"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Is this a name a hotel's schema may have? (never platform, public, information_schema or pg_*) */
export function isHotelSchemaName(name: string): boolean {
  return SCHEMA_SHAPE.test(name) && !SYSTEM_SCHEMAS.has(name) && !name.startsWith("pg_");
}

/** The old name of every hotel schema: hotel_<32 hex>. Hotels not renamed yet still have it. */
export const LEGACY_SCHEMA = /^hotel_[0-9a-f]{32}$/;

/** The hotel's login-less role, from its id: hotel_<32 hex>_rw. */
export function hotelRoleOf(hotelId: string): string {
  if (!UUID.test(hotelId)) throw new Error("Not a hotel id");
  return `hotel_${hotelId.replaceAll("-", "")}_rw`;
}
