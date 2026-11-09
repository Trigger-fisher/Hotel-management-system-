import "server-only";
import type { AttendanceLock, AttendanceRow, AttendanceSheet } from "@shared/dashboards/payrollCore";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { AttendanceCellWrite, AttendanceEntryRecord, AttendanceMonthRecord, AttendanceStatusRecord, PayrollCompanyRecord } from "../../repos/payrollCore";
import { phpRound } from "../../money/phpFloat";
import { istMoment } from "../cash/ist";
import { isAdmin, isSuperAdmin } from "../cash/rules";
import { companyOrFail, conflict, monthKey, monthLabel, notFound, PART, payrollKit, refuse, SALARY_NOT_READY, type PayrollDeps, type PayrollUnitRepos, type PayrollWrite } from "./context";
import { dtoStatus } from "./dto";
import type { AttendanceSaveBody } from "./schemas";
import { searchWords } from "../../validation/listQuery";

// Attendance (Pallav AttendanceController, Models/AttendanceMonth.php, SalaryProcessor::employeesWithIncompleteAttendance). The grid is read
// in ONE query per page of people; every count is an aggregate; a save is written as one batch. Salary generation itself is the SalaryRun
// port (task B6). Spec: docs/specs/payroll-core.md §5. Golden: the save's cell rule, progress and month completeness (fixtures/payroll-core.json).

const LOCKED = "This attendance month is locked. An Admin must unlock it before changes can be made.";
const incompleteMessage = (names: string[]): string =>
  `Salary Generation cannot be completed. Please complete attendance entries for all active employees before generating salary: ${names.join(", ")}.`;

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** AttendanceMonth::isComplete (:72-75): the month is over once its LAST day has begun (IST). */
export function isComplete(m: { year: number; month: number }, today: string): boolean {
  return today >= `${monthKey(m)}-${String(daysInMonth(m.year, m.month)).padStart(2, "0")}`;
}

/** AttendanceController::index (:39-41): days expected so far (the current month runs to today). */
export function daysExpected(m: { year: number; month: number }, today: string): number {
  const days = daysInMonth(m.year, m.month);
  return today.slice(0, 7) === monthKey(m) ? Math.min(days, Number(today.slice(8, 10))) : days;
}

/** PHP round() of filled / expected × 100, at most 100 (PayrollDashboardController :75); PHP 8.3's round, as Pallav's server. */
export function progressPercent(filled: number, expected: number): number {
  if (expected === 0) return 0;
  return Math.min(100, phpRound((filled / expected) * 100));
}

/**
 * The save's cell rule (:70-125), pure. Keys upper-cased and trimmed; any key that is not an ACTIVE status fails the whole save, each key once
 * in the order met; days outside the month skipped; no key and no overtime clears the day; else the status is COPIED onto the day.
 */
export function cells(
  rows: readonly { employeeId: string; days: readonly (string | null)[]; overtime: readonly (number | null)[] }[],
  statuses: readonly AttendanceStatusRecord[],
  days: number,
): { error: string } | { upsert: AttendanceCellWrite[]; clear: { employeeId: string; day: number }[] } {
  const byKey = new Map<string, AttendanceStatusRecord>();
  for (const s of statuses) if (s.isActive) byKey.set(s.shortcutKey.toUpperCase(), s);
  const unknown = new Set<string>();
  for (const r of rows) {
    for (const raw of r.days) {
      const key = (raw ?? "").trim().toUpperCase();
      if (key !== "" && !byKey.has(key)) unknown.add(key);
    }
  }
  if (unknown.size > 0) return { error: `Unknown attendance status shortcut key(s): ${[...unknown].join(", ")}. Only keys configured in Attendance Status Master are allowed.` };
  const upsert: AttendanceCellWrite[] = [];
  const clear: { employeeId: string; day: number }[] = [];
  for (const r of rows) {
    r.days.forEach((raw, i) => {
      const day = i + 1;
      if (day < 1 || day > days) return;
      const key = (raw ?? "").trim().toUpperCase();
      const status = key === "" ? null : byKey.get(key)!;
      const hours = r.overtime[i] ?? 0;
      if (status === null && hours <= 0) {
        clear.push({ employeeId: r.employeeId, day });
        return;
      }
      upsert.push({
        employeeId: r.employeeId,
        day,
        attendanceStatusId: status?.id ?? null,
        shortcutKey: status?.shortcutKey ?? null,
        attendancePercentage: status?.attendancePercentage ?? 0,
        overtimeHours: hours.toFixed(2),
        skipsFood: status?.skipsFood ?? false,
      });
    });
  }
  return { upsert, clear };
}

export function createAttendanceService(deps: PayrollDeps) {
  const { unit, catalog, now, salaryRun } = deps;
  const kit = payrollKit(deps);
  const today = (): string => istMoment(now()).date;
  const admin = (session: VerifiedSession): boolean => isSuperAdmin(session) || isAdmin(session, catalog);

  const parse = (month: string): { year: number; month: number } => ({ year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) });
  /** A month after the current one is the current one (:24-28). */
  function clamp(m: { year: number; month: number }): { year: number; month: number } {
    const t = today();
    return monthKey(m) > t.slice(0, 7) ? parse(t.slice(0, 7)) : m;
  }

  /** AttendanceMonth::revertStaleUnlock (:52-68): an admin unlock lives only in the session that made it. */
  async function revertStaleUnlock(repos: PayrollUnitRepos, m: AttendanceMonthRecord, sessionId: string): Promise<AttendanceMonthRecord> {
    const temporarilyUnlocked = !m.isLocked && m.salaryGeneratedAt !== null;
    if (!temporarilyUnlocked || m.unlockSessionId === null || m.unlockSessionId === sessionId) return m;
    return repos.attendance.updateMonth(m.id, { isLocked: true, unlockedBy: null, unlockedAt: null, unlockSessionId: null });
  }

  const lockOf = (m: AttendanceMonthRecord): AttendanceLock => (m.isLocked ? "locked" : m.salaryGeneratedAt !== null ? "unlocked" : "editable");

  async function sheet(repos: PayrollUnitRepos, company: PayrollCompanyRecord, m: AttendanceMonthRecord, q: { page: number; pageSize: number; search?: string }): Promise<AttendanceSheet> {
    const days = daysInMonth(m.year, m.month);
    const t = today();
    const people = await repos.employees.list(company.id, { words: searchWords(q.search), active: true, deleted: "no", sort: "name", page: q.page, pageSize: q.pageSize });
    // THE GRID: one query for the page's people
    const entries = await repos.attendance.entries(m.id, people.rows.map((p) => p.id));
    const byPerson = new Map<string, AttendanceEntryRecord[]>();
    for (const e of entries) byPerson.set(e.employeeId, [...(byPerson.get(e.employeeId) ?? []), e]);
    const statuses = await repos.attendanceStatuses.list(company.id, { activeOnly: true, order: "name" });
    const used = await repos.attendanceStatuses.usedCounts(company.id);
    const { active } = await repos.employees.counts(company.id);
    const rows: AttendanceRow[] = people.rows.map((p) => {
      const daysOf: (string | null)[] = Array.from({ length: days }, () => null);
      const keys: (string | null)[] = Array.from({ length: days }, () => null);
      const overtime: number[] = Array.from({ length: days }, () => 0);
      for (const e of byPerson.get(p.id) ?? []) {
        if (e.day < 1 || e.day > days) continue;
        daysOf[e.day - 1] = e.attendanceStatusId;
        keys[e.day - 1] = e.attendanceStatusId ? e.shortcutKey : null;
        overtime[e.day - 1] = Number(e.overtimeHours);
      }
      const total = overtime.reduce((a, b) => a + b, 0);
      return { employeeId: p.id, employeeName: p.name, employeeCode: p.employeeCode, designation: p.designation, days: daysOf, keys, overtime, overtimeHours: Math.round(total * 100) / 100 };
    });
    return {
      companyId: company.id,
      month: monthKey(m),
      daysInMonth: days,
      daysElapsed: daysExpected(m, t),
      monthOver: isComplete(m, t),
      lock: lockOf(m),
      salaryGeneratedAt: m.salaryGeneratedAt?.toISOString() ?? null,
      statuses: statuses.map((s) => dtoStatus(s, used.get(s.id) ?? 0)),
      rows,
      page: { total: people.total, page: q.page, pageSize: q.pageSize },
      progress: { filled: await repos.attendance.filledCount(m.id), expected: active * daysExpected(m, t), required: active * days },
      incomplete: await repos.attendance.incomplete(company.id, m.id, days),
    };
  }

  async function write<T>(session: VerifiedSession, companyId: string, meta: RequestMeta, work: (w: PayrollWrite) => Promise<T>): Promise<T> {
    const actor = await kit.actor(session);
    return unit.run(session, async (repos) => work({ repos, session, meta, actor, company: await companyOrFail(repos, companyId) }));
  }
  /** The month row of a write (locked for update); a month never opened (or still to come) is not found, as Pallav's route binding. */
  async function monthFor(w: PayrollWrite, month: string): Promise<AttendanceMonthRecord> {
    const m = parse(month);
    if (monthKey(m) > today().slice(0, 7)) throw notFound();
    const found = await w.repos.attendance.findMonth(w.company.id, m.year, m.month);
    if (!found) throw notFound();
    return w.repos.attendance.month(w.company.id, m.year, m.month, { forUpdate: true });
  }

  async function generateInUnit(w: PayrollWrite, m: AttendanceMonthRecord): Promise<AttendanceMonthRecord> {
    // SalaryProcessor::generate (:54-101): the pay rows (B6), then the month locked
    if (!salaryRun) throw new AppError("VALIDATION_FAILED", SALARY_NOT_READY, { fields: { reason: SALARY_NOT_READY } });
    await kit.guardMonth(w, m);
    await salaryRun.generate(w.repos, m, w.session.userId);
    const at = now();
    return w.repos.attendance.updateMonth(m.id, {
      isLocked: true,
      lockedAt: at,
      salaryGeneratedAt: at,
      salaryGeneratedBy: w.session.userId,
      generationCount: m.generationCount + 1,
      unlockedBy: null,
      unlockedAt: null,
      unlockSessionId: null,
    });
  }

  return {
    /** index (:19-55): the month (made on first open), the page of people by name, progress and who blocks salary. */
    async sheet(session: VerifiedSession, companyId: string, month: string, q: { page: number; pageSize: number; search?: string }): Promise<AttendanceSheet> {
      requirePermission(session, catalog, PART.attendance, "view");
      const m = clamp(parse(month));
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const row = await revertStaleUnlock(repos, await repos.attendance.month(companyId, m.year, m.month), session.sessionId);
        return sheet(repos, company, row, q);
      });
    },

    /** save (:58-128) */
    async save(session: VerifiedSession, companyId: string, month: string, input: AttendanceSaveBody, q: { page: number; pageSize: number }, meta: RequestMeta): Promise<AttendanceSheet> {
      requirePermission(session, catalog, PART.attendance, "edit");
      // the month row stays locked only for the write; the sheet sent back is read after the commit, so clerks saving the same month do not queue
      // behind each other's sheet rebuild
      const saved = await write(session, companyId, meta, async (w) => {
        const m = await revertStaleUnlock(w.repos, await monthFor(w, month), session.sessionId);
        if (await kit.locked(m.isLocked, "This attendance month is locked An Admin must", w)) throw conflict(LOCKED);
        // **HMS:** the rows must be this company's live staff (Pallav wrote whatever ids the form posted)
        const ids = [...new Set(input.rows.map((r) => r.employeeId))];
        if ((await w.repos.employees.ownIds(companyId, ids)).length !== ids.length) throw notFound();
        // "omit overtime to keep": the stored overtime of the rows sent, in the same one-query read as the grid
        const kept = new Map<string, number>();
        if (input.rows.some((r) => r.overtime === undefined)) {
          for (const e of await w.repos.attendance.entries(m.id, ids)) kept.set(`${e.employeeId}|${e.day}`, Number(e.overtimeHours));
        }
        const statuses = await w.repos.attendanceStatuses.list(companyId, { activeOnly: true, order: "name" });
        const days = daysInMonth(m.year, m.month);
        const result = cells(
          input.rows.map((r) => ({
            employeeId: r.employeeId,
            days: r.days,
            overtime: r.overtime ?? r.days.map((_, i) => kept.get(`${r.employeeId}|${i + 1}`) ?? 0),
          })),
          statuses,
          days,
        );
        if ("error" in result) throw new AppError("VALIDATION_FAILED", result.error, { fields: { days: result.error } });
        await w.repos.attendance.write(m.id, result);
        await kit.log(w, { action: "updated", entity: "Attendance", summary: `Attendance saved for ${monthLabel(m)}`, subject: { id: m.id, label: monthLabel(m) }, details: { Month: monthLabel(m), Action: "Attendance saved" } });
        return { m, company: w.company };
      });
      return unit.run(session, (repos) => sheet(repos, saved.company, saved.m, q));
    },

    /** generateSalary (:130-156) */
    async generate(session: VerifiedSession, companyId: string, month: string, q: { page: number; pageSize: number }, meta: RequestMeta): Promise<AttendanceSheet> {
      requirePermission(session, catalog, PART.attendance, "edit");
      return write(session, companyId, meta, async (w) => {
        let m = await revertStaleUnlock(w.repos, await monthFor(w, month), session.sessionId);
        if (await kit.locked(!isComplete(m, today()), "Salary can only be generated once the attendance", w)) throw conflict("Salary can only be generated once the attendance month is over.");
        if (await kit.locked(m.isLocked, "Salary has already been generated for this month", w)) throw conflict("Salary has already been generated for this month. An Admin must unlock attendance to re-generate.");
        const incomplete = await w.repos.attendance.incomplete(companyId, m.id, daysInMonth(m.year, m.month));
        if (await kit.locked(incomplete.length > 0, "Salary Generation cannot be completed Please complete attendance", w)) throw conflict(incompleteMessage(incomplete));
        m = await generateInUnit(w, m);
        await kit.log(w, { action: "updated", entity: "Attendance", summary: `Salary generated for ${monthLabel(m)}`, subject: { id: m.id, label: monthLabel(m) }, details: { Month: monthLabel(m), Action: "Salary generated and month locked" } });
        return sheet(w.repos, w.company, m, q);
      });
    },

    /** regenerateSalary (:158-178): Admins only; Pallav does not look at the lock here. */
    async regenerate(session: VerifiedSession, companyId: string, month: string, q: { page: number; pageSize: number }, meta: RequestMeta): Promise<AttendanceSheet> {
      requirePermission(session, catalog, PART.attendance, "edit");
      return write(session, companyId, meta, async (w) => {
        let m = await monthFor(w, month);
        if (await kit.locked(!admin(session), "Only Admin users can re-generate salary", w)) throw refuse("Only Admin users can re-generate salary.");
        const incomplete = await w.repos.attendance.incomplete(companyId, m.id, daysInMonth(m.year, m.month));
        if (await kit.locked(incomplete.length > 0, "Salary Generation cannot be completed Please complete attendance", w)) throw conflict(incompleteMessage(incomplete));
        m = await generateInUnit(w, m);
        await kit.log(w, { action: "updated", entity: "Attendance", summary: `Salary re-generated for ${monthLabel(m)}`, subject: { id: m.id, label: monthLabel(m) }, details: { Month: monthLabel(m), Action: "Salary re-generated" } });
        return sheet(w.repos, w.company, m, q);
      });
    },

    /** unlock (:180-202): Admins only, a locked month; the unlock belongs to THIS session. */
    async unlock(session: VerifiedSession, companyId: string, month: string, q: { page: number; pageSize: number }, meta: RequestMeta): Promise<AttendanceSheet> {
      requirePermission(session, catalog, PART.attendance, "edit");
      return write(session, companyId, meta, async (w) => {
        let m = await monthFor(w, month);
        if (await kit.locked(!admin(session), "Only Admin users can unlock attendance", w)) throw refuse("Only Admin users can unlock attendance.");
        if (await kit.locked(!m.isLocked, "This attendance month is not locked", w)) throw conflict("This attendance month is not locked.");
        await kit.guardMonth(w, m);
        m = await w.repos.attendance.updateMonth(m.id, { isLocked: false, unlockedBy: session.userId, unlockedAt: now(), unlockSessionId: session.sessionId });
        await kit.log(w, { action: "updated", entity: "Attendance", summary: `Attendance unlocked for ${monthLabel(m)}`, subject: { id: m.id, label: monthLabel(m) }, details: { Month: monthLabel(m), Action: "Attendance unlocked" } });
        return sheet(w.repos, w.company, m, q);
      });
    },
  };
}

export type AttendanceService = ReturnType<typeof createAttendanceService>;
