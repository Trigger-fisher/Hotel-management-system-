import "server-only";
import type { AdvanceList, BonusList, Advance, BonusEntry } from "@shared/dashboards/payrollPay";
import { canUseRecycleBin } from "../../auth/access";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { AdvanceFields, BonusFields, BonusRecord, PayrollAdvanceRecord, RecoveryType } from "../../repos/payrollPay";
import { istInstant, istMoment } from "../cash/ist";
import { isAdmin, isSuperAdmin } from "../cash/rules";
import { companyOrFail, conflict, notFound, payrollKit, refuse, type PayrollDeps, type PayrollUnitRepos, type PayrollWrite } from "../payrollCore/context";
import { Rules } from "../payrollCore/validate";
import { advanceDto, bonusDto, monthOfInstant, numberFormat } from "./dto";
import { hasWords, monthInstants, pageOf, sortRows, wordsOf, type SortDir } from "./listView";
import type { AdvanceBody, BonusBody } from "./schemas";

// Advances (Pallav PayrollAdvanceController, Models/PayrollAdvance.php) and bonuses / incentives (BonusIncentiveController): numbered entries,
// soft-deleted to the recycle bin, locked once the person's salary for that month is processed; changing or deleting one is for Admins. A page
// shows its locks from ONE read. Spec: docs/specs/payroll-pay.md §7-8.

const ADVANCE = "payroll.advance";
const BONUS = "payroll.bonus-incentive";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const n = paiseToNumber;

type AdvanceSort = "date" | "entryNo" | "employee" | "amount" | "recovery" | "recovered" | "outstanding";
type BonusSort = "date" | "entryNo" | "employee" | "amount" | "type";
type Named = { employeeName: string | null; employeeCode: string | null };
const person = (r: Named): string[] => [(r.employeeName ?? "").toLowerCase(), (r.employeeCode ?? "").toLowerCase()];
const ADVANCE_SORT: Record<AdvanceSort, (a: PayrollAdvanceRecord & Named) => string | number | bigint | readonly (string | number | bigint)[]> = {
  date: (a) => a.advanceDate.getTime(),
  entryNo: (a) => a.entryNo,
  employee: person,
  amount: (a) => a.amountPaise,
  // the "Recovery" column: the recovery type (Monthly before One Time), then the instalment
  recovery: (a) => [a.deductionType, a.deductionAmountPaise],
  recovered: (a) => a.recoveredAmountPaise,
  outstanding: (a) => (a.amountPaise > a.recoveredAmountPaise ? a.amountPaise - a.recoveredAmountPaise : BigInt(0)),
};
const BONUS_SORT: Record<BonusSort, (b: BonusRecord & Named) => string | number | bigint | readonly (string | number | bigint)[]> = {
  date: (b) => b.entryDate.getTime(),
  entryNo: (b) => b.entryNo,
  employee: person,
  amount: (b) => b.amountPaise,
  type: (b) => b.type,
};

export function createAdjustmentService(deps: PayrollDeps) {
  const { unit, catalog, people, now } = deps;
  const kit = payrollKit(deps);
  const admin = (session: VerifiedSession): boolean => isSuperAdmin(session) || isAdmin(session, catalog);
  const key = (employeeId: string, at: Date): string => {
    const m = monthOfInstant(at);
    return `${employeeId}|${m.year}|${m.month}`;
  };

  async function write<T>(session: VerifiedSession, companyId: string, meta: RequestMeta, work: (w: PayrollWrite) => Promise<T>): Promise<T> {
    const actor = await kit.actor(session);
    return unit.run(session, async (repos) => work({ repos, session, meta, actor, company: await companyOrFail(repos, companyId) }));
  }

  /** A date as typed: an ISO moment as is, a "YYYY-MM-DD" as the start of that IST day; null when it is not a date. */
  function parseDate(value: string | null): Date | null {
    if (value === null) return null;
    if (DAY.test(value)) {
      const d = istInstant(value, "00:00:00");
      return Number.isNaN(d.getTime()) || istMoment(d).date !== value ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** The person must be this company's (PayrollScope::belongsToCompany('employees')). */
  async function employeeOf(repos: PayrollUnitRepos, companyId: string, v: Rules, id: string): Promise<string | null> {
    if (v.required("employeeId", "employee id", id) === null) return null;
    if ((await repos.employees.ownIds(companyId, [id])).length === 0) {
      v.fail("employeeId", "The selected employee id is invalid.");
      return null;
    }
    return id;
  }

  const processed = (repos: PayrollUnitRepos, companyId: string, employeeId: string, at: Date): Promise<boolean> => {
    const m = monthOfInstant(at);
    return repos.salaryProcessings.processedFor(companyId, employeeId, m.year, m.month);
  };

  /* ---------------------------------------------------------- advances */

  /** rules() + messages() (:51-77); the date: left at today = the moment of the save (`_stamp_set`), a date of its own as typed. */
  async function advanceFields(w: PayrollWrite, input: AdvanceBody, existing: PayrollAdvanceRecord | null): Promise<AdvanceFields> {
    const v = new Rules();
    const employeeId = await employeeOf(w.repos, w.company.id, v, input.employeeId);
    const dateText = v.required("date", "advance date", input.date);
    let date = parseDate(dateText);
    if (dateText !== null && date === null) v.fail("date", "The advance date field must be a valid date.");
    const at = now();
    if (date && date > at && !(DAY.test(dateText!) && dateText === istMoment(at).date)) v.fail("date", "Advance date cannot be in the future.");
    if (input.amountPaise === null) v.fail("amountPaise", "The amount field is required.");
    else if (input.amountPaise <= 0) v.fail("amountPaise", "Advance amount must be greater than zero.");
    const type = v.oneOf("recoveryType", "deduction type", v.required("recoveryType", "deduction type", input.recoveryType), ["One Time", "Monthly"]) as RecoveryType | null;
    if (type === "Monthly") {
      if (input.instalmentPaise === null) v.fail("instalmentPaise", "The deduction amount field is required when deduction type is Monthly.");
      else if (input.instalmentPaise < 0) v.fail("instalmentPaise", "The deduction amount field must be at least 0.");
      else if (input.instalmentPaise <= 0) v.fail("instalmentPaise", "A monthly recovery needs an instalment greater than zero.");
    } else if (input.instalmentPaise !== null && input.instalmentPaise < 0) v.fail("instalmentPaise", "The deduction amount field must be at least 0.");
    v.done();
    // a date left at today is the moment of the save (new) or keeps its own seconds (an edit of the same day)
    if (DAY.test(dateText!)) {
      if (existing && istMoment(existing.advanceDate).date === dateText) date = existing.advanceDate;
      else if (!existing && dateText === istMoment(at).date) date = at;
    }
    const amount = BigInt(input.amountPaise!);
    return { employeeId: employeeId!, advanceDate: date!, amountPaise: amount, deductionType: type!, deductionAmountPaise: type === "One Time" ? amount : BigInt(input.instalmentPaise ?? 0), remarks: Rules.clean(input.remarks) };
  }

  async function advanceOut(w: Pick<PayrollWrite, "repos" | "session" | "company">, a: PayrollAdvanceRecord): Promise<Advance> {
    const emp = await w.repos.employees.get(w.company.id, a.employeeId);
    const name = emp?.name ?? null;
    const creator = a.createdBy ? ((await people.get([a.createdBy])).get(a.createdBy)?.name ?? "Removed user") : "System";
    return advanceDto({ ...a, employeeName: name, employeeCode: emp?.employeeCode ?? null }, { locked: await processed(w.repos, w.company.id, a.employeeId, a.advanceDate), admin: admin(w.session), createdBy: creator });
  }

  /** Admin, not a carry-forward, its month not processed (:109-141); each lock steps aside under ForceMode. */
  async function advanceLocks(w: PayrollWrite, a: PayrollAdvanceRecord, verb: "update" | "delete"): Promise<void> {
    const noun = verb === "update" ? "changed" : "deleted";
    if (await kit.locked(!admin(w.session), `Only Admin users can ${verb} advance records`, w)) throw refuse(`Only Admin users can ${verb} advance records.`);
    if (await kit.locked(a.isCarryForward, "Carry-forward advances are generated by Salary Processing and", w)) throw conflict(`Carry-forward advances are generated by Salary Processing and cannot be ${verb === "update" ? "edited" : "deleted"}.`);
    if (await kit.locked(await processed(w.repos, w.company.id, a.employeeId, a.advanceDate), "Salary Processing is already completed for this period,", w)) {
      throw conflict(`Salary Processing is already completed for this period, so this advance cannot be ${noun}.`);
    }
  }

  /* ---------------------------------------------------------- bonuses */

  async function bonusFields(w: PayrollWrite, input: BonusBody, isNew: boolean): Promise<BonusFields> {
    const v = new Rules();
    const employeeId = await employeeOf(w.repos, w.company.id, v, input.employeeId);
    const dateText = v.required("date", "entry date", input.date);
    const date = parseDate(dateText);
    const at = now();
    if (dateText !== null && date === null) v.fail("date", "The entry date field must be a valid date.");
    else if (date && date > at) v.fail("date", "Date cannot be in the future.");
    else if (date && isNew) {
      // currentMonthRule (:31-45): only the current month, never one closed out or one to come
      const m = monthOfInstant(date);
      const t = monthOfInstant(at);
      if (m.year !== t.year || m.month !== t.month) v.fail("date", `Bonus and incentive entries can only be dated in the current month (${MONTHS[t.month - 1]} ${t.year}).`);
    }
    const type = v.oneOf("type", "type", v.required("type", "type", input.type), ["Bonus", "Incentive"]) as "Bonus" | "Incentive" | null;
    if (input.amountPaise === null) v.fail("amountPaise", "The amount field is required.");
    else if (input.amountPaise <= 0) v.fail("amountPaise", "Amount must be greater than zero.");
    v.done();
    return { employeeId: employeeId!, entryDate: date!, type: type!, amountPaise: BigInt(input.amountPaise!), remarks: Rules.clean(input.remarks) };
  }

  async function bonusOut(w: Pick<PayrollWrite, "repos" | "session" | "company">, b: BonusRecord): Promise<BonusEntry> {
    const emp = await w.repos.employees.get(w.company.id, b.employeeId);
    const name = emp?.name ?? null;
    return bonusDto({ ...b, employeeName: name, employeeCode: emp?.employeeCode ?? null }, { locked: await processed(w.repos, w.company.id, b.employeeId, b.entryDate), admin: admin(w.session) });
  }

  async function bonusLocks(w: PayrollWrite, b: BonusRecord, verb: "update" | "delete"): Promise<void> {
    if (await kit.locked(!admin(w.session), `Only Admin users can ${verb} these records`, w)) throw refuse(`Only Admin users can ${verb} these records.`);
    if (await kit.locked(await processed(w.repos, w.company.id, b.employeeId, b.entryDate), "Salary Processing is already completed for this period,", w)) {
      throw conflict(`Salary Processing is already completed for this period, so this entry cannot be ${verb === "update" ? "changed" : "deleted"}.`);
    }
  }

  const iso = (d: Date): string => istMoment(d).date;

  return {
    /**
     * index (:13-49): latest first; a page's locks from ONE read. Period, search, status (or the old tab) and sort apply before paging; the four
     * figures and the counts cover the period (else every advance), whatever the page, search, status or sort (docs/BACKEND.md §7.6).
     */
    async listAdvances(
      session: VerifiedSession,
      companyId: string,
      q: { search?: string; period?: string; tab: "all" | "open" | "settled"; status?: "open" | "settled"; sort?: AdvanceSort; dir?: SortDir; deleted: boolean; page: number; pageSize: number },
    ): Promise<AdvanceList> {
      requirePermission(session, catalog, ADVANCE, "view");
      if (q.deleted && !canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can open the recycle bin.");
      const words = wordsOf(q.search);
      const range = q.period ? monthInstants(q.period) : undefined;
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        // the period's rows (live or bin); search, status and tab narrow the page only
        const all = await repos.payrollAdvances.list(companyId, { viewFrom: null, range, deleted: q.deleted ? "only" : "no", page: 1, pageSize: 100_000 });
        const keep = (a: (typeof all.rows)[number], s: "all" | "open" | "settled" | undefined): boolean => (s === "open" ? !a.isSettled : s === "settled" ? a.isSettled : true);
        const filtered = all.rows.filter((a) => hasWords(words, a.employeeName, a.employeeCode, a.remarks, String(a.entryNo)) && keep(a, q.tab) && keep(a, q.status));
        const sorted = sortRows(filtered, q.sort ? ADVANCE_SORT[q.sort] : undefined, q.dir);
        const rows = pageOf(sorted, q);
        const locks = await repos.salaryProcessings.processedKeys(companyId, rows.map((a) => ({ employeeId: a.employeeId, ...monthOfInstant(a.advanceDate) })));
        const creators = await people.get([...new Set(rows.flatMap((a) => (a.createdBy ? [a.createdBy] : [])))]);
        const s = await repos.payrollAdvances.summary(companyId, { viewFrom: null, range });
        const open = all.rows.filter((a) => !a.isSettled).length;
        return {
          page: { items: rows.map((a) => advanceDto(a, { locked: locks.has(key(a.employeeId, a.advanceDate)), admin: admin(session), createdBy: a.createdBy ? (creators.get(a.createdBy)?.name ?? "Removed user") : "System" })), total: filtered.length, page: q.page, pageSize: q.pageSize },
          summary: { issuedPaise: n(s.issuedPaise), recoveredPaise: n(s.recoveredPaise), outstandingPaise: n(s.outstandingPaise), open: s.open },
          counts: { all: all.total, open, settled: all.total - open },
        };
      });
    },

    /** One live advance as the list shows it (the voucher PDF's data). */
    async getAdvance(session: VerifiedSession, companyId: string, id: string): Promise<Advance> {
      requirePermission(session, catalog, ADVANCE, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const a = await repos.payrollAdvances.get(companyId, id);
        if (!a) throw notFound();
        const locks = await repos.salaryProcessings.processedKeys(companyId, [{ employeeId: a.employeeId, ...monthOfInstant(a.advanceDate) }]);
        const creator = a.createdBy ? (await people.get([a.createdBy])).get(a.createdBy) : undefined;
        const e = await repos.employees.get(companyId, a.employeeId);
        return advanceDto({ ...a, employeeName: e?.name ?? null, employeeCode: e?.employeeCode ?? null }, { locked: locks.has(key(a.employeeId, a.advanceDate)), admin: admin(session), createdBy: a.createdBy ? (creator?.name ?? "Removed user") : "System" });
      });
    },

    /** store (:79-96): numbered; One Time recovers the whole amount. */
    async createAdvance(session: VerifiedSession, companyId: string, input: AdvanceBody, meta: RequestMeta): Promise<Advance> {
      requirePermission(session, catalog, ADVANCE, "create");
      return write(session, companyId, meta, async (w) => {
        const fields = await advanceFields(w, input, null);
        await kit.guard(w, { was: null, now: iso(fields.advanceDate), action: "save" });
        const a = await w.repos.payrollAdvances.create(companyId, fields, session.userId);
        await kit.log(w, { action: "created", entity: "Advance", summary: `Advance of ₹${numberFormat(a.amountPaise)} recorded (${a.deductionType})`, subject: { id: a.id, label: `#${a.entryNo}` }, details: { Amount: numberFormat(a.amountPaise), Recovery: a.deductionType, Instalment: numberFormat(a.deductionAmountPaise) } });
        return advanceOut(w, a);
      });
    },

    /** update (:98-119) */
    async updateAdvance(session: VerifiedSession, companyId: string, id: string, input: AdvanceBody, meta: RequestMeta): Promise<Advance> {
      requirePermission(session, catalog, ADVANCE, "edit");
      return write(session, companyId, meta, async (w) => {
        const a = await w.repos.payrollAdvances.get(companyId, id, { forUpdate: true });
        if (!a) throw notFound();
        await advanceLocks(w, a, "update");
        const fields = await advanceFields(w, input, a);
        // a closed year's advance keeps being recovered ($booksPending) but is not otherwise changed
        await kit.guard(w, { was: iso(a.advanceDate), now: iso(fields.advanceDate), action: "save", pending: { onlyPendingChanged: false, actionDates: [] } });
        const saved = await w.repos.payrollAdvances.update(companyId, id, fields, session.userId);
        await kit.log(w, { action: "updated", entity: "Advance", summary: `Advance #${saved.entryNo} updated`, subject: { id, label: `#${saved.entryNo}` }, details: { Amount: numberFormat(saved.amountPaise), Recovery: saved.deductionType } });
        return advanceOut(w, saved);
      });
    },

    /** destroy (:121-139): to the recycle bin. */
    async deleteAdvance(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, ADVANCE, "full");
      return write(session, companyId, meta, async (w) => {
        const a = await w.repos.payrollAdvances.get(companyId, id, { forUpdate: true });
        if (!a) throw notFound();
        await advanceLocks(w, a, "delete");
        await kit.guard(w, { was: iso(a.advanceDate), now: null, action: "delete" });
        await w.repos.payrollAdvances.softDelete(companyId, id, session.userId);
        await kit.log(w, { action: "deleted", entity: "Advance", summary: `Advance #${a.entryNo} of ₹${numberFormat(a.amountPaise)} deleted`, subject: { id, label: `#${a.entryNo}` }, details: null });
        return { id };
      });
    },

    async restoreAdvance(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<Advance> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const a = await w.repos.payrollAdvances.get(companyId, id, { deleted: true, forUpdate: true });
        if (!a) throw notFound();
        await w.repos.payrollAdvances.restore(companyId, id);
        await kit.log(w, { action: "updated", entity: "Advance", summary: `Advance #${a.entryNo} restored`, subject: { id, label: `#${a.entryNo}` }, details: null });
        return advanceOut(w, { ...a, deletedAt: null, deletedBy: null });
      });
    },

    async purgeAdvance(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const a = await w.repos.payrollAdvances.get(companyId, id, { deleted: true, forUpdate: true });
        if (!a) throw notFound();
        await w.repos.payrollAdvances.purge(companyId, id);
        await kit.log(w, { action: "deleted", entity: "Advance", summary: `Advance #${a.entryNo} removed for good`, subject: { id, label: `#${a.entryNo}` }, details: null });
        return { id };
      });
    },

    /* ---------------------------------------------------------- bonuses */

    /** Latest first; period, search, status (the type, or the old tab) and sort apply before paging; the figures and counts cover the period (§7.6). */
    async listBonus(
      session: VerifiedSession,
      companyId: string,
      q: { search?: string; period?: string; tab: "all" | "Bonus" | "Incentive"; status?: "Bonus" | "Incentive"; sort?: BonusSort; dir?: SortDir; deleted: boolean; page: number; pageSize: number },
    ): Promise<BonusList> {
      requirePermission(session, catalog, BONUS, "view");
      if (q.deleted && !canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can open the recycle bin.");
      const words = wordsOf(q.search);
      const range = q.period ? monthInstants(q.period) : undefined;
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const all = await repos.bonuses.list(companyId, { viewFrom: null, range, deleted: q.deleted ? "only" : "no", page: 1, pageSize: 100_000 });
        const filtered = all.rows.filter((b) => hasWords(words, b.employeeName, b.employeeCode, b.remarks, b.type, String(b.entryNo)) && (q.tab === "all" || b.type === q.tab) && (!q.status || b.type === q.status));
        const rows = pageOf(sortRows(filtered, q.sort ? BONUS_SORT[q.sort] : undefined, q.dir), q);
        const locks = await repos.salaryProcessings.processedKeys(companyId, rows.map((b) => ({ employeeId: b.employeeId, ...monthOfInstant(b.entryDate) })));
        const s = await repos.bonuses.summary(companyId, { viewFrom: null, range });
        return {
          page: { items: rows.map((b) => bonusDto(b, { locked: locks.has(key(b.employeeId, b.entryDate)), admin: admin(session) })), total: filtered.length, page: q.page, pageSize: q.pageSize },
          summary: { bonusPaise: n(s.bonusPaise), incentivePaise: n(s.incentivePaise), people: s.people },
          counts: { all: all.total, Bonus: all.rows.filter((b) => b.type === "Bonus").length, Incentive: all.rows.filter((b) => b.type === "Incentive").length },
        };
      });
    },

    /** One bonus or incentive as the list shows it (the voucher PDF's data). */
    async getBonus(session: VerifiedSession, companyId: string, id: string): Promise<BonusEntry> {
      requirePermission(session, catalog, BONUS, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const b = await repos.bonuses.get(companyId, id);
        if (!b) throw notFound();
        const locks = await repos.salaryProcessings.processedKeys(companyId, [{ employeeId: b.employeeId, ...monthOfInstant(b.entryDate) }]);
        const e = await repos.employees.get(companyId, b.employeeId);
        return bonusDto({ ...b, employeeName: e?.name ?? null, employeeCode: e?.employeeCode ?? null }, { locked: locks.has(key(b.employeeId, b.entryDate)), admin: admin(session) });
      });
    },

    /** store (:85-104): only the current month, and not once its salary is generated. */
    async createBonus(session: VerifiedSession, companyId: string, input: BonusBody, meta: RequestMeta): Promise<BonusEntry> {
      requirePermission(session, catalog, BONUS, "create");
      return write(session, companyId, meta, async (w) => {
        const fields = await bonusFields(w, input, true);
        if (await kit.locked(await processed(w.repos, companyId, fields.employeeId, fields.entryDate), "Salary has already been generated for this month,", w)) {
          throw conflict("Salary has already been generated for this month, so no more bonus or incentive entries can be added to it.");
        }
        await kit.guard(w, { was: null, now: iso(fields.entryDate), action: "save" });
        const b = await w.repos.bonuses.create(companyId, fields, session.userId);
        await kit.log(w, { action: "created", entity: "Bonus / Incentive", summary: `${b.type} of ₹${numberFormat(b.amountPaise)} recorded`, subject: { id: b.id, label: `#${b.entryNo}` }, details: { Type: b.type, Amount: numberFormat(b.amountPaise) } });
        return bonusOut(w, b);
      });
    },

    /** update (:106-119) */
    async updateBonus(session: VerifiedSession, companyId: string, id: string, input: BonusBody, meta: RequestMeta): Promise<BonusEntry> {
      requirePermission(session, catalog, BONUS, "edit");
      return write(session, companyId, meta, async (w) => {
        const b = await w.repos.bonuses.get(companyId, id, { forUpdate: true });
        if (!b) throw notFound();
        await bonusLocks(w, b, "update");
        const fields = await bonusFields(w, input, false);
        await kit.guard(w, { was: iso(b.entryDate), now: iso(fields.entryDate), action: "save", pending: { onlyPendingChanged: false, actionDates: [] } });
        const saved = await w.repos.bonuses.update(companyId, id, fields, session.userId);
        await kit.log(w, { action: "updated", entity: "Bonus / Incentive", summary: `#${saved.entryNo} updated`, subject: { id, label: `#${saved.entryNo}` }, details: { Type: saved.type, Amount: numberFormat(saved.amountPaise) } });
        return bonusOut(w, saved);
      });
    },

    async deleteBonus(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, BONUS, "full");
      return write(session, companyId, meta, async (w) => {
        const b = await w.repos.bonuses.get(companyId, id, { forUpdate: true });
        if (!b) throw notFound();
        await bonusLocks(w, b, "delete");
        await kit.guard(w, { was: iso(b.entryDate), now: null, action: "delete" });
        await w.repos.bonuses.softDelete(companyId, id, session.userId);
        await kit.log(w, { action: "deleted", entity: "Bonus / Incentive", summary: `${b.type} of ₹${numberFormat(b.amountPaise)} deleted`, subject: { id, label: `#${b.entryNo}` }, details: null });
        return { id };
      });
    },

    async restoreBonus(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<BonusEntry> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const b = await w.repos.bonuses.get(companyId, id, { deleted: true, forUpdate: true });
        if (!b) throw notFound();
        await w.repos.bonuses.restore(companyId, id);
        await kit.log(w, { action: "updated", entity: "Bonus / Incentive", summary: `#${b.entryNo} restored`, subject: { id, label: `#${b.entryNo}` }, details: null });
        return bonusOut(w, { ...b, deletedAt: null, deletedBy: null });
      });
    },

    async purgeBonus(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const b = await w.repos.bonuses.get(companyId, id, { deleted: true, forUpdate: true });
        if (!b) throw notFound();
        await w.repos.bonuses.purge(companyId, id);
        await kit.log(w, { action: "deleted", entity: "Bonus / Incentive", summary: `#${b.entryNo} removed for good`, subject: { id, label: `#${b.entryNo}` }, details: null });
        return { id };
      });
    },
  };
}

export type AdjustmentService = ReturnType<typeof createAdjustmentService>;
