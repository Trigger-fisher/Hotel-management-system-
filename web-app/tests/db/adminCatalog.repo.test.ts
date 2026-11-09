// The expense catalogue repository (repos/postgres/admin.ts expenseCatalog) on the REAL PostgreSQL instance (hms_test): categories per business, priced items,
// numbering, the UNIQUE rules, the cascade on removing a category, and that the in-memory double refuses the same things.
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
  hotel = await createTestHotel(owner, "Catalogue Hotel");
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

/** The same scenario on the real database and on the double: they must agree. */
for (const [label, make] of [["PostgreSQL", () => pg], ["in-memory double", memory]] as const) {
  describe(`expense catalogue repository (${label})`, () => {
    test("categories per business in order with their items; items numbered; rename; the UNIQUE rules; removing a category takes its items", async () => {
      const run = make();
      const a = await run((r) => r.expenseCatalog.createCategory("hotel", "Cleaning"));
      const b = await run((r) => r.expenseCatalog.createCategory("hotel", "Repairs"));
      const f = await run((r) => r.expenseCatalog.createCategory("food", "Cleaning"));
      assert.deepEqual([a.business, a.name, a.items], ["hotel", "Cleaning", []]);
      const mine = new Set(["Cleaning", "Repairs", "Plumbing"]); // a new hotel already has its seeded categories (Kitchen, Housekeeping, Maintenance ...): look only at ours
      assert.deepEqual((await run((r) => r.expenseCatalog.categories("hotel"))).map((c) => c.name).filter((n) => mine.has(n)), ["Cleaning", "Repairs"], "in the order they were added");
      assert.ok((await run((r) => r.expenseCatalog.categories("food"))).some((c) => c.id === f.id));
      const mop = await run((r) => r.expenseCatalog.createItem(a.id, "Mop", BigInt(25050)));
      await run((r) => r.expenseCatalog.createItem(a.id, "Bucket", BigInt(0)));
      assert.deepEqual([mop.name, mop.pricePaise, mop.categoryId], ["Mop", BigInt(25050), a.id]);
      assert.deepEqual((await run((r) => r.expenseCatalog.category(a.id)))?.items.map((i) => [i.name, i.pricePaise]), [["Mop", BigInt(25050)], ["Bucket", BigInt(0)]], "items keep the order they were added in");
      const found = await run((r) => r.expenseCatalog.item(mop.id));
      assert.deepEqual([found?.item.id, found?.category.id], [mop.id, a.id]);
      const upd = await run((r) => r.expenseCatalog.updateItem(mop.id, { name: "Big mop", pricePaise: BigInt(30000) }));
      assert.deepEqual([upd?.name, upd?.pricePaise], ["Big mop", BigInt(30000)]);
      assert.equal(await run((r) => r.expenseCatalog.updateItem("00000000-0000-4000-8000-0000000000aa", { name: "x", pricePaise: BigInt(1) })), null);
      assert.equal((await run((r) => r.expenseCatalog.renameCategory(b.id, "Plumbing")))?.name, "Plumbing");
      await assert.rejects(() => run((r) => r.expenseCatalog.createCategory("hotel", "Cleaning")), (e) => e instanceof RepoError && e.kind === "unique");
      await assert.rejects(() => run((r) => r.expenseCatalog.renameCategory(b.id, "Cleaning")), (e) => e instanceof RepoError && e.kind === "unique");
      await assert.rejects(() => run((r) => r.expenseCatalog.createItem(a.id, "Bucket", BigInt(5))), (e) => e instanceof RepoError && e.kind === "unique");
      await assert.rejects(() => run((r) => r.expenseCatalog.createItem(a.id, "Negative", BigInt(-1))), (e) => e instanceof RepoError);
      assert.equal(await run((r) => r.expenseCatalog.removeItem(mop.id)), true);
      assert.equal(await run((r) => r.expenseCatalog.removeItem(mop.id)), false);
      assert.equal(await run((r) => r.expenseCatalog.removeCategory(a.id)), true);
      assert.equal(await run((r) => r.expenseCatalog.item(mop.id)), null);
      assert.equal(await run((r) => r.expenseCatalog.category(a.id)), null);
      assert.equal(await run((r) => r.expenseCatalog.removeCategory(a.id)), false);
      assert.ok((await run((r) => r.expenseCatalog.categories("food"))).some((c) => c.id === f.id), "the other business is untouched");
    });
  });
}

describe("in the real database only", () => {
  test("removing a category cascades to its items in the table", async () => {
    const c = await pg((r) => r.expenseCatalog.createCategory("food", "Cascade"));
    const item = await pg((r) => r.expenseCatalog.createItem(c.id, "One", BigInt(100)));
    await pg((r) => r.expenseCatalog.removeCategory(c.id));
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".expense_items WHERE id = $1`, [item.id])).rows[0].n), 0);
  });
});
