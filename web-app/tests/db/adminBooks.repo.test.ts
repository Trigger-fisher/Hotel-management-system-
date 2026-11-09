// The Books repository (repos/postgres/adminBooks.ts) on the REAL PostgreSQL instance: the years, a count per dated table, what an older year left
// open, start-next in one step, and the all-or-nothing removal of the newest year with every give-back of docs/specs/admin.md §8.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import { DATED_TABLES, type AdminBooksRepos } from "../../src/server/repos/adminBooks";
import { createPgAdminBooksUnit } from "../../src/server/repos/postgres/adminBooks";
import { RepoError, type Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<AdminBooksRepos>;
const ACTOR = newId();
const NOW = new Date("2027-04-02T05:00:00.000Z");
const run = <T>(work: (r: AdminBooksRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: ACTOR }, work);
const S = (): string => `"${hotel.schema}"`;
const row = (table: string, over: Record<string, unknown> = {}) => insertRow(owner, hotel.schema, table, over);
const one = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>> => (await owner.query(sql, params)).rows[0];

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Books Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  unit = createPgAdminBooksUnit(database.withHotel);
  await owner.query(`DELETE FROM ${S()}.accounting_years`); // a new hotel starts with the current year (seed 0002): this test sets its own years
  await owner.query(`INSERT INTO ${S()}.accounting_years (label, starts_on, ends_on) VALUES ('2025-26', '2025-04-01', '2026-03-31'), ('2026-27', '2026-04-01', '2027-03-31')`);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

describe("years, counts, carried, start", () => {
  test("years oldest first; a count per dated table counts only the rows dated in the year; start closes the current year and opens the next in one step", async () => {
    const years = await run((r) => r.books.years());
    assert.deepEqual(years.map((y) => [y.label, y.startsOn, y.endsOn]), [["2025-26", "2025-04-01", "2026-03-31"], ["2026-27", "2026-04-01", "2027-03-31"]]);
    const dated: Record<string, Record<string, unknown>> = {
      hotel_cash_deposits: { date: "2026-06-10" }, food_cash_deposits: { date: "2026-06-10" }, hotel_cash_withdrawals: { date: "2026-06-10" }, food_cash_withdrawals: { date: "2026-06-10" },
      hotel_misc_expenses: { date: "2026-06-10" }, food_misc_expenses: { date: "2026-06-10" }, shift_handovers: { date: "2026-06-10" }, bill_master_bills: { bill_date: "2026-06-10" },
      bill_master_advances: { payment_date: "2026-06-10" }, staff_advances: { date: "2026-06-10" }, payroll_advances: { advance_date: "2026-06-10T08:00:00Z" },
      bonus_incentives: { entry_date: "2026-06-10T08:00:00Z" }, employee_meal_periods: { starts_on: "2026-06-10" }, salary_processings: { year: 2026, month: 6 }, attendance_months: { year: 2026, month: 6 },
    };
    for (const table of DATED_TABLES) await row(table, dated[table]);
    await row("hotel_cash_deposits", { date: "2025-12-01" });
    await row("bill_master_bills", { bill_date: "2027-04-01" });
    const counts = await run((r) => r.books.counts(years[1]));
    assert.deepEqual(Object.keys(counts).sort(), [...DATED_TABLES].sort());
    for (const table of DATED_TABLES) assert.equal(counts[table], 1, table);
    assert.equal((await run((r) => r.books.counts(years[0])))["hotel_cash_deposits"], 1);

    const carried = await run((r) => r.books.carried(years[1]));
    assert.deepEqual([carried.cashPaise, carried.bills.count, carried.advances.count, carried.payroll.count, carried.salaries.count], [null, 0, 0, 0, 0]);

    const next = await run((r) => r.books.start({ label: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31" }, ACTOR, NOW));
    assert.deepEqual([next.label, next.closedAt, next.startedBy], ["2027-28", null, ACTOR]);
    const after = await run((r) => r.books.years());
    assert.deepEqual(after.map((y) => [y.label, y.closedAt !== null]), [["2025-26", true], ["2026-27", true], ["2027-28", false]]);
    assert.equal(after[1].closedBy, ACTOR);
    await assert.rejects(() => run((r) => r.books.start({ label: "2027-28", startsOn: "2028-04-01", endsOn: "2029-03-31" }, ACTOR, NOW)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal((await run((r) => r.books.years())).length, 3, "the refused start left nothing behind");
  });
});

describe("removeLatest", () => {
  test("gives back what the year did to older records, deletes everything dated in it, reopens the previous year; one removal at a time", async () => {
    await owner.query(`DELETE FROM ${S()}.accounting_years WHERE label = '2027-28'`);
    await owner.query(`UPDATE ${S()}.accounting_years SET closed_at = now() WHERE label = '2025-26'`);

    // (3) an older advance used by a bill of this year gets back what the bill took
    const used = await row("bill_master_advances", { payment_date: "2025-10-01", hotel_balance_paise: 0, food_balance_paise: 0, hotel_amount_paise: 5000, food_amount_paise: 0, total_paise: 0 });
    await row("bill_master_bills", { bill_date: "2026-08-01", advance_id: used.id, advance_delete_hotel_amount_paise: 3000, advance_delete_food_amount_paise: 200 });

    // (4) an older debit bill settled in this year waits again, and the advance made from its overpayment goes
    await row("bill_master_advances", { payment_date: "2026-07-05", receipt_number: "Excessive / OLD-1" });
    const debit = await row("bill_master_bills", {
      bill_date: "2025-11-01", total_hotel_amount_paise: 5000, total_food_amount_paise: 700, balance_hotel_amount_paise: 0, balance_food_amount_paise: 0, debit_bill_date: "2026-07-01",
      debit_hotel_amount_paise: 5000, debit_hotel_mode: "Cash", formatted_advance_receipt_number: "Excessive / OLD-1", debit_hotel_advance: "x", debit_reference_name: "Ref",
    });

    // (5) an older advance refunded in this year is not refunded any more
    const refunded = await row("bill_master_advances", {
      payment_date: "2025-12-01", hotel_balance_paise: 1000, food_balance_paise: 0, total_paise: 1000, hotel_refund_amount_paise: 4000, food_refund_amount_paise: 500, hotel_refund_mode: "Cash",
      refund_payment_date: "2026-09-09", refund_guest_name: "G",
    });

    // (2) an older salary paid in this year is pending again
    const paid = await row("salary_processings", { year: 2026, month: 2, net_salary_paise: 9000, paid_amount_paise: 9000, payment_status: "Paid", paid_at: "2026-05-01", payment_reference: "UTR1" });

    // (1) a salary run of this year took 1500 of an older payroll advance: the recovery goes back; its carry-forward goes
    const company = await row("payroll_companies");
    const employee = await row("employees", { payroll_company_id: company.id });
    const advance = await row("payroll_advances", { payroll_company_id: company.id, employee_id: employee.id, advance_date: "2025-12-01T08:00:00Z", amount_paise: 4000, recovered_amount_paise: 4000, is_settled: true });
    const processing = await row("salary_processings", { payroll_company_id: company.id, employee_id: employee.id, year: 2026, month: 7 });
    await owner.query(`INSERT INTO ${S()}.salary_processing_lines (salary_processing_id, category, label, amount_paise, source_type, source_id) VALUES ($1, 'Advance', 'Advance', 1500, 'advance', $2)`, [processing.id, advance.id]);

    // the dated rows the removal deletes, with an expense line that has no foreign key
    const expense = await row("hotel_misc_expenses", { date: "2026-10-10" });
    await row("expense_lines", { business: "hotel", expense_id: expense.id });
    await row("attendance_months", { payroll_company_id: company.id, year: 2026, month: 8 });

    const before = await run((r) => r.books.counts({ id: "", label: "", startsOn: "2026-04-01", endsOn: "2027-03-31", closedAt: null, startedBy: null, closedBy: null }));
    const removed = await run((r) => r.books.removeLatest(ACTOR, NOW));
    assert.deepEqual(removed, before);

    const adv = await one(`SELECT hotel_balance_paise, food_balance_paise, version FROM ${S()}.bill_master_advances WHERE id = $1`, [used.id]);
    assert.deepEqual([Number(adv.hotel_balance_paise), Number(adv.food_balance_paise), Number(adv.version)], [3000, 200, 2]);

    const bill = await one(`SELECT balance_hotel_amount_paise, balance_food_amount_paise, debit_bill_date, debit_hotel_amount_paise, debit_hotel_mode, formatted_advance_receipt_number, debit_hotel_advance, debit_reference_name FROM ${S()}.bill_master_bills WHERE id = $1`, [debit.id]);
    assert.deepEqual([Number(bill.balance_hotel_amount_paise), Number(bill.balance_food_amount_paise), bill.debit_bill_date, bill.debit_hotel_amount_paise, bill.debit_hotel_mode, bill.formatted_advance_receipt_number, bill.debit_hotel_advance, bill.debit_reference_name], [5000, 700, null, null, null, null, null, null]);
    assert.equal(Number((await one(`SELECT COUNT(*) AS n FROM ${S()}.bill_master_advances WHERE receipt_number = 'Excessive / OLD-1'`)).n), 0);

    const ref = await one(`SELECT hotel_balance_paise, food_balance_paise, total_paise, hotel_refund_amount_paise, hotel_refund_mode, refund_payment_date, refund_guest_name FROM ${S()}.bill_master_advances WHERE id = $1`, [refunded.id]);
    assert.deepEqual([Number(ref.hotel_balance_paise), Number(ref.food_balance_paise), Number(ref.total_paise), ref.hotel_refund_amount_paise, ref.hotel_refund_mode, ref.refund_payment_date, ref.refund_guest_name], [5000, 500, 5500, null, null, null, null]);

    const sal = await one(`SELECT payment_status, paid_amount_paise, paid_at, payment_reference FROM ${S()}.salary_processings WHERE id = $1`, [paid.id]);
    assert.deepEqual([sal.payment_status, Number(sal.paid_amount_paise), sal.paid_at, sal.payment_reference], ["Pending", 0, null, null]);

    const pay = await one(`SELECT recovered_amount_paise, is_settled FROM ${S()}.payroll_advances WHERE id = $1`, [advance.id]);
    assert.deepEqual([Number(pay.recovered_amount_paise), pay.is_settled], [2500, false]);

    for (const table of DATED_TABLES) {
      if (table === "salary_processings") continue; // the older salaries stay
      const left = Number((await one(`SELECT COUNT(*) AS n FROM ${S()}.${table}`)).n);
      assert.ok(left <= 2, `${table}: only rows dated before the year remain (${left})`);
    }
    assert.equal(Number((await one(`SELECT COUNT(*) AS n FROM ${S()}.bill_master_bills WHERE bill_date BETWEEN '2026-04-01' AND '2027-03-31'`)).n), 0);
    assert.equal(Number((await one(`SELECT COUNT(*) AS n FROM ${S()}.expense_lines`)).n), 0);
    assert.equal(Number((await one(`SELECT COUNT(*) AS n FROM ${S()}.attendance_entries`)).n), 0);
    assert.equal(Number((await one(`SELECT COUNT(*) AS n FROM ${S()}.salary_processing_lines`)).n), 0);
    const years = await run((r) => r.books.years());
    assert.deepEqual(years.map((y) => [y.label, y.closedAt]), [["2025-26", null]]);
  });

  test("never the only year: nothing is removed", async () => {
    await assert.rejects(() => run((r) => r.books.removeLatest(ACTOR, NOW)), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal((await run((r) => r.books.years())).length, 1);
  });

  test("all or nothing: a failure in the middle rolls every step back", async () => {
    await owner.query(`DELETE FROM ${S()}.accounting_years`);
    await owner.query(`INSERT INTO ${S()}.accounting_years (label, starts_on, ends_on) VALUES ('2025-26', '2025-04-01', '2026-03-31'), ('2026-27', '2026-04-01', '2027-03-31')`);
    const bill = await row("bill_master_bills", { bill_date: "2026-09-01" });
    await owner.query(`CREATE OR REPLACE FUNCTION ${S()}.refuse_year_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused' USING ERRCODE = '23514'; END $$`);
    await owner.query(`CREATE TRIGGER refuse_year_delete BEFORE DELETE ON ${S()}.accounting_years FOR EACH ROW EXECUTE FUNCTION ${S()}.refuse_year_delete()`);
    await assert.rejects(() => run((r) => r.books.removeLatest(ACTOR, NOW)));
    assert.equal(Number((await one(`SELECT COUNT(*) AS n FROM ${S()}.bill_master_bills WHERE id = $1`, [bill.id])).n), 1, "the bill dated in the year is still there");
    assert.equal((await run((r) => r.books.years())).length, 2);
    await owner.query(`DROP TRIGGER refuse_year_delete ON ${S()}.accounting_years`);
  });
});

after(async () => {
  await releaseTestLock?.();
});
