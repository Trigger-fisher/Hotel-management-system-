import "server-only";
import { newId } from "../../db/ids";
import type {
  AttendanceEntryRecord,
  AttendanceMonthRecord,
  AttendanceStatusRecord,
  DeductionRecord,
  EmployeeDeductionRecord,
  EmployeeListRow,
  EmployeeRecord,
  PayrollCompanyRecord,
  PayrollCoreRepos,
  PayrollLogEntry,
  PayrollMasterItemRecord,
  StaffEmailFilter,
  StaffEmailRecord,
} from "../payrollCore";
import { RepoError, type ListResult } from "../types";
import type { PayrollPayData } from "./payrollPay";

// The in-memory double of the payroll-core repositories (repos/payrollCore.ts), in the SAME per-hotel data as billing, the front office and
// companies. It keeps the table rules: everything scoped to its company, live-unique employee codes and emails per company, unique status keys
// and colours and deduction names per company (case-insensitive, as Pallav's collation is), one month row per company and month, one entry per
// (month, employee, day), soft delete for employees only, assignments and entries going with a hard-deleted parent. `payrollBlockers` stands in
// for the payroll-pay tables (advances, bonuses, salary processings, staff advances) until task B6 adds them.

export interface PayrollData {
  payrollCompanies: PayrollCompanyRecord[];
  employees: EmployeeRecord[];
  employeeDeductions: EmployeeDeductionRecord[];
  deductions: DeductionRecord[];
  attendanceStatuses: AttendanceStatusRecord[];
  attendanceMonths: AttendanceMonthRecord[];
  attendanceEntries: Map<string, AttendanceEntryRecord & { monthId: string }>;
  payrollMasterItems: PayrollMasterItemRecord[];
  staffEmails: StaffEmailRecord[];
  payrollLogs: (PayrollLogEntry & { id: string; createdAt: Date })[];
  joiningLetters: { payrollCompanyId: string; isActive: boolean }[];
  experienceLetters: { payrollCompanyId: string }[];
  /** employee id → what else still names them (Staff Advance Salaries, a front-office table), for tests. */
  payrollBlockers: Map<string, string>;
}

export const emptyPayrollData = (): PayrollData => ({
  payrollCompanies: [],
  employees: [],
  employeeDeductions: [],
  deductions: [],
  attendanceStatuses: [],
  attendanceMonths: [],
  attendanceEntries: new Map(),
  payrollMasterItems: [],
  staffEmails: [],
  payrollLogs: [],
  joiningLetters: [],
  experienceLetters: [],
  payrollBlockers: new Map(),
});

const FIXED_CODES = ["HP01", "PF01"];
const copy = <T>(r: T): T => structuredClone(r);
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();
const hasEvery = (hay: string, words: readonly string[] | undefined): boolean => !words || words.every((w) => hay.includes(w.toLowerCase()));
const paged = <T>(rows: T[], p: { page: number; pageSize: number }): ListResult<T> => ({ rows: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(copy), total: rows.length });
const newestFirst = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): number => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
const cellKey = (monthId: string, employeeId: string, day: number): string => `${monthId}|${employeeId}|${day}`;

export function bindPayrollCore(data: PayrollData & Partial<PayrollPayData>): PayrollCoreRepos {
  const company = (id: string) => data.payrollCompanies.find((c) => c.id === id);
  const live = (companyId: string) => data.employees.filter((e) => e.payrollCompanyId === companyId && e.deletedAt === null);
  const employeeOf = (companyId: string, id: string) => data.employees.find((e) => e.id === id && e.payrollCompanyId === companyId);
  const listRow = (e: EmployeeRecord): EmployeeListRow => copy(e);
  const counts = (companyId: string) => {
    const staff = live(companyId);
    return { all: staff.length, active: staff.filter((e) => e.isActive).length };
  };
  const companyRow = (c: PayrollCompanyRecord) => {
    const n = counts(c.id);
    return { ...copy(c), staffCount: n.all, activeStaffCount: n.active };
  };
  const employeeText = (e: EmployeeRecord): string => lower([e.name, e.employeeCode, e.designation, e.department, e.email, e.contactNumber].join(" "));
  const entriesOfMonth = (monthId: string) => [...data.attendanceEntries.values()].filter((x) => x.monthId === monthId);
  const status = (companyId: string, id: string) => data.attendanceStatuses.find((s) => s.id === id && s.payrollCompanyId === companyId);
  const deduction = (companyId: string, id: string) => data.deductions.find((d) => d.id === id && d.payrollCompanyId === companyId);
  const emailMatches = (r: StaffEmailRecord, q: StaffEmailFilter & { staleBefore: Date }): boolean => {
    if (!hasEvery(lower([r.employeeName, r.employeeCode, r.recipientName, r.recipientEmail, r.sentByName].join(" ")), q.words)) return false;
    const stale = r.status === "sending" && r.createdAt < q.staleBefore;
    if (q.status === "sent" && r.status !== "sent") return false;
    if (q.status === "sending" && !(r.status === "sending" && !stale)) return false;
    if (q.status === "failed" && !(r.status === "failed" || stale)) return false;
    // whereDate(created_at) in the app's time zone (IST)
    const day = new Date(r.createdAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    if (q.from && day < q.from) return false;
    if (q.to && day > q.to) return false;
    return true;
  };

  return {
    payrollCompanies: {
      get: async (id) => {
        const c = company(id);
        return c ? copy(c) : null;
      },
      list: async (q) =>
        data.payrollCompanies
          .filter((c) => (q.active === undefined || c.isActive === q.active) && hasEvery(lower([c.name, c.code, c.ownerName].join(" ")), q.words))
          .sort((a, b) => {
            const ia = FIXED_CODES.indexOf(a.code);
            const ib = FIXED_CODES.indexOf(b.code);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || byName(a, b);
          })
          .map(companyRow),
      row: async (id) => {
        const c = company(id);
        return c ? companyRow(c) : null;
      },
      update: async (id, patch, by) => {
        const c = company(id);
        if (!c) throw new RepoError("check", "payroll company not found");
        Object.assign(c, patch, { updatedBy: by, updatedAt: new Date() });
        return copy(c);
      },
    },

    employees: {
      get: async (companyId, id, options) => {
        const e = employeeOf(companyId, id);
        return e && (e.deletedAt !== null) === (options?.deleted === true) ? copy(e) : null;
      },
      ownIds: async (companyId, ids) => live(companyId).filter((e) => ids.includes(e.id)).map((e) => e.id),
      getMany: async (companyId, ids) => live(companyId).filter((e) => ids.includes(e.id)).map(copy),
      list: async (companyId, q) => {
        const rows = data.employees.filter(
          (e) => e.payrollCompanyId === companyId && (q.deleted === "only") === (e.deletedAt !== null) && (q.active === undefined || e.isActive === q.active) && hasEvery(employeeText(e), q.words),
        );
        rows.sort(
          q.sort === "name"
            ? (a, b) => byName(a, b) || (a.id < b.id ? -1 : 1)
            : q.sort === "active"
              ? (a, b) => Number(b.isActive) - Number(a.isActive) || byName(a, b) || (a.id < b.id ? -1 : 1)
              : q.sort === "updated"
              ? (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1)
              : (a, b) => (a.joiningDate === b.joiningDate ? (a.id < b.id ? 1 : -1) : a.joiningDate < b.joiningDate ? 1 : -1),
        );
        const page = paged(rows, q);
        return { rows: page.rows.map(listRow), total: page.total };
      },
      lookup: async (companyId, q) => {
        const p = q.prefix.toLowerCase();
        return live(companyId)
          .filter((e) => (q.active === undefined || e.isActive === q.active) && (e.name.toLowerCase().startsWith(p) || e.employeeCode.toLowerCase().startsWith(p)))
          .sort((a, b) => Number(b.isActive) - Number(a.isActive) || byName(a, b))
          .slice(0, q.limit)
          .map(listRow);
      },
      codeTaken: async (companyId, code, except) => live(companyId).some((e) => e.id !== except && e.employeeCode.toLowerCase() === code.toLowerCase()),
      emailTaken: async (companyId, email, except) => live(companyId).some((e) => e.id !== except && e.email.toLowerCase() === email.toLowerCase()),
      counts: async (companyId) => counts(companyId),
      blockingDependency: async (id, opts) => {
        // Employee::blockingDependency in Pallav's order (a soft-deleted advance or bonus still names the person: the foreign key does)
        if ([...data.attendanceEntries.values()].some((x) => x.employeeId === id)) return "Attendance Management";
        if (data.payrollAdvances?.some((x) => x.employeeId === id)) return "Advance Management";
        if (data.bonuses?.some((x) => x.employeeId === id)) return "Bonus & Incentive Management";
        if (data.salaryProcessings?.some((x) => x.employeeId === id)) return "Salary Processing";
        const other = data.payrollBlockers.get(id);
        if (other) return other;
        // removal for good only: separations and meal periods point at the person ON DELETE RESTRICT, deleted rows included
        if (opts?.purge && data.separations?.some((x) => x.employeeId === id)) return "Separation Management";
        if (opts?.purge && data.mealPeriods?.some((x) => x.employeeId === id)) return "Meals Management";
        return null;
      },
      create: async (companyId, fields, by) => {
        if (live(companyId).some((e) => e.employeeCode.toLowerCase() === fields.employeeCode.toLowerCase())) throw new RepoError("unique", "employees_payroll_company_id_employee_code_key");
        const now = new Date();
        const row: EmployeeRecord = { ...copy(fields), id: newId(), payrollCompanyId: companyId, isActive: true, createdBy: by, updatedBy: by, deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now };
        data.employees.push(row);
        return copy(row);
      },
      update: async (companyId, id, patch, by) => {
        const e = employeeOf(companyId, id);
        if (!e || e.deletedAt) throw new RepoError("check", "employee not found");
        if (patch.employeeCode && live(companyId).some((x) => x.id !== id && x.employeeCode.toLowerCase() === patch.employeeCode!.toLowerCase())) throw new RepoError("unique", "employees_payroll_company_id_employee_code_key");
        Object.assign(e, copy(patch), { updatedBy: by, updatedAt: new Date() });
        return copy(e);
      },
      setActive: async (companyId, id, active, by) => {
        const e = employeeOf(companyId, id);
        if (!e || e.deletedAt) throw new RepoError("check", "employee not found");
        Object.assign(e, { isActive: active, updatedBy: by, updatedAt: new Date() });
        return copy(e);
      },
      softDelete: async (companyId, id, by) => {
        const e = employeeOf(companyId, id);
        if (!e || e.deletedAt) return false;
        Object.assign(e, { deletedAt: new Date(), deletedBy: by });
        return true;
      },
      restore: async (companyId, id) => {
        const e = employeeOf(companyId, id);
        if (!e || !e.deletedAt) return false;
        if (live(companyId).some((x) => x.employeeCode.toLowerCase() === e.employeeCode.toLowerCase())) throw new RepoError("unique", "employees_payroll_company_id_employee_code_key");
        Object.assign(e, { deletedAt: null, deletedBy: null });
        return true;
      },
      purge: async (companyId, id) => {
        const e = employeeOf(companyId, id);
        if (!e || !e.deletedAt) return false;
        // ON DELETE RESTRICT (advances, bonuses, separations, meal periods; deleted rows included), as the database refuses
        if ([data.payrollAdvances, data.bonuses, data.separations, data.mealPeriods].some((rows) => rows?.some((x) => x.employeeId === id))) throw new RepoError("check", "employee is still referenced");
        data.employees = data.employees.filter((x) => x.id !== id);
        // ON DELETE CASCADE (assignments, entries) and SET NULL (staff emails)
        data.employeeDeductions = data.employeeDeductions.filter((x) => x.employeeId !== id);
        for (const [k, v] of data.attendanceEntries) if (v.employeeId === id) data.attendanceEntries.delete(k);
        for (const m of data.staffEmails) if (m.employeeId === id) m.employeeId = null;
        return true;
      },
    },

    employeeDeductions: {
      forEmployees: async (ids) => data.employeeDeductions.filter((x) => ids.includes(x.employeeId)).map(copy),
      sync: async (employeeId, rows) => {
        const kept = new Set(rows.map((r) => r.id).filter((x): x is string => Boolean(x)));
        data.employeeDeductions = data.employeeDeductions.filter((x) => x.employeeId !== employeeId || kept.has(x.id));
        for (const r of rows) {
          const own = r.id ? data.employeeDeductions.find((x) => x.id === r.id && x.employeeId === employeeId) : undefined;
          if (own) Object.assign(own, { deductionId: r.deductionId, deductionType: r.deductionType, amountPaise: r.amountPaise });
          else data.employeeDeductions.push({ id: newId(), employeeId, deductionId: r.deductionId, deductionType: r.deductionType, amountPaise: r.amountPaise, isSettled: false });
        }
      },
    },

    deductions: {
      get: async (companyId, id) => {
        const d = deduction(companyId, id);
        return d ? copy(d) : null;
      },
      list: async (companyId, q) =>
        data.deductions
          .filter((d) => d.payrollCompanyId === companyId && (!q?.activeOnly || d.isActive))
          .sort(newestFirst)
          .map((d) => ({ ...copy(d), assignedCount: data.employeeDeductions.filter((x) => x.deductionId === d.id).length })),
      ownIds: async (companyId, ids) => data.deductions.filter((d) => d.payrollCompanyId === companyId && ids.includes(d.id)).map((d) => d.id),
      nameTaken: async (companyId, name, except) => data.deductions.some((d) => d.payrollCompanyId === companyId && d.id !== except && d.name.toLowerCase() === name.toLowerCase()),
      isAssigned: async (id) => data.employeeDeductions.some((x) => x.deductionId === id),
      any: async (companyId) => data.deductions.some((d) => d.payrollCompanyId === companyId),
      create: async (companyId, fields) => {
        if (data.deductions.some((d) => d.payrollCompanyId === companyId && d.name.toLowerCase() === fields.name.toLowerCase())) throw new RepoError("unique", "deductions_payroll_company_id_name_key");
        const row: DeductionRecord = { id: newId(), payrollCompanyId: companyId, name: fields.name, amountPaise: fields.amountPaise, isActive: true, createdAt: new Date() };
        data.deductions.push(row);
        return copy(row);
      },
      update: async (companyId, id, patch) => {
        const d = deduction(companyId, id);
        if (!d) throw new RepoError("check", "deduction not found");
        Object.assign(d, patch);
        return copy(d);
      },
      remove: async (companyId, id) => {
        if (!deduction(companyId, id)) return false;
        data.deductions = data.deductions.filter((d) => d.id !== id);
        data.employeeDeductions = data.employeeDeductions.filter((x) => x.deductionId !== id);
        return true;
      },
    },

    attendanceStatuses: {
      get: async (companyId, id) => {
        const s = status(companyId, id);
        return s ? copy(s) : null;
      },
      list: async (companyId, q) =>
        data.attendanceStatuses
          .filter((s) => s.payrollCompanyId === companyId && (!q.activeOnly || s.isActive))
          .sort(q.order === "name" ? byName : newestFirst)
          .map(copy),
      usedCounts: async (companyId) => {
        const mine = new Set(data.attendanceStatuses.filter((s) => s.payrollCompanyId === companyId).map((s) => s.id));
        const out = new Map<string, number>();
        for (const x of data.attendanceEntries.values()) if (x.attendanceStatusId && mine.has(x.attendanceStatusId)) out.set(x.attendanceStatusId, (out.get(x.attendanceStatusId) ?? 0) + 1);
        return out;
      },
      shortcutTaken: async (companyId, key, except) => data.attendanceStatuses.some((s) => s.payrollCompanyId === companyId && s.id !== except && s.shortcutKey.toLowerCase() === key.toLowerCase()),
      colorTaken: async (companyId, color, except) => data.attendanceStatuses.some((s) => s.payrollCompanyId === companyId && s.id !== except && s.color.toLowerCase() === color.toLowerCase()),
      isUsed: async (id) => [...data.attendanceEntries.values()].some((x) => x.attendanceStatusId === id),
      create: async (companyId, fields) => {
        const row: AttendanceStatusRecord = { ...fields, id: newId(), payrollCompanyId: companyId, isActive: true, createdAt: new Date() };
        data.attendanceStatuses.push(row);
        return copy(row);
      },
      update: async (companyId, id, patch) => {
        const s = status(companyId, id);
        if (!s) throw new RepoError("check", "status not found");
        Object.assign(s, patch);
        return copy(s);
      },
      remove: async (companyId, id) => {
        if (!status(companyId, id)) return false;
        data.attendanceStatuses = data.attendanceStatuses.filter((s) => s.id !== id);
        // ON DELETE SET NULL on attendance_entries.attendance_status_id
        for (const x of data.attendanceEntries.values()) if (x.attendanceStatusId === id) x.attendanceStatusId = null;
        return true;
      },
    },

    attendance: {
      month: async (companyId, year, month) => {
        let m = data.attendanceMonths.find((x) => x.payrollCompanyId === companyId && x.year === year && x.month === month);
        if (!m) {
          m = { id: newId(), payrollCompanyId: companyId, year, month, isLocked: false, lockedAt: null, salaryGeneratedAt: null, salaryGeneratedBy: null, generationCount: 0, unlockedBy: null, unlockedAt: null, unlockSessionId: null };
          data.attendanceMonths.push(m);
        }
        return copy(m);
      },
      findMonth: async (companyId, year, month) => {
        const m = data.attendanceMonths.find((x) => x.payrollCompanyId === companyId && x.year === year && x.month === month);
        return m ? copy(m) : null;
      },
      updateMonth: async (id, patch) => {
        const m = data.attendanceMonths.find((x) => x.id === id);
        if (!m) throw new RepoError("check", "month not found");
        Object.assign(m, patch);
        return copy(m);
      },
      entries: async (monthId, employeeIds) => {
        const wanted = new Set(employeeIds);
        return entriesOfMonth(monthId)
          .filter((x) => wanted.has(x.employeeId))
          .map(({ monthId: _m, ...x }) => {
            void _m;
            return copy(x);
          });
      },
      filledCount: async (monthId) => entriesOfMonth(monthId).filter((x) => x.attendanceStatusId !== null).length,
      incomplete: async (companyId, monthId, daysInMonth) => {
        const filled = new Map<string, number>();
        for (const x of entriesOfMonth(monthId)) if (x.attendanceStatusId !== null) filled.set(x.employeeId, (filled.get(x.employeeId) ?? 0) + 1);
        return live(companyId)
          .filter((e) => e.isActive)
          .sort(byName)
          .filter((e) => (filled.get(e.id) ?? 0) < daysInMonth)
          .map((e) => e.name);
      },
      write: async (monthId, cells) => {
        for (const c of cells.clear) data.attendanceEntries.delete(cellKey(monthId, c.employeeId, c.day));
        for (const c of cells.upsert) {
          if (c.day < 1 || c.day > 31) throw new RepoError("check", "attendance_entries.day");
          data.attendanceEntries.set(cellKey(monthId, c.employeeId, c.day), { ...copy(c), monthId });
        }
      },
      followSkipsFood: async (statusId, skipsFood) => {
        const open = new Set(data.attendanceMonths.filter((m) => !m.isLocked).map((m) => m.id));
        let n = 0;
        for (const x of data.attendanceEntries.values()) {
          if (x.attendanceStatusId === statusId && open.has(x.monthId)) {
            x.skipsFood = skipsFood;
            n += 1;
          }
        }
        return n;
      },
    },

    payrollMasters: {
      active: async (list, companyId) => activeItems([list], companyId),
      activeMany: async (lists, companyId) => activeItems(lists, companyId),
    },

    staffEmails: {
      get: async (id) => {
        const r = data.staffEmails.find((x) => x.id === id);
        return r ? copy(r) : null;
      },
      list: async (companyId, q) => paged(data.staffEmails.filter((r) => r.payrollCompanyId === companyId && emailMatches(r, q)).sort(newestFirst), q),
      feed: async (companyId, q) => {
        const mine = data.staffEmails.filter((r) => r.payrollCompanyId === companyId);
        const fresh = mine
          .filter((r) => (q.after === null || r.createdAt > q.after) && emailMatches(r, q))
          .sort(newestFirst)
          .slice(0, 50);
        const watched = mine.filter((r) => q.watch.slice(0, 200).includes(r.id));
        const all = new Map([...fresh, ...watched].map((r) => [r.id, r]));
        return [...all.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).map(copy);
      },
      stats: async (companyId, q) => {
        const mine = data.staffEmails.filter((r) => r.payrollCompanyId === companyId);
        return {
          total: mine.length,
          sent: mine.filter((r) => r.status === "sent").length,
          failed: mine.filter((r) => r.status !== "sent" && (r.status === "failed" || r.createdAt < q.staleBefore)).length,
          today: mine.filter((r) => r.createdAt >= q.todayFrom && r.createdAt <= q.todayTo).length,
        };
      },
      open: async (companyId, row) => {
        const rec: StaffEmailRecord = { ...copy(row), payrollCompanyId: companyId, id: newId(), status: "sending", message: null, error: null, durationMs: null, attachmentBytes: null, finishedAt: null };
        data.staffEmails.push(rec);
        return copy(rec);
      },
      finish: async (id, result) => {
        const r = data.staffEmails.find((x) => x.id === id);
        if (!r) throw new RepoError("check", "staff email not found");
        Object.assign(r, { ...result, message: result.message.slice(0, 500), finishedAt: new Date() });
        return copy(r);
      },
    },

    payrollLog: {
      record: async (entry) => void data.payrollLogs.push({ ...copy(entry), id: newId(), createdAt: new Date() }),
    },

    payrollSetup: {
      setup: async (companyId) => ({
        hasActiveStatus: data.attendanceStatuses.some((s) => s.payrollCompanyId === companyId && s.isActive),
        hasActiveStaff: live(companyId).some((e) => e.isActive),
        hasDeduction: data.deductions.some((d) => d.payrollCompanyId === companyId),
        hasJoiningLetter: data.joiningLetters.some((j) => j.payrollCompanyId === companyId) || Boolean(data.letters?.some((l) => l.payrollCompanyId === companyId && l.kind === "joining")),
        hasExperienceLetter: data.experienceLetters.some((j) => j.payrollCompanyId === companyId) || Boolean(data.letters?.some((l) => l.payrollCompanyId === companyId && l.kind === "experience")),
      }),
      joiningTemplateActive: async (companyId) =>
        data.joiningLetters.some((j) => j.payrollCompanyId === companyId && j.isActive) || Boolean(data.letters?.some((l) => l.payrollCompanyId === companyId && l.kind === "joining" && l.isActive)),
    },
  };

  function activeItems(lists: readonly string[], companyId: string): PayrollMasterItemRecord[] {
    return data.payrollMasterItems
      .filter((i) => lists.includes(i.list) && i.isActive && (i.payrollCompanyId === null || i.payrollCompanyId === companyId))
      .sort((a, b) => Number(a.payrollCompanyId !== null) - Number(b.payrollCompanyId !== null) || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
      .map(copy);
  }
}
