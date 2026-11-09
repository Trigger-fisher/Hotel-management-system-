// The Reports reads (repos/postgres/reports.ts) on the REAL PostgreSQL instance: every kind of day-sheet line, the pushed-down opening against the sum of
// the lines, the food plan's stay bills, the dashboard's movements and figures, and arrivalsToday.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { ReportsRepos } from "../../src/server/repos/reports";
import { createPgReportsUnit } from "../../src/server/repos/postgres/reports";
import type { Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<ReportsRepos>;
const run = <T>(work: (r: ReportsRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: newId() }, work);
const row = (table: string, over: Record<string, unknown> = {}) => insertRow(owner, hotel.schema, table, over);
const P = (n: number): bigint => BigInt(n);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Reports Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  unit = createPgReportsUnit(database.withHotel);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

describe("the day sheet", () => {
  test("every kind of line is built the way Pallav builds it, deleted rows are left out, and the pushed-down opening equals the sum of the lines", async () => {
    const company = await row("company_profiles", { name: "Acme Travels" });
    const advance = await row("bill_master_advances", {
      receipt_number: "2026 / 814", room_number: "12", guest_name: "Ann", payment_date: "2026-05-01", hotel_amount_paise: 200000, food_amount_paise: 50000, hotel_mode: "Cash", food_mode: "UPI",
      hotel_balance_paise: 0, food_balance_paise: 0, total_paise: 0, refund_payment_date: "2026-05-03", hotel_refund_amount_paise: 10000, food_refund_amount_paise: null, hotel_refund_mode: " cash ", refund_instruction: "Left early",
    });
    await row("bill_master_bills", {
      bill_number: "2026 / 1660", bill_date: "2026-05-02", room_number: "12", guest_name: "Ann", company_id: company.id, hotel_plan: "CP", total_hotel_amount_paise: 300000, total_food_amount_paise: 80000,
      advance_hotel_amount_paise: 150000, advance_food_amount_paise: 0, advance_receipt_number: "2026 / 814", hotel_mode_of_payment: "Cash", food_mode_of_payment: "Debit",
      debit_bill_date: "2026-05-10", debit_food_mode: "Cash", debit_food_amount_paise: 30000, debit_bill_date_2: "2026-05-12", debit_food_mode_2: "UPI", debit_food_amount_2_paise: 50000,
    });
    await row("bill_master_bills", { bill_number: "X / 1", bill_date: "2026-05-02", total_hotel_amount_paise: 99900, total_food_amount_paise: 0, advance_hotel_amount_paise: 0, advance_food_amount_paise: 0, guest_name: null, hotel_mode_of_payment: "Cash" });
    const gone = await row("bill_master_bills", { bill_number: "X / 2", bill_date: "2026-05-02", total_hotel_amount_paise: 77700 });
    await owner.query(`UPDATE "${hotel.schema}".bill_master_bills SET deleted_at = now(), version = version + 1 WHERE id = $1`, [gone.id]);
    const employee = await row("employees", { name: "Ravi" });
    await row("hotel_cash_deposits", { date: "2026-05-02", depositor: "Owner", amount_paise: 40000, reason: "Float", entry_no: 7 });
    await row("food_cash_withdrawals", { date: "2026-05-03", withdrawer: "Chef", amount_paise: 5000, instruction: "Vegetables", entry_no: 3 });
    await row("hotel_misc_expenses", { date: "2026-05-04", expense_name: "Bulbs", amount_paise: 2500, expense_head: "Repairs", entry_no: 9 });
    await row("staff_advances", { date: "2026-05-04", amount_paise: 100000, employee_id: employee.id, year_month: "2026-05", business: "food", entry_no: 2 });

    const lines = await run((r) => r.daySheet.lines({ from: null, to: "2026-05-31" }));
    const find = (kind: string, pred: (l: (typeof lines)[number]) => boolean = () => true) => lines.find((l) => l.kind === kind && pred(l));
    const billHotel = lines.find((l) => l.kind === "Bill" && l.ref === "1660" && l.unit === "hotel");
    assert.ok(billHotel);
    assert.deepEqual([billHotel.amountPaise, billHotel.fromAdvancePaise, billHotel.mode, billHotel.party, billHotel.room, billHotel.particulars, billHotel.note], [P(150000), P(150000), "Cash", "Acme Travels", "12", "Ann", "CP - 1,500.00 from advance 814"]);
    const billFood = lines.find((l) => l.kind === "Bill" && l.ref === "1660" && l.unit === "food");
    assert.deepEqual([billFood?.amountPaise, billFood?.mode, billFood?.note], [P(80000), "Debit", "Pallav Food"]);
    assert.equal(lines.find((l) => l.kind === "Bill" && l.ref === "1")?.particulars, "Walk-in guest");
    assert.equal(lines.some((l) => l.ref === "2"), false, "a deleted bill is never read");
    assert.deepEqual([find("Advance", (l) => l.unit === "hotel")?.note, find("Advance", (l) => l.unit === "food")?.note, find("Advance", (l) => l.unit === "food")?.mode], ["Advance received", "Advance received Pallav Food", "UPI"]);
    const refund = find("Refund");
    assert.deepEqual([refund?.direction, refund?.amountPaise, refund?.note, refund?.mode, refund?.date, refund?.ref], ["out", P(10000), "Advance refunded - Left early", " cash ", "2026-05-03", "814"]);
    assert.deepEqual(lines.filter((l) => l.kind === "Debit recovery").map((l) => [l.unit, l.amountPaise, l.mode, l.date, l.note, l.particulars, l.ref]).sort(), [
      ["food", P(30000), "Cash", "2026-05-10", "Against an earlier debit bill Pallav Food", "Acme Travels", "1660"],
      ["food", P(50000), "UPI", "2026-05-12", "Against an earlier debit bill Pallav Food", "Acme Travels", "1660"],
    ]);
    assert.deepEqual([find("Collection")?.ref, find("Collection")?.particulars, find("Collection")?.note, find("Collection")?.mode, find("Collection")?.direction], ["#7", "Owner", "Float", "Cash", "in"]);
    assert.deepEqual([find("Withdrawal")?.unit, find("Withdrawal")?.note, find("Withdrawal")?.direction], ["food", "Vegetables", "out"]);
    assert.deepEqual([find("Expense")?.note, find("Expense")?.particulars], ["Repairs", "Bulbs"]);
    assert.deepEqual([find("Staff advance")?.particulars, find("Staff advance")?.note, find("Staff advance")?.unit, find("Staff advance")?.ref], ["Ravi", "Salary advance for 2026-05", "food", "#2"]);
    void advance;

    const window = await run((r) => r.daySheet.lines({ from: "2026-05-03", to: "2026-05-03" }));
    assert.ok(window.every((l) => l.date === "2026-05-03") && window.length >= 2);

    for (const day of ["2026-05-02", "2026-05-04", "2026-06-01"]) {
      const before = await run((r) => r.daySheet.lines({ from: null, to: new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) }));
      const sum = before.filter((l) => (l.mode ?? "").trim().toLowerCase() === "cash").reduce((n, l) => n + (l.direction === "in" ? l.amountPaise : -l.amountPaise), BigInt(0));
      assert.equal(await run((r) => r.daySheet.cashNetBefore(day)), sum, `opening before ${day}`);
    }
  });
});

describe("the food plan, the dashboard and arrivals", () => {
  test("stay bills in the window with their parts or dates; movements, recent, handover and payroll figures; arrivals today counts confirmed arrivals only", async () => {
    await row("bill_master_bills", {
      bill_number: "S / 1", bill_date: "2026-07-01", room_number: "5", guest_name: "Stay", persons: 2, hotel_plan: "MAP", arrival_at: "2026-06-29T08:00:00Z", departure_at: "2026-07-01T05:00:00Z",
      stay_segments: JSON.stringify([{ from: "2026-06-29", to: "2026-07-01", plan: "MAP", persons: 2, nights: 2 }]),
    });
    await row("bill_master_bills", { bill_number: "S / 2", bill_date: "2026-07-02", stay_segments: null, arrival_at: null, departure_at: null });
    const stays = await run((r) => r.foodPlan.stayBills({ billDateFrom: "2026-06-01", billDateTo: "2026-08-31" }));
    assert.equal(stays.length, 1);
    assert.deepEqual([stays[0].billNumber, stays[0].arrivalDate, stays[0].departureDate, stays[0].persons, stays[0].stay], ["S / 1", "2026-06-29", "2026-07-01", 2, [{ from: "2026-06-29", to: "2026-07-01", plan: "MAP", persons: 2 }]]);
    assert.equal((await run((r) => r.foodPlan.stayBills({ billDateFrom: "2027-01-01", billDateTo: "2027-02-01" }))).length, 0);

    // mealPlans: a bill with no stay parts is left out when its own plan is not a priced one; a bill with stay parts always comes back
    await row("bill_master_bills", { bill_number: "S / 3", bill_date: "2026-07-03", persons: 1, hotel_plan: "CP", arrival_at: "2026-07-01T08:00:00Z", departure_at: "2026-07-03T05:00:00Z", stay_segments: null });
    await row("bill_master_bills", { bill_number: "S / 4", bill_date: "2026-07-03", persons: 1, hotel_plan: "EP", arrival_at: "2026-07-01T08:00:00Z", departure_at: "2026-07-03T05:00:00Z", stay_segments: null });
    const win = { billDateFrom: "2026-06-01", billDateTo: "2026-08-31" };
    assert.deepEqual((await run((r) => r.foodPlan.stayBills(win))).map((b) => b.billNumber), ["S / 1", "S / 3", "S / 4"]);
    assert.deepEqual((await run((r) => r.foodPlan.stayBills({ ...win, mealPlans: ["cp", "map"] }))).map((b) => b.billNumber), ["S / 1", "S / 3"]);
    assert.deepEqual((await run((r) => r.foodPlan.stayBills({ ...win, mealPlans: [] }))).map((b) => b.billNumber), ["S / 1"]);

    await row("hotel_cash_deposits", { date: "2026-08-02", time: "09:15:00", depositor: "Dep", amount_paise: 1000, entry_no: 21, full_name: "Asha" });
    await row("food_misc_expenses", { date: "2026-08-02", time: "18:40:00", expense_name: "Gas", amount_paise: 3000, expense_head: null, entry_no: 22, full_name: "Asha" });
    const moves = await run((r) => r.overview.movements({ from: "2026-08-01", to: "2026-08-31" }));
    assert.deepEqual(moves.map((m) => [m.kind, m.unit, m.direction, m.head, m.who, m.entryNo, m.byName, m.date, m.time]), [
      ["Deposit", "hotel", "in", null, "Dep", "21", "Asha", "2026-08-02", "09:15"],
      ["Expense", "food", "out", "Unsorted", "Gas", "22", "Asha", "2026-08-02", "18:40"],
    ]);
    assert.equal((await run((r) => r.overview.recent(1)))[0].who, "Gas", "newest by date, time, id");
    assert.ok(moves.every((m) => typeof m.userId === "string" && m.userId.length > 0), "every movement carries the recording user's id");

    await row("shift_handovers", { date: "2026-08-02", time: "20:00:00", shift: "Night", total_paise: 450000, full_name: "Asha" });
    await row("shift_handovers", { date: "2026-07-15", time: "08:00:00", shift: "Morning", total_paise: 1000 });
    const handovers = await run((r) => r.overview.handovers("2026-08-02", "2026-08-01"));
    assert.deepEqual([handovers.todayCount, handovers.todayCashPaise, handovers.monthCount, handovers.latest?.shift, handovers.latest?.time, handovers.latest?.byName], [1, P(450000), 1, "Night", "20:00", "Asha"]);
    assert.equal(typeof handovers.latest?.userId, "string");

    const employee = await row("employees", { joining_date: "2026-08-01", is_active: true });
    await row("employees", { joining_date: "2024-01-01", is_active: false });
    await row("salary_processings", { employee_id: employee.id, year: 2026, month: 6, net_salary_paise: 50000, paid_amount_paise: 20000, payment_status: "Partially Paid" });
    await row("salary_processings", { year: 2026, month: 7, net_salary_paise: 40000, paid_amount_paise: 40000, payment_status: "Paid", paid_at: "2026-08-02" });
    await row("staff_advances", { date: "2026-08-02", amount_paise: 7000, entry_no: 31 });
    const pay = await run((r) => r.overview.payroll("2026-08-01", "2026-08-02"));
    assert.deepEqual([pay.activeStaff >= 1, pay.joinedThisMonth, pay.openCount, pay.openAmountPaise, pay.openSince, pay.advancesPaise, pay.advanceCount, pay.paidPaise, pay.paidCount], [true, 1, 1, P(30000), "2026-06", P(7000), 1, P(40000), 1]);

    await row("pms_reservations", { check_in: "2026-08-02", check_out: "2026-08-04", status: "confirmed" });
    await row("pms_reservations", { check_in: "2026-08-02", check_out: "2026-08-04", status: "checked_in" });
    await row("pms_reservations", { check_in: "2026-08-03", check_out: "2026-08-04", status: "confirmed" });
    assert.equal(await run((r) => r.reservations.arrivalsToday("2026-08-02")), 1);
  });
});
