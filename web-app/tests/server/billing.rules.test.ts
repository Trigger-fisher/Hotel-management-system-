// Billing: the accounting-year guard's "pending columns" (Pallav Books::guard 4th/5th arguments, Books.php:59-81), concurrency on the
// in-memory double, and the MySQL tests that wait for Worker A's repositories (skipped until then).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError } from "../../src/server/errors";
import type { AccountingYear } from "../../src/server/repos/cashSupport";
import { createMemoryBilling } from "../../src/server/repos/memory/billing";
import { createAdvanceService } from "../../src/server/services/billing/advanceService";
import { guardBooks } from "../../src/server/services/cash/books";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const years: AccountingYear[] = [
  { id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" },
  { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" },
];
const refused = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.message;
    throw error;
  }
  return "";
};

describe("guardBooks with pending columns (Books.php:59-81)", () => {
  test("without `pending` a closed year's record is still refused 'changed' (cash unchanged)", () => {
    assert.match(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save" })), /cannot be changed/);
  });
  test("only pending columns of a closed year's record: allowed, with no action date or one dated this year", () => {
    assert.equal(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save", pending: { onlyPendingChanged: true, actionDates: [] } })), "");
    assert.equal(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: null, now: "2026-10-05" }] } })), "");
  });
  test("other columns too: refused 'changed'", () => {
    assert.match(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save", pending: { onlyPendingChanged: false, actionDates: [] } })), /2025-26 is closed, so an entry dated 01 Mar 2026 cannot be changed/);
  });
  test("an action date in the closed year: refused 'dated'; one in a year not started: the 'not started' message", () => {
    assert.match(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: null, now: "2026-03-15" }] } })), /nothing can be dated 15 Mar 2026/);
    assert.match(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: null, now: "2027-04-02" }] } })), /^02 Apr 2027 is in 2027-28, which has not been started yet\./);
  });
  test("undoing what a closed year did is closed too", () => {
    assert.match(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: "2026-03-10", now: null }] } })), /entry dated 10 Mar 2026 cannot be changed/);
  });
  test("an unchanged action date is not checked", () => {
    assert.equal(refused(() => guardBooks({ years, was: "2026-03-01", now: "2026-03-01", action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: "2026-03-10", now: "2026-03-10" }] } })), "");
  });
  test("a current-year record ignores `pending` (Pallav checks action dates only for a closed year's record)", () => {
    assert.equal(refused(() => guardBooks({ years, was: "2026-10-01", now: "2026-10-01", action: "save", pending: { onlyPendingChanged: true, actionDates: [{ was: null, now: "2026-03-15" }] } })), "");
  });
  test("delete ignores `pending`", () => {
    assert.match(refused(() => guardBooks({ years, was: "2026-03-01", now: null, action: "delete", pending: { onlyPendingChanged: true, actionDates: [] } })), /cannot be deleted/);
  });
});

describe("concurrency on the in-memory double (one unit at a time per hotel)", () => {
  const people = { get: async () => new Map() };
  const audit = { record: async () => undefined };
  const meta = { traceId: "t", ip: null };
  const editor = makeSession({ userId: "00000000-0000-4000-8000-000000000003", grants: [grant("bills.advances", "full")] });
  const body = (receiptNo: string) => ({
    receiptNo, paymentDate: "2026-10-05", guestName: "G", mobile: "", companyId: null, roomNo: "", covers: "hotel" as const, hotelPaise: 1000, foodPaise: null,
    hotelMode: null, foodMode: null, referenceName: "", referenceMobile: "", instruction: "",
  });

  test("twenty advances saved at once get twenty different entry numbers", async () => {
    const billing = createMemoryBilling();
    billing.store.dataFor(HOTEL_A).years = years;
    const service = createAdvanceService({ unit: billing.unit, people, audit, catalog, now: () => new Date("2026-10-05T10:00:00+05:30") });
    const made = await Promise.all(Array.from({ length: 20 }, (_, i) => service.create(editor, body(String(i + 1)), meta)));
    assert.deepEqual(made.map((a) => a.entryNo).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  });
  test("the same receipt number twice at once: one is saved, the other gets Pallav's message", async () => {
    const billing = createMemoryBilling();
    billing.store.dataFor(HOTEL_A).years = years;
    const service = createAdvanceService({ unit: billing.unit, people, audit, catalog, now: () => new Date("2026-10-05T10:00:00+05:30") });
    const results = await Promise.allSettled([service.create(editor, body("7"), meta), service.create(editor, body("7"), meta)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.equal((failed.reason as AppError).message, "This receipt number already exists.");
  });
  test("two refunds of the same advance at once: one wins, the other is refused; the balance never goes below zero", async () => {
    const billing = createMemoryBilling();
    billing.store.dataFor(HOTEL_A).years = years;
    const service = createAdvanceService({ unit: billing.unit, people, audit, catalog, now: () => new Date("2026-10-05T10:00:00+05:30") });
    const a = await service.create(editor, body("1"), meta);
    const refund = { date: "2026-10-05", hotelPaise: 1000, foodPaise: null, hotelMode: null, foodMode: null, toName: "", toMobile: "", note: "", version: a.version };
    const results = await Promise.allSettled([service.refund(editor, a.id, refund, meta), service.refund(editor, a.id, refund, meta)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as AppError).code, "CONFLICT");
    assert.equal(billing.store.dataFor(HOTEL_A).advances[0].hotelBalancePaise, BigInt(0));
  });
});

// The same rules against MySQL (Worker A's M2/M3 repositories, run with `npm run test:db`). They stay skipped until the MySQL billing
// repository exists; the in-memory double above already proves the service side.
const MYSQL = "needs the MySQL billing repository (Worker A, M3): un-skipped when it lands";
describe("billing on MySQL (skipped until the repository exists)", () => {
  test("the MySQL AdvanceRepo passes the same repository suite as the in-memory double", { skip: MYSQL }, () => {});
  test("entry numbers under GET_LOCK: 20 parallel creates on two connections give 20 different numbers; a soft-deleted row keeps its number", { skip: MYSQL }, () => {});
  test("get(id, { forUpdate: true }) holds the row: a second unit applying the same advance waits, then sees the lower balance", { skip: MYSQL }, () => {});
  test("the receipt number is unique among LIVE rows only (functional unique index)", { skip: MYSQL }, () => {});
  test("a negative balance is refused by the CHECK even if the service let one through", { skip: MYSQL }, () => {});
  test("hotel B's user cannot select, update or delete hotel A's advances even with a qualified table name", { skip: MYSQL }, () => {});
  test("EXPLAIN: the list by payment date and the open-advance picker use an index", { skip: MYSQL }, () => {});
});
