// rename-hotel-schemas: gives the schema of every hotel that already has one its readable name (MJ, 2 Nov 2026; platform migration 0172):
//   <group>_<hotel> for a hotel of a real group, <hotel> for an individual hotel (platform.hotel_schema_name_for() makes the name, the same function create-hotel uses).
// Safe by construction:
//   - a DRY RUN (the default) does the real work in ONE transaction and rolls it back, so what it prints is exactly what would happen, collisions included, and nothing is kept;
//   - --apply renames ONE hotel per transaction (ALTER SCHEMA ... RENAME and the hotel's row together), so a failure leaves every other hotel as it was; each rename is checked
//     (the renamed schema still holds the hotel's own tables) before it is kept, and written to the platform audit log;
//   - the hotel's ROLE is never touched (hotel_<hex>_rw, from the id): its grants, default privileges and the app's right to become it follow the schema, because PostgreSQL keeps
//     them by object, not by name, so the isolation the tests prove is the same before and after;
//   - a hotel whose name is already right is skipped, so it is safe to run again (also after a hotel joins a group or is renamed: it brings the schema name back in line).
// Runs as hms_owner (the app role cannot rename a schema).
import type { MigrationClient } from "./migrate";
import { isHotelSchemaName } from "./schema-names";

export interface SchemaRename {
  hotelId: string;
  hotelName: string;
  from: string;
  to: string;
}

const sqlStateOf = (error: unknown): string => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : "";
};

/** Renames the schemas. `apply` false = a dry run (everything rolled back at the end). Returns what was (or would be) renamed, in order. */
export async function renameHotelSchemas(owner: MigrationClient, options: { apply: boolean; report?: (message: string) => void }): Promise<SchemaRename[]> {
  const say = options.report ?? ((): void => undefined);
  const hotels = (await owner.query("SELECT id, name, schema_name FROM platform.hotels WHERE provisioned_at IS NOT NULL AND deleted_at IS NULL ORDER BY created_at, id")).rows;
  const renamed: SchemaRename[] = [];

  const renameOne = async (hotel: Record<string, unknown>): Promise<SchemaRename | null> => {
    const id = String(hotel.id);
    const from = String(hotel.schema_name);
    const target = (await owner.query("SELECT platform.hotel_schema_name_for($1::uuid) AS name", [id])).rows[0]?.name;
    const to = typeof target === "string" ? target : "";
    if (!isHotelSchemaName(from) || !isHotelSchemaName(to)) throw new Error(`Refusing to rename: "${from}" -> "${to}" is not a safe hotel schema name`);
    if (to === from) return null;
    const there = await owner.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`"${from}".schema_migrations`]);
    if (there.rows[0]?.ok !== true) throw new Error(`The hotel's schema "${from}" is not there or is not a hotel schema; refusing to rename it`);
    await owner.query(`ALTER SCHEMA "${from}" RENAME TO "${to}"`);
    await owner.query("UPDATE platform.hotels SET schema_name = $2 WHERE id = $1", [id, to]);
    // proof before it is kept: the renamed schema holds the hotel's own tables, and the old name is gone
    const check = await owner.query("SELECT to_regclass($1) IS NOT NULL AS renamed, to_regclass($2) IS NULL AS old_gone", [`"${to}".schema_migrations`, `"${from}".schema_migrations`]);
    if (check.rows[0]?.renamed !== true || check.rows[0]?.old_gone !== true) throw new Error(`The rename of "${from}" did not check out; nothing was kept`);
    await owner.query("INSERT INTO platform.audit_log (action, entity, entity_id, hotel_id, after) VALUES ($1, $2, $3, $3, $4::jsonb)", ["hotel.schema_renamed", "hotel", id, JSON.stringify({ from, to })]);
    return { hotelId: id, hotelName: String(hotel.name), from, to };
  };

  if (!options.apply) await owner.query("BEGIN");
  try {
    for (const hotel of hotels) {
      if (options.apply) await owner.query("BEGIN");
      try {
        const done = await renameOne(hotel);
        if (options.apply) await owner.query("COMMIT");
        if (done) {
          renamed.push(done);
          say(`${options.apply ? "Renamed" : "Would rename"} ${done.from} -> ${done.to}  (${done.hotelName})`);
        }
      } catch (error) {
        if (options.apply) {
          try {
            await owner.query("ROLLBACK");
          } catch {
            // the connection is gone; the server rolls the transaction back itself
          }
        }
        throw new Error(`Could not rename the schema of "${String(hotel.name)}" (SQLSTATE ${sqlStateOf(error) || "unknown"}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
  } finally {
    if (!options.apply) {
      try {
        await owner.query("ROLLBACK");
      } catch {
        // nothing to undo
      }
    }
  }
  return renamed;
}
