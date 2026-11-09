// The room-service menu's round 3 columns (hotel migrations 0041 and 0043) on the REAL PostgreSQL, throwaway hms_test only: category and veg written and read, an older save
// (without them) leaves them alone, the photo name set and cleared (answering the item as it was). Run with: npm run test:db
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { pgMenuRepo } from "../../src/server/repos/postgres/menu";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 2 });
  hotel = await createTestHotel(owner, "Menu Round 3 Hotel");
});
after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

const menu = <T>(work: (r: ReturnType<typeof pgMenuRepo>) => Promise<T>) => database.withHotel({ hotelId: hotel.id, userId: "00000000-0000-4000-8000-000000000e01" } as never, (tx) => work(pgMenuRepo(tx)));

describe("menu round 3 columns", () => {
  test("category and veg are written, kept by an older save, and checked; the photo name is set and cleared", async () => {
    const made = await menu((r) => r.create("restaurant", { name: "Thali", note: null, pricePaise: BigInt(32000), available: true, category: "Lunch", veg: "yes" }));
    assert.deepEqual([made.category, made.veg, made.imageFile], ["Lunch", "yes", null]);
    const kept = await menu((r) => r.update(made.id, { name: "Thali", note: "With sweet", pricePaise: BigInt(34000), available: true }));
    assert.deepEqual([kept?.category, kept?.veg, kept?.note], ["Lunch", "yes", "With sweet"]);
    const before1 = await menu((r) => r.setImage(made.id, "menu-abc.webp"));
    assert.equal(before1?.imageFile, null);
    const before2 = await menu((r) => r.setImage(made.id, null));
    assert.equal(before2?.imageFile, "menu-abc.webp");
    assert.equal((await menu((r) => r.get(made.id)))?.imageFile, null);
    assert.equal(await menu((r) => r.setImage("00000000-0000-4000-8000-0000000000ee", "x.webp")), null);
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${hotel.schema}".menu_items SET veg = 'maybe' WHERE id = $1`, [made.id])), "23514");
    assert.equal(await sqlStateOf(owner.query(`UPDATE "${hotel.schema}".menu_items SET image_file = repeat('x', 161) WHERE id = $1`, [made.id])), "22001");
  });
});