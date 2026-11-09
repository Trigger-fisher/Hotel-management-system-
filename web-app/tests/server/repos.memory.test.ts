// The in-memory repositories are the test double for PostgreSQL, so they must obey the same rules as the tables: entry numbers,
// soft delete, the version check, the CHECKs, one transaction per unit, and one data set per hotel.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toPaise } from "../../src/server/money/paise";
import type { NewCashDeposit } from "../../src/server/repos/cashDeposit";
import { createMemoryCash } from "../../src/server/repos/memory/cashDeposit";
import { RepoError } from "../../src/server/repos/types";
import { unwrapVersioned } from "../../src/server/repos/unwrap";
import { AppError } from "../../src/server/errors";
import { HOTEL_A, HOTEL_B } from "./helpers/session";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A = { hotelId: HOTEL_A, userId: USER };
const B = { hotelId: HOTEL_B, userId: USER };
const deposit = (over: Partial<NewCashDeposit> = {}): NewCashDeposit => ({
  date: "2026-10-05",
  time: "10:30:00",
  userId: USER,
  fullName: "Asha",
  depositor: "Front desk",
  amountPaise: toPaise(150000),
  amountInWords: null,
  reason: null,
  createdBy: USER,
  ...over,
});
const list = { page: 1, pageSize: 50, sort: "entryNo" as const, dir: "asc" as const };

describe("entry numbers (Pallav HasEntryNumber)", () => {
  test("one past the highest, per book", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      assert.deepEqual([(await cashDeposits.create("hotel", deposit())).entryNo, (await cashDeposits.create("hotel", deposit())).entryNo], [1, 2]);
      assert.equal((await cashDeposits.create("food", deposit())).entryNo, 1, "the food book counts on its own");
      assert.equal(await cashDeposits.nextEntryNo("hotel"), 3);
    });
  });
  test("a soft-deleted entry keeps its number; purging the last one frees it; a gap in the middle stays", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      const one = await cashDeposits.create("hotel", deposit());
      const two = await cashDeposits.create("hotel", deposit());
      const three = await cashDeposits.create("hotel", deposit());
      unwrapVersioned(await cashDeposits.softDelete("hotel", two.id, 1, USER));
      assert.equal(await cashDeposits.nextEntryNo("hotel"), 4, "the middle gap stays, the next number is still 4");
      unwrapVersioned(await cashDeposits.softDelete("hotel", three.id, 1, USER));
      assert.equal(await cashDeposits.nextEntryNo("hotel"), 4, "soft-deleted rows still count");
      assert.equal(await cashDeposits.purge("hotel", three.id), true);
      assert.equal(await cashDeposits.nextEntryNo("hotel"), 3, "purged for good: the number is free again");
      assert.equal(await cashDeposits.purge("hotel", one.id), false, "a live row is never purged");
    });
  });
  test("parallel creates never share a number (one unit at a time per hotel, like the advisory lock)", async () => {
    const { unit } = createMemoryCash();
    const made = await Promise.all(Array.from({ length: 20 }, () => unit.run(A, ({ cashDeposits }) => cashDeposits.create("hotel", deposit()))));
    assert.deepEqual(made.map((r) => r.entryNo).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe("soft delete and the recycle bin", () => {
  test("a deleted row leaves get, list and totals, shows in the bin, and comes back on restore", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      const row = await cashDeposits.create("hotel", deposit({ amountPaise: toPaise(10000) }));
      await cashDeposits.create("hotel", deposit({ amountPaise: toPaise(5000) }));
      const gone = unwrapVersioned(await cashDeposits.softDelete("hotel", row.id, 1, USER));
      assert.equal(gone.deletedBy, USER);
      assert.equal(gone.version, 2);
      assert.equal(await cashDeposits.get("hotel", row.id), null);
      assert.equal((await cashDeposits.get("hotel", row.id, { deleted: true }))?.id, row.id);
      assert.equal((await cashDeposits.list("hotel", list)).total, 1);
      assert.equal((await cashDeposits.list("hotel", { ...list, deleted: "only" })).total, 1);
      assert.deepEqual(await cashDeposits.totals("hotel", {}), { count: 1, totalPaise: toPaise(5000) });
      const back = unwrapVersioned(await cashDeposits.restore("hotel", row.id, 2, USER));
      assert.equal(back.deletedAt, null);
      assert.equal(back.version, 3);
      assert.equal((await cashDeposits.totals("hotel", {})).count, 2);
    });
  });
  test("deleting twice, or restoring a live row, finds nothing", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      const row = await cashDeposits.create("hotel", deposit());
      assert.deepEqual(await cashDeposits.restore("hotel", row.id, 1, USER), { ok: false, reason: "not_found" });
      unwrapVersioned(await cashDeposits.softDelete("hotel", row.id, 1, USER));
      assert.deepEqual(await cashDeposits.softDelete("hotel", row.id, 2, USER), { ok: false, reason: "not_found" });
    });
  });
});

describe("the version check", () => {
  test("a matching version updates and raises it by one; a stale one matches nothing and reports the current version", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      const row = await cashDeposits.create("hotel", deposit());
      assert.equal(row.version, 1);
      const next = unwrapVersioned(await cashDeposits.update("hotel", row.id, 1, { depositor: "Night desk" }, USER));
      assert.deepEqual([next.version, next.depositor, next.updatedBy], [2, "Night desk", USER]);
      assert.deepEqual(await cashDeposits.update("hotel", row.id, 1, { depositor: "Old tab" }, USER), { ok: false, reason: "conflict", currentVersion: 2 });
      assert.equal((await cashDeposits.get("hotel", row.id))?.depositor, "Night desk");
      assert.throws(() => unwrapVersioned({ ok: false, reason: "conflict", currentVersion: 2 }), (e: unknown) => e instanceof AppError && e.code === "CONFLICT" && e.details?.currentVersion === 2);
      assert.throws(() => unwrapVersioned({ ok: false, reason: "not_found" }), (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
    });
  });
});

describe("the table's CHECKs", () => {
  test("amount_paise must be above zero and the depositor not empty, on create and on update", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      for (const bad of [deposit({ amountPaise: toPaise(0) }), deposit({ amountPaise: toPaise(-5) }), deposit({ depositor: "  " })]) {
        await assert.rejects(() => cashDeposits.create("hotel", bad), (e: unknown) => e instanceof RepoError && e.kind === "check");
      }
      const row = await cashDeposits.create("hotel", deposit());
      await assert.rejects(() => cashDeposits.update("hotel", row.id, 1, { amountPaise: toPaise(0) }, USER), (e: unknown) => e instanceof RepoError);
    });
  });
});

describe("list, search, sort and totals", () => {
  test("search is a plain case-insensitive substring: % and _ are ordinary characters, quotes do nothing", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      await cashDeposits.create("hotel", deposit({ depositor: "Front desk", reason: "50% advance" }));
      await cashDeposits.create("hotel", deposit({ depositor: "Night desk", reason: "o'brien'; DROP TABLE x;--" }));
      assert.equal((await cashDeposits.list("hotel", { ...list, search: "FRONT" })).total, 1);
      assert.equal((await cashDeposits.list("hotel", { ...list, search: "%" })).total, 1, "% matches only a real percent sign");
      assert.equal((await cashDeposits.list("hotel", { ...list, search: "_" })).total, 0);
      assert.equal((await cashDeposits.list("hotel", { ...list, search: "'; drop table" })).total, 1);
    });
  });
  test("sort, direction, date range and paging", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      for (const [d, amount] of [["2026-10-01", 100], ["2026-10-03", 300], ["2026-10-02", 200]] as const) await cashDeposits.create("hotel", deposit({ date: d, amountPaise: toPaise(amount) }));
      assert.deepEqual((await cashDeposits.list("hotel", { ...list, sort: "date" })).rows.map((r) => r.date), ["2026-10-01", "2026-10-02", "2026-10-03"]);
      assert.deepEqual((await cashDeposits.list("hotel", { ...list, sort: "amountPaise", dir: "desc" })).rows.map((r) => Number(r.amountPaise)), [300, 200, 100]);
      assert.equal((await cashDeposits.list("hotel", { ...list, from: "2026-10-02", to: "2026-10-03" })).total, 2);
      const page2 = await cashDeposits.list("hotel", { ...list, pageSize: 2, page: 2 });
      assert.deepEqual([page2.rows.length, page2.total], [1, 3]);
      assert.deepEqual(await cashDeposits.totals("hotel", { from: "2026-10-02" }), { count: 2, totalPaise: toPaise(500) });
    });
  });
});

describe("a unit is one transaction on one hotel", () => {
  test("a throw undoes everything the unit did", async () => {
    const { unit } = createMemoryCash();
    await assert.rejects(() =>
      unit.run(A, async ({ cashDeposits }) => {
        await cashDeposits.create("hotel", deposit());
        throw new Error("boom");
      }),
    );
    assert.equal(await unit.run(A, ({ cashDeposits }) => cashDeposits.nextEntryNo("hotel")), 1, "the rolled-back entry is gone and its number unused");
  });
  test("hotel B can never see hotel A's rows, by id, by list or by totals; each hotel numbers from 1", async () => {
    const { unit } = createMemoryCash();
    const row = await unit.run(A, ({ cashDeposits }) => cashDeposits.create("hotel", deposit()));
    await unit.run(B, async ({ cashDeposits }) => {
      assert.equal(await cashDeposits.get("hotel", row.id), null);
      assert.equal((await cashDeposits.list("hotel", list)).total, 0);
      assert.deepEqual(await cashDeposits.totals("hotel", {}), { count: 0, totalPaise: toPaise(0) });
      assert.deepEqual(await cashDeposits.update("hotel", row.id, 1, { depositor: "x" }, USER), { ok: false, reason: "not_found" });
      assert.deepEqual(await cashDeposits.softDelete("hotel", row.id, 1, USER), { ok: false, reason: "not_found" });
      assert.equal((await cashDeposits.create("hotel", deposit())).entryNo, 1);
    });
    assert.equal((await unit.run(A, ({ cashDeposits }) => cashDeposits.get("hotel", row.id)))?.depositor, "Front desk");
  });
  test("the repositories hand out copies: changing a returned row does not change the store", async () => {
    const { unit } = createMemoryCash();
    await unit.run(A, async ({ cashDeposits }) => {
      const row = await cashDeposits.create("hotel", deposit());
      row.depositor = "tampered";
      assert.equal((await cashDeposits.get("hotel", row.id))?.depositor, "Front desk");
    });
  });
});
