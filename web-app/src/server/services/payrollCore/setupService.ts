import "server-only";
import type { AttendanceStatus, Deduction } from "@shared/dashboards/payrollCore";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { AttendanceStatusFields, StatusType } from "../../repos/payrollCore";
import { RepoError } from "../../repos/types";
import { companyOrFail, conflict, notFound, PART, payrollKit, type PayrollDeps, type PayrollWrite } from "./context";
import { dtoDeduction, dtoStatus } from "./dto";
import type { DeductionBody, StatusBody } from "./schemas";
import { fieldError, Rules } from "./validate";
import { matchWords } from "../../validation/listQuery";

// Attendance marks (Pallav AttendanceStatusController) and deduction types (DeductionController): per company, hard-deleted, refused while in
// use. Spec: docs/specs/payroll-core.md §6.

const PERCENTAGES = [0, 25, 50, 75, 100] as const;
const KEY_TAKEN = "This shortcut key is already used by another attendance status.";
const COLOUR_TAKEN = "This colour is already used by another attendance status.";
const NAME_TAKEN = "A deduction with this name already exists for this company.";

export function createSetupService(deps: PayrollDeps) {
  const { unit, catalog } = deps;
  const kit = payrollKit(deps);

  async function write<T>(session: VerifiedSession, companyId: string, meta: RequestMeta, work: (w: PayrollWrite) => Promise<T>): Promise<T> {
    const actor = await kit.actor(session);
    return unit.run(session, async (repos) => work({ repos, session, meta, actor, company: await companyOrFail(repos, companyId) }));
  }
  const read = <T>(session: VerifiedSession, companyId: string, work: (w: Omit<PayrollWrite, "meta" | "actor">) => Promise<T>): Promise<T> =>
    unit.run(session, async (repos) => work({ repos, session, company: await companyOrFail(repos, companyId) }));

  /** rules() + messages() (:15-43); the key upper-cased on save (:52, :66). */
  async function statusFields(w: Pick<PayrollWrite, "repos" | "company">, input: StatusBody, except?: string): Promise<AttendanceStatusFields> {
    const v = new Rules();
    const name = v.max("name", "name", v.required("name", "name", input.name), 100);
    const key = v.max("shortcutKey", "shortcut key", v.required("shortcutKey", "shortcut key", input.shortcutKey), 10);
    const color = v.max("color", "color", v.required("color", "color", input.color), 20);
    if (!(PERCENTAGES as readonly number[]).includes(input.attendancePercentage)) v.fail("attendancePercentage", "Attendance percentage can only be 0, 25, 50, 75 or 100.");
    const type = v.oneOf("statusType", "status type", v.required("statusType", "status type", input.statusType), ["Paid", "Unpaid"]);
    // unique per company, as the stored key is compared (the column collation ignores case)
    if (key && !v.has("shortcutKey") && (await w.repos.attendanceStatuses.shortcutTaken(w.company.id, key, except))) v.fail("shortcutKey", KEY_TAKEN);
    if (color && !v.has("color") && (await w.repos.attendanceStatuses.colorTaken(w.company.id, color, except))) v.fail("color", COLOUR_TAKEN);
    v.done();
    return { name: name!, shortcutKey: key!.toUpperCase(), color: color!, attendancePercentage: input.attendancePercentage as AttendanceStatusFields["attendancePercentage"], statusType: type as StatusType, skipsFood: input.skipsFood ?? false };
  }
  const statusUnique = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw fieldError(error.message.includes("color") ? "color" : "shortcutKey", error.message.includes("color") ? COLOUR_TAKEN : KEY_TAKEN);
    throw error;
  };

  async function deductionFields(w: Pick<PayrollWrite, "repos" | "company">, input: DeductionBody, except?: string): Promise<{ name: string; amountPaise: bigint }> {
    const v = new Rules();
    const name = v.max("name", "name", v.required("name", "name", input.name), 100);
    v.atLeast("standardAmountPaise", "amount", input.standardAmountPaise, 0);
    if (name && !v.has("name") && (await w.repos.deductions.nameTaken(w.company.id, name, except))) v.fail("name", NAME_TAKEN);
    v.done();
    return { name: name!, amountPaise: BigInt(input.standardAmountPaise) };
  }
  const nameUnique = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw fieldError("name", NAME_TAKEN);
    throw error;
  };

  async function statusOut(w: Pick<PayrollWrite, "repos" | "company">, id: string): Promise<AttendanceStatus> {
    const s = await w.repos.attendanceStatuses.get(w.company.id, id);
    if (!s) throw notFound();
    return dtoStatus(s, (await w.repos.attendanceStatuses.usedCounts(w.company.id)).get(id) ?? 0);
  }
  async function deductionOut(w: Pick<PayrollWrite, "repos" | "company">, id: string): Promise<Deduction> {
    const found = (await w.repos.deductions.list(w.company.id)).find((d) => d.id === id);
    if (!found) throw notFound();
    return dtoDeduction(found);
  }

  return {
    /* ------------------------------------------------------------ attendance marks */

    /** index: newest first, with how many days use each (ONE grouped count). */
    async listStatuses(session: VerifiedSession, companyId: string, search?: string): Promise<AttendanceStatus[]> {
      requirePermission(session, catalog, PART.statuses, "view");
      return read(session, companyId, async (w) => {
        const used = await w.repos.attendanceStatuses.usedCounts(companyId);
        return matchWords((await w.repos.attendanceStatuses.list(companyId, { activeOnly: false, order: "newest" })).map((s) => dtoStatus(s, used.get(s.id) ?? 0)), search, (s) => [s.name, s.shortcutKey]);
      });
    },

    /** store (:46-57) */
    async createStatus(session: VerifiedSession, companyId: string, input: StatusBody, meta: RequestMeta): Promise<AttendanceStatus> {
      requirePermission(session, catalog, PART.statuses, "create");
      return write(session, companyId, meta, async (w) => {
        const s = await w.repos.attendanceStatuses.create(companyId, await statusFields(w, input)).catch(statusUnique);
        await kit.log(w, { action: "created", entity: "Attendance Status", summary: `Attendance status added: ${s.name} (${s.shortcutKey})`, subject: { id: s.id, label: s.name }, details: { Key: s.shortcutKey, Percentage: s.attendancePercentage, Type: s.statusType } });
        return dtoStatus(s, 0);
      });
    },

    /** update (:59-78): days of UNLOCKED months follow a changed "skips food"; a locked month keeps what it had. */
    async updateStatus(session: VerifiedSession, companyId: string, id: string, input: StatusBody, meta: RequestMeta): Promise<AttendanceStatus> {
      requirePermission(session, catalog, PART.statuses, "edit");
      return write(session, companyId, meta, async (w) => {
        const before = await w.repos.attendanceStatuses.get(companyId, id);
        if (!before) throw notFound();
        const fields = await statusFields(w, input, id);
        const s = await w.repos.attendanceStatuses.update(companyId, id, fields).catch(statusUnique);
        if (before.skipsFood !== s.skipsFood) await w.repos.attendance.followSkipsFood(id, s.skipsFood);
        await kit.log(w, { action: "updated", entity: "Attendance Status", summary: `Attendance status updated: ${s.name} (${s.shortcutKey})`, subject: { id, label: s.name }, details: { Key: s.shortcutKey, Percentage: s.attendancePercentage, Type: s.statusType, "Skips food": s.skipsFood ? "Yes" : "No" } });
        return statusOut(w, id);
      });
    },

    /** destroy (:80-91): refused while a day uses it (ForceMode steps past; the days then keep their copied key, status set null). */
    async deleteStatus(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART.statuses, "full");
      return write(session, companyId, meta, async (w) => {
        const s = await w.repos.attendanceStatuses.get(companyId, id);
        if (!s) throw notFound();
        if (await kit.locked(await w.repos.attendanceStatuses.isUsed(id), "This attendance status is already used in Attendance", w)) {
          throw conflict("This attendance status is already used in Attendance Management and cannot be deleted.");
        }
        await w.repos.attendanceStatuses.remove(companyId, id);
        await kit.log(w, { action: "deleted", entity: "Attendance Status", summary: `Attendance status deleted: ${s.name} (${s.shortcutKey})`, subject: { id, label: s.name }, details: null });
        return { id };
      });
    },

    /** toggleActive (:93-100) */
    async toggleStatus(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<AttendanceStatus> {
      requirePermission(session, catalog, PART.statuses, "edit");
      return write(session, companyId, meta, async (w) => {
        const s = await w.repos.attendanceStatuses.get(companyId, id);
        if (!s) throw notFound();
        await w.repos.attendanceStatuses.update(companyId, id, { isActive: !s.isActive });
        await kit.log(w, { action: "updated", entity: "Attendance Status", summary: `Attendance status ${s.isActive ? "deactivated" : "activated"}: ${s.name}`, subject: { id, label: s.name }, details: { Active: s.isActive ? "No" : "Yes" } });
        return statusOut(w, id);
      });
    },

    /* ------------------------------------------------------------ deduction types */

    /** index: newest first with the assignment count (withCount('assignments')). */
    async listDeductions(session: VerifiedSession, companyId: string, search?: string): Promise<Deduction[]> {
      requirePermission(session, catalog, PART.deductions, "view");
      return read(session, companyId, async (w) => matchWords((await w.repos.deductions.list(companyId)).map(dtoDeduction), search, (d) => [d.name]));
    },

    async createDeduction(session: VerifiedSession, companyId: string, input: DeductionBody, meta: RequestMeta): Promise<Deduction> {
      requirePermission(session, catalog, PART.deductions, "create");
      return write(session, companyId, meta, async (w) => {
        const d = await w.repos.deductions.create(companyId, await deductionFields(w, input), session.userId).catch(nameUnique);
        await kit.log(w, { action: "created", entity: "Deduction", summary: `Deduction added: ${d.name}`, subject: { id: d.id, label: d.name }, details: { Amount: (Number(d.amountPaise) / 100).toFixed(2) } });
        return dtoDeduction(d);
      });
    },

    async updateDeduction(session: VerifiedSession, companyId: string, id: string, input: DeductionBody, meta: RequestMeta): Promise<Deduction> {
      requirePermission(session, catalog, PART.deductions, "edit");
      return write(session, companyId, meta, async (w) => {
        if (!(await w.repos.deductions.get(companyId, id))) throw notFound();
        const d = await w.repos.deductions.update(companyId, id, await deductionFields(w, input, id), session.userId).catch(nameUnique);
        await kit.log(w, { action: "updated", entity: "Deduction", summary: `Deduction updated: ${d.name}`, subject: { id, label: d.name }, details: { Amount: (Number(d.amountPaise) / 100).toFixed(2) } });
        return deductionOut(w, id);
      });
    },

    /** destroy (:70-80): refused while assigned to anyone. */
    async deleteDeduction(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, PART.deductions, "full");
      return write(session, companyId, meta, async (w) => {
        const d = await w.repos.deductions.get(companyId, id);
        if (!d) throw notFound();
        if (await kit.locked(await w.repos.deductions.isAssigned(id), "This deduction is already assigned to an employee", w)) {
          throw conflict("This deduction is already assigned to an employee and cannot be deleted.");
        }
        await w.repos.deductions.remove(companyId, id);
        await kit.log(w, { action: "deleted", entity: "Deduction", summary: `Deduction deleted: ${d.name}`, subject: { id, label: d.name }, details: null });
        return { id };
      });
    },

    async toggleDeduction(session: VerifiedSession, companyId: string, id: string, meta: RequestMeta): Promise<Deduction> {
      requirePermission(session, catalog, PART.deductions, "edit");
      return write(session, companyId, meta, async (w) => {
        const d = await w.repos.deductions.get(companyId, id);
        if (!d) throw notFound();
        await w.repos.deductions.update(companyId, id, { isActive: !d.isActive }, session.userId);
        await kit.log(w, { action: "updated", entity: "Deduction", summary: `Deduction ${d.isActive ? "deactivated" : "activated"}: ${d.name}`, subject: { id, label: d.name }, details: { Active: d.isActive ? "No" : "Yes" } });
        return deductionOut(w, id);
      });
    },
  };
}

export type SetupService = ReturnType<typeof createSetupService>;
