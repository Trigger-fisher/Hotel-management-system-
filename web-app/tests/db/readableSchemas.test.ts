// Readable hotel schemas on the REAL PostgreSQL instance (platform 0172; MJ, 2 Nov 2026): a hotel's schema is named for the hotel (<group>_<hotel>, or <hotel> for an individual one),
// made in ONE place (platform.hotel_schema_name_for) that create-hotel / provisionHotel call, and an existing schema is renamed by the rename script without touching the hotel's
// role: the isolation is the same before and after. Run with:   npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import { renameHotelSchemas } from "../../../common/db/scripts/rename-hotel-schemas";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { hotelRoleName } from "../../src/db/schemaName";
import { connectOwner, appUrl, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let owner: DbClient;
let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  await removeAllTestHotels(owner);
});
after(async () => {
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

/** A bare hotel row (no schema built): enough to ask what its schema would be called. */
async function row(name: string, schemaName?: string): Promise<string> {
  const id = String((await owner.query("INSERT INTO platform.hotels (name, slug, status, provisioned_at) VALUES ($1, $2, 'pending_approval', NULL) RETURNING id", [name, `n-${tag()}-${Math.random().toString(36).slice(2, 6)}`])).rows[0].id);
  if (schemaName) await owner.query("UPDATE platform.hotels SET schema_name = $2 WHERE id = $1", [id, schemaName]);
  return id;
}
const nameOf = async (id: string): Promise<string> => String((await owner.query("SELECT platform.hotel_schema_name_for($1::uuid) AS n", [id])).rows[0].n);

describe("platform.hotel_schema_name_for: the one rule for a schema's name", () => {
  // the bare rows above wait for approval and have no schema: clear them (and the groups made here) before the next describe builds real hotels
  after(async () => removeAllTestHotels(owner));

  test("an individual hotel is named for the hotel; case, spaces and punctuation become single underscores", async () => {
    assert.equal(await nameOf(await row("Blue Lagoon Residency")), "blue_lagoon_residency");
    assert.equal(await nameOf(await row("  Hotel  Sunrise, Rajkot!  ")), "hotel_sunrise_rajkot");
    assert.equal(await nameOf(await row("Taj (Palace) & Spa - 2")), "taj_palace_spa_2");
  });

  test("a hotel of a real group is <group>_<hotel>; the system's own 'Individual hotels' group is never part of a name", async () => {
    const id = await row("Sunrise Rajkot");
    assert.equal(await nameOf(id), "sunrise_rajkot", "an individual hotel (the trigger of 0157 put it in the individual group)");
    const group = String((await owner.query("INSERT INTO platform.hotel_groups (name, slug) VALUES ('Sunrise Group', $1) RETURNING id", [`sg-${tag()}`])).rows[0].id);
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [group, id]);
    assert.equal(await nameOf(id), "sunrise_group_sunrise_rajkot");
  });

  test("a name with no usable letters, a leading digit, a system name and a long name are all made safe", async () => {
    assert.equal(await nameOf(await row("હોટેલ સનરાઇઝ")), "hotel", "Gujarati only");
    assert.equal(await nameOf(await row("7 Seas")), "h_7_seas");
    const platform = await nameOf(await row("Platform"));
    assert.match(platform, /^platform_[0-9a-f]{6}$/, "never the platform schema");
    assert.match(await nameOf(await row("PG Catalog Inn")), /^pg_catalog_inn_[0-9a-f]{6}$/, "never a pg_ name");
    const long = await nameOf(await row("The Grand Imperial Maharaja Palace Heritage Resort And Spa Of Udaipur On The Lake Pichola"));
    assert.ok(long.length <= 63 && /^[a-z][a-z0-9_]*$/.test(long) && !long.endsWith("_"), long);
  });

  test("two hotels with the same name never get the same schema: the second one gets the end of its id", async () => {
    const first = await row("Twin Hotel");
    const firstName = await nameOf(first);
    assert.equal(firstName, "twin_hotel");
    await owner.query("UPDATE platform.hotels SET schema_name = $2 WHERE id = $1", [first, firstName]);
    const second = await row("Twin Hotel");
    assert.match(await nameOf(second), /^twin_hotel_[0-9a-f]{6}$/);
    assert.equal(await nameOf(first), "twin_hotel", "the hotel that has the name keeps it");
  });

  test("the table itself refuses a schema name that is not a safe hotel schema", async () => {
    const id = await row("Check Hotel");
    for (const bad of ["platform", "public", "pg_temp", "Has_Capital", "has space", "has-dash", "1starts", "x".repeat(64)]) {
      assert.equal(await sqlStateOf(owner.query("UPDATE platform.hotels SET schema_name = $2 WHERE id = $1", [id, bad])), "23514", bad);
    }
  });

  test("a hotel row made without a schema name still gets the old hotel_<id> one until its schema is built", async () => {
    const id = await row("Waiting Hotel");
    assert.equal((await owner.query("SELECT schema_name, role_name FROM platform.hotels WHERE id = $1", [id])).rows[0].schema_name, `hotel_${id.replaceAll("-", "")}`);
    assert.equal((await owner.query("SELECT role_name FROM platform.hotels WHERE id = $1", [id])).rows[0].role_name, hotelRoleName(id));
  });
});

describe("a hotel made now is named in the format, and renaming keeps the isolation", () => {
  let A: CreatedHotel;
  let B: CreatedHotel;
  let groupId: string;

  before(async () => {
    A = await createTestHotel(owner, "Rename Alpha");
    B = await createTestHotel(owner, "Rename Beta");
    groupId = String((await owner.query("INSERT INTO platform.hotel_groups (name, slug) VALUES ('Rename Group One', $1) RETURNING id", [`rg-${tag()}`])).rows[0].id);
  });

  test("create-hotel names the schema for the hotel, saves it on the hotel's row, and the role stays hotel_<id>_rw", async () => {
    assert.equal(A.schema, "rename_alpha");
    assert.equal(B.schema, "rename_beta");
    assert.equal((await owner.query("SELECT schema_name, role_name FROM platform.hotels WHERE id = $1", [A.id])).rows[0].schema_name, "rename_alpha");
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = 'rename_alpha'")).rows.length, 1);
    assert.equal((await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [hotelRoleName(A.id)])).rows.length, 1);
  });

  test("a dry run shows what would change and keeps nothing; --apply renames and writes the audit row; running again changes nothing", async () => {
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [groupId, A.id]);
    const said: string[] = [];
    const planned = await renameHotelSchemas(owner, { apply: false, report: (m) => said.push(m) });
    assert.deepEqual(planned.map((r) => [r.from, r.to]), [["rename_alpha", "rename_group_one_rename_alpha"]]);
    assert.equal((await owner.query("SELECT schema_name FROM platform.hotels WHERE id = $1", [A.id])).rows[0].schema_name, "rename_alpha", "the dry run kept nothing");
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = 'rename_alpha'")).rows.length, 1);

    const done = await renameHotelSchemas(owner, { apply: true });
    assert.deepEqual(done.map((r) => [r.from, r.to]), [["rename_alpha", "rename_group_one_rename_alpha"]]);
    assert.equal((await owner.query("SELECT schema_name FROM platform.hotels WHERE id = $1", [A.id])).rows[0].schema_name, "rename_group_one_rename_alpha");
    assert.equal((await owner.query("SELECT 1 FROM pg_namespace WHERE nspname = 'rename_alpha'")).rows.length, 0, "the old name is gone");
    assert.equal((await owner.query("SELECT 1 FROM platform.audit_log WHERE action = 'hotel.schema_renamed' AND hotel_id = $1", [A.id])).rows.length, 1);
    assert.deepEqual(await renameHotelSchemas(owner, { apply: true }), [], "nothing left to rename");
  });

  test("after the rename the hotel works through withHotel, and the two hotels still cannot see each other (the roles did not change)", async () => {
    const database: Database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
    try {
      const A2 = { ...A, schema: "rename_group_one_rename_alpha" };
      const seeded = async (h: CreatedHotel): Promise<number> => Number((await database.withHotel({ hotelId: h.id }, async (tx) => (await tx.query("SELECT COUNT(*) AS n FROM business_units")).rows[0].n)) ?? 0);
      assert.ok((await seeded(A2)) >= 1, "A reads its own seeded tables under the new name");
      assert.ok((await seeded(B)) >= 1, "B is untouched");
      assert.equal(await sqlStateOf(database.withHotel({ hotelId: B.id }, (tx) => tx.query(`SELECT * FROM "${A2.schema}".business_units`))), "42501", "B cannot read A, by A's new name");
      assert.equal(await sqlStateOf(database.withHotel({ hotelId: A.id }, (tx) => tx.query(`SELECT * FROM "${B.schema}".business_units`))), "42501", "A cannot read B");
      assert.equal(await sqlStateOf(database.withHotel({ hotelId: A.id }, (tx) => tx.query("SELECT * FROM platform.hotels"))), "42501", "and nobody reads platform");
      assert.equal((await owner.query("SELECT has_schema_privilege($1, $2, 'USAGE') AS ok", [hotelRoleName(A.id), A2.schema])).rows[0].ok, true, "A's role still has USAGE on its renamed schema");
      assert.equal((await owner.query("SELECT has_schema_privilege($1, $2, 'USAGE') AS ok", [hotelRoleName(A.id), B.schema])).rows[0].ok, false);
    } finally {
      await database.close();
    }
  });
});
