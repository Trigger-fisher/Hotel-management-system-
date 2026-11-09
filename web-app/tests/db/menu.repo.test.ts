// The room-service menu repository (repos/postgres/menu.ts, table menu_items, migration 0020) on the REAL PostgreSQL instance (hms_test): ordering, the
// case-insensitive UNIQUE name per group, the CHECK rules, the swap of neighbours, hard delete, and that the in-memory double does the same.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { AdminRepos } from "../../src/server/repos/admin";
import { bindAdmin, emptyAdminData } from "../../src/server/repos/memory/admin";
import { createPgAdminUnit } from "../../src/server/repos/postgres/admin";
import { RepoError } from "../../src/server/repos/types";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
const SESSION = { userId: "00000000-0000-4000-8000-000000000001" };

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Menu Hotel");
});

after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

type Run = <T>(work: (r: AdminRepos) => Promise<T>) => Promise<T>;
const pg: Run = (work) => createPgAdminUnit(database.withHotel).run({ hotelId: hotel.id, ...SESSION }, work);
const memory = (): Run => {
  const data = { ...emptyAdminData() } as never;
  return (work) => work(bindAdmin(data));
};
const fields = (name: string, over: Partial<{ note: string | null; pricePaise: bigint; available: boolean }> = {}) => ({ name, note: null, pricePaise: BigInt(10000), available: true, ...over });

for (const [label, make] of [["PostgreSQL", () => pg], ["in-memory double", memory]] as const) {
  describe(`room-service menu repository (${label})`, () => {
    test("items are listed by group then order; a new item goes to the end of its group; update and read back; the price is exact paise", async () => {
      const run = make();
      const a = await run((r) => r.menuItems.create("restaurant", fields("Dal Tadka", { pricePaise: BigInt(19050) })));
      await run((r) => r.menuItems.create("restaurant", fields("Veg Biryani", { note: "With raita" })));
      await run((r) => r.menuItems.create("laundry", fields("Shirt", { pricePaise: BigInt(4000) })));
      const list = await run((r) => r.menuItems.list());
      assert.deepEqual(list.map((i) => [i.group, i.name]), [["laundry", "Shirt"], ["restaurant", "Dal Tadka"], ["restaurant", "Veg Biryani"]]);
      assert.deepEqual([a.pricePaise, a.available, a.note], [BigInt(19050), true, null]);
      const upd = await run((r) => r.menuItems.update(a.id, fields("Dal Tadka", { note: "Mild", pricePaise: BigInt(21000), available: false })));
      assert.deepEqual([upd?.note, upd?.pricePaise, upd?.available], ["Mild", BigInt(21000), false]);
      assert.equal((await run((r) => r.menuItems.get(a.id)))?.available, false);
      assert.equal(await run((r) => r.menuItems.update("00000000-0000-4000-8000-0000000000ff", fields("X"))), null);
    });

    test("the name is unique per group whatever its case; the same name in another group is fine; a price below zero or an empty name is a check failure", async () => {
      const run = make();
      await run((r) => r.menuItems.create("service", fields("Tea")));
      const clash = await run((r) => r.menuItems.create("service", fields("TEA"))).then(() => null, (e: unknown) => e);
      assert.ok(clash instanceof RepoError && clash.kind === "unique");
      await run((r) => r.menuItems.create("laundry", fields("Tea")));
      const neg = await run((r) => r.menuItems.create("service", fields("Cheap", { pricePaise: BigInt(-1) }))).then(() => null, (e: unknown) => e);
      assert.ok(neg instanceof RepoError && neg.kind === "check");
      const blank = await run((r) => r.menuItems.create("service", fields("   "))).then(() => null, (e: unknown) => e);
      assert.ok(blank instanceof RepoError && blank.kind === "check");
    });

    test("swap exchanges places with the neighbour inside the group only; at an end it is false; remove is final", async () => {
      const run = make();
      for (const old of await run((r) => r.menuItems.list())) await run((r) => r.menuItems.remove(old.id));
      const a = await run((r) => r.menuItems.create("restaurant", fields("Swap A")));
      const b = await run((r) => r.menuItems.create("restaurant", fields("Swap B")));
      const c = await run((r) => r.menuItems.create("restaurant", fields("Swap C")));
      const order = async () => (await run((r) => r.menuItems.list())).filter((i) => i.name.startsWith("Swap")).map((i) => i.name);
      assert.equal(await run((r) => r.menuItems.swap(b.id, "up")), true);
      assert.deepEqual(await order(), ["Swap B", "Swap A", "Swap C"]);
      assert.equal(await run((r) => r.menuItems.swap(b.id, "up")), false);
      assert.equal(await run((r) => r.menuItems.swap(c.id, "down")), false);
      assert.equal(await run((r) => r.menuItems.swap(a.id, "down")), true);
      assert.deepEqual(await order(), ["Swap B", "Swap C", "Swap A"]);
      assert.equal(await run((r) => r.menuItems.swap("00000000-0000-4000-8000-0000000000ff", "up")), false);
      assert.equal(await run((r) => r.menuItems.remove(a.id)), true);
      assert.equal(await run((r) => r.menuItems.remove(a.id)), false);
      assert.deepEqual(await order(), ["Swap B", "Swap C"]);
    });
  });
}
