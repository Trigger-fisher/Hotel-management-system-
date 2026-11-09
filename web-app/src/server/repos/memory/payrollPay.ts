import "server-only";
import { randomUUID } from "node:crypto";
import { PAYMENT_STATUSES } from "../payrollPay";
import type {
  BonusRecord, InstantRange, LetterRecord, MealPeriodRecord, MealPriceRecord, PaymentStatus, PayrollAdvanceRecord, PayrollPayRepos, RevisionRecord, SalaryLineRecord, SalaryProcessingRecord, SeparationRecord,
  SeparationStatus, SlipSort,
} from "../payrollPay";
import { RepoError, type ListResult } from "../types";
import type { PayrollData } from "./payrollCore";

// The in-memory double of the payroll-pay repositories (repos/payrollPay.ts), in the SAME per-hotel data as payroll core. It keeps the table
// rules: everything scoped to its company, entry numbers unique per table (hotel-wide, as the UNIQUE key), soft delete for advances and bonuses,
// lines going with their processing (ON DELETE CASCADE), a carry-forward's source set null when its processing goes.

export interface PayrollPayData {
  salaryProcessings: SalaryProcessingRecord[];
  salaryLines: SalaryLineRecord[];
  revisions: RevisionRecord[];
  payrollAdvances: PayrollAdvanceRecord[];
  bonuses: BonusRecord[];
  mealPrices: MealPriceRecord[];
  mealPeriods: MealPeriodRecord[];
  letters: LetterRecord[];
  separations: SeparationRecord[];
}

export const emptyPayrollPayData = (): PayrollPayData => ({ salaryProcessings: [], salaryLines: [], revisions: [], payrollAdvances: [], bonuses: [], mealPrices: [], mealPeriods: [], letters: [], separations: [] });

const ZERO = BigInt(0);
const copy = <T>(r: T): T => structuredClone(r);
const paged = <T>(rows: T[], p: { page: number; pageSize: number }): ListResult<T> => ({ rows: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(copy), total: rows.length });
const latestFirst = <T extends { id: string; entryNo: number }>(at: (r: T) => Date) => (a: T, b: T): number => at(b).getTime() - at(a).getTime() || b.entryNo - a.entryNo;
const key = (employeeId: string, year: number, month: number): string => `${employeeId}|${year}|${month}`;
const max0 = (v: bigint): bigint => (v > ZERO ? v : ZERO);

type SortKey = readonly (string | number | bigint)[];
/** Compares two sort keys column by column (strings in byte order, as COLLATE "C"). */
const byKeys = (x: SortKey, y: SortKey): number => {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};
/** The Salary Slips sort columns, as the PostgreSQL repo's SLIP_SORT. */
const SLIP_SORT: Record<SlipSort, (p: SalaryProcessingRecord) => SortKey> = {
  period: (p) => [p.year, p.month],
  employee: (p) => [p.employeeName.toLowerCase(), p.employeeCode.toLowerCase()],
  net: (p) => [p.netSalaryPaise],
  processed: (p) => [p.processedAt.getTime()],
  status: (p) => [PAYMENT_STATUSES.indexOf(p.paymentStatus)],
};

export function bindPayrollPay(data: PayrollData & PayrollPayData): PayrollPayRepos {
  const nameOf = (employeeId: string): string | null => data.employees.find((e) => e.id === employeeId)?.name ?? null;
  const codeOf = (employeeId: string): string => data.employees.find((e) => e.id === employeeId)?.employeeCode ?? "";
  const matches = (words: readonly string[] | undefined, ...parts: (string | null)[]): boolean => {
    const hay = parts.join(" ").toLowerCase();
    return !words || words.every((w) => hay.includes(w));
  };
  const processing = (companyId: string, id: string) => data.salaryProcessings.find((p) => p.id === id && p.payrollCompanyId === companyId);
  const advance = (companyId: string, id: string) => data.payrollAdvances.find((a) => a.id === id && a.payrollCompanyId === companyId);
  const bonus = (companyId: string, id: string) => data.bonuses.find((b) => b.id === id && b.payrollCompanyId === companyId);
  const nextNo = (rows: { entryNo: number }[]): number => rows.reduce((m, r) => Math.max(m, r.entryNo), 0) + 1;
  const inRange = (at: Date, range: InstantRange | undefined): boolean => !range || (at >= range.from && at < range.to);
  const advanceView = (companyId: string, q: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange }, deleted = false) =>
    data.payrollAdvances.filter(
      (a) =>
        a.payrollCompanyId === companyId &&
        (a.deletedAt !== null) === deleted &&
        (q.viewFrom === null || a.advanceDate >= q.viewFrom || !a.isSettled) &&
        (!q.employeeId || a.employeeId === q.employeeId) &&
        inRange(a.advanceDate, q.range) &&
        matches(q.words, nameOf(a.employeeId), codeOf(a.employeeId), a.remarks, String(a.entryNo)),
    );
  const bonusView = (companyId: string, q: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange }, deleted = false) =>
    data.bonuses.filter(
      (b) =>
        b.payrollCompanyId === companyId &&
        (b.deletedAt !== null) === deleted &&
        (q.viewFrom === null || b.entryDate >= q.viewFrom) &&
        (!q.employeeId || b.employeeId === q.employeeId) &&
        inRange(b.entryDate, q.range) &&
        matches(q.words, nameOf(b.employeeId), codeOf(b.employeeId), b.remarks, b.type, String(b.entryNo)),
    );
  const outstanding = (a: PayrollAdvanceRecord): bigint => max0(a.amountPaise - a.recoveredAmountPaise);

  return {
    salaryProcessings: {
      get: async (companyId, id) => {
        const p = processing(companyId, id);
        return p ? copy(p) : null;
      },
      getMany: async (companyId, ids) => data.salaryProcessings.filter((p) => p.payrollCompanyId === companyId && ids.includes(p.id)).map(copy),
      month: async (companyId, year, month, order, options) => {
        const rows = data.salaryProcessings.filter((p) => p.payrollCompanyId === companyId && p.year === year && p.month === month && (!options?.employeeId || p.employeeId === options.employeeId));
        const byName = (a: SalaryProcessingRecord, b: SalaryProcessingRecord): number => a.employeeName.localeCompare(b.employeeName);
        // orderByRaw('paid_at IS NULL DESC'), orderByDesc('paid_at'), orderBy('employee_name')
        const payments = (a: SalaryProcessingRecord, b: SalaryProcessingRecord): number =>
          Number(b.paidAt === null) - Number(a.paidAt === null) || (b.paidAt ?? "").localeCompare(a.paidAt ?? "") || byName(a, b);
        return rows.sort(order === "name" ? byName : payments).map(copy);
      },
      lines: async (ids) => data.salaryLines.filter((l) => ids.includes(l.salaryProcessingId)).map(copy),
      list: async (companyId, q) => {
        const from = q.from;
        const newest = (a: SalaryProcessingRecord, b: SalaryProcessingRecord): number => b.year - a.year || b.month - a.month || b.processedAt.getTime() - a.processedAt.getTime() || (a.id < b.id ? 1 : -1);
        const sort = q.sort;
        const first = sort ? SLIP_SORT[sort.key] : null;
        const sign = sort?.dir === "desc" ? -1 : 1;
        const rows = data.salaryProcessings
          .filter(
            (p) =>
              p.payrollCompanyId === companyId &&
              (!from || p.year * 100 + p.month >= from.year * 100 + from.month) &&
              (!q.period || (p.year === q.period.year && p.month === q.period.month)) &&
              matches(q.words, p.employeeName, p.employeeCode, p.designation) &&
              (!q.status || p.paymentStatus === q.status),
          )
          .sort((a, b) => (first ? byKeys(first(a), first(b)) * sign : 0) || newest(a, b));
        return paged(rows, q);
      },
      slipSummary: async (companyId, period) => {
        const rows = data.salaryProcessings.filter((p) => p.payrollCompanyId === companyId && (!period || (p.year === period.year && p.month === period.month)));
        const sum = (f: (p: SalaryProcessingRecord) => bigint): bigint => rows.reduce((t, p) => t + f(p), ZERO);
        const latest = rows.reduce<number | null>((m, p) => Math.max(m ?? 0, p.year * 100 + p.month), null);
        return {
          slips: rows.length,
          people: new Set(rows.map((p) => p.employeeId)).size,
          netPaise: sum((p) => p.netSalaryPaise),
          paidPaise: sum((p) => p.paidAmountPaise),
          outstandingPaise: sum((p) => max0(p.netSalaryPaise - p.paidAmountPaise)),
          byStatus: Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, rows.filter((p) => p.paymentStatus === s).length])) as Record<PaymentStatus, number>,
          latest: latest === null ? null : { year: Math.floor(latest / 100), month: latest % 100 },
          latestNetPaise: rows.filter((p) => p.year * 100 + p.month === latest).reduce((t, p) => t + p.netSalaryPaise, ZERO),
          periods: new Set(rows.map((p) => p.year * 100 + p.month)).size,
        };
      },
      periods: async (companyId) => {
        const counts = new Map<string, { year: number; month: number; people: number }>();
        for (const p of data.salaryProcessings.filter((x) => x.payrollCompanyId === companyId)) {
          const k = `${p.year}-${p.month}`;
          const row = counts.get(k) ?? { year: p.year, month: p.month, people: 0 };
          row.people += 1;
          counts.set(k, row);
        }
        return [...counts.values()].sort((a, b) => b.year - a.year || b.month - a.month);
      },
      latestPeriod: async (companyId) => {
        const rows = data.salaryProcessings.filter((p) => p.payrollCompanyId === companyId).sort((a, b) => b.year - a.year || b.month - a.month);
        return rows[0] ? { year: rows[0].year, month: rows[0].month } : null;
      },
      processedFor: async (companyId, employeeId, year, month) => data.salaryProcessings.some((p) => p.payrollCompanyId === companyId && p.employeeId === employeeId && p.year === year && p.month === month),
      processedKeys: async (companyId, keys) => {
        const have = new Set(data.salaryProcessings.filter((p) => p.payrollCompanyId === companyId).map((p) => key(p.employeeId, p.year, p.month)));
        return new Set(keys.map((k) => key(k.employeeId, k.year, k.month)).filter((k) => have.has(k)));
      },
      createMany: async (rows) => {
        const out: SalaryProcessingRecord[] = [];
        for (const r of rows) {
          const rec: SalaryProcessingRecord = { ...copy(r.fields), id: randomUUID(), createdAt: new Date(), version: 1 };
          data.salaryProcessings.push(rec);
          for (const l of r.lines) data.salaryLines.push({ ...copy(l), id: randomUUID(), salaryProcessingId: rec.id });
          out.push(copy(rec));
        }
        return out;
      },
      setTotals: async (id, totals) => {
        const p = data.salaryProcessings.find((x) => x.id === id);
        if (!p) throw new RepoError("check", "salary processing not found");
        Object.assign(p, totals);
      },
      updatePayment: async (id, patch, options) => {
        const p = data.salaryProcessings.find((x) => x.id === id);
        if (!p) return { ok: false, reason: "not_found" };
        if (options?.expectedVersion !== undefined && options.expectedVersion !== p.version) return { ok: false, reason: "conflict", currentVersion: p.version };
        Object.assign(p, copy(patch), { version: options?.version ?? p.version + 1 });
        return { ok: true, record: copy(p) };
      },
      removeMonth: async (companyId, year, month) => {
        const gone = new Set(data.salaryProcessings.filter((p) => p.payrollCompanyId === companyId && p.year === year && p.month === month).map((p) => p.id));
        data.salaryProcessings = data.salaryProcessings.filter((p) => !gone.has(p.id));
        data.salaryLines = data.salaryLines.filter((l) => !gone.has(l.salaryProcessingId));
        for (const a of data.payrollAdvances) if (a.sourceSalaryProcessingId && gone.has(a.sourceSalaryProcessingId)) a.sourceSalaryProcessingId = null;
        return gone.size;
      },
      figures: async (companyId) => {
        const mine = data.salaryProcessings.filter((p) => p.payrollCompanyId === companyId);
        const latest = mine.sort((a, b) => b.year - a.year || b.month - a.month)[0];
        const month = latest ? mine.filter((p) => p.year === latest.year && p.month === latest.month) : [];
        return {
          latest: latest ? { year: latest.year, month: latest.month } : null,
          netPaise: month.reduce((t, p) => t + p.netSalaryPaise, ZERO),
          paidPaise: month.reduce((t, p) => t + p.paidAmountPaise, ZERO),
          unpaid: month.filter((p) => p.paymentStatus !== "Paid").length,
          count: month.length,
          open: mine.filter((p) => ["Pending", "Processing", "On Hold", "Partially Paid"].includes(p.paymentStatus)).length,
          failed: mine.filter((p) => p.paymentStatus === "Failed").length,
        };
      },
    },

    revisions: {
      forEmployee: async (employeeId) =>
        data.revisions
          .filter((r) => r.employeeId === employeeId)
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .map(copy),
      salaryInMonth: async (ids, from, to) =>
        data.revisions.filter((r) => ids.includes(r.employeeId) && r.fieldName === "Salary" && r.effectiveDate >= from && r.effectiveDate <= to).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.getTime() - b.createdAt.getTime()).map(copy),
      summary: async (ids) => {
        const out = new Map<string, { count: number; latest: string }>();
        for (const r of data.revisions.filter((x) => ids.includes(x.employeeId))) {
          const row = out.get(r.employeeId) ?? { count: 0, latest: r.effectiveDate };
          row.count += 1;
          if (r.effectiveDate > row.latest) row.latest = r.effectiveDate;
          out.set(r.employeeId, row);
        }
        return out;
      },
      createBatch: async (rows) => {
        const at = new Date();
        for (const r of rows) data.revisions.push({ ...copy(r), id: randomUUID(), createdAt: at });
      },
    },

    payrollAdvances: {
      get: async (companyId, id, options) => {
        const a = advance(companyId, id);
        return a && (a.deletedAt !== null) === (options?.deleted === true) ? copy(a) : null;
      },
      getMany: async (ids) => data.payrollAdvances.filter((a) => ids.includes(a.id)).map(copy),
      list: async (companyId, q) => paged(advanceView(companyId, q, q.deleted === "only").sort(latestFirst((a) => a.advanceDate)).map((a) => ({ ...a, employeeName: nameOf(a.employeeId), employeeCode: codeOf(a.employeeId) || null })), q),
      summary: async (companyId, q) => {
        const rows = advanceView(companyId, q);
        const ids = new Set(rows.map((a) => a.id));
        const moved = new Map<string, bigint>();
        for (const c of data.payrollAdvances) if (c.parentAdvanceId && ids.has(c.parentAdvanceId)) moved.set(c.parentAdvanceId, (moved.get(c.parentAdvanceId) ?? ZERO) + c.amountPaise);
        return {
          issuedPaise: rows.filter((a) => !a.isCarryForward).reduce((t, a) => t + a.amountPaise, ZERO),
          recoveredPaise: rows.reduce((t, a) => t + a.recoveredAmountPaise - (moved.get(a.id) ?? ZERO), ZERO),
          outstandingPaise: rows.reduce((t, a) => t + outstanding(a), ZERO),
          open: rows.filter((a) => !a.isSettled).length,
        };
      },
      openFor: async (ids) =>
        data.payrollAdvances
          .filter((a) => ids.includes(a.employeeId) && a.deletedAt === null && !a.isSettled)
          .sort((a, b) => a.advanceDate.getTime() - b.advanceDate.getTime() || a.entryNo - b.entryNo)
          .map(copy),
      carriedBy: async (ids) => data.payrollAdvances.filter((a) => a.sourceSalaryProcessingId !== null && ids.includes(a.sourceSalaryProcessingId)).map(copy),
      figures: async (companyId) => {
        const live = data.payrollAdvances.filter((a) => a.payrollCompanyId === companyId && a.deletedAt === null);
        return { outstandingPaise: live.reduce((t, a) => t + outstanding(a), ZERO), open: live.filter((a) => !a.isSettled).length };
      },
      create: async (companyId, fields, by) => {
        const rec: PayrollAdvanceRecord = {
          ...copy(fields),
          id: randomUUID(),
          payrollCompanyId: companyId,
          entryNo: nextNo(data.payrollAdvances),
          recoveredAmountPaise: ZERO,
          isSettled: false,
          isCarryForward: fields.isCarryForward ?? false,
          parentAdvanceId: fields.parentAdvanceId ?? null,
          sourceSalaryProcessingId: fields.sourceSalaryProcessingId ?? null,
          createdBy: by,
          updatedBy: by,
          deletedAt: null,
          deletedBy: null,
          createdAt: new Date(),
        };
        if (rec.amountPaise <= ZERO) throw new RepoError("check", "payroll_advances.amount_paise");
        data.payrollAdvances.push(rec);
        return copy(rec);
      },
      update: async (companyId, id, patch, by) => {
        const a = advance(companyId, id);
        if (!a || a.deletedAt) throw new RepoError("check", "advance not found");
        Object.assign(a, copy(patch), { updatedBy: by });
        return copy(a);
      },
      setRecovery: async (rows) => {
        for (const r of rows) {
          const a = data.payrollAdvances.find((x) => x.id === r.id);
          if (a) Object.assign(a, { recoveredAmountPaise: r.recoveredAmountPaise, isSettled: r.isSettled });
        }
      },
      removeCarried: async (ids) => {
        data.payrollAdvances = data.payrollAdvances.filter((a) => !ids.includes(a.id));
        for (const a of data.payrollAdvances) if (a.parentAdvanceId && ids.includes(a.parentAdvanceId)) a.parentAdvanceId = null;
      },
      softDelete: async (companyId, id, by) => {
        const a = advance(companyId, id);
        if (!a || a.deletedAt) return false;
        Object.assign(a, { deletedAt: new Date(), deletedBy: by });
        return true;
      },
      restore: async (companyId, id) => {
        const a = advance(companyId, id);
        if (!a || !a.deletedAt) return false;
        Object.assign(a, { deletedAt: null, deletedBy: null });
        return true;
      },
      purge: async (companyId, id) => {
        const a = advance(companyId, id);
        if (!a || !a.deletedAt) return false;
        data.payrollAdvances = data.payrollAdvances.filter((x) => x.id !== id);
        return true;
      },
    },

    bonuses: {
      get: async (companyId, id, options) => {
        const b = bonus(companyId, id);
        return b && (b.deletedAt !== null) === (options?.deleted === true) ? copy(b) : null;
      },
      list: async (companyId, q) => paged(bonusView(companyId, q, q.deleted === "only").sort(latestFirst((b) => b.entryDate)).map((b) => ({ ...b, employeeName: nameOf(b.employeeId), employeeCode: codeOf(b.employeeId) || null })), q),
      summary: async (companyId, q) => {
        const rows = bonusView(companyId, q);
        return {
          bonusPaise: rows.filter((b) => b.type === "Bonus").reduce((t, b) => t + b.amountPaise, ZERO),
          incentivePaise: rows.filter((b) => b.type === "Incentive").reduce((t, b) => t + b.amountPaise, ZERO),
          people: new Set(rows.map((b) => b.employeeId)).size,
        };
      },
      inMonth: async (ids, from, to) => data.bonuses.filter((b) => ids.includes(b.employeeId) && b.deletedAt === null && b.entryDate >= from && b.entryDate <= to).sort((a, b) => a.entryNo - b.entryNo).map(copy),
      create: async (companyId, fields, by) => {
        if (fields.amountPaise <= ZERO) throw new RepoError("check", "bonus_incentives.amount_paise");
        const rec: BonusRecord = { ...copy(fields), id: randomUUID(), payrollCompanyId: companyId, entryNo: nextNo(data.bonuses), createdBy: by, updatedBy: by, deletedAt: null, deletedBy: null, createdAt: new Date() };
        data.bonuses.push(rec);
        return copy(rec);
      },
      update: async (companyId, id, patch, by) => {
        const b = bonus(companyId, id);
        if (!b || b.deletedAt) throw new RepoError("check", "bonus not found");
        Object.assign(b, copy(patch), { updatedBy: by });
        return copy(b);
      },
      softDelete: async (companyId, id, by) => {
        const b = bonus(companyId, id);
        if (!b || b.deletedAt) return false;
        Object.assign(b, { deletedAt: new Date(), deletedBy: by });
        return true;
      },
      restore: async (companyId, id) => {
        const b = bonus(companyId, id);
        if (!b || !b.deletedAt) return false;
        Object.assign(b, { deletedAt: null, deletedBy: null });
        return true;
      },
      purge: async (companyId, id) => {
        const b = bonus(companyId, id);
        if (!b || !b.deletedAt) return false;
        data.bonuses = data.bonuses.filter((x) => x.id !== id);
        return true;
      },
    },

    meals: {
      prices: async (providerId) => data.mealPrices.filter((p) => p.payrollCompanyId === providerId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.getTime() - b.createdAt.getTime()).map(copy),
      priceOn: async (providerId, day) => copy(data.mealPrices.find((p) => p.payrollCompanyId === providerId && p.effectiveFrom === day) ?? null),
      getPrice: async (providerId, id) => copy(data.mealPrices.find((p) => p.payrollCompanyId === providerId && p.id === id) ?? null),
      createPrice: async (providerId, row, by) => {
        const rec: MealPriceRecord = { id: randomUUID(), payrollCompanyId: providerId, monthlyAmountPaise: row.monthlyAmountPaise, effectiveFrom: row.effectiveFrom, createdBy: by, createdAt: new Date() };
        data.mealPrices.push(rec);
        return copy(rec);
      },
      setPrice: async (id, amount) => {
        const p = data.mealPrices.find((x) => x.id === id);
        if (!p) throw new RepoError("check", "price not found");
        p.monthlyAmountPaise = amount;
        return copy(p);
      },
      removePrice: async (id) => void (data.mealPrices = data.mealPrices.filter((p) => p.id !== id)),
      periodsOf: async (ids) => data.mealPeriods.filter((p) => ids.includes(p.employeeId) && p.deletedAt === null).map(copy),
      periodsIn: async (companyId, from, to) => data.mealPeriods.filter((p) => p.payrollCompanyId === companyId && p.deletedAt === null && p.startsOn <= to && (p.endsOn === null || p.endsOn >= from)).map(copy),
      getPeriod: async (companyId, id) => copy(data.mealPeriods.find((p) => p.payrollCompanyId === companyId && p.id === id && p.deletedAt === null) ?? null),
      overlapping: async (employeeId, starts, ends, except) =>
        copy(data.mealPeriods.find((p) => p.employeeId === employeeId && p.deletedAt === null && p.id !== except && p.startsOn <= (ends ?? "9999-12-31") && (p.endsOn === null || p.endsOn >= starts)) ?? null),
      createPeriod: async (companyId, row, by) => {
        const rec: MealPeriodRecord = { ...row, id: randomUUID(), payrollCompanyId: companyId, createdBy: by, deletedAt: null, createdAt: new Date() };
        data.mealPeriods.push(rec);
        return copy(rec);
      },
      setEnd: async (id, endsOn) => {
        const p = data.mealPeriods.find((x) => x.id === id);
        if (!p) throw new RepoError("check", "meal period not found");
        p.endsOn = endsOn;
        return copy(p);
      },
      softDeletePeriod: async (companyId, id) => {
        const p = data.mealPeriods.find((x) => x.id === id && x.payrollCompanyId === companyId && x.deletedAt === null);
        if (!p) return false;
        p.deletedAt = new Date();
        return true;
      },
      deletedPeriods: async (companyId) =>
        data.mealPeriods.filter((p) => p.payrollCompanyId === companyId && p.deletedAt !== null).sort((a, b) => (b.deletedAt as Date).getTime() - (a.deletedAt as Date).getTime()).map(copy),
      restorePeriod: async (companyId, id) => {
        const p = data.mealPeriods.find((x) => x.id === id && x.payrollCompanyId === companyId && x.deletedAt !== null);
        if (!p) return false;
        p.deletedAt = null;
        return true;
      },
      purgePeriod: async (companyId, id) => {
        const before = data.mealPeriods.length;
        data.mealPeriods = data.mealPeriods.filter((p) => !(p.id === id && p.payrollCompanyId === companyId && p.deletedAt !== null));
        return data.mealPeriods.length < before;
      },
      skippedDays: async (companyId, year, month) => {
        const m = data.attendanceMonths.find((x) => x.payrollCompanyId === companyId && x.year === year && x.month === month);
        const out = new Map<string, number[]>();
        if (!m) return out;
        for (const e of data.attendanceEntries.values()) if (e.monthId === m.id && e.skipsFood) out.set(e.employeeId, [...(out.get(e.employeeId) ?? []), e.day]);
        return out;
      },
      lockedThrough: async () => {
        const p = [...data.salaryProcessings].sort((a, b) => b.year - a.year || b.month - a.month)[0];
        return p ? { year: p.year, month: p.month } : null;
      },
    },

    letters: {
      get: async (companyId, kind) => copy(data.letters.find((l) => l.payrollCompanyId === companyId && l.kind === kind) ?? null),
      save: async (companyId, kind, fields) => {
        let l = data.letters.find((x) => x.payrollCompanyId === companyId && x.kind === kind);
        if (l) Object.assign(l, copy(fields), { updatedAt: new Date() });
        else {
          l = { ...copy(fields), id: randomUUID(), payrollCompanyId: companyId, kind, isActive: true, signatureImagePath: null, updatedAt: new Date() };
          data.letters.push(l);
        }
        return copy(l);
      },
      setActive: async (companyId, kind, active) => {
        const l = data.letters.find((x) => x.payrollCompanyId === companyId && x.kind === kind);
        if (!l) throw new RepoError("check", "letter not found");
        Object.assign(l, { isActive: active, updatedAt: new Date() });
        return copy(l);
      },
      remove: async (companyId, kind) => {
        const before = data.letters.length;
        data.letters = data.letters.filter((l) => !(l.payrollCompanyId === companyId && l.kind === kind));
        return data.letters.length < before;
      },
    },

    separations: {
      get: async (companyId, id, options) => {
        const x = data.separations.find((s) => s.id === id && s.payrollCompanyId === companyId);
        return x && (x.deletedAt !== null) === (options?.deleted === true) ? copy(x) : null;
      },
      list: async (companyId, q) => {
        const rows = data.separations
          .filter(
            (s) =>
              s.payrollCompanyId === companyId &&
              (s.deletedAt !== null) === (q.deleted === "only") &&
              matches(q.words, nameOf(s.employeeId), codeOf(s.employeeId), s.reason, s.separationType, String(s.entryNo)) &&
              (!q.lastDay || (s.lastWorkingDate >= q.lastDay.from && s.lastWorkingDate <= q.lastDay.to)),
          )
          .sort((a, b) => b.lastWorkingDate.localeCompare(a.lastWorkingDate) || b.entryNo - a.entryNo)
          .map((s) => ({ ...s, employeeName: nameOf(s.employeeId), designation: data.employees.find((e) => e.id === s.employeeId)?.designation ?? null }));
        return paged(rows, q);
      },
      counts: async (companyId, lastDay) => {
        const live = data.separations.filter((s) => s.payrollCompanyId === companyId && s.deletedAt === null && (!lastDay || (s.lastWorkingDate >= lastDay.from && s.lastWorkingDate <= lastDay.to)));
        const status = (x: SeparationStatus): number => live.filter((s) => s.status === x).length;
        return {
          inNotice: live.filter((s) => s.status !== "Relieved" && s.rejoinedAt === null).length,
          relieved: live.filter((s) => s.status === "Relieved" && s.rejoinedAt === null).length,
          rejoined: live.filter((s) => s.rejoinedAt !== null).length,
          all: live.length,
          byStatus: { Pending: status("Pending"), Accepted: status("Accepted"), Relieved: status("Relieved") },
        };
      },
      openFor: async (employeeId, except) => copy(data.separations.find((s) => s.employeeId === employeeId && s.deletedAt === null && s.rejoinedAt === null && s.id !== except) ?? null),
      lastDays: async (ids) => new Map(data.separations.filter((s) => ids.includes(s.employeeId) && s.deletedAt === null && s.rejoinedAt === null && s.status === "Relieved").map((s) => [s.employeeId, s.lastWorkingDate])),
      create: async (companyId, fields, by) => {
        const rec: SeparationRecord = { ...copy(fields), id: randomUUID(), payrollCompanyId: companyId, entryNo: nextNo(data.separations), rejoinedAt: null, createdBy: by, deletedAt: null, createdAt: new Date() };
        data.separations.push(rec);
        return copy(rec);
      },
      update: async (companyId, id, patch) => {
        const x = data.separations.find((s) => s.id === id && s.payrollCompanyId === companyId);
        if (!x) throw new RepoError("check", "separation not found");
        Object.assign(x, copy(patch));
        return copy(x);
      },
      softDelete: async (companyId, id) => {
        const x = data.separations.find((s) => s.id === id && s.payrollCompanyId === companyId && s.deletedAt === null);
        if (!x) return false;
        x.deletedAt = new Date();
        return true;
      },
      restore: async (companyId, id) => {
        const x = data.separations.find((s) => s.id === id && s.payrollCompanyId === companyId && s.deletedAt !== null);
        if (!x) return false;
        x.deletedAt = null;
        return true;
      },
      purge: async (companyId, id) => {
        const before = data.separations.length;
        data.separations = data.separations.filter((s) => !(s.id === id && s.payrollCompanyId === companyId && s.deletedAt !== null));
        return data.separations.length < before;
      },
    },

    payrollRun: {
      assignments: async (ids) =>
        data.employeeDeductions
          .filter((a) => ids.includes(a.employeeId))
          .map((a) => ({ id: a.id, employeeId: a.employeeId, deductionName: data.deductions.find((d) => d.id === a.deductionId)?.name ?? null, deductionType: a.deductionType, amountPaise: a.amountPaise, isSettled: a.isSettled })),
      setSettled: async (ids, settled) => {
        for (const a of data.employeeDeductions) if (ids.includes(a.id)) a.isSettled = settled;
      },
    },
  };
}
