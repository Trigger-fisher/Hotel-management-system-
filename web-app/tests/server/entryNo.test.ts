// nextEntryNo with a fake client: the SQL text and the order of the statements. Real parallel inserts run on the PostgreSQL instance in
// tests/db/concurrency.test.ts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assumeTransaction, type SqlClient, type SqlResult, type TxClient } from "../../src/db/types";
import { ENTRY_LOCK_SQL, ENTRY_NUMBER_TABLES, nextEntryNo, type EntryNumberTable } from "../../src/server/data/entryNo";
import { AppError } from "../../src/server/errors";

const SCHEMA = `hotel_${"0198a3b27c4d7e5f8a9b0c1d2e3f4a5b"}`;

class Recorder implements SqlClient {
  readonly calls: { text: string; params: readonly unknown[] | undefined }[] = [];
  constructor(private readonly max: unknown = 4) {}
  async query(text: string, params?: readonly unknown[]): Promise<SqlResult> {
    this.calls.push({ text, params });
    return { rows: text.startsWith("SELECT COALESCE") ? [{ next: this.max }] : [], affectedRows: 0 };
  }
  tx(): TxClient {
    return assumeTransaction(this, SCHEMA);
  }
}

describe("nextEntryNo", () => {
  test("takes the transaction-level advisory lock FIRST, then reads MAX+1 over the whole table; there is nothing to unlock (COMMIT or ROLLBACK does it)", async () => {
    const client = new Recorder(7);
    const next = await nextEntryNo(client.tx(), "hotel_cash_deposits");
    assert.equal(next, 7);
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].text, ENTRY_LOCK_SQL);
    assert.deepEqual(client.calls[0].params, ["hotel_cash_deposits"]);
    assert.equal(client.calls[1].text, 'SELECT COALESCE(MAX(entry_no), 0) + 1 AS next FROM "hotel_cash_deposits"');
  });

  test("the lock is per hotel (current_schema()) and per table, and is a transaction lock, never a session lock that would leak through the pool", () => {
    assert.match(ENTRY_LOCK_SQL, /pg_advisory_xact_lock\(/);
    assert.doesNotMatch(ENTRY_LOCK_SQL, /pg_advisory_lock\(|pg_try_advisory/);
    assert.match(ENTRY_LOCK_SQL, /current_schema\(\)/);
    assert.match(ENTRY_LOCK_SQL, /\$1::text/);
  });

  test("counts every row: the query has no WHERE, so soft-deleted entries keep their number", async () => {
    const client = new Recorder();
    await nextEntryNo(client.tx(), "bill_master_bills");
    assert.ok(!/\bWHERE\b/i.test(client.calls[1].text));
    assert.ok(!/deleted_at/i.test(client.calls[1].text));
  });

  test("an empty book starts at 1; numbers can arrive as strings or numbers", async () => {
    assert.equal(await nextEntryNo(new Recorder(1).tx(), "shift_handovers"), 1);
    assert.equal(await nextEntryNo(new Recorder("42").tx(), "shift_handovers"), 42);
    assert.equal(await nextEntryNo(new Recorder(BigInt(9)).tx(), "shift_handovers"), 9);
  });

  test("every numbered book works, and there are exactly Pallav's 13", async () => {
    assert.equal(ENTRY_NUMBER_TABLES.length, 13);
    assert.equal(new Set(ENTRY_NUMBER_TABLES).size, 13);
    for (const table of ENTRY_NUMBER_TABLES) {
      const client = new Recorder();
      await nextEntryNo(client.tx(), table);
      assert.ok(client.calls[1].text.endsWith(`FROM "${table}"`));
    }
  });

  test("a table that is not in the list is refused before any query", async () => {
    const hostile = ["users", "platform.users", "hotel_cash_deposits ", " hotel_cash_deposits", "HOTEL_CASH_DEPOSITS", 'x"; DROP TABLE users; --', "hotel_cash_deposits; SELECT 1", "", "employees", "pms_rooms"];
    for (const table of hostile) {
      const client = new Recorder();
      await assert.rejects(
        () => nextEntryNo(client.tx(), table as EntryNumberTable),
        (error: unknown) => error instanceof AppError && error.code === "SERVER_ERROR",
        JSON.stringify(table),
      );
      assert.equal(client.calls.length, 0, "no SQL may run for a refused table");
    }
    for (const notAString of [null, undefined, 5, {}, ["hotel_cash_deposits"]]) {
      await assert.rejects(() => nextEntryNo(new Recorder().tx(), notAString as never), AppError);
    }
  });

  test("an impossible result is an error, not a number", async () => {
    for (const bad of [null, "abc", Number.NaN, -3, 0, 1.5, Number.MAX_SAFE_INTEGER + 10]) {
      await assert.rejects(() => nextEntryNo(new Recorder(bad).tx(), "staff_advances"), AppError, String(bad));
    }
  });

  test("no row at all is an error too", async () => {
    const client = new Recorder();
    client.query = async (): Promise<SqlResult> => ({ rows: [], affectedRows: 0 });
    await assert.rejects(() => nextEntryNo(client.tx(), "staff_advances"), AppError);
  });

  test("a lock that times out (the role's lock_timeout: another save holds the book) is a CONFLICT and the MAX query never runs", async () => {
    const ran: string[] = [];
    const timedOut: SqlClient = {
      async query(text: string): Promise<SqlResult> {
        ran.push(text);
        throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
      },
    };
    await assert.rejects(() => nextEntryNo(assumeTransaction(timedOut, SCHEMA), "staff_advances"), (e: unknown) => e instanceof AppError && e.code === "CONFLICT");
    assert.deepEqual(ran, [ENTRY_LOCK_SQL]);
  });

  test("any other failure of the lock statement is passed on unchanged and stops everything", async () => {
    const ran: string[] = [];
    const failing: SqlClient = {
      async query(text: string): Promise<SqlResult> {
        ran.push(text);
        throw new Error("connection lost");
      },
    };
    await assert.rejects(() => nextEntryNo(assumeTransaction(failing, SCHEMA), "staff_advances"), /connection lost/);
    assert.deepEqual(ran, [ENTRY_LOCK_SQL]);
  });
});
