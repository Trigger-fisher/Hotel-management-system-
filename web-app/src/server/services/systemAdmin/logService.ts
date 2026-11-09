import "server-only";
import type { Page } from "@shared/dashboards/common";
import { can, isPortalAccount } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RecordHistory } from "@shared/dashboards/adminSystem";
import type { LogFilter } from "../../repos/systemAdmin";
import { dayRange, detailsText, intersect, istWindow, requireSuperAdmin, type SystemAdminDeps } from "./context";

/** A record's History shows at most this many lines; the System Log has the rest. */
const HISTORY_LIMIT = 50;

// The System Log and the Force Log (Pallav SystemLogController, ForceLogController; SuperAdmin only): newest first, read a module at a time, the quick
// views along the top, 10/25/50/100 a page (25 by default), and the numbers on top. Read only (both tables are insert-only). Payroll keeps its own log.

/** SystemLogController::MONEY_MODULES / ACCESS_MODULES. */
const MONEY_MODULES = ["revenue", "expense", "handover", "bills"];
const ACCESS_MODULES = ["users", "access", "account"];

export const SYSTEM_LOG_VIEWS = ["today", "week", "money", "access", "deletions", "problems"] as const;
export const FORCE_LOG_VIEWS = ["today", "week", "locks", "checks", "sessions"] as const;

interface SystemLogQuery {
  search?: string;
  view?: (typeof SYSTEM_LOG_VIEWS)[number];
  module?: string;
  action?: string;
  status?: "success" | "failed";
  user?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

type ForceLogQuery = Omit<SystemLogQuery, "view" | "status"> & { view?: (typeof FORCE_LOG_VIEWS)[number] };

/** ui-shared adminSystem SystemLogRow (contract request: `id` is a UUID string here, the mock has a number; `at` is an ISO instant). */
export interface SystemLogRowDto {
  id: string;
  module: string;
  userName: string | null;
  action: string;
  status: "success" | "failed";
  entity: string;
  subject: string | null;
  summary: string;
  details: Record<string, string> | null;
  ip: string | null;
  at: string;
}

/** ui-shared adminSystem ForceLogRow (same notes). */
export interface ForceLogRowDto {
  id: string;
  module: string;
  userName: string | null;
  action: string;
  summary: string;
  details: Record<string, string> | null;
  method: string | null;
  path: string | null;
  route: string | null;
  ip: string | null;
  at: string;
}

type SystemLogResult = Page<SystemLogRowDto> & { stats: { total: number; today: number; people: number; failed: number }; modules: { key: string; count: number }[]; people: string[] };
type ForceLogResult = Page<ForceLogRowDto> & { stats: { total: number; today: number; locks: number; checks: number }; modules: { key: string; count: number }[]; people: string[] };

/** A printed log is capped (PDF_LIMIT): past this the dates or filters should narrow it. */
const LOG_PDF_LIMIT = 400;

export function createLogService(deps: SystemAdminDeps) {
  const { unit, now } = deps;

  function systemFilter(q: Omit<SystemLogQuery, "page" | "pageSize">): LogFilter {
    const w = istWindow(now());
    const base: LogFilter = { search: q.search, module: q.module, action: q.action, status: q.status, user: q.user };
    let window = dayRange(q.from, q.to);
    switch (q.view) {
      case "today": window = intersect(window, { fromAt: w.todayStart, toAt: w.tomorrowStart }); break;
      case "week": window = intersect(window, { fromAt: w.weekStart }); break;
      case "money": base.modules = MONEY_MODULES; break;
      case "access": base.modules = ACCESS_MODULES; break;
      case "deletions": base.actions = ["deleted"]; break;
      case "problems": base.status = base.status && base.status !== "failed" ? "__none__" : "failed"; break;
      default: break;
    }
    return { ...base, ...window };
  }

  function forceFilter(q: Omit<ForceLogQuery, "page" | "pageSize">): LogFilter {
    const w = istWindow(now());
    const base: LogFilter = { search: q.search, module: q.module, action: q.action, user: q.user };
    let window = dayRange(q.from, q.to);
    switch (q.view) {
      case "today": window = intersect(window, { fromAt: w.todayStart, toAt: w.tomorrowStart }); break;
      case "week": window = intersect(window, { fromAt: w.weekStart }); break;
      case "locks": base.actions = ["lock"]; break;
      case "checks": base.actions = ["checks"]; break;
      case "sessions": base.actions = ["armed", "disarmed"]; break;
      default: break;
    }
    return { ...base, ...window };
  }


  /** The letterhead of a printed log: Settings general.site_name, else "Hotel". */
  const hotelName = async (session: VerifiedSession): Promise<string> => ((await unit.run(session, (repos) => repos.health.settings(["general.site_name"]))).get("general.site_name") ?? "").trim() || "Hotel";

  const service = {
    async systemLog(session: VerifiedSession, q: SystemLogQuery): Promise<SystemLogResult> {
      requireSuperAdmin(session, "the System Log");
      const w = istWindow(now());
      return unit.run(session, async (repos) => {
        const r = repos.systemLogReader;
        const page = await r.list(systemFilter(q), { offset: (q.page - 1) * q.pageSize, limit: q.pageSize });
        const people = await r.distinct("user_name");
        return {
          items: page.rows.map((x) => ({ id: x.id, module: x.module, userName: x.userName, action: x.action, status: x.status, entity: x.entity, subject: x.subjectLabel, summary: x.summary, details: detailsText(x.details), ip: x.ipAddress, at: x.createdAt.toISOString() })),
          total: page.total,
          page: q.page,
          pageSize: q.pageSize,
          stats: { total: await r.count({}), today: await r.count({ fromAt: w.todayStart, toAt: w.tomorrowStart }), people: people.length, failed: await r.count({ status: "failed" }) },
          modules: (await r.distinct("module")).map((m) => ({ key: m.value, count: m.count })),
          people: people.map((p) => p.value),
        };
      });
    },

    /**
     * The history of ONE record (MJ's plan, N9): the system-log lines whose subject is that id, plus the payroll-log lines about it (an employee, a staff
     * advance) when the person may view Payroll; newest first, at most 50. Any hotel account may ask; the SuperAdmin sees every line, anyone else only the
     * lines of modules they may view (a cashier sees a bill's lines, not the users' ones). A portal account never reaches it. An unknown id simply has no lines.
     */
    async recordHistory(session: VerifiedSession, subjectId: string): Promise<RecordHistory> {
      if (isPortalAccount(session)) throw new AppError("FORBIDDEN");
      const superAdmin = session.roleKey === "super_admin";
      const seesPayroll = superAdmin || can(session, deps.catalog, "payroll", "view");
      return unit.run(session, async (repos) => {
        const [system, payroll] = await Promise.all([
          repos.systemLogReader.list({ subjectId }, { offset: 0, limit: HISTORY_LIMIT }),
          seesPayroll ? repos.payrollLogReader.list({ subjectId }, { offset: 0, limit: HISTORY_LIMIT }) : Promise.resolve({ rows: [], total: 0 }),
        ]);
        const rows = [
          ...system.rows.filter((x) => superAdmin || can(session, deps.catalog, x.module, "view")),
          ...payroll.rows,
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id > a.id ? 1 : -1));
        return {
          items: rows.slice(0, HISTORY_LIMIT).map((x) => ({ id: x.id, at: x.createdAt.toISOString(), userName: x.userName, action: x.action, status: x.status, summary: x.summary, details: detailsText(x.details) })),
          more: system.total + payroll.total > HISTORY_LIMIT,
        };
      });
    },

    async forceLog(session: VerifiedSession, q: ForceLogQuery): Promise<ForceLogResult> {
      requireSuperAdmin(session, "the Force Log");
      const w = istWindow(now());
      return unit.run(session, async (repos) => {
        const r = repos.forceLogReader;
        const page = await r.list(forceFilter(q), { offset: (q.page - 1) * q.pageSize, limit: q.pageSize });
        return {
          items: page.rows.map((x) => ({ id: x.id, module: x.module, userName: x.userName, action: x.action, summary: x.summary, details: detailsText(x.details), method: x.method, path: x.path, route: x.route, ip: x.ipAddress, at: x.createdAt.toISOString() })),
          total: page.total,
          page: q.page,
          pageSize: q.pageSize,
          stats: { total: await r.count({}), today: await r.count({ fromAt: w.todayStart, toAt: w.tomorrowStart }), locks: await r.count({ actions: ["lock"] }), checks: await r.count({ actions: ["checks"] }) },
          modules: (await r.distinct("module")).map((m) => ({ key: m.value, count: m.count })),
          people: (await r.distinct("user_name")).map((p) => p.value),
        };
      });
    },

    /** The rows the printed System Log shows (the same filters, at most 400) and whether more were left out. */
    async systemLogRows(session: VerifiedSession, q: Omit<SystemLogQuery, "page" | "pageSize">): Promise<{ rows: SystemLogRowDto[]; truncated: boolean; hotelName: string }> {
      const res = await service.systemLog(session, { ...q, page: 1, pageSize: LOG_PDF_LIMIT });
      return { rows: res.items, truncated: res.total > res.items.length, hotelName: await hotelName(session) };
    },

    async forceLogRows(session: VerifiedSession, q: Omit<ForceLogQuery, "page" | "pageSize">): Promise<{ rows: ForceLogRowDto[]; truncated: boolean; hotelName: string }> {
      const res = await service.forceLog(session, { ...q, page: 1, pageSize: LOG_PDF_LIMIT });
      return { rows: res.items, truncated: res.total > res.items.length, hotelName: await hotelName(session) };
    },
  };
  return service;
}

export type LogService = ReturnType<typeof createLogService>;
