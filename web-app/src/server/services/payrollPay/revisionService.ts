import "server-only";
import { randomUUID } from "node:crypto";
import type { Page } from "@shared/dashboards/common";
import type { PayEmployee, SalaryChange, SalaryProfile, SalaryRevision } from "@shared/dashboards/payrollPay";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { EmployeeFields, EmployeeRecord } from "../../repos/payrollCore";
import type { RevisionRecord } from "../../repos/payrollPay";
import { companyOrFail, conflict, notFound, payrollKit, type PayrollDeps, type PayrollWrite } from "../payrollCore/context";
import { choices } from "../payrollCore/masters";
import { Rules } from "../payrollCore/validate";
import { payEmployee } from "./dto";
import type { RevisionBody } from "./schemas";

// Salary revisions (Pallav SalaryUpdateController, Models/SalaryUpdateHistory.php): the tracked fields of a person changed with an effective
// date, every change kept as history (one batch per save). A "Salary" change inside a month pays its new rate from that date on (the run).
// Account Number and IFSC Code are kept in the history as typed (plain data, MJ), but the log only says they changed. Spec: docs/specs/payroll-pay.md §2.

const PART = "payroll.salary-update";
const SECRET = new Set(["Account Number", "IFSC Code"]);
/** SalaryUpdateHistory::TRACKED_FIELDS order: a batch's changes are shown in it (ids are UUIDs here, so Pallav's id order is not kept). */
const ORDER = ["Salary", "Designation", "Department", "Working Hours", "Salary Payment Type", "Bank Name", "Account Holder Name", "Account Number", "IFSC Code", "Branch Name"];

export function createRevisionService(deps: PayrollDeps) {
  const { unit, catalog, people } = deps;
  const kit = payrollKit(deps);

  const shown = (value: string | null): string | null => {
    return value === "" ? null : value;
  };

  async function revisionsOf(rows: readonly RevisionRecord[]): Promise<SalaryRevision[]> {
    const names = await people.get([...new Set(rows.flatMap((r) => (r.changedBy ? [r.changedBy] : [])))]);
    const batches = new Map<string, RevisionRecord[]>();
    for (const r of rows) batches.set(r.batchId, [...(batches.get(r.batchId) ?? []), r]);
    return [...batches.values()].map((b) => ({
      batchId: b[0].batchId,
      effectiveDate: b[0].effectiveDate,
      changedAt: b[0].createdAt.toISOString(),
      changedBy: b[0].changedBy ? (names.get(b[0].changedBy)?.name ?? "Removed user") : "System",
      changes: [...b].sort((x, y) => ORDER.indexOf(x.fieldName) - ORDER.indexOf(y.fieldName)).map((r): SalaryChange => ({ id: r.id, field: r.fieldName, previous: shown(r.previousValue), next: shown(r.newValue) })),
    }));
  }

  return {
    /** index (:13-27): active staff, most recently changed first, with how many revisions each has (ONE grouped read). */
    async listProfiles(session: VerifiedSession, companyId: string, q: { search?: string; page: number; pageSize: number }): Promise<Page<SalaryProfile>> {
      requirePermission(session, catalog, PART, "view");
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const listed = await repos.employees.list(companyId, { words, active: true, deleted: "no", sort: "updated", page: q.page, pageSize: q.pageSize });
        const summary = await repos.revisions.summary(listed.rows.map((r) => r.id));
        return {
          items: listed.rows.map((e) => ({ employee: payEmployee(e), lastRevisedOn: summary.get(e.id)?.latest ?? null, revisionCount: summary.get(e.id)?.count ?? 0 })),
          total: listed.total,
          page: q.page,
          pageSize: q.pageSize,
        };
      });
    },

    /** show (:29-45): current terms and every change on record, newest first, grouped by batch. */
    async profile(session: VerifiedSession, companyId: string, employeeId: string): Promise<{ employee: PayEmployee; history: SalaryRevision[] }> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        await companyOrFail(repos, companyId);
        const e = await repos.employees.get(companyId, employeeId);
        if (!e) throw notFound();
        return { employee: payEmployee(e), history: await revisionsOf(await repos.revisions.forEmployee(e.id)) };
      });
    },

    /** update (:47-104) */
    async revise(session: VerifiedSession, companyId: string, employeeId: string, input: RevisionBody, meta: RequestMeta): Promise<{ changed: number; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const actor = await kit.actor(session);
      return unit.run(session, async (repos) => {
        const company = await companyOrFail(repos, companyId);
        const w: PayrollWrite = { repos, session, meta, actor, company };
        const e = await repos.employees.get(companyId, employeeId, { forUpdate: true });
        if (!e) throw notFound();
        const v = new Rules();
        const effectiveDate = v.date("effectiveDate", "effective date", v.required("effectiveDate", "effective date", input.effectiveDate));
        if (input.salaryPaise === null) v.fail("salaryPaise", "The salary field is required.");
        else v.atLeast("salaryPaise", "salary", input.salaryPaise, 0);
        const designation = v.text("designation", "designation", input.designation, 100);
        const department = v.text("department", "department", input.department, 100);
        const hoursText = v.required("dailyWorkingHours", "daily working hours", input.dailyWorkingHours);
        const hours = Number(hoursText);
        if (hoursText !== null) {
          if (!Number.isFinite(hours)) v.fail("dailyWorkingHours", "The daily working hours field must be a number.");
          else {
            v.atLeast("dailyWorkingHours", "daily working hours", hours, 0.5);
            v.atMost("dailyWorkingHours", "daily working hours", hours, 24);
          }
        }
        const paymentMode = v.oneOf("paymentMode", "payment mode", v.required("paymentMode", "payment mode", input.paymentMode), await choices(repos, "salary_payment_mode", companyId));
        const bankName = v.text("bankName", "bank name", input.bankName, 150);
        const holder = v.text("accountHolderName", "account holder name", input.accountHolderName, 150);
        const accountNumber = input.accountNumber === undefined ? undefined : v.text("accountNumber", "account number", input.accountNumber, 50);
        const ifscCode = v.text("ifscCode", "ifsc code", input.ifscCode, 20);
        const branchName = v.text("branchName", "branch name", input.branchName, 150);
        v.done();

        // TRACKED_FIELDS in Pallav's order; numbers compared loosely so 8 and 8.00 are the same (:66-82)
        const rupees = (paise: bigint): string => (Number(paise) / 100).toFixed(2);
        const tracked: { label: string; previous: string | null; next: string | null; numeric?: boolean; present: boolean }[] = [
          { label: "Salary", previous: rupees(e.salaryPaise), next: rupees(BigInt(input.salaryPaise!)), numeric: true, present: true },
          { label: "Designation", previous: e.designation || null, next: designation, present: true },
          { label: "Department", previous: e.department, next: department, present: true },
          { label: "Working Hours", previous: e.dailyWorkingHours, next: hours.toFixed(2), numeric: true, present: true },
          { label: "Salary Payment Type", previous: e.paymentMode, next: paymentMode, present: true },
          { label: "Bank Name", previous: e.bankName, next: bankName, present: true },
          { label: "Account Holder Name", previous: e.accountHolderName, next: holder, present: true },
          // write-only: absent = not part of this save (array_key_exists is false in Pallav)
          { label: "Account Number", previous: e.accountNumber, next: accountNumber ?? null, present: accountNumber !== undefined },
          { label: "IFSC Code", previous: e.ifscCode, next: ifscCode, present: true },
          { label: "Branch Name", previous: e.branchName, next: branchName, present: true },
        ];
        const same = (t: (typeof tracked)[number]): boolean =>
          t.numeric && t.previous !== null && t.next !== null ? Math.abs(Number(t.previous) - Number(t.next)) < 0.0001 : (t.previous ?? "") === (t.next ?? "");
        const changes = tracked.filter((t) => t.present && !same(t));
        if (await kit.locked(changes.length === 0, "No tracked fields were changed", w)) throw conflict("No tracked fields were changed.");

        const patch: Partial<EmployeeFields> = {
          salaryPaise: BigInt(input.salaryPaise!),
          designation: designation ?? "",
          department,
          dailyWorkingHours: hours.toFixed(2),
          paymentMode: paymentMode!,
          bankName,
          accountHolderName: holder,
          ifscCode,
          branchName,
          ...(accountNumber !== undefined ? { accountNumber } : {}),
        };
        const updated: EmployeeRecord = await repos.employees.update(companyId, e.id, patch, session.userId);
        const batchId = randomUUID();
        await repos.revisions.createBatch(
          changes.map((c) => ({ employeeId: e.id, batchId, effectiveDate: effectiveDate!, fieldName: c.label, previousValue: c.previous, newValue: c.next, changedBy: session.userId })),
        );
        const message = `${changes.length} field(s) updated and recorded in the update history.`;
        await kit.log(w, {
          action: "updated",
          entity: "Salary Update",
          summary: `Salary updated: ${updated.name} (${updated.employeeCode}), effective ${effectiveDate}`,
          subject: { id: e.id, label: `${updated.name} (${updated.employeeCode})` },
          // the log names what changed; bank numbers never reach it
          details: Object.fromEntries(changes.map((c) => [c.label, SECRET.has(c.label) ? "changed" : `${c.previous ?? ""} → ${c.next ?? ""}`])),
        });
        return { changed: changes.length, message };
      });
    },
  };
}

export type RevisionService = ReturnType<typeof createRevisionService>;
