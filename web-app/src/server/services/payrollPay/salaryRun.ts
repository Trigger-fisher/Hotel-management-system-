import "server-only";
import type { AttendanceMonthRecord, EmployeeRecord } from "../../repos/payrollCore";
import type { NewSalaryLine, PaymentPatch, SalaryProcessingFields, SalaryProcessingRecord } from "../../repos/payrollPay";
import { unwrapVersioned } from "../../repos/unwrap";
import { istInstant } from "../cash/ist";
import type { PayrollUnitRepos, SalaryRun } from "../payrollCore/context";
import { salaryForMonth, type MonthResult } from "./salaryMath";

// The salary run (Pallav Services/Payroll/SalaryProcessor.php generate :54-101 and reverse :103-147), filling payroll core's SalaryRun port.
// It runs INSIDE the caller's unit (attendance generate / re-generate), which then locks the month. Reads are per month, batched for every
// active person (entries, salary revisions, bonuses, deduction assignments, open advances); writes are batched. The arithmetic is
// salaryMath.ts (golden against real PHP). Spec: docs/specs/payroll-pay.md §3.

const ZERO = BigInt(0);
const PAYMENT_FIELDS = ["paymentStatus", "paidAmountPaise", "paidAt", "paymentReference", "paymentRemarks", "paymentUpdatedBy", "paymentUpdatedAt"] as const;
const pad = (n: number): string => String(n).padStart(2, "0");
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function createSalaryRun(deps: { now: () => Date }): SalaryRun & { reverse(repos: PayrollUnitRepos, month: AttendanceMonthRecord): Promise<void> } {

  /** reverse (:103-147): undo what a previous run applied, so a re-generate starts clean; other months are never touched. */
  async function reverse(repos: PayrollUnitRepos, month: AttendanceMonthRecord): Promise<void> {
    const processings = await repos.salaryProcessings.month(month.payrollCompanyId, month.year, month.month, "name");
    if (processings.length === 0) return;
    const ids = processings.map((p) => p.id);
    const lines = await repos.salaryProcessings.lines(ids);
    const carried = await repos.payrollAdvances.carriedBy(ids);
    const touchedIds = new Set<string>([...carried.flatMap((c) => (c.parentAdvanceId ? [c.parentAdvanceId] : [])), ...lines.flatMap((l) => (l.sourceType === "advance" && l.sourceId ? [l.sourceId] : []))]);
    const touched = new Map((await repos.payrollAdvances.getMany([...touchedIds], { forUpdate: true })).map((a) => [a.id, a]));
    const takeBack = (id: string, amount: bigint): void => {
      const a = touched.get(id);
      if (!a) return;
      const left = a.recoveredAmountPaise - amount;
      a.recoveredAmountPaise = left > ZERO ? left : ZERO;
    };
    // each carry-forward's balance goes back to the advance it came from, then the carry-forward goes
    for (const c of carried) if (c.parentAdvanceId) takeBack(c.parentAdvanceId, c.amountPaise);
    for (const l of lines) if (l.sourceType === "advance" && l.sourceId) takeBack(l.sourceId, l.amountPaise);
    await repos.payrollAdvances.removeCarried(carried.map((c) => c.id));
    await repos.payrollRun.setSettled(lines.flatMap((l) => (l.sourceType === "employee_deduction" && l.sourceId ? [l.sourceId] : [])), false);
    // is_settled = outstanding() <= 0.001: in paise, nothing left
    await repos.payrollAdvances.setRecovery([...touched.values()].map((a) => ({ id: a.id, recoveredAmountPaise: a.recoveredAmountPaise, isSettled: a.amountPaise - a.recoveredAmountPaise <= ZERO })));
    await repos.salaryProcessings.removeMonth(month.payrollCompanyId, month.year, month.month);
  }

  return {
    reverse,

    /** generate (:54-101), the month lock left to the caller. */
    async generate(repos, month, userId) {
      const companyId = month.payrollCompanyId;
      // payments are real-world events: a re-generate must not forget them
      const before = await repos.salaryProcessings.month(companyId, month.year, month.month, "name");
      const payments = new Map(before.map((p) => [p.employeeId, { patch: Object.fromEntries(PAYMENT_FIELDS.map((f) => [f, p[f]])) as PaymentPatch, version: p.version }]));
      await reverse(repos, month);

      const company = (await repos.payrollCompanies.get(companyId))!;
      const listed = await repos.employees.list(companyId, { active: true, deleted: "no", sort: "name", page: 1, pageSize: 100_000 });
      const people: EmployeeRecord[] = await repos.employees.getMany(companyId, listed.rows.map((r) => r.id));
      const byName = new Map(listed.rows.map((r, i) => [r.id, i]));
      people.sort((a, b) => (byName.get(a.id) ?? 0) - (byName.get(b.id) ?? 0));
      const ids = people.map((p) => p.id);

      // the month's reads, ONE per table, grouped by person in code
      const days = daysIn(month.year, month.month);
      const first = `${month.year}-${pad(month.month)}-01`;
      const last = `${month.year}-${pad(month.month)}-${pad(days)}`;
      const group = <T extends { employeeId: string }>(rows: readonly T[]): Map<string, T[]> => {
        const m = new Map<string, T[]>();
        for (const r of rows) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]);
        return m;
      };
      const entries = group(await repos.attendance.entries(month.id, ids));
      const revisions = group(await repos.revisions.salaryInMonth(ids, first, last));
      const bonuses = group(await repos.bonuses.inMonth(ids, istInstant(first, "00:00:00"), new Date(istInstant(last, "23:59:59").getTime() + 999)));
      const assignments = group(await repos.payrollRun.assignments(ids));
      const advances = group(await repos.payrollAdvances.openFor(ids, { forUpdate: true }));

      const at = deps.now();
      const results: { person: EmployeeRecord; r: MonthResult }[] = people.map((person) => ({
        person,
        r: salaryForMonth({
          year: month.year,
          month: month.month,
          salaryPaise: person.salaryPaise,
          dailyWorkingHours: person.dailyWorkingHours,
          entries: (entries.get(person.id) ?? []).map((e) => ({ day: e.day, percentage: e.attendancePercentage, overtimeHours: e.overtimeHours })),
          revisions: (revisions.get(person.id) ?? []).map((v) => ({ effectiveDate: v.effectiveDate, previousValue: v.previousValue, newValue: v.newValue })),
          bonuses: (bonuses.get(person.id) ?? []).map((b) => ({ id: b.id, type: b.type, amountPaise: b.amountPaise, remarks: b.remarks })),
          assignments: (assignments.get(person.id) ?? []).map((a) => ({ id: a.id, name: a.deductionName, type: a.deductionType, amountPaise: a.amountPaise, isSettled: a.isSettled })),
          advances: (advances.get(person.id) ?? []).map((a) => ({ id: a.id, amountPaise: a.amountPaise, recoveredPaise: a.recoveredAmountPaise, type: a.deductionType, deductionAmountPaise: a.deductionAmountPaise, remarks: a.remarks })),
        }),
      }));

      const rows = results.map(({ person, r }) => {
        const fields: SalaryProcessingFields = {
          payrollCompanyId: companyId,
          employeeId: person.id,
          year: month.year,
          month: month.month,
          companyName: company.name,
          employeeCode: person.employeeCode,
          employeeName: person.name,
          designation: person.designation,
          department: person.department,
          paymentMode: person.paymentMode,
          monthlySalaryPaise: person.salaryPaise,
          dailyWorkingHours: person.dailyWorkingHours,
          totalDaysInMonth: r.daysInMonth,
          dailySalaryPaise: r.dailySalaryPaise,
          days0: r.buckets[0].toFixed(2),
          days25: r.buckets[1].toFixed(2),
          days50: r.buckets[2].toFixed(2),
          days75: r.buckets[3].toFixed(2),
          days100: r.buckets[4].toFixed(2),
          totalPayableDays: r.payableDays,
          attendanceSalaryPaise: r.attendanceSalaryPaise,
          overtimeHours: r.overtimeHours,
          hourlyRatePaise: r.hourlyRatePaise,
          overtimeAmountPaise: r.overtimeAmountPaise,
          bonusAmountPaise: r.bonusPaise,
          incentiveAmountPaise: r.incentivePaise,
          deductionAmountPaise: r.deductionPaise,
          advanceDeductionPaise: r.advanceDeductedPaise,
          pendingAdvanceAmountPaise: r.pendingAdvancePaise,
          netSalaryPaise: r.netPaise,
          paymentStatus: "Pending",
          generationCount: month.generationCount + 1,
          processedBy: userId,
          processedAt: at,
          paidAmountPaise: ZERO,
          paidAt: null,
          paymentReference: null,
          paymentRemarks: null,
          paymentUpdatedBy: null,
          paymentUpdatedAt: null,
          // copied, not looked up: the slip prints the details as they were when it was paid
          bankName: person.bankName,
          accountHolderName: person.accountHolderName,
          accountNumber: person.accountNumber,
          ifscCode: person.ifscCode,
          branchName: person.branchName,
        };
        const lines: NewSalaryLine[] = r.lines.map((l) => ({ category: l.category, label: l.label, deductionType: l.type, amountPaise: l.amountPaise, pendingAmountPaise: l.pendingPaise, sourceType: l.source.type, sourceId: l.source.id }));
        return { fields, lines };
      });
      const created = await repos.salaryProcessings.createMany(rows);
      const processingOf = new Map(created.map((p) => [p.employeeId, p]));

      // the run's effects on what it read: One Time deductions settled, advances recovered and closed, balances carried to next month
      await repos.payrollRun.setSettled(results.flatMap(({ r }) => r.settled), true);
      await repos.payrollAdvances.setRecovery(results.flatMap(({ r }) => r.advances.map((a) => ({ id: a.id, recoveredAmountPaise: a.recoveredPaise, isSettled: true }))));
      const parents = new Map(results.flatMap(({ person }) => (advances.get(person.id) ?? []).map((a) => [a.id, a] as const)));
      for (const { person, r } of results) {
        for (const c of r.carry) {
          await repos.payrollAdvances.create(
            companyId,
            {
              employeeId: person.id,
              advanceDate: istInstant(c.date, "00:00:00"),
              amountPaise: c.amountPaise,
              deductionType: c.type,
              deductionAmountPaise: c.deductionAmountPaise,
              remarks: c.remarks,
              isCarryForward: true,
              parentAdvanceId: parents.get(c.parentId)?.id ?? c.parentId,
              sourceSalaryProcessingId: processingOf.get(person.id)!.id,
            },
            userId,
          );
        }
      }

      // what was already paid stays paid; a salary that grew past what was paid is only partly paid now
      for (const p of created) {
        const previous = payments.get(p.employeeId);
        if (!previous) continue;
        const patch = { ...previous.patch };
        if (patch.paymentStatus === "Paid" && patch.paidAmountPaise < p.netSalaryPaise) patch.paymentStatus = "Partially Paid";
        // the new row carries the old number on, one higher: a form opened before the re-generate can never match it
        unwrapVersioned(await repos.salaryProcessings.updatePayment(p.id, patch, { version: previous.version + 1 }));
      }
    },
  };
}

export type { SalaryProcessingRecord };
