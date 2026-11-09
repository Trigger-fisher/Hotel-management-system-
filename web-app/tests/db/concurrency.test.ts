// Concurrency on the REAL PostgreSQL instance (hms_test): what the database itself must guarantee when several requests hit one hotel at once.
// Entry numbers under parallel inserts, the version trigger on every versioned table, optimistic locking with two writers, one in-house stay per
// room, a deadlock retried once, and the pool surviving errors without leaking a hotel role or search_path to the next request.
// Run with:   npm run test:db   (serial: these suites share hms_test)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import type { TxClient } from "../../src/db/types";
import { nextEntryNo, type EntryNumberTable } from "../../src/server/data/entryNo";
import { newId } from "../../src/server/db/ids";
import { classifyPgError } from "../../src/server/db/pgErrors";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let owner: DbClient;
let A: CreatedHotel;
let B: CreatedHotel;
let database: Database;

const as = <T>(hotel: CreatedHotel, work: (tx: TxClient) => Promise<T>, retry = false): Promise<T> =>
  database.withHotel({ hotelId: hotel.id }, work, retry ? { retryOnDeadlock: true } : {});

let releaseTestLock: (() => Promise<void>) | undefined;

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  A = await createTestHotel(owner, "Concurrency A");
  B = await createTestHotel(owner, "Concurrency B");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 12 });
  // warm the pool: the first burst of 40 parallel saves must not spend its time opening 12 new connections (pool connect timeout is 5 s)
  await Promise.all(Array.from({ length: 12 }, () => database.withHotel({ hotelId: A.id }, (tx) => tx.query("SELECT 1"))));
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

/** Inserts a row numbered by nextEntryNo, in one unit of work, the way every numbered book does. */
async function numbered(hotel: CreatedHotel, table: EntryNumberTable): Promise<number> {
  return as(hotel, async (tx) => {
    const no = await nextEntryNo(tx, table);
    await insertRow(tx, tx.schema, table, { entry_no: no });
    return no;
  });
}

describe("entry numbers under parallel inserts", () => {
  for (const table of ["hotel_cash_deposits", "bill_master_bills", "shift_handovers"] as const) {
    test(`${table}: 40 parallel saves get 40 different, gap-free numbers`, async () => {
      const numbers = await Promise.all(Array.from({ length: 40 }, () => numbered(A, table)));
      assert.equal(new Set(numbers).size, 40, "no number was handed out twice");
      assert.deepEqual([...numbers].sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1));
    });
  }

  test("the numbers of two hotels do not wait for, or disturb, each other", async () => {
    const [a, b] = await Promise.all([
      Promise.all(Array.from({ length: 15 }, () => numbered(A, "food_cash_deposits"))),
      Promise.all(Array.from({ length: 15 }, () => numbered(B, "food_cash_deposits"))),
    ]);
    assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.deepEqual([...b].sort((x, y) => x - y), Array.from({ length: 15 }, (_, i) => i + 1));
  });

  test("a soft-deleted row still counts: the next number is one past the highest including deleted ones", async () => {
    await as(A, async (tx) => {
      await insertRow(tx, tx.schema, "hotel_misc_expenses", { entry_no: 7, deleted_at: new Date().toISOString() });
    });
    assert.equal(await as(A, (tx) => nextEntryNo(tx, "hotel_misc_expenses")), 8);
  });

  test("a failed save gives its number back (the lock and the insert roll back together)", async () => {
    const first = await as(A, (tx) => nextEntryNo(tx, "staff_advances"));
    await assert.rejects(
      as(A, async (tx) => {
        const no = await nextEntryNo(tx, "staff_advances");
        await insertRow(tx, tx.schema, "staff_advances", { entry_no: no });
        throw new Error("the service failed after the insert");
      }),
    );
    assert.equal(await as(A, (tx) => nextEntryNo(tx, "staff_advances")), first);
  });

  test("the UNIQUE index is the backstop: a hand-made duplicate number is refused with 23505", async () => {
    await numbered(A, "hotel_cash_withdrawals");
    const error = await as(A, (tx) => insertRow(tx, tx.schema, "hotel_cash_withdrawals", { entry_no: 1 })).catch((e: unknown) => e);
    assert.equal(classifyPgError(error).kind, "unique");
  });
});

const VERSIONED = [
  "hotel_cash_deposits",
  "food_cash_deposits",
  "hotel_cash_withdrawals",
  "food_cash_withdrawals",
  "hotel_misc_expenses",
  "food_misc_expenses",
  "shift_handovers",
  "bill_master_advances",
  "bill_master_bills",
  "pms_reservations",
  "pms_stays",
  "salary_processings",
] as const;

describe("the version trigger on the 12 versioned tables", () => {
  for (const table of VERSIONED) {
    test(`${table}: version +1 passes; no change, +2 and going back are refused (23514)`, async () => {
      const row = await as(A, (tx) => insertRow(tx, tx.schema, table));
      const id = row.id as string;
      const bump = async (to: string): Promise<string | null> => {
        try {
          await as(A, (tx) => tx.query(`UPDATE ${table} SET version = ${to} WHERE id = $1`, [id]));
          return null;
        } catch (error) {
          return classifyPgError(error).kind;
        }
      };
      assert.equal(await bump("version"), "check", "an update that keeps the version is refused");
      // salary_processings may rise by more than one (migration 0015: a re-generate carries the old number on, one higher); every other table by exactly one
      if (table !== "salary_processings") assert.equal(await bump("version + 2"), "check", "a jump of two is refused");
      assert.equal(await bump("version - 1"), "check", "going back is refused");
      assert.equal(await bump("version + 1"), null, "exactly +1 passes");
      const res = await as(A, (tx) => tx.query(`SELECT version FROM ${table} WHERE id = $1`, [id]));
      assert.equal(Number(res.rows[0]!.version), 2);
    });
  }
});

describe("two writers on one row", () => {
  test("optimistic locking: of 6 parallel UPDATE ... WHERE version = 1, exactly one wins and the version is 2", async () => {
    const row = await as(A, (tx) => insertRow(tx, tx.schema, "bill_master_bills"));
    const id = row.id as string;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        as(A, async (tx) => (await tx.query("UPDATE bill_master_bills SET version = version + 1 WHERE id = $1 AND version = 1", [id])).affectedRows),
      ),
    );
    assert.equal(results.filter((n) => n === 1).length, 1);
    assert.equal(results.filter((n) => n === 0).length, 5);
    const res = await as(A, (tx) => tx.query("SELECT version FROM bill_master_bills WHERE id = $1", [id]));
    assert.equal(Number(res.rows[0]!.version), 2);
  });

  test("a blind +1 by two clerks at once never loses an update: both apply one after the other (version 3)", async () => {
    const row = await as(A, (tx) => insertRow(tx, tx.schema, "pms_reservations"));
    const id = row.id as string;
    await Promise.all([1, 2].map(() => as(A, (tx) => tx.query("UPDATE pms_reservations SET version = version + 1 WHERE id = $1", [id]))));
    const res = await as(A, (tx) => tx.query("SELECT version FROM pms_reservations WHERE id = $1", [id]));
    assert.equal(Number(res.rows[0]!.version), 3);
  });

  test("FOR UPDATE makes the second writer wait for the first, then see its result", async () => {
    const row = await as(A, (tx) => insertRow(tx, tx.schema, "salary_processings"));
    const id = row.id as string;
    const order: string[] = [];
    const first = as(A, async (tx) => {
      await tx.query("SELECT 1 FROM salary_processings WHERE id = $1 FOR UPDATE", [id]);
      await new Promise((r) => setTimeout(r, 400));
      await tx.query("UPDATE salary_processings SET version = version + 1 WHERE id = $1", [id]);
      order.push("first committed");
    });
    await new Promise((r) => setTimeout(r, 100));
    const second = as(A, async (tx) => {
      const res = await tx.query("SELECT version FROM salary_processings WHERE id = $1 FOR UPDATE", [id]);
      order.push(`second saw version ${String(res.rows[0]!.version)}`);
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first committed", "second saw version 2"]);
  });
});

describe("one in-house stay per room", () => {
  test("three check-ins of the same room at once: one wins, two get 23505 on the one-in-house index", async () => {
    const room = await as(A, (tx) => insertRow(tx, tx.schema, "pms_rooms"));
    const checkIn = (): Promise<unknown> => as(A, (tx) => insertRow(tx, tx.schema, "pms_stays", { room_id: room.id, status: "in_house", reservation_id: null }));
    const outcomes = await Promise.allSettled([checkIn(), checkIn(), checkIn()]);
    const ok = outcomes.filter((o) => o.status === "fulfilled").length;
    const refused = outcomes.filter((o) => o.status === "rejected" && classifyPgError(o.reason).kind === "unique").length;
    assert.equal(ok, 1);
    assert.equal(refused, 2);
  });

  test("a checked-out stay frees the room for the next guest", async () => {
    const room = await as(A, (tx) => insertRow(tx, tx.schema, "pms_rooms"));
    const stay = await as(A, (tx) => insertRow(tx, tx.schema, "pms_stays", { room_id: room.id, status: "in_house", reservation_id: null }));
    await as(A, (tx) => tx.query("UPDATE pms_stays SET status = 'checked_out', version = version + 1 WHERE id = $1", [stay.id]));
    await as(A, (tx) => insertRow(tx, tx.schema, "pms_stays", { room_id: room.id, status: "in_house", reservation_id: null }));
  });
});

describe("deadlocks and the pool", () => {
  async function crossUpdate(first: string, second: string, retry: boolean): Promise<void> {
    await as(
      A,
      async (tx) => {
        await tx.query("UPDATE hotel_cash_deposits SET reason = 'x', version = version + 1 WHERE id = $1", [first]);
        await new Promise((r) => setTimeout(r, 300));
        await tx.query("UPDATE hotel_cash_deposits SET reason = 'y', version = version + 1 WHERE id = $1", [second]);
      },
      retry,
    );
  }

  test("two units that lock two rows in opposite order: without retry one is the deadlock victim (40P01)", async () => {
    const r1 = (await as(A, (tx) => insertRow(tx, tx.schema, "hotel_cash_deposits"))).id as string;
    const r2 = (await as(A, (tx) => insertRow(tx, tx.schema, "hotel_cash_deposits"))).id as string;
    const outcomes = await Promise.allSettled([crossUpdate(r1, r2, false), crossUpdate(r2, r1, false)]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    const failed = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    assert.equal(classifyPgError(failed.reason).kind, "deadlock");
  });

  test("the same crossing with retryOnDeadlock: the victim is run again once and both finish", async () => {
    const r1 = (await as(A, (tx) => insertRow(tx, tx.schema, "hotel_cash_deposits"))).id as string;
    const r2 = (await as(A, (tx) => insertRow(tx, tx.schema, "hotel_cash_deposits"))).id as string;
    await Promise.all([crossUpdate(r1, r2, true), crossUpdate(r2, r1, true)]);
  });

  test("a failing unit does not poison the pool: 30 more units run, and no connection keeps a hotel role or search_path", async () => {
    for (let i = 0; i < 5; i += 1) await assert.rejects(as(A, (tx) => tx.query("SELECT * FROM table_that_does_not_exist")));
    await assert.rejects(as(B, () => Promise.reject(new Error("service bug"))));
    await Promise.all(Array.from({ length: 30 }, (_, i) => as(i % 2 === 0 ? A : B, (tx) => tx.query("SELECT 1"))));
    // look at EVERY connection of the pool from the outside: each one is back to hms_app with the default search_path
    const clients = await Promise.all(Array.from({ length: Math.max(1, database.pool.totalCount) }, () => database.pool.connect()));
    try {
      for (const client of clients) {
        const res = await client.query("SELECT current_user AS u, current_setting('search_path') AS p");
        assert.equal(res.rows[0]!.u, "hms_app");
        assert.doesNotMatch(String(res.rows[0]!.p), /hotel_/);
      }
    } finally {
      for (const client of clients) client.release();
    }
  });

  test("a unit that throws mid-way leaves no open transaction behind", async () => {
    await assert.rejects(
      as(A, async (tx) => {
        await insertRow(tx, tx.schema, "hotel_cash_deposits");
        throw new Error("boom");
      }),
    );
    const idle = await owner.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND usename = 'hms_app'");
    assert.equal(Number(idle.rows[0]!.n), 0);
  });

  test("a hotel that does not exist is refused before any statement runs", async () => {
    await assert.rejects(database.withHotel({ hotelId: newId() }, (tx) => tx.query("SELECT 1")));
  });
});

// registered last, so it runs last: parallel runs on hms_test queue instead of wiping each other's hotels
after(async () => {
  await releaseTestLock?.();
});
