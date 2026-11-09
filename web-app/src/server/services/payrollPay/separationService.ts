import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { Separation, SeparationStatus, SeparationSummary } from "@shared/dashboards/payrollPay";
import { canUseRecycleBin } from "../../auth/access";
import { canWriteAnything, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { EmployeeFields } from "../../repos/payrollCore";
import type { SeparationFields, SeparationRecord } from "../../repos/payrollPay";
import { isAdmin, isSuperAdmin } from "../cash/rules";
import { companyOrFail, conflict, notFound, payrollKit, refuse, type PayrollDeps, type PayrollUnitRepos, type PayrollWrite } from "../payrollCore/context";
import { BANK_MODE, choices } from "../payrollCore/masters";
import * as phone from "../payrollCore/phone";
import { Rules } from "../payrollCore/validate";
import { longDate } from "./dates";
import { monthDays, pageOf, sortRows, wordsOf, type SortDir } from "./listView";
import type { RejoinBody, SeparationBody } from "./schemas";

// Resignations (Pallav SeparationController, Models/EmployeeSeparation.php): numbered, soft-deleted; a Relieved person drops out of attendance and
// payroll (inactive); rejoining takes them back with their payroll history intact. Spec: docs/specs/payroll-pay.md §13.

const PART = "payroll.separation";
const STATUSES: readonly SeparationStatus[] = ["Pending", "Accepted", "Relieved"];

type SeparationSort = "lastWorkingDate" | "resignationDate" | "employee" | "entryNo" | "status" | "type";
type Listed = SeparationRecord & { employeeName: string | null; designation: string | null };
const SEPARATION_SORT: Record<SeparationSort, (s: Listed) => string | number> = {
  lastWorkingDate: (s) => s.lastWorkingDate,
  resignationDate: (s) => s.resignationDate,
  employee: (s) => (s.employeeName ?? "").toLowerCase(),
  entryNo: (s) => s.entryNo,
  status: (s) => s.status,
  type: (s) => s.separationType.toLowerCase(),
};

export function createSeparationService(deps: PayrollDeps) {
  const { unit, catalog, people } = deps;
  const kit = payrollKit(deps);
  const admin = (session: VerifiedSession): boolean => isSuperAdmin(session) || isAdmin(session, catalog);
  /** PayrollRules::canEdit: can write, and an Admin, the SuperAdmin or whoever recorded it. */
  const canEdit = (session: VerifiedSession, s: { createdBy: string | null }): boolean => canWriteAnything(session) && (admin(session) || (s.createdBy !== null && s.createdBy === session.userId));

  async function write<T>(session: VerifiedSession, companyId: string, meta: RequestMeta, work: (w: PayrollWrite) => Promise<T>): Promise<T> {
    const actor = await kit.actor(session);
    return unit.run(session, async (repos) => work({ repos, session, meta, actor, company: await companyOrFail(repos, companyId) }));
  }

  async function dtos(session: VerifiedSession, rows: readonly (SeparationRecord & { employeeName?: string | null; designation?: string | null })[]): Promise<(Separation & { canEdit: boolean; canDelete: boolean })[]> {
    const names = await people.get([...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))]);
    return rows.map((s) => ({
      id: s.id,
      entryNo: String(s.entryNo),
      companyId: s.payrollCompanyId,
      employeeId: s.employeeId,
      employeeName: s.employeeName ?? "Removed employee",
      designation: s.designation ?? "",
      type: s.separationType,
      resignationDate: s.resignationDate,
      lastWorkingDate: s.lastWorkingDate,
      reason: s.reason,
      remarks: s.remarks ?? "",
      status: s.status,
      documentName: s.documentPath ? (s.documentPath.split("/").pop() ?? null) : null,
      rejoinedOn: s.rejoinedAt,
      createdBy: s.createdBy ? (names.get(s.createdBy)?.name ?? "Removed user") : "System",
      canEdit: canEdit(session, s),
      canDelete: admin(session),
    }));
  }

  async function out(w: PayrollWrite, s: SeparationRecord): Promise<Separation & { canEdit: boolean; canDelete: boolean }> {
    const e = await w.repos.employees.get(w.company.id, s.employeeId);
    return (await dtos(w.session, [{ ...s, employeeName: e?.name ?? null, designation: e?.designation ?? null }]))[0];
  }

  /** rules() + messages() (:36-55) */
  async function validated(repos: PayrollUnitRepos, companyId: string, input: SeparationBody, keepEmployee: string | null): Promise<SeparationFields> {
    const v = new Rules();
    let employeeId = keepEmployee;
    if (employeeId === null) {
      const id = v.required("employeeId", "employee id", input.employeeId);
      if (id !== null) {
        if ((await repos.employees.ownIds(companyId, [id])).length === 0) v.fail("employeeId", "The selected employee id is invalid.");
        else employeeId = id;
      }
    }
    const type = v.oneOf("type", "separation type", v.required("type", "separation type", input.type), await choices(repos, "separation_type", companyId));
    const resignation = v.date("resignationDate", "resignation date", v.required("resignationDate", "resignation date", input.resignationDate));
    const last = v.date("lastWorkingDate", "last working date", v.required("lastWorkingDate", "last working date", input.lastWorkingDate));
    if (resignation && last && !v.has("lastWorkingDate") && last < resignation) v.fail("lastWorkingDate", "The last working day cannot be before the resignation date.");
    const reason = v.required("reason", "reason", input.reason);
    const status = v.oneOf("status", "status", v.required("status", "status", input.status), STATUSES) as SeparationStatus | null;
    v.done();
    // the acceptance document is uploaded with the media store (a later task); a name sent now is not kept
    return { employeeId: employeeId!, separationType: type!, resignationDate: resignation!, lastWorkingDate: last!, reason: reason!, remarks: Rules.clean(input.remarks), status: status!, documentPath: null };
  }

  return {
    /**
     * index (:13-30): most recent leaver first. Period (by last working day), search, status, the old tab and sort apply before paging; the
     * summary covers the period's live records (else every one), whatever the page, search, status, tab or sort (docs/BACKEND.md §7.6).
     */
    async list(
      session: VerifiedSession,
      companyId: string,
      q: { search?: string; period?: string; tab: "all" | "notice" | "relieved" | "rejoined"; status?: SeparationStatus; sort?: SeparationSort; dir?: SortDir; deleted: boolean; page: number; pageSize: number },
    ): Promise<{ page: Page<Separation & { canEdit: boolean; canDelete: boolean }>; summary: SeparationSummary & { byStatus: Record<SeparationStatus, number> } }> {
      requirePermission(session, catalog, PART, "view");
      if (q.deleted && !canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can open the recycle bin.");
      const words = wordsOf(q.search);
      const lastDay = q.period ? monthDays(q.period) : undefined;
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const all = await repos.separations.list(companyId, { words, lastDay, deleted: q.deleted ? "only" : "no", page: 1, pageSize: 100_000 });
        const tabbed = all.rows.filter(
          (x) =>
            (q.tab === "notice" ? x.status !== "Relieved" && x.rejoinedAt === null : q.tab === "relieved" ? x.status === "Relieved" && x.rejoinedAt === null : q.tab === "rejoined" ? x.rejoinedAt !== null : true) &&
            (!q.status || x.status === q.status),
        );
        const shown = pageOf(sortRows(tabbed, q.sort ? SEPARATION_SORT[q.sort] : undefined, q.dir), q);
        const counts = await repos.separations.counts(companyId, lastDay);
        return {
          page: { items: await dtos(session, shown), total: tabbed.length, page: q.page, pageSize: q.pageSize },
          summary: counts,
        };
      });
    },

    /** One live record as the list shows it (the record PDF's data). */
    async get(session: VerifiedSession, companyId: string, id: string): Promise<Separation & { canEdit: boolean; canDelete: boolean }> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const s = await repos.separations.get(companyId, id);
        if (!s) throw notFound();
        const e = await repos.employees.get(companyId, s.employeeId);
        return (await dtos(session, [{ ...s, employeeName: e?.name ?? null, designation: e?.designation ?? null }]))[0];
      });
    },

    /** store (:57-85): one open record per person; Relieved takes them out of attendance and payroll. */
    async create(session: VerifiedSession, companyId: string, input: SeparationBody, meta: RequestMeta): Promise<Separation & { canEdit: boolean; canDelete: boolean }> {
      requirePermission(session, catalog, PART, "create");
      return write(session, companyId, meta, async (w) => {
        const fields = await validated(w.repos, companyId, input, null);
        const e = await w.repos.employees.get(companyId, fields.employeeId, { forUpdate: true });
        if (!e) throw notFound();
        if (await kit.locked((await w.repos.separations.openFor(e.id)) !== null, "This employee already has an open separation record", w)) throw conflict("This employee already has an open separation record.");
        const s = await w.repos.separations.create(companyId, fields, session.userId);
        if (fields.status === "Relieved") await w.repos.employees.setActive(companyId, e.id, false, session.userId);
        await kit.log(w, { action: "created", entity: "Separation", summary: `Separation recorded for ${e.name}`, subject: { id: s.id, label: `${e.name} (${e.employeeCode})` }, details: { Type: s.separationType, "Last working day": s.lastWorkingDate, Status: s.status } });
        return out(w, s);
      });
    },

    /** update (:87-111): an Admin or whoever recorded it; a person who has not rejoined follows the status. */
    async update(session: VerifiedSession, companyId: string, id: string, input: SeparationBody, meta: RequestMeta): Promise<Separation & { canEdit: boolean; canDelete: boolean }> {
      requirePermission(session, catalog, PART, "edit");
      return write(session, companyId, meta, async (w) => {
        const before = await w.repos.separations.get(companyId, id, { forUpdate: true });
        if (!before) throw notFound();
        if (await kit.locked(!canEdit(session, before), "Not allowed to edit this separation record", w)) throw refuse("Only an Admin or whoever recorded this separation can edit it.");
        // an edit never moves a record to another person
        const fields = await validated(w.repos, companyId, input, before.employeeId);
        const s = await w.repos.separations.update(companyId, id, { ...fields, documentPath: before.documentPath }, session.userId);
        const e = await w.repos.employees.get(companyId, s.employeeId, { forUpdate: true });
        if (e && s.rejoinedAt === null) await w.repos.employees.setActive(companyId, e.id, fields.status !== "Relieved", session.userId);
        await kit.log(w, { action: "updated", entity: "Separation", summary: `Separation updated (${s.status})`, subject: { id, label: e ? `${e.name} (${e.employeeCode})` : id }, details: { Type: s.separationType, "Last working day": s.lastWorkingDate, Status: s.status } });
        return out(w, s);
      });
    },

    /** destroy (:113-125): Admins only; the employee goes back into active payroll. */
    async remove(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, PART, "full");
      return write(session, companyId, meta, async (w) => {
        const s = await w.repos.separations.get(companyId, id, { forUpdate: true });
        if (!s) throw notFound();
        if (await kit.locked(!admin(session), "Only Admin users can delete a separation record", w)) throw refuse("Only Admin users can delete a separation record.");
        await w.repos.separations.softDelete(companyId, id, session.userId);
        const e = await w.repos.employees.get(companyId, s.employeeId, { forUpdate: true });
        if (e) await w.repos.employees.setActive(companyId, e.id, true, session.userId);
        await kit.log(w, { action: "deleted", entity: "Separation", summary: `Separation record #${s.entryNo} removed`, subject: { id, label: e ? `${e.name} (${e.employeeCode})` : id }, details: null });
        return { id, message: "Separation record removed and the employee reactivated." };
      });
    },

    async restore(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<Separation & { canEdit: boolean; canDelete: boolean }> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const s = await w.repos.separations.get(companyId, id, { deleted: true, forUpdate: true });
        if (!s) throw notFound();
        await w.repos.separations.restore(companyId, id);
        const e = await w.repos.employees.get(companyId, s.employeeId, { forUpdate: true });
        if (e && s.rejoinedAt === null) await w.repos.employees.setActive(companyId, e.id, s.status !== "Relieved", session.userId);
        await kit.log(w, { action: "updated", entity: "Separation", summary: `Separation record #${s.entryNo} restored`, subject: { id, label: e ? `${e.name} (${e.employeeCode})` : id }, details: null });
        return out(w, { ...s, deletedAt: null });
      });
    },

    async purge(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw refuse("Only the SuperAdmin can use the recycle bin.");
      return write(session, companyId, meta, async (w) => {
        const s = await w.repos.separations.get(companyId, id, { deleted: true, forUpdate: true });
        if (!s) throw notFound();
        await w.repos.separations.purge(companyId, id);
        await kit.log(w, { action: "deleted", entity: "Separation", summary: `Separation record #${s.entryNo} removed for good`, subject: { id, label: String(s.entryNo) }, details: null });
        return { id };
      });
    },

    /** rejoin (:127-176): the person is taken back on with their history intact; the record notes the date. */
    async rejoin(session: VerifiedSession, companyId: string, id: string, input: RejoinBody, meta: RequestMeta): Promise<Separation & { canEdit: boolean; canDelete: boolean }> {
      requirePermission(session, catalog, PART, "edit");
      return write(session, companyId, meta, async (w) => {
        const s = await w.repos.separations.get(companyId, id, { forUpdate: true });
        if (!s) throw notFound();
        const e = await w.repos.employees.get(companyId, s.employeeId, { forUpdate: true });
        if (!e) throw notFound();
        const v = new Rules();
        const joining = v.date("joiningDate", "joining date", v.required("joiningDate", "joining date", input.joiningDate));
        const designation = v.max("designation", "designation", v.required("designation", "designation", input.designation), 100);
        const department = v.text("department", "department", input.department, 100);
        if (input.salaryPaise === null) v.fail("salaryPaise", "The salary field is required.");
        else v.atLeast("salaryPaise", "salary", input.salaryPaise, 0);
        const hoursText = v.required("dailyWorkingHours", "daily working hours", input.dailyWorkingHours);
        const hours = Number(hoursText);
        if (hoursText !== null) {
          if (!Number.isFinite(hours)) v.fail("dailyWorkingHours", "The daily working hours field must be a number.");
          else {
            v.atLeast("dailyWorkingHours", "daily working hours", hours, 0.5);
            v.atMost("dailyWorkingHours", "daily working hours", hours, 24);
          }
        }
        // normalise (:132-139): a number is a country code and national digits, however it was typed
        let contact: { country: string; number: string } | null = null;
        if (Rules.clean(input.phone) !== null) {
          const [dial, national] = phone.normalise(input.phone, input.contactCountry ?? null);
          const wrong = phone.check(dial, national);
          if (wrong) v.fail("phone", wrong);
          else contact = { country: dial, number: national };
        }
        const address = input.address === undefined ? undefined : v.text("address", "address", input.address, 255);
        const mode = v.oneOf("paymentMode", "payment mode", v.required("paymentMode", "payment mode", input.paymentMode), await choices(w.repos, "salary_payment_mode", companyId));
        const bank = mode === BANK_MODE;
        const need = (key: string, label: string, message: string, value: string | null, max: number): string | null => {
          if (bank && value === null) v.fail(key, message);
          return v.max(key, label, value, max);
        };
        const bankName = need("bankName", "bank name", "Bank name is required when the payment mode is Bank.", Rules.clean(input.bankName), 150);
        const holder = need("accountHolderName", "account holder name", "Account holder name is required when the payment mode is Bank.", Rules.clean(input.accountHolderName), 150);
        const accountInput = input.accountNumber === undefined ? undefined : Rules.clean(input.accountNumber);
        if (bank && (accountInput === undefined ? e.accountNumber === null : accountInput === null)) v.fail("accountNumber", "Account number is required when the payment mode is Bank.");
        if (accountInput) v.max("accountNumber", "account number", accountInput, 50);
        const ifscCode = need("ifscCode", "ifsc code", "IFSC code is required when the payment mode is Bank.", Rules.clean(input.ifscCode), 20);
        const branch = input.branchName === undefined ? undefined : v.text("branchName", "branch name", input.branchName, 150);
        v.done();
        const patch: Partial<EmployeeFields> = {
          joiningDate: joining!,
          designation: designation!,
          department,
          salaryPaise: BigInt(input.salaryPaise!),
          dailyWorkingHours: hours.toFixed(2),
          paymentMode: mode!,
          bankName,
          accountHolderName: holder,
          ifscCode,
          ...(accountInput !== undefined ? { accountNumber: accountInput } : {}),
          ...(branch !== undefined ? { branchName: branch } : {}),
          ...(address !== undefined ? { address } : {}),
          ...(contact ? { contactCountry: contact.country, contactNumber: contact.number } : {}),
        };
        await w.repos.employees.update(companyId, e.id, patch, session.userId);
        await w.repos.employees.setActive(companyId, e.id, true, session.userId);
        const saved = await w.repos.separations.update(companyId, id, { rejoinedAt: joining! }, session.userId);
        await kit.log(w, { action: "updated", entity: "Separation", summary: `${e.name} has rejoined from ${longDate(joining!)}`, subject: { id, label: `${e.name} (${e.employeeCode})` }, details: { "Joining date": joining, Designation: designation, Salary: (paiseToNumber(BigInt(input.salaryPaise!)) / 100).toFixed(2) } });
        return out(w, saved);
      });
    },
  };
}

export type SeparationService = ReturnType<typeof createSeparationService>;
