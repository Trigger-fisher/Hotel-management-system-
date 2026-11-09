// The hotel schemas that exist: the list `migrate` and `seed` walk. A hotel row without a schema is NOT in it: one waiting for approval (the onboarding form
// made the row, approval builds the schema), a rejected one, or one whose data was deleted for good. platform.hotels.provisioned_at (migration 0102) says
// when the schema was built; before that migration every hotel row had one.
import type { MigrationClient } from "./migrate";

export async function listHotelSchemas(owner: MigrationClient): Promise<string[]> {
  const present = await owner.query("SELECT to_regclass('platform.hotels') AS found");
  if (present.rows[0]?.found === null) return [];
  const hasColumn = (await owner.query("SELECT 1 AS present FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'hotels' AND column_name = 'provisioned_at'")).rows.length > 0;
  const where = hasColumn ? "deleted_at IS NULL AND provisioned_at IS NOT NULL" : "deleted_at IS NULL";
  return (await owner.query(`SELECT schema_name FROM platform.hotels WHERE ${where} ORDER BY created_at`)).rows.map((r) => String(r.schema_name));
}
