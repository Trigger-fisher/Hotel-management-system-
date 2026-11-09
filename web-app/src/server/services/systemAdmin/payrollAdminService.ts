import "server-only";
import type { LogQuery, LogResult, MasterItem, MasterItemInput, MasterListKey, MasterView, PayrollLogEntry } from "@shared/dashboards/payrollPay";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { LogFilter, PayrollMasterItemRecord, SystemAdminRepos } from "../../repos/systemAdmin";
import { RepoError } from "../../repos/types";
import { dayRange, intersect, istWindow, requireSuperAdmin, type SystemAdminDeps } from "./context";
import { matchWords } from "../../validation/listQuery";

// Payroll Master (Pallav PayrollMasterController + Support/PayrollMasters.php) and the Payroll Log (PayrollLogController), both SuperAdmin only and both
// in a SCOPE: "all" (shared by every company) or one payroll company. Pallav keeps the scope in the session; HMS takes it from the query (`scope`), checked
// to be this hotel's active company. An item is only changed from the scope it lives in. Each master change writes a user-audit row in the same unit
// (UserAuditLog::record: payroll_master.added / updated / toggled / removed, with the list and the item).

/** PayrollMasters::LISTS: key -> what the saved value is (email lists keep an address beside the label). None is fixed. */
const PAYROLL_LISTS: Readonly<Record<MasterListKey, { name: string; email: boolean }>> = {
  share_emails: { name: "Share recipients", email: true },
  designations: { name: "Designations", email: false },
  departments: { name: "Departments", email: false },
  gender: { name: "Gender", email: false },
  separation_type: { name: "Exit types", email: false },
  id_proofs: { name: "ID proof types", email: false },
  salary_payment_mode: { name: "Salary payment modes", email: false },
};
const PAYROLL_LIST_KEYS = Object.keys(PAYROLL_LISTS) as MasterListKey[];

/** PayrollLogController::MONEY_ENTITIES. */
const MONEY_ENTITIES = ["Salary slip", "Advance", "Bonus / incentive", "Meal price", "Meals record", "Attendance"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const chars = (s: string): number => Array.from(s).length;

interface PayrollLogQuery extends Omit<LogQuery, "page" | "pageSize" | "sort" | "dir" | "tab"> {
  page: number;
  pageSize: number;
}

export function createPayrollAdminService(deps: SystemAdminDeps) {
  const { unit, now } = deps;

  const toItem = (r: PayrollMasterItemRecord): MasterItem => ({ id: r.id, list: r.list as MasterListKey, scope: r.companyId ?? "all", label: r.label, value: r.value, isActive: r.isActive, sortOrder: r.sortOrder });

  async function scopeOf(repos: SystemAdminRepos, scope: string): Promise<{ id: string | null; name: string | null }> {
    if (scope === "all") return { id: null, name: null };
    const company = await repos.payrollMaster.company(scope);
    if (!company || !company.isActive) throw new AppError("NOT_FOUND", "Select a company first.");
    return { id: company.id, name: company.name };
  }

  const listOf = (key: string): { key: MasterListKey; email: boolean } => {
    const def = PAYROLL_LISTS[key as MasterListKey];
    if (!def) throw new AppError("NOT_FOUND");
    return { key: key as MasterListKey, email: def.email };
  };

  /** PayrollMasterController::validated: label required, max 120; an email list's value required, an email, max 190, lower-cased; the same entry twice in one scope is a slip. */
  async function validated(repos: SystemAdminRepos, list: { key: MasterListKey; email: boolean }, companyId: string | null, input: MasterItemInput, except?: string): Promise<{ label: string; value: string | null }> {
    const fields: Record<string, string> = {};
    const label = input.label.trim();
    if (label === "") fields.label = "The label field is required.";
    else if (chars(label) > 120) fields.label = "The label field must not be greater than 120 characters.";
    let value: string | null = null;
    if (list.email) {
      value = input.value.trim().toLowerCase();
      if (value === "") fields.value = "The value field is required.";
      else if (chars(value) > 190) fields.value = "The value field must not be greater than 190 characters.";
      else if (!EMAIL.test(value)) fields.value = "The value field must be a valid email address.";
    }
    if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields });
    const field = list.email ? "value" : "label";
    if (await repos.payrollMaster.taken(list.key, companyId, field, list.email ? (value as string) : label, except)) {
      throw new AppError("VALIDATION_FAILED", "That is already in this list.", { fields: { [field]: "That is already in this list." } });
    }
    return { label, value };
  }

  /** outOfScope: an item is only editable from the scope it lives in. */
  function inScope(item: PayrollMasterItemRecord, companyId: string | null): void {
    if (item.companyId === companyId) return;
    throw new AppError("CONFLICT", item.companyId === null ? "This one applies to every company. Switch the scope to All companies to change it." : "This one belongs to another company. Switch to that company to change it.");
  }

  async function itemInScope(repos: SystemAdminRepos, id: string, scope: string): Promise<{ item: PayrollMasterItemRecord; companyId: string | null }> {
    const s = await scopeOf(repos, scope);
    const item = await repos.payrollMaster.item(id);
    if (!item) throw new AppError("NOT_FOUND");
    inScope(item, s.id);
    return { item, companyId: s.id };
  }

  const audit = (repos: SystemAdminRepos, session: VerifiedSession, meta: RequestMeta, action: string, list: string, item: string): Promise<void> =>
    repos.userAudit.write({ actorId: session.userId, action, details: { list, item }, ipAddress: meta.ip });

  /** The database's unique key is the backstop of `taken`: a race between two saves reads as the same field error. */
  async function uniqueAsField<T>(work: Promise<T>, field: string): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof RepoError && error.kind === "unique") throw new AppError("VALIDATION_FAILED", "That is already in this list.", { fields: { [field]: "That is already in this list." } });
      throw error;
    }
  }

  return {
    /** index: the list's own items in this scope, the shared ones a company page inherits, and how many each list holds in this scope. */
    async master(session: VerifiedSession, scope: string, listKey: string, search?: string): Promise<MasterView> {
      requireSuperAdmin(session, "Payroll Master");
      const list = listOf(listKey);
      return unit.run(session, async (repos) => {
        const s = await scopeOf(repos, scope);
        const items = await repos.payrollMaster.items(list.key, s.id, s.id !== null);
        const counts = await repos.payrollMaster.counts(s.id);
        return {
          own: matchWords(items.filter((i) => i.companyId === s.id).map(toItem), search, (i) => [i.label, i.value]),
          inherited: s.id === null ? [] : matchWords(items.filter((i) => i.companyId === null).map(toItem), search, (i) => [i.label, i.value]),
          counts: Object.fromEntries(PAYROLL_LIST_KEYS.map((k) => [k, counts[k] ?? 0])) as Record<MasterListKey, number>,
        };
      });
    },

    /** store: "Added for {company}." / "Added for every company." */
    async create(session: VerifiedSession, scope: string, listKey: string, input: MasterItemInput, meta: RequestMeta): Promise<MasterItem> {
      requireSuperAdmin(session, "Payroll Master");
      const list = listOf(listKey);
      return unit.run(session, async (repos) => {
        const s = await scopeOf(repos, scope);
        const clean = await validated(repos, list, s.id, input);
        const item = await uniqueAsField(repos.payrollMaster.create({ list: list.key, companyId: s.id, label: clean.label, value: clean.value }), list.email ? "value" : "label");
        await audit(repos, session, meta, "payroll_master.added", list.key, clean.label);
        return toItem(item);
      });
    },

    /** update: "Saved." */
    async update(session: VerifiedSession, scope: string, id: string, input: MasterItemInput, meta: RequestMeta): Promise<MasterItem> {
      requireSuperAdmin(session, "Payroll Master");
      return unit.run(session, async (repos) => {
        const { item, companyId } = await itemInScope(repos, id, scope);
        const list = listOf(item.list);
        const clean = await validated(repos, list, companyId, input, item.id);
        const saved = await uniqueAsField(repos.payrollMaster.update(item.id, { label: clean.label, value: clean.value }), list.email ? "value" : "label");
        if (!saved) throw new AppError("NOT_FOUND");
        await audit(repos, session, meta, "payroll_master.updated", item.list, saved.label);
        return toItem(saved);
      });
    },

    /** toggle: switches it on or off ("Switched on." / "Switched off."). HMS: `isActive` sent makes it a SET, so two clicks at once cannot cancel out; absent = Pallav's toggle. */
    async toggle(session: VerifiedSession, scope: string, id: string, isActive: boolean | undefined, meta: RequestMeta): Promise<MasterItem> {
      requireSuperAdmin(session, "Payroll Master");
      return unit.run(session, async (repos) => {
        const { item } = await itemInScope(repos, id, scope);
        const saved = await repos.payrollMaster.update(item.id, { isActive: isActive ?? !item.isActive });
        if (!saved) throw new AppError("NOT_FOUND");
        // UserAuditLog::record like add / update / remove, in the same unit: a failing write undoes the switch
        await audit(repos, session, meta, "payroll_master.toggled", item.list, saved.label);
        return toItem(saved);
      });
    },

    /** destroy: removed for good (Pallav deletes it; records that already use the label keep it). "Removed." */
    async remove(session: VerifiedSession, scope: string, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requireSuperAdmin(session, "Payroll Master");
      return unit.run(session, async (repos) => {
        const { item } = await itemInScope(repos, id, scope);
        if (!(await repos.payrollMaster.remove(item.id))) throw new AppError("NOT_FOUND");
        await audit(repos, session, meta, "payroll_master.removed", item.list, item.label);
        return { id: item.id };
      });
    },

    /** The payroll log: newest first, across every company or one, the quick views, the numbers on top, the entities and people to filter by. */
    async log(session: VerifiedSession, scope: string, q: PayrollLogQuery): Promise<LogResult> {
      requireSuperAdmin(session, "the Payroll Log");
      const w = istWindow(now());
      return unit.run(session, async (repos) => {
        const s = await scopeOf(repos, scope);
        const company = s.id ? { companyId: s.id } : {};
        const filter: LogFilter = { ...company, search: q.search, action: q.action || undefined, entity: q.entity || undefined, status: q.status || undefined, user: q.user || undefined };
        let window = dayRange(q.from, q.to);
        switch (q.view) {
          case "today": window = intersect(window, { fromAt: w.todayStart, toAt: w.tomorrowStart }); break;
          case "week": window = intersect(window, { fromAt: w.weekStart }); break;
          case "emails": filter.actions = ["emailed"]; break;
          case "money": filter.entities = MONEY_ENTITIES; break;
          case "deletions": filter.actions = ["deleted"]; break;
          case "problems": filter.status = filter.status && filter.status !== "failed" ? "__none__" : "failed"; break;
          default: break;
        }
        const r = repos.payrollLogReader;
        const page = await r.list({ ...filter, ...window }, { offset: (q.page - 1) * q.pageSize, limit: q.pageSize });
        const items: PayrollLogEntry[] = page.rows.map((l) => ({
          id: l.id,
          at: l.createdAt.toISOString(),
          companyId: l.companyId,
          companyName: l.companyName ?? "",
          userName: l.userName ?? "",
          action: l.action as PayrollLogEntry["action"],
          entity: l.entity,
          subject: l.subjectLabel ?? "",
          summary: l.summary,
          details: l.details === null || l.details === undefined ? "" : typeof l.details === "string" ? l.details : JSON.stringify(l.details),
          status: l.status,
        }));
        return {
          page: { items, total: page.total, page: q.page, pageSize: q.pageSize },
          stats: {
            total: await r.count(company),
            today: await r.count({ ...company, fromAt: w.todayStart, toAt: w.tomorrowStart }),
            emails: await r.count({ ...company, actions: ["emailed"], status: "success" }),
            failed: await r.count({ ...company, status: "failed" }),
          },
          entities: (await r.distinct("entity", company)).map((e) => e.value),
          people: (await r.distinct("user_name", company)).map((p) => p.value),
        };
      });
    },
  };
}

export type PayrollAdminService = ReturnType<typeof createPayrollAdminService>;
