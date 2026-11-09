// The Payroll pay repositories on the REAL PostgreSQL instance (repos/postgres/payrollPay.ts): the salary run's rows and payments with their
// version rules, revisions, staff advances and bonuses, the run's reads, staff meals, letters and separations. Every rule of the in-memory double
// is proven here against the database, including the company scoping.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { PayrollPayRepos, SalaryProcessingFields } from "../../src/server/repos/payrollPay";
import { createPgPayrollPayUnit } from "../../src/server/repos/postgres/payrollPay";
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
let unit: Unit<PayrollPayRepos>;
let HP: string;
let PF: string;
let asha: string;
let bina: string;
const ACTOR = newId();
const USER = newId();
const Z = BigInt(0);
const run = <T>(work: (r: PayrollPayRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: USER }, work);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Pay Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 8 });
  unit = createPgPayrollPayUnit(database.withHotel);
  const ids = await owner.query(`SELECT id, code FROM "${hotel.schema}".payroll_companies`);
  HP = String(ids.rows.find((r) => r.code === "HP01")?.id);
  PF = String(ids.rows.find((r) => r.code === "PF01")?.id);
  asha = String((await insertRow(owner, hotel.schema, "employees", { payroll_company_id: HP, name: "Asha Rao", employee_code: "E1", email: "asha@x.test" })).id);
  bina = String((await insertRow(owner, hotel.schema, "employees", { payroll_company_id: HP, name: "bina Shah", employee_code: "E2", email: "bina@x.test" })).id);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

const salary = (employeeId: string, over: Partial<SalaryProcessingFields> = {}): SalaryProcessingFields => ({
  payrollCompanyId: HP, employeeId, year: 2026, month: 3, companyName: "Pay Hotel", employeeCode: "E1", employeeName: "Asha Rao", designation: "Cook", department: "Kitchen", paymentMode: "Cash",
  monthlySalaryPaise: BigInt(1_800_000), dailyWorkingHours: "8.00", totalDaysInMonth: 31, dailySalaryPaise: BigInt(58_064), days0: "1.00", days25: "0.00", days50: "0.00", days75: "0.00", days100: "30.00",
  totalPayableDays: "30.00", attendanceSalaryPaise: BigInt(1_741_935), overtimeHours: "2.50", hourlyRatePaise: BigInt(7_258), overtimeAmountPaise: BigInt(18_145), bonusAmountPaise: BigInt(50_000),
  incentiveAmountPaise: Z, deductionAmountPaise: BigInt(10_000), advanceDeductionPaise: BigInt(20_000), pendingAdvanceAmountPaise: BigInt(5_000), netSalaryPaise: BigInt(1_780_080), paymentStatus: "Pending",
  generationCount: 1, processedBy: ACTOR, processedAt: new Date("2026-04-01T05:00:00Z"), paidAmountPaise: Z, paidAt: null, paymentReference: null, paymentRemarks: null, paymentUpdatedBy: null,
  paymentUpdatedAt: null, bankName: "SBI", accountHolderName: "Asha Rao", accountNumber: "1234567890", ifscCode: "SBIN0000001", branchName: "Surat", ...over,
});
const line = (over: Record<string, unknown> = {}) => ({ category: "Deduction" as const, label: "Room rent", deductionType: "Monthly", amountPaise: BigInt(10_000), pendingAmountPaise: Z, sourceType: "employee_deduction" as const, sourceId: newId(), ...over });

describe("salary processings", () => {
  test("createMany writes a month in one call (rows and lines), every field reads back exactly, the account details in plain text", async () => {
    const made = await run((r) => r.salaryProcessings.createMany([
      { fields: salary(asha), lines: [line(), line({ category: "Bonus", label: "Festival", deductionType: null, amountPaise: BigInt(50_000), sourceType: "bonus_incentive" })] },
      { fields: salary(bina, { employeeName: "bina Shah", employeeCode: "E2", netSalaryPaise: BigInt(1_000_000), monthlySalaryPaise: BigInt(1_000_000) }), lines: [] },
    ]));
    assert.equal(made.length, 2);
    const a = made[0];
    assert.deepEqual([a.version, a.employeeId, a.days100, a.days0, a.overtimeHours, a.totalPayableDays, a.netSalaryPaise, a.accountNumber, a.ifscCode, a.paidAt, a.processedAt.toISOString(), a.generationCount], [1, asha, "30.00", "1.00", "2.50", "30.00", BigInt(1_780_080), "1234567890", "SBIN0000001", null, "2026-04-01T05:00:00.000Z", 1]);
    assert.deepEqual(await run((r) => r.salaryProcessings.get(HP, a.id)), a);
    assert.equal(await run((r) => r.salaryProcessings.get(PF, a.id)), null, "another company reads as absent");
    const lines = await run((r) => r.salaryProcessings.lines([a.id, made[1].id, newId()]));
    assert.deepEqual(lines.map((l) => [l.category, l.label, l.deductionType, l.amountPaise, l.sourceType]), [["Deduction", "Room rent", "Monthly", BigInt(10_000), "employee_deduction"], ["Bonus", "Festival", null, BigInt(50_000), "bonus_incentive"]]);
    assert.deepEqual(await run((r) => r.salaryProcessings.lines([])), []);
    await assert.rejects(() => run((r) => r.salaryProcessings.createMany([{ fields: salary(asha, { daysInvalid: 1 } as never, ), lines: [line({ amountPaise: BigInt(-1) })] }])), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal((await run((r) => r.salaryProcessings.month(HP, 2026, 3, "name"))).length, 2, "a refused batch leaves nothing behind");
  });

  test("a month's rows: by name, or payments order (unpaid first, then paid latest first, then name); one person; getMany; locking", async () => {
    const ids = (await run((r) => r.salaryProcessings.month(HP, 2026, 3, "name"))).map((p) => p.id);
    assert.deepEqual((await run((r) => r.salaryProcessings.month(HP, 2026, 3, "name"))).map((p) => p.employeeName), ["Asha Rao", "bina Shah"]);
    await run((r) => r.salaryProcessings.updatePayment(ids[0], { paymentStatus: "Paid", paidAmountPaise: BigInt(1_780_080), paidAt: "2026-04-05", paymentReference: "UTR1", paymentRemarks: null, paymentUpdatedBy: ACTOR, paymentUpdatedAt: new Date("2026-04-05T06:00:00Z") }));
    assert.deepEqual((await run((r) => r.salaryProcessings.month(HP, 2026, 3, "payments"))).map((p) => p.employeeName), ["bina Shah", "Asha Rao"], "unpaid first");
    assert.deepEqual((await run((r) => r.salaryProcessings.month(HP, 2026, 3, "name", { employeeId: bina }))).map((p) => p.employeeName), ["bina Shah"]);
    assert.equal((await run((r) => r.salaryProcessings.month(PF, 2026, 3, "name"))).length, 0);
    assert.equal((await run((r) => r.salaryProcessings.getMany(HP, [...ids, newId()], { forUpdate: true }))).length, 2);
    assert.equal((await run((r) => r.salaryProcessings.getMany(PF, ids))).length, 0);
    assert.deepEqual(await run((r) => r.salaryProcessings.getMany(HP, [])), []);
  });

  test("a payment change raises the version; an expected version that is stale is a conflict; a re-generate carries the number on, higher; it never goes back", async () => {
    const [p] = await run((r) => r.salaryProcessings.month(HP, 2026, 3, "name", { employeeId: bina }));
    assert.equal(p.version, 1);
    const patch = { paymentStatus: "Partially Paid" as const, paidAmountPaise: BigInt(400_000), paidAt: "2026-04-06", paymentReference: "UTR2", paymentRemarks: "Half", paymentUpdatedBy: ACTOR, paymentUpdatedAt: new Date("2026-04-06T06:00:00Z") };
    const ok = await run((r) => r.salaryProcessings.updatePayment(p.id, patch, { expectedVersion: 1 }));
    assert.ok(ok.ok && ok.record.version === 2 && ok.record.paymentStatus === "Partially Paid" && ok.record.paidAt === "2026-04-06" && ok.record.paymentRemarks === "Half");
    assert.deepEqual(await run((r) => r.salaryProcessings.updatePayment(p.id, patch, { expectedVersion: 1 })), { ok: false, reason: "conflict", currentVersion: 2 });
    assert.deepEqual(await run((r) => r.salaryProcessings.updatePayment(newId(), patch)), { ok: false, reason: "not_found" });
    const jump = await run((r) => r.salaryProcessings.updatePayment(p.id, patch, { version: 7 }));
    assert.ok(jump.ok && jump.record.version === 7, "a re-generate's new row carries the old number on, one higher");
    await assert.rejects(() => run((r) => r.salaryProcessings.updatePayment(p.id, patch, { version: 7 })), (e) => e instanceof RepoError && e.kind === "check", "the version may never stay or fall");
    await run((r) => r.salaryProcessings.setTotals(p.id, { deductionAmountPaise: BigInt(1), advanceDeductionPaise: BigInt(2), pendingAdvanceAmountPaise: BigInt(3), netSalaryPaise: BigInt(-4) }));
    const after = await run((r) => r.salaryProcessings.get(HP, p.id));
    assert.deepEqual([after?.deductionAmountPaise, after?.advanceDeductionPaise, after?.pendingAdvanceAmountPaise, after?.netSalaryPaise, after?.version], [BigInt(1), BigInt(2), BigInt(3), BigInt(-4), 8], "a net below zero is allowed by the column");
  });

  test("two clerks changing the same payment at once: exactly one wins on the expected version", async () => {
    const [p] = await run((r) => r.salaryProcessings.month(HP, 2026, 3, "name", { employeeId: asha }));
    const base = (p as { version: number }).version;
    const results = await Promise.all([1, 2, 3, 4].map((i) => run((r) => r.salaryProcessings.updatePayment(p.id, { paymentStatus: "Processing", paidAmountPaise: BigInt(i), paidAt: null, paymentReference: `R${i}`, paymentRemarks: null, paymentUpdatedBy: ACTOR, paymentUpdatedAt: new Date() }, { expectedVersion: base }))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.reason === "conflict").length, 3);
  });

  test("list, periods, latest, processed locks, figures, and a re-generate's removal of the month with its lines", async () => {
    await run((r) => r.salaryProcessings.createMany([{ fields: salary(asha, { year: 2026, month: 2, processedAt: new Date("2026-03-01T05:00:00Z") }), lines: [line()] }, { fields: salary(asha, { year: 2025, month: 12 }), lines: [] }]));
    const list = await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10 }));
    assert.deepEqual(list.rows.map((x) => [x.year, x.month]), [[2026, 3], [2026, 3], [2026, 2], [2025, 12]], "newest period first");
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10, from: { year: 2026, month: 2 } }))).total, 3);
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10, period: { year: 2026, month: 2 } }))).total, 1);
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10, words: ["bina"] }))).total, 1);
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 2, pageSize: 3 }))).rows.length, 1);
    // the Salary Slips paging contract: a status narrows (and `total` follows), a sort goes first with the newest-first order breaking ties
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10, status: "Processing" }))).total, 1);
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10, status: "Failed" }))).total, 0);
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10, sort: { key: "period", dir: "asc" } }))).rows.map((x) => [x.year, x.month]), [[2025, 12], [2026, 2], [2026, 3], [2026, 3]]);
    assert.deepEqual((await run((r) => r.salaryProcessings.list(HP, { page: 1, pageSize: 10, sort: { key: "status", dir: "desc" } }))).rows.map((x) => x.paymentStatus), ["Partially Paid", "Processing", "Pending", "Pending"], "the natural order of a payment (Pending first, Failed last), reversed");
    const march = await run((r) => r.salaryProcessings.slipSummary(HP, { year: 2026, month: 3 }));
    assert.deepEqual([march.slips, march.people, march.byStatus.Processing, march.byStatus["Partially Paid"], march.byStatus.Pending, march.latest], [2, 2, 1, 1, 0, { year: 2026, month: 3 }]);
    const every = await run((r) => r.salaryProcessings.slipSummary(HP));
    assert.deepEqual([every.periods, every.latestNetPaise], [3, march.netPaise], "three months have slips; the latest net is March's");
    assert.deepEqual([every.slips, every.people, every.byStatus.Pending, every.latest], [4, 2, 2, { year: 2026, month: 3 }]);
    assert.deepEqual(await run((r) => r.salaryProcessings.slipSummary(PF)), { slips: 0, people: 0, netPaise: Z, paidPaise: Z, outstandingPaise: Z, byStatus: { Pending: 0, Processing: 0, "On Hold": 0, "Partially Paid": 0, Paid: 0, Failed: 0 }, latest: null, latestNetPaise: Z, periods: 0 });
    assert.deepEqual(await run((r) => r.salaryProcessings.periods(HP)), [{ year: 2026, month: 3, people: 2 }, { year: 2026, month: 2, people: 1 }, { year: 2025, month: 12, people: 1 }]);
    assert.deepEqual(await run((r) => r.salaryProcessings.latestPeriod(HP)), { year: 2026, month: 3 });
    assert.equal(await run((r) => r.salaryProcessings.latestPeriod(PF)), null);
    assert.equal(await run((r) => r.salaryProcessings.processedFor(HP, asha, 2026, 2)), true);
    assert.equal(await run((r) => r.salaryProcessings.processedFor(HP, bina, 2026, 2)), false);
    const keys = await run((r) => r.salaryProcessings.processedKeys(HP, [{ employeeId: asha, year: 2026, month: 2 }, { employeeId: bina, year: 2026, month: 2 }, { employeeId: bina, year: 2026, month: 3 }]));
    assert.deepEqual([...keys].sort(), [`${asha}|2026|2`, `${bina}|2026|3`].sort());
    assert.deepEqual((await run((r) => r.salaryProcessings.processedKeys(HP, []))).size, 0);
    const figures = await run((r) => r.salaryProcessings.figures(HP));
    assert.deepEqual([figures.latest, figures.count, figures.unpaid, figures.open, figures.failed], [{ year: 2026, month: 3 }, 2, 2, 4, 0]);
    assert.ok(figures.paidPaise >= BigInt(400_000) && figures.paidPaise < BigInt(400_005), "bina paid 400 000 and the race winner paid a few paise");
    assert.equal(figures.netPaise, BigInt(-4) + BigInt(1_780_080), "the latest month's net: the totals set earlier plus the other person's");
    const gone = await run((r) => r.salaryProcessings.removeMonth(HP, 2026, 2));
    assert.equal(gone, 1);
    assert.equal(await run((r) => r.salaryProcessings.processedFor(HP, asha, 2026, 2)), false);
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".salary_processing_lines WHERE category = 'Deduction'`)).rows[0].n), 1, "the removed month's lines went with it (the other month's line is still there)");
    assert.equal(await run((r) => r.salaryProcessings.removeMonth(PF, 2026, 3)), 0, "never another company's month");
  });
});

describe("salary revisions", () => {
  test("a batch of changes, newest effective date first, the salary changes of a month, count and latest per person", async () => {
    const batch = newId();
    await run((r) => r.revisions.createBatch([
      { employeeId: asha, batchId: batch, effectiveDate: "2026-03-10", fieldName: "Salary", previousValue: "18000", newValue: "20000", changedBy: ACTOR },
      { employeeId: asha, batchId: batch, effectiveDate: "2026-03-10", fieldName: "Account Number", previousValue: "1234567890", newValue: "9876543210", changedBy: ACTOR },
      { employeeId: asha, batchId: newId(), effectiveDate: "2026-01-01", fieldName: "Salary", previousValue: "15000", newValue: "18000", changedBy: null },
      { employeeId: bina, batchId: newId(), effectiveDate: "2026-03-20", fieldName: "Salary", previousValue: "10000", newValue: "12000", changedBy: ACTOR },
    ]));
    await run((r) => r.revisions.createBatch([]));
    const mine = await run((r) => r.revisions.forEmployee(asha));
    assert.deepEqual(mine.map((x) => x.effectiveDate), ["2026-03-10", "2026-03-10", "2026-01-01"], "newest effective date first");
    assert.equal(mine[0].effectiveDate, "2026-03-10");
    assert.deepEqual([mine.find((x) => x.fieldName === "Account Number")?.previousValue, mine.find((x) => x.fieldName === "Account Number")?.newValue], ["1234567890", "9876543210"], "plain text in the history too");
    assert.equal(mine[2].changedBy, null);
    const inMonth = await run((r) => r.revisions.salaryInMonth([asha, bina], "2026-03-01", "2026-03-31"));
    assert.deepEqual(inMonth.map((x) => [x.employeeId, x.effectiveDate]), [[asha, "2026-03-10"], [bina, "2026-03-20"]], "only Salary rows, by effective date");
    assert.deepEqual(await run((r) => r.revisions.salaryInMonth([], "2026-03-01", "2026-03-31")), []);
    const summary = await run((r) => r.revisions.summary([asha, bina, newId()]));
    assert.deepEqual([...summary.entries()].sort(), [[asha, { count: 3, latest: "2026-03-10" }], [bina, { count: 1, latest: "2026-03-20" }]].sort());
  });
});

describe("staff advances", () => {
  const advance = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, advanceDate: new Date("2026-03-10T05:30:15.123Z"), amountPaise: BigInt(100_000), deductionType: "Monthly" as const, deductionAmountPaise: BigInt(20_000), remarks: null, ...over });

  test("create numbers them (soft-deleted rows included), keeps the moment to the millisecond, refuses a zero amount; scoped get; update; recovery in a batch", async () => {
    const a = await run((r) => r.payrollAdvances.create(HP, advance(asha), ACTOR));
    const b = await run((r) => r.payrollAdvances.create(HP, advance(bina, { amountPaise: BigInt(50_000), remarks: "Festival" }), ACTOR));
    assert.deepEqual([a.entryNo, b.entryNo, a.advanceDate.toISOString(), a.recoveredAmountPaise, a.isSettled, a.isCarryForward, a.createdBy, a.updatedBy], [1, 2, "2026-03-10T05:30:15.123Z", Z, false, false, ACTOR, ACTOR]);
    await assert.rejects(() => run((r) => r.payrollAdvances.create(HP, advance(asha, { amountPaise: Z }), ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal(await run((r) => r.payrollAdvances.get(PF, a.id)), null);
    const upd = await run((r) => r.payrollAdvances.update(HP, a.id, { remarks: "Corrected", deductionAmountPaise: BigInt(25_000) }, ACTOR));
    assert.deepEqual([upd.remarks, upd.deductionAmountPaise], ["Corrected", BigInt(25_000)]);
    await assert.rejects(() => run((r) => r.payrollAdvances.update(PF, a.id, { remarks: "x" }, ACTOR)), (e) => e instanceof RepoError);
    await run((r) => r.payrollAdvances.setRecovery([{ id: a.id, recoveredAmountPaise: BigInt(40_000), isSettled: false }, { id: b.id, recoveredAmountPaise: BigInt(50_000), isSettled: true }]));
    await run((r) => r.payrollAdvances.setRecovery([]));
    assert.deepEqual((await run((r) => r.payrollAdvances.getMany([a.id, b.id, newId()]))).map((x) => [x.recoveredAmountPaise, x.isSettled]).sort(), [[BigInt(40_000), false], [BigInt(50_000), true]].sort());
    assert.deepEqual((await run((r) => r.payrollAdvances.openFor([asha, bina]))).map((x) => x.id), [a.id], "only the unsettled one");
    assert.equal((await run((r) => r.payrollAdvances.openFor([asha], { forUpdate: true }))).length, 1);
    assert.deepEqual(await run((r) => r.payrollAdvances.openFor([])), []);
  });

  test("soft delete keeps the number and hides; restore and purge are scoped; a person with advances cannot be deleted", async () => {
    const c = await run((r) => r.payrollAdvances.create(HP, advance(asha, { remarks: "Bin me" }), ACTOR));
    assert.equal(c.entryNo, 3);
    assert.equal(await run((r) => r.payrollAdvances.softDelete(HP, c.id, ACTOR)), true);
    assert.equal(await run((r) => r.payrollAdvances.softDelete(HP, c.id, ACTOR)), false);
    assert.equal(await run((r) => r.payrollAdvances.get(HP, c.id)), null);
    assert.equal((await run((r) => r.payrollAdvances.get(HP, c.id, { deleted: true })))?.deletedBy, ACTOR);
    const d = await run((r) => r.payrollAdvances.create(HP, advance(asha), ACTOR));
    assert.equal(d.entryNo, 4, "a binned entry keeps its number");
    assert.equal(await run((r) => r.payrollAdvances.purge(PF, c.id)), false);
    assert.equal(await run((r) => r.payrollAdvances.restore(HP, c.id)), true);
    assert.equal(await run((r) => r.payrollAdvances.restore(HP, c.id)), false);
    await run((r) => r.payrollAdvances.softDelete(HP, c.id, ACTOR));
    assert.equal(await run((r) => r.payrollAdvances.purge(HP, c.id)), true);
    await assert.rejects(() => run((r) => r.payrollAdvances.create(HP, advance(newId()), ACTOR)), (e) => e instanceof RepoError && e.kind === "check", "an unknown person is refused by the foreign key");
  });

  test("the screen: latest first within the window plus older ones still open, words over the person and the remarks and the number; the four figures with carry-forwards", async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".payroll_advances`);
    const old = await run((r) => r.payrollAdvances.create(HP, advance(asha, { advanceDate: new Date("2025-06-01T00:00:00Z"), amountPaise: BigInt(80_000), remarks: "Old open" }), ACTOR));
    const oldDone = await run((r) => r.payrollAdvances.create(HP, advance(asha, { advanceDate: new Date("2025-07-01T00:00:00Z"), amountPaise: BigInt(30_000), remarks: "Old done" }), ACTOR));
    await run((r) => r.payrollAdvances.setRecovery([{ id: oldDone.id, recoveredAmountPaise: BigInt(30_000), isSettled: true }, { id: old.id, recoveredAmountPaise: BigInt(30_000), isSettled: false }]));
    const recent = await run((r) => r.payrollAdvances.create(HP, advance(bina, { advanceDate: new Date("2026-03-15T00:00:00Z"), amountPaise: BigInt(60_000), remarks: "Recent" }), ACTOR));
    const child = await run((r) => r.payrollAdvances.create(HP, { ...advance(asha, { advanceDate: new Date("2026-04-01T00:00:00Z"), amountPaise: BigInt(50_000), remarks: "Carried" }), isCarryForward: true, parentAdvanceId: old.id }, null));
    const query = (over: Record<string, unknown> = {}) => run((r) => r.payrollAdvances.list(HP, { viewFrom: new Date("2026-01-01T00:00:00Z"), page: 1, pageSize: 10, ...over }));
    assert.deepEqual((await query()).rows.map((x) => x.remarks), ["Carried", "Recent", "Old open"], "latest first; the old settled one is outside the window");
    assert.deepEqual((await query({ viewFrom: null })).total, 4);
    assert.deepEqual((await query({ viewFrom: null, countTotal: false })).total, -1, "the recycle bin's read skips the COUNT");
    assert.deepEqual((await query({ words: ["bina"] })).rows.map((x) => x.remarks), ["Recent"]);
    assert.deepEqual((await query({ words: ["old", "open"] })).rows.map((x) => x.remarks), ["Old open"]);
    assert.deepEqual((await query({ words: [String(recent.entryNo)] })).rows.map((x) => x.remarks), ["Recent"], "by number");
    assert.deepEqual((await query({ employeeId: bina })).rows.map((x) => [x.employeeName, x.employeeCode]), [["bina Shah", "E2"]]);
    assert.deepEqual((await query({ deleted: "only" })).rows, []);
    const s = await run((r) => r.payrollAdvances.summary(HP, { viewFrom: new Date("2026-01-01T00:00:00Z") }));
    assert.deepEqual(s, { issuedPaise: BigInt(80_000 + 60_000), recoveredPaise: BigInt(30_000 - 50_000), outstandingPaise: BigInt(50_000 + 60_000 + 50_000), open: 3 }, "issued leaves out carry-forwards; recovered less what moved on");
    assert.deepEqual(await run((r) => r.payrollAdvances.figures(HP)), { outstandingPaise: BigInt(50_000 + 60_000 + 50_000), open: 3 });
    // one month (the pay lists' `period`): [from, to)
    const april = { from: new Date("2026-03-31T18:30:00Z"), to: new Date("2026-04-30T18:30:00Z") };
    assert.deepEqual((await query({ viewFrom: null, range: { from: new Date("2026-02-28T18:30:00Z"), to: april.from } })).rows.map((x) => x.remarks), ["Recent"]);
    assert.deepEqual(await run((r) => r.payrollAdvances.summary(HP, { viewFrom: null, range: april })), { issuedPaise: Z, recoveredPaise: Z, outstandingPaise: BigInt(50_000), open: 1 });
    assert.deepEqual(await run((r) => r.payrollAdvances.figures(PF)), { outstandingPaise: Z, open: 0 });
    const proc = (await run((r) => r.salaryProcessings.month(HP, 2026, 3, "name", { employeeId: asha })))[0];
    await owner.query(`UPDATE "${hotel.schema}".payroll_advances SET source_salary_processing_id = $1 WHERE id = $2`, [proc.id, child.id]);
    assert.deepEqual((await run((r) => r.payrollAdvances.carriedBy([proc.id, newId()]))).map((x) => x.id), [child.id]);
    await run((r) => r.payrollAdvances.removeCarried([child.id]));
    assert.equal(await run((r) => r.payrollAdvances.get(HP, child.id)), null);
    await run((r) => r.payrollAdvances.removeCarried([]));
  });
});

describe("bonuses and incentives", () => {
  const bonus = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, entryDate: new Date("2026-03-12T04:00:00Z"), type: "Bonus" as const, amountPaise: BigInt(50_000), remarks: null, ...over });

  test("create numbers them, list and summary over the same filter, in-month reads for the run, update, soft delete, restore, purge", async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".bonus_incentives`);
    const a = await run((r) => r.bonuses.create(HP, bonus(asha, { remarks: "Diwali" }), ACTOR));
    const b = await run((r) => r.bonuses.create(HP, bonus(bina, { type: "Incentive", amountPaise: BigInt(20_000), entryDate: new Date("2026-04-02T04:00:00Z") }), ACTOR));
    const c = await run((r) => r.bonuses.create(HP, bonus(asha, { entryDate: new Date("2025-01-01T00:00:00Z"), amountPaise: BigInt(1_000) }), ACTOR));
    assert.deepEqual([a.entryNo, b.entryNo, c.entryNo, a.type, a.createdBy], [1, 2, 3, "Bonus", ACTOR]);
    await assert.rejects(() => run((r) => r.bonuses.create(HP, bonus(asha, { amountPaise: Z }), ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    const list = (over: Record<string, unknown> = {}) => run((r) => r.bonuses.list(HP, { viewFrom: null, page: 1, pageSize: 10, ...over }));
    assert.deepEqual((await list()).rows.map((x) => x.entryNo), [2, 1, 3], "latest date first");
    assert.deepEqual((await list({ viewFrom: new Date("2026-01-01T00:00:00Z") })).rows.map((x) => x.entryNo), [2, 1]);
    assert.deepEqual((await list({ words: ["incentive"] })).rows.map((x) => x.entryNo), [2], "the type is searched");
    assert.deepEqual((await list({ words: ["diwali"] })).rows.map((x) => [x.employeeName, x.employeeCode]), [["Asha Rao", "E1"]]);
    assert.deepEqual((await list({ employeeId: bina })).total, 1);
    assert.deepEqual(await run((r) => r.bonuses.summary(HP, { viewFrom: new Date("2026-01-01T00:00:00Z") })), { bonusPaise: BigInt(50_000), incentivePaise: BigInt(20_000), people: 2 });
    assert.deepEqual(await run((r) => r.bonuses.summary(HP, { viewFrom: null, employeeId: asha })), { bonusPaise: BigInt(51_000), incentivePaise: Z, people: 1 });
    const april = { from: new Date("2026-03-31T18:30:00Z"), to: new Date("2026-04-30T18:30:00Z") };
    assert.deepEqual((await list({ range: { from: new Date("2026-02-28T18:30:00Z"), to: april.from } })).rows.map((x) => x.entryNo), [1]);
    assert.deepEqual(await run((r) => r.bonuses.summary(HP, { viewFrom: null, range: april })), { bonusPaise: Z, incentivePaise: BigInt(20_000), people: 1 });
    assert.deepEqual((await run((r) => r.bonuses.inMonth([asha, bina], new Date("2026-03-01T00:00:00Z"), new Date("2026-03-31T23:59:59Z")))).map((x) => x.entryNo), [1]);
    assert.deepEqual(await run((r) => r.bonuses.inMonth([], new Date(), new Date())), []);
    const upd = await run((r) => r.bonuses.update(HP, a.id, { amountPaise: BigInt(60_000), remarks: "Changed" }, ACTOR));
    assert.deepEqual([upd.amountPaise, upd.remarks, upd.updatedBy], [BigInt(60_000), "Changed", ACTOR]);
    await assert.rejects(() => run((r) => r.bonuses.update(PF, a.id, { remarks: "x" }, ACTOR)), (e) => e instanceof RepoError);
    assert.equal(await run((r) => r.bonuses.softDelete(HP, a.id, ACTOR)), true);
    assert.equal(await run((r) => r.bonuses.get(HP, a.id)), null);
    assert.deepEqual((await list({ deleted: "only" })).rows.map((x) => x.entryNo), [1]);
    assert.equal((await run((r) => r.bonuses.create(HP, bonus(bina), ACTOR))).entryNo, 4, "a binned bonus keeps its number");
    assert.equal(await run((r) => r.bonuses.purge(HP, a.id)), true);
    assert.equal(await run((r) => r.bonuses.restore(HP, a.id)), false);
  });
});

describe("the run's reads of payroll core", () => {
  test("assignments with their deduction names, in one query, and the One Time ones settled in a batch", async () => {
    const d = String((await insertRow(owner, hotel.schema, "deductions", { payroll_company_id: HP, name: "Run rent" })).id);
    const x = String((await insertRow(owner, hotel.schema, "employee_deductions", { employee_id: asha, deduction_id: d, deduction_type: "One Time", amount_paise: 7000 })).id);
    const y = String((await insertRow(owner, hotel.schema, "employee_deductions", { employee_id: bina, deduction_id: d, deduction_type: "Monthly", amount_paise: 3000 })).id);
    const list = await run((r) => r.payrollRun.assignments([asha, bina]));
    assert.deepEqual(list.map((a) => [a.employeeId, a.deductionName, a.deductionType, a.amountPaise, a.isSettled]).sort(), [[asha, "Run rent", "One Time", BigInt(7000), false], [bina, "Run rent", "Monthly", BigInt(3000), false]].sort());
    assert.deepEqual(await run((r) => r.payrollRun.assignments([])), []);
    await run((r) => r.payrollRun.setSettled([x], true));
    await run((r) => r.payrollRun.setSettled([], true));
    assert.deepEqual((await run((r) => r.payrollRun.assignments([asha, bina]))).map((a) => [a.id, a.isSettled]).sort(), [[x, true], [y, false]].sort());
    await run((r) => r.payrollRun.setSettled([x], false));
    assert.equal((await run((r) => r.payrollRun.assignments([asha]))).find((a) => a.id === x)?.isSettled, false);
  });
});

describe("staff meals", () => {
  test("prices of the provider oldest first, by day, set, removed; periods of people and of a window; overlap; end; soft delete; days that skip food; the price lock", async () => {
    const p1 = await run((r) => r.meals.createPrice(PF, { monthlyAmountPaise: BigInt(150_000), effectiveFrom: "2026-04-01" }, ACTOR));
    const p0 = await run((r) => r.meals.createPrice(PF, { monthlyAmountPaise: BigInt(120_000), effectiveFrom: "2025-04-01" }, ACTOR));
    assert.deepEqual((await run((r) => r.meals.prices(PF))).map((x) => [x.effectiveFrom, x.monthlyAmountPaise]), [["2025-04-01", BigInt(120_000)], ["2026-04-01", BigInt(150_000)]]);
    assert.equal((await run((r) => r.meals.priceOn(PF, "2026-04-01")))?.id, p1.id);
    assert.equal(await run((r) => r.meals.priceOn(PF, "2026-05-01")), null);
    assert.equal(await run((r) => r.meals.getPrice(HP, p1.id)), null, "another provider reads as absent");
    assert.equal((await run((r) => r.meals.setPrice(p1.id, BigInt(160_000), ACTOR))).monthlyAmountPaise, BigInt(160_000));
    await run((r) => r.meals.removePrice(p0.id));
    assert.equal((await run((r) => r.meals.prices(PF))).length, 1);
    const open = await run((r) => r.meals.createPeriod(HP, { employeeId: asha, startsOn: "2026-01-01", endsOn: null }, ACTOR));
    const closed = await run((r) => r.meals.createPeriod(HP, { employeeId: bina, startsOn: "2026-01-01", endsOn: "2026-02-15" }, ACTOR));
    await assert.rejects(() => run((r) => r.meals.createPeriod(HP, { employeeId: bina, startsOn: "2026-03-01", endsOn: "2026-02-01" }, ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    assert.deepEqual((await run((r) => r.meals.periodsOf([asha, bina]))).map((x) => x.id).sort(), [open.id, closed.id].sort());
    assert.deepEqual((await run((r) => r.meals.periodsIn(HP, "2026-03-01", "2026-03-31"))).map((x) => x.id), [open.id]);
    assert.equal((await run((r) => r.meals.overlapping(asha, "2026-06-01", null)))?.id, open.id);
    assert.equal(await run((r) => r.meals.overlapping(asha, "2026-06-01", null, open.id)), null);
    assert.equal(await run((r) => r.meals.overlapping(bina, "2026-03-01", "2026-03-31")), null);
    assert.equal((await run((r) => r.meals.getPeriod(HP, open.id, { forUpdate: true })))?.id, open.id);
    assert.equal((await run((r) => r.meals.setEnd(open.id, "2026-12-31", ACTOR))).endsOn, "2026-12-31");
    const status = String((await insertRow(owner, hotel.schema, "attendance_statuses", { payroll_company_id: HP, skips_food: true })).id);
    const month = await owner.query(`INSERT INTO "${hotel.schema}".attendance_months (payroll_company_id, year, month) VALUES ($1, 2026, 3) RETURNING id`, [HP]);
    for (const day of [5, 3, 9]) await owner.query(`INSERT INTO "${hotel.schema}".attendance_entries (attendance_month_id, employee_id, day, attendance_status_id, skips_food) VALUES ($1, $2, $3, $4, true)`, [month.rows[0].id, asha, day, status]);
    await owner.query(`INSERT INTO "${hotel.schema}".attendance_entries (attendance_month_id, employee_id, day, skips_food) VALUES ($1, $2, 1, false)`, [month.rows[0].id, bina]);
    assert.deepEqual([...(await run((r) => r.meals.skippedDays(HP, 2026, 3))).entries()], [[asha, [3, 5, 9]]]);
    assert.deepEqual((await run((r) => r.meals.skippedDays(HP, 2026, 4))).size, 0);
    assert.equal(await run((r) => r.meals.softDeletePeriod(HP, closed.id, ACTOR)), true);
    assert.equal(await run((r) => r.meals.softDeletePeriod(HP, closed.id, ACTOR)), false);
    assert.equal(await run((r) => r.meals.getPeriod(HP, closed.id)), null);
    assert.deepEqual(await run((r) => r.meals.lockedThrough()), { year: 2026, month: 3 });
    await owner.query(`DELETE FROM "${hotel.schema}".salary_processings`);
    assert.equal(await run((r) => r.meals.lockedThrough()), null);
  });
});

describe("letters", () => {
  test("one template per company and kind: saved (and saved again), activated, removed; each kind keeps its own sections", async () => {
    const fields = (over: Record<string, unknown> = {}) => ({
      subject: "Appointment", sections: { introduction_content: "Welcome", roles_responsibilities: "Cook", terms_conditions: "Six months" }, closingMessage: "Regards", useCompanySignatory: false, authorizedName: "Mr Owner",
      authorizedDesignation: "Director", authorizedClosingText: "Sincerely", acceptanceHeading: "I accept", acceptanceContent: "Signed", acceptanceClosingText: "Thanks", ...over,
    });
    const first = await run((r) => r.letters.save(HP, "joining", fields(), ACTOR));
    assert.deepEqual([first.subject, first.sections, first.useCompanySignatory, first.isActive, first.acceptanceHeading], ["Appointment", { introduction_content: "Welcome", roles_responsibilities: "Cook", terms_conditions: "Six months" }, false, true, "I accept"]);
    const again = await run((r) => r.letters.save(HP, "joining", fields({ subject: "Updated" }), ACTOR));
    assert.equal(again.id, first.id, "updateOrCreate: the same template");
    assert.equal(again.subject, "Updated");
    const exp = await run((r) => r.letters.save(HP, "experience", fields({ sections: { body_content: "Worked here", conduct_remarks: "Good" } }), ACTOR));
    assert.deepEqual(exp.sections, { body_content: "Worked here", conduct_remarks: "Good" });
    assert.equal(await run((r) => r.letters.get(PF, "joining")), null);
    assert.equal((await run((r) => r.letters.get(HP, "joining")))?.subject, "Updated");
    assert.equal((await run((r) => r.letters.setActive(HP, "joining", false, ACTOR))).isActive, false);
    await assert.rejects(() => run((r) => r.letters.setActive(PF, "joining", false, ACTOR)), (e) => e instanceof RepoError);
    assert.equal(await run((r) => r.letters.remove(HP, "joining")), true);
    assert.equal(await run((r) => r.letters.remove(HP, "joining")), false);
    assert.equal((await run((r) => r.letters.get(HP, "experience")))?.id, exp.id, "the other kind is untouched");
  });
});

describe("separations", () => {
  const sep = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, separationType: "Resignation", resignationDate: "2026-03-01", lastWorkingDate: "2026-03-31", reason: "Better job", remarks: null, status: "Pending" as const, documentPath: null, ...over });

  test("numbered, counted by state, found by open record and last day, updated (rejoin), listed latest leaver first, soft delete, restore, purge", async () => {
    const a = await run((r) => r.separations.create(HP, sep(asha), ACTOR));
    const b = await run((r) => r.separations.create(HP, sep(bina, { lastWorkingDate: "2026-02-28", resignationDate: "2026-02-01", status: "Relieved", reason: "Moved away" }), ACTOR));
    assert.deepEqual([a.entryNo, b.entryNo, a.rejoinedAt, a.status, a.createdBy], [1, 2, null, "Pending", ACTOR]);
    await assert.rejects(() => run((r) => r.separations.create(HP, sep(asha, { lastWorkingDate: "2026-02-01" }), ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    assert.deepEqual(await run((r) => r.separations.counts(HP)), { inNotice: 1, relieved: 1, rejoined: 0, all: 2, byStatus: { Pending: 1, Accepted: 0, Relieved: 1 } });
    // one month by last working day (the pay lists' `period`)
    assert.deepEqual(await run((r) => r.separations.counts(HP, { from: "2026-03-01", to: "2026-03-31" })), { inNotice: 1, relieved: 0, rejoined: 0, all: 1, byStatus: { Pending: 1, Accepted: 0, Relieved: 0 } });
    assert.deepEqual((await run((r) => r.separations.list(HP, { page: 1, pageSize: 10, lastDay: { from: "2026-02-01", to: "2026-02-28" } }))).rows.map((x) => x.entryNo), [2]);
    assert.equal((await run((r) => r.separations.openFor(asha)))?.id, a.id);
    assert.equal(await run((r) => r.separations.openFor(asha, a.id)), null);
    assert.deepEqual([...(await run((r) => r.separations.lastDays([asha, bina]))).entries()], [[bina, "2026-02-28"]], "only Relieved and not rejoined");
    const list = await run((r) => r.separations.list(HP, { page: 1, pageSize: 10 }));
    assert.deepEqual(list.rows.map((x) => [x.employeeName, x.lastWorkingDate]), [["Asha Rao", "2026-03-31"], ["bina Shah", "2026-02-28"]]);
    assert.equal(list.rows[0].designation, "Cook".length > 0 ? list.rows[0].designation : null, "the person's designation comes along");
    assert.deepEqual((await run((r) => r.separations.list(HP, { page: 1, pageSize: 10, words: ["moved"] }))).rows.map((x) => x.entryNo), [2]);
    assert.deepEqual((await run((r) => r.separations.list(HP, { page: 1, pageSize: 10, words: ["bina", "resignation"] }))).rows.map((x) => x.entryNo), [2]);
    const upd = await run((r) => r.separations.update(HP, b.id, { rejoinedAt: "2026-04-10", remarks: "Came back" }, ACTOR));
    assert.deepEqual([upd.rejoinedAt, upd.remarks], ["2026-04-10", "Came back"]);
    assert.deepEqual(await run((r) => r.separations.counts(HP)), { inNotice: 1, relieved: 0, rejoined: 1, all: 2, byStatus: { Pending: 1, Accepted: 0, Relieved: 1 } });
    assert.deepEqual((await run((r) => r.separations.lastDays([bina]))).size, 0);
    await assert.rejects(() => run((r) => r.separations.update(PF, a.id, { remarks: "x" }, ACTOR)), (e) => e instanceof RepoError);
    assert.equal(await run((r) => r.separations.softDelete(HP, a.id, ACTOR)), true);
    assert.equal(await run((r) => r.separations.get(HP, a.id)), null);
    assert.equal((await run((r) => r.separations.get(HP, a.id, { deleted: true })))?.id, a.id);
    assert.equal((await run((r) => r.separations.create(HP, sep(asha), ACTOR))).entryNo, 3, "a binned record keeps its number");
    assert.equal(await run((r) => r.separations.purge(PF, a.id)), false);
    assert.equal(await run((r) => r.separations.restore(HP, a.id)), true);
    await run((r) => r.separations.softDelete(HP, a.id, ACTOR));
    assert.equal(await run((r) => r.separations.purge(HP, a.id)), true);
    assert.deepEqual((await run((r) => r.separations.list(HP, { page: 1, pageSize: 10, deleted: "only" }))).rows, []);
    assert.equal((await run((r) => r.separations.list(HP, { page: 1, pageSize: 10, countTotal: false }))).total, -1, "the recycle bin's read skips the COUNT");
    assert.equal((await run((r) => r.bonuses.list(HP, { viewFrom: null, page: 1, pageSize: 10, countTotal: false }))).total, -1);
  });
});

after(async () => {
  await releaseTestLock?.();
});
