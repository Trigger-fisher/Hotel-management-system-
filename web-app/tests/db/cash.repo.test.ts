// The Daily Cash repositories on the REAL PostgreSQL instance (repos/postgres/cash.ts), through the same unit the cash services get: entry numbers,
// versions, the recycle bin, the plain search, paging and sorting, totals, miscellaneous expenses with their lines, and the small support
// repositories. The in-memory double (repos/memory/entries.ts) is the reference for every rule; the service-level scenarios and the golden search
// fixtures run on it, because the token search lives in the service and only needs rows() from the repository.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { CashRepos } from "../../src/server/repos/cashDeposit";
import type { CashBook } from "../../src/server/repos/entries";
import { createPgCashUnit } from "../../src/server/repos/postgres/cash";
import { RepoError, type Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<CashRepos>;
const USER = newId();
const ACTOR = newId();
const session = () => ({ hotelId: hotel.id, userId: USER });
const run = <T>(work: (r: CashRepos) => Promise<T>): Promise<T> => unit.run(session(), work);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Cash Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 12 });
  unit = createPgCashUnit(database.withHotel);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

const deposit = (over: Partial<{ date: string; time: string; depositor: string; amountPaise: bigint; reason: string | null; fullName: string | null }> = {}) => ({
  date: "2026-03-04", time: "10:30:00", userId: USER, fullName: "Asha", amountPaise: BigInt(150_000), amountInWords: "One thousand five hundred rupees only", createdBy: USER, depositor: "Front desk", reason: null as string | null, ...over,
});
const withdrawal = (over: Record<string, unknown> = {}) => ({ date: "2026-03-04", time: "11:00:00", userId: USER, fullName: "Asha", amountPaise: BigInt(50_000), amountInWords: null, createdBy: USER, withdrawer: "Hitesh", instruction: null as string | null, ...over });
const line = (over: Record<string, unknown> = {}) => ({ categoryId: null, itemId: null, category: "Dairy", item: "Milk", pricing: "custom" as const, quantity: 2.5, pricePaise: BigInt(6000), totalPaise: BigInt(15000), ...over });

describe("deposits: the generic entry repository", () => {
  test("create gives gap-free entry numbers per book, and a record reads back with exact money, dates and times", async () => {
    const a = await run((r) => r.cashDeposits.create("hotel", deposit({ reason: "Night shift" })));
    const b = await run((r) => r.cashDeposits.create("hotel", deposit({ time: "23:59:59", amountPaise: BigInt("9007199254740993") })));
    const c = await run((r) => r.cashDeposits.create("food", deposit()));
    assert.deepEqual([a.entryNo, b.entryNo, c.entryNo], [1, 2, 1]);
    assert.equal(a.version, 1);
    assert.equal(a.book, "hotel");
    assert.deepEqual([a.date, a.time, a.reason, a.amountPaise, a.createdBy, a.updatedBy, a.deletedAt], ["2026-03-04", "10:30:00", "Night shift", BigInt(150_000), USER, null, null]);
    assert.equal(b.amountPaise, BigInt("9007199254740993"), "an amount beyond 2^53 survives exactly");
    assert.ok(a.createdAt instanceof Date);
    assert.deepEqual(await run((r) => r.cashDeposits.get("hotel", a.id)), a);
    assert.equal(await run((r) => r.cashDeposits.get("food", a.id)), null, "the other book does not have it");
  });

  test("the table's CHECKs come back as RepoError", async () => {
    await assert.rejects(() => run((r) => r.cashDeposits.create("hotel", deposit({ amountPaise: BigInt(0) }))), (e) => e instanceof RepoError && e.kind === "check");
  });

  test("update changes the given fields, raises the version, records who; a stale version is a conflict that names the current one", async () => {
    const row = await run((r) => r.cashDeposits.create("food", deposit({ depositor: "Original" })));
    const ok = await run((r) => r.cashDeposits.update("food", row.id, 1, { depositor: "Changed", amountPaise: BigInt(200) }, ACTOR));
    assert.ok(ok.ok);
    if (ok.ok) assert.deepEqual([ok.record.depositor, ok.record.amountPaise, ok.record.version, ok.record.updatedBy, ok.record.reason], ["Changed", BigInt(200), 2, ACTOR, null]);
    const stale = await run((r) => r.cashDeposits.update("food", row.id, 1, { depositor: "Late" }, ACTOR));
    assert.deepEqual(stale, { ok: false, reason: "conflict", currentVersion: 2 });
    assert.deepEqual(await run((r) => r.cashDeposits.update("food", newId(), 1, { depositor: "x" }, ACTOR)), { ok: false, reason: "not_found" });
    assert.equal((await run((r) => r.cashDeposits.get("food", row.id)))?.depositor, "Changed");
  });

  test("soft delete keeps the number and the row in the bin; restore brings it back; purge removes only a binned row", async () => {
    const x = await run((r) => r.cashDeposits.create("hotel", deposit()));
    const y = await run((r) => r.cashDeposits.create("hotel", deposit()));
    const del = await run((r) => r.cashDeposits.softDelete("hotel", y.id, 1, ACTOR));
    assert.ok(del.ok && del.record.deletedAt instanceof Date && del.record.deletedBy === ACTOR && del.record.version === 2);
    assert.equal(await run((r) => r.cashDeposits.get("hotel", y.id)), null);
    assert.equal((await run((r) => r.cashDeposits.get("hotel", y.id, { deleted: true })))?.id, y.id);
    assert.deepEqual(await run((r) => r.cashDeposits.softDelete("hotel", y.id, 2, ACTOR)), { ok: false, reason: "not_found" }, "already in the bin");
    const next = await run((r) => r.cashDeposits.nextEntryNo("hotel"));
    assert.equal(next, y.entryNo + 1, "a binned entry still holds its number");
    const bin = await run((r) => r.cashDeposits.rows("hotel", { deleted: "only" }));
    assert.deepEqual(bin.map((b) => b.id), [y.id]);
    assert.equal(await run((r) => r.cashDeposits.purge("hotel", x.id)), false, "a live row is never purged");
    const back = await run((r) => r.cashDeposits.restore("hotel", y.id, 2, ACTOR));
    assert.ok(back.ok && back.record.deletedAt === null && back.record.deletedBy === null && back.record.version === 3);
    await run((r) => r.cashDeposits.softDelete("hotel", y.id, 3, ACTOR));
    assert.equal(await run((r) => r.cashDeposits.purge("hotel", y.id)), true);
    assert.equal(await run((r) => r.cashDeposits.get("hotel", y.id, { deleted: true })), null);
    assert.equal(await run((r) => r.cashDeposits.nextEntryNo("hotel")), y.entryNo, "purging the LAST entry frees its number");
  });

  test("20 parallel creates in one book get 20 different, gap-free numbers (the advisory lock)", async () => {
    const before = await run((r) => r.cashDeposits.nextEntryNo("food"));
    const made = await Promise.all(Array.from({ length: 20 }, () => run((r) => r.cashDeposits.create("food", deposit()))));
    const numbers = made.map((m) => m.entryNo).sort((p, q) => p - q);
    assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => before + i));
  });

  test("a failed unit takes its entry back", async () => {
    const before = await run((r) => r.cashDeposits.nextEntryNo("hotel"));
    await assert.rejects(() => run(async (r) => { await r.cashDeposits.create("hotel", deposit()); throw new Error("boom"); }), /boom/);
    assert.equal(await run((r) => r.cashDeposits.nextEntryNo("hotel")), before);
  });
});

describe("list, search, totals and the newest entry", () => {
  const book: CashBook = "hotel";
  before(async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".hotel_cash_deposits`);
    const rows: [string, string, string, bigint, string | null][] = [
      ["2026-03-01", "09:00:00", "Alpha 100%", BigInt(100), null],
      ["2026-03-02", "09:00:00", "beta_x", BigInt(300), "Cash for ALPHA"],
      ["2026-03-02", "08:00:00", "Gamma", BigInt(200), "it's a 'quote'"],
      ["2026-03-03", "09:00:00", "Alpha", BigInt(50), null],
    ];
    for (const [date, time, depositor, amountPaise, reason] of rows) await run((r) => r.cashDeposits.create(book, deposit({ date, time, depositor, amountPaise, reason })));
  });

  const list = (over: Record<string, unknown> = {}) => run((r) => r.cashDeposits.list(book, { page: 1, pageSize: 10, sort: "entryNo", dir: "asc", ...over } as never));

  test("sorting by a column with ties broken by entry number, both directions, and paging with the total", async () => {
    assert.deepEqual((await list({ sort: "date", dir: "asc" })).rows.map((r) => r.entryNo), [1, 2, 3, 4]);
    assert.deepEqual((await list({ sort: "date", dir: "desc" })).rows.map((r) => r.entryNo), [4, 3, 2, 1]);
    assert.deepEqual((await list({ sort: "amountPaise", dir: "desc" })).rows.map((r) => r.amountPaise), [BigInt(300), BigInt(200), BigInt(100), BigInt(50)]);
    assert.deepEqual((await list({ sort: "depositor", dir: "asc" })).rows.map((r) => r.depositor), ["Alpha", "Alpha 100%", "Gamma", "beta_x"], "plain byte order, like the double");
    const page = await list({ page: 2, pageSize: 3, sort: "entryNo" });
    assert.deepEqual([page.total, page.rows.map((r) => r.entryNo)], [4, [4]]);
    await assert.rejects(() => list({ sort: "drop table" }), /Not a sort column/);
  });

  test("the plain search is a case-insensitive substring over the kind's fields and the person: % and _ and quotes are ordinary characters", async () => {
    const found = async (search: string) => (await list({ search })).rows.map((r) => r.entryNo);
    assert.deepEqual(await found("alpha"), [1, 2, 4], "depositor and reason, any case");
    assert.deepEqual(await found("100%"), [1]);
    assert.deepEqual(await found("%"), [1], "a percent sign matches only a percent sign");
    assert.deepEqual(await found("_"), [2], "an underscore matches only an underscore");
    assert.deepEqual(await found("'quote'"), [3]);
    assert.deepEqual(await found("asha"), [1, 2, 3, 4], "the recorder's name");
    assert.deepEqual(await found("'; DROP TABLE hotel_cash_deposits; --"), []);
  });

  test("the date window, the totals and the newest entry (date, then time, then number, all descending)", async () => {
    assert.deepEqual((await list({ from: "2026-03-02", to: "2026-03-02" })).rows.map((r) => r.entryNo), [2, 3]);
    assert.deepEqual(await run((r) => r.cashDeposits.totals(book, { from: "2026-03-02" })), { count: 3, totalPaise: BigInt(550) });
    assert.deepEqual(await run((r) => r.cashDeposits.totals(book, { search: "alpha" })), { count: 3, totalPaise: BigInt(450) });
    const newest = await run((r) => r.cashDeposits.newestId(book));
    assert.equal((await run((r) => r.cashDeposits.get(book, newest as string)))?.entryNo, 4);
    assert.equal(await run((r) => r.cashDeposits.newestId("food")), (await run((r) => r.cashDeposits.rows("food", {}))).slice(-1)[0]?.id, "food: the last of its own book");
  });
});

describe("withdrawals and miscellaneous expenses", () => {
  test("a withdrawal round-trips", async () => {
    const w = await run((r) => r.cashWithdrawals.create("food", withdrawal({ instruction: "For the market" }) as never));
    assert.deepEqual([w.withdrawer, w.instruction, w.entryNo, w.book], ["Hitesh", "For the market", 1, "food"]);
    assert.equal((await run((r) => r.cashWithdrawals.get("hotel", w.id))), null);
  });

  test("a miscellaneous expense keeps its lines: exact quantity and money, replaced on edit, kept on soft delete, found by the search, removed on purge", async () => {
    const created = await run((r) => r.miscExpenses.create("hotel", { date: "2026-03-04", time: "12:00:00", userId: USER, fullName: "Asha", amountPaise: BigInt(15000), amountInWords: null, createdBy: USER, expenseName: "Milk", expenseHead: "Kitchen", instruction: null, lines: [line(), line({ category: "Veg", item: "Tomato", quantity: 0.125, pricePaise: BigInt(4000), totalPaise: BigInt(500) })] }));
    assert.equal(created.lines.length, 2);
    assert.deepEqual(created.lines.map((l) => [l.category, l.item, l.quantity, l.pricePaise, l.totalPaise, l.pricing]), [["Dairy", "Milk", 2.5, BigInt(6000), BigInt(15000), "custom"], ["Veg", "Tomato", 0.125, BigInt(4000), BigInt(500), "custom"]]);
    const search = (needle: string, book: CashBook = "hotel") => run(async (r) => (await r.miscExpenses.list(book, { page: 1, pageSize: 10, sort: "entryNo", dir: "asc", search: needle })).rows.map((x) => x.id));
    assert.deepEqual(await search("TOMATO"), [created.id], "found by a line's item");
    assert.deepEqual(await search("tomato", "food"), []);
    const edited = await run((r) => r.miscExpenses.update("hotel", created.id, 1, { lines: [line({ item: "Butter", category: "Dairy" })], amountPaise: BigInt(15000) }, ACTOR));
    assert.ok(edited.ok);
    if (edited.ok) {
      assert.deepEqual(edited.record.lines.map((l) => l.item), ["Butter"]);
      assert.notEqual(edited.record.lines[0].id, created.lines[0].id, "editing replaces every line with new ones");
    }
    assert.deepEqual(await search("tomato"), []);
    const patchNoLines = await run((r) => r.miscExpenses.update("hotel", created.id, 2, { expenseHead: "Bar" }, ACTOR));
    assert.ok(patchNoLines.ok && patchNoLines.record.lines.length === 1, "a patch without lines leaves the lines alone");
    await run((r) => r.miscExpenses.softDelete("hotel", created.id, 3, ACTOR));
    assert.equal((await run((r) => r.miscExpenses.get("hotel", created.id, { deleted: true })))?.lines.length, 1, "soft delete keeps the lines");
    assert.equal(await run((r) => r.miscExpenses.purge("hotel", created.id)), true);
    const left = await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".expense_lines WHERE expense_id = $1`, [created.id]);
    assert.equal(Number(left.rows[0].n), 0, "purge removes the lines too");
  });

  test("a line the table refuses rolls the whole expense back (no entry, no half-written lines)", async () => {
    const before = await run((r) => r.miscExpenses.nextEntryNo("food"));
    await assert.rejects(
      () => run((r) => r.miscExpenses.create("food", { date: "2026-03-04", time: "12:00:00", userId: USER, fullName: null, amountPaise: BigInt(100), amountInWords: null, createdBy: USER, expenseName: "Bad", expenseHead: null, instruction: null, lines: [line({ quantity: -1 })] })),
      (e) => e instanceof RepoError && e.kind === "check",
    );
    assert.equal(await run((r) => r.miscExpenses.nextEntryNo("food")), before);
  });
});

describe("the support repositories", () => {
  test("catalogue, Master Data values, accounting years and the two logs", async () => {
    const cat = String((await owner.query(`INSERT INTO "${hotel.schema}".expense_categories (business, name, sort_order) VALUES ('hotel', 'Dairy', 1) RETURNING id`)).rows[0].id);
    await owner.query(`INSERT INTO "${hotel.schema}".expense_items (expense_category_id, name, price_paise, sort_order) VALUES ($1, 'Milk', 6000, 1), ($1, 'Curd', 8000, 2)`, [cat]);
    const catalog = await run((r) => r.expenseCatalog.forBook("hotel"));
    const dairy = catalog.find((c) => c.name === "Dairy");
    assert.deepEqual(dairy?.items.map((i) => [i.name, i.pricePaise]), [["Milk", BigInt(6000)], ["Curd", BigInt(8000)]]);
    const set = String((await owner.query(`SELECT id FROM "${hotel.schema}".option_sets LIMIT 1`)).rows[0].id);
    const key = String((await owner.query(`SELECT key FROM "${hotel.schema}".option_sets WHERE id = $1`, [set])).rows[0].key);
    await owner.query(`UPDATE "${hotel.schema}".option_items SET is_active = false WHERE option_set_id = $1 AND sort_order = 1`, [set]);
    const total = Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".option_items WHERE option_set_id = $1`, [set])).rows[0].n);
    assert.equal((await run((r) => r.masterLists.activeValues(key))).length, total - 1, "inactive values are left out");
    await owner.query(`DELETE FROM "${hotel.schema}".accounting_years`);
    await owner.query(`INSERT INTO "${hotel.schema}".accounting_years (label, starts_on, ends_on) VALUES ('2026-27', '2026-04-01', '2027-03-31'), ('2025-26', '2025-04-01', '2026-03-31')`);
    assert.deepEqual((await run((r) => r.accountingYears.list())).map((y) => [y.label, y.startsOn, y.endsOn]), [["2025-26", "2025-04-01", "2026-03-31"], ["2026-27", "2026-04-01", "2027-03-31"]]);
    await run(async (r) => {
      await r.systemLogs.write({ module: "revenue", action: "created", entity: "deposit", subjectId: newId(), subjectLabel: "#1", summary: "Created", details: { amountPaise: "150000" }, userId: USER, userName: "Asha", ipAddress: "10.0.0.1", traceId: "trace-12345678" });
      await r.forceLogs.write({ userId: USER, userName: "Asha", action: "bypass", module: "revenue", summary: "Backdated", details: null, route: "revenue.deposits.store", method: "POST", ipAddress: null });
    });
    const logs = await owner.query(`SELECT module, details FROM "${hotel.schema}".system_logs`);
    assert.deepEqual(logs.rows, [{ module: "revenue", details: { amountPaise: "150000" } }]);
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".force_logs`)).rows[0].n), 1);
  });
});

after(async () => {
  await releaseTestLock?.();
});
