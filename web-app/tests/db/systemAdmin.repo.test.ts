// The payroll master lists (designations, departments, share e-mails ...) of repos/postgres/systemAdmin.ts on the REAL PostgreSQL instance (hms_test):
// create (shared and per company), the order, the uniqueness rules, update, hide, remove, counts. Found by a live test: an untyped parameter used in two
// places of the INSERT made PostgreSQL answer "inconsistent types deduced for parameter $1" (a 500), which the in-memory double could never show.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { RepoError } from "../../src/server/repos/types";
import { createPgSystemAdminUnit } from "../../src/server/repos/postgres/systemAdmin";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
let companyId: string;
const SESSION = { userId: "00000000-0000-4000-8000-000000000001" };

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Master Hotel");
  companyId = String((await owner.query(`SELECT id FROM "${hotel.schema}".payroll_companies WHERE code = 'HP01'`)).rows[0].id);
});

after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

const run = <T>(work: Parameters<ReturnType<typeof createPgSystemAdminUnit>["run"]>[1] extends (r: infer R) => Promise<unknown> ? (r: R) => Promise<T> : never): Promise<T> =>
  createPgSystemAdminUnit(database.withHotel).run({ hotelId: hotel.id, ...SESSION }, work as never) as Promise<T>;

describe("payroll master lists", () => {
  test("create works in a shared list and in a company's own list, numbering after the last; the same label twice is refused by the database", async () => {
    const a = await run((r) => r.payrollMaster.create({ list: "designations", companyId: null, label: "LT Cook", value: null }));
    const b = await run((r) => r.payrollMaster.create({ list: "designations", companyId: null, label: "LT Waiter", value: null }));
    assert.deepEqual([a.list, a.companyId, a.label, a.value, a.isActive, b.sortOrder - a.sortOrder], ["designations", null, "LT Cook", null, true, 1]);
    const mail = await run((r) => r.payrollMaster.create({ list: "share_emails", companyId, label: "Accounts", value: "a@b.com" }));
    assert.deepEqual([mail.companyId, mail.value, mail.sortOrder], [companyId, "a@b.com", 1]);
    const own = await run((r) => r.payrollMaster.create({ list: "share_emails", companyId, label: "Owner", value: "o@b.com" }));
    assert.equal(own.sortOrder, 2);
    await assert.rejects(() => run((r) => r.payrollMaster.create({ list: "designations", companyId: null, label: "LT Cook", value: null })), (e) => e instanceof RepoError && e.kind === "unique");
    await assert.rejects(() => run((r) => r.payrollMaster.create({ list: "share_emails", companyId, label: "Owner", value: "x@b.com" })), (e) => e instanceof RepoError && e.kind === "unique");
  });

  test("items by list and company (with the shared ones), taken, update, hide, counts, remove", async () => {
    const shared = await run((r) => r.payrollMaster.items("designations", null, false));
    assert.deepEqual(shared.map((x) => x.label).filter((l) => l.startsWith("LT ")), ["LT Cook", "LT Waiter"]);
    const mine = await run((r) => r.payrollMaster.items("share_emails", companyId, true));
    assert.deepEqual(mine.map((x) => x.label), ["Accounts", "Owner"]);
    assert.equal(await run((r) => r.payrollMaster.taken("designations", null, "label", "lt cook", undefined)), true);
    assert.equal(await run((r) => r.payrollMaster.taken("designations", null, "label", "lt cook", shared[0].id)), false, "an item does not clash with itself");
    assert.equal(await run((r) => r.payrollMaster.taken("share_emails", companyId, "value", "A@B.COM", undefined)), true);
    const first = shared.find((x) => x.label === "LT Cook")!;
    const saved = await run((r) => r.payrollMaster.update(first.id, { label: "LT Head Cook", isActive: false }));
    assert.deepEqual([saved?.label, saved?.isActive], ["LT Head Cook", false]);
    assert.equal((await run((r) => r.payrollMaster.update(first.id, {})))?.label, "LT Head Cook");
    const counts = await run((r) => r.payrollMaster.counts(companyId));
    assert.equal(counts.share_emails, 2);
    assert.equal((await run((r) => r.payrollMaster.counts(null))).designations >= 2, true);
    assert.equal(await run((r) => r.payrollMaster.remove(first.id)), true);
    assert.equal(await run((r) => r.payrollMaster.remove(first.id)), false);
    assert.equal(await run((r) => r.payrollMaster.item(first.id)), null);
  });
});
