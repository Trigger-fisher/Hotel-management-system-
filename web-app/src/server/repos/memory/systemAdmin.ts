import "server-only";
import { randomUUID } from "node:crypto";
import type { SystemLogEntry } from "../cashSupport";
import type {
  FeatureErrorRecord,
  ForceLogRecord,
  HealthCheckRecord,
  LogColumn,
  LogFilter,
  LogReader,
  PayrollLogRecord,
  PayrollMasterItemRecord,
  PayrollCompanyRef,
  SystemAdminRepos,
  SystemLogRecord,
} from "../systemAdmin";
import { RepoError } from "../types";
import { createMemoryUnit, MemoryStore } from "./store";

// The in-memory double of the system pages and payroll administration (repos/systemAdmin.ts): per-hotel data, one unit at a time, rollback on throw.
// The log readers filter exactly as the PostgreSQL ones (plain, case-insensitive substring search; newest first by created_at then id).

interface SystemAdminData {
  systemLogs: SystemLogRecord[];
  forceLogs: ForceLogRecord[];
  payrollLogs: PayrollLogRecord[];
  checks: HealthCheckRecord[];
  errors: FeatureErrorRecord[];
  settings: Record<string, string | null>;
  companies: PayrollCompanyRef[];
  masterItems: PayrollMasterItemRecord[];
  userAudit: { actorId: string; action: string; details: Record<string, unknown>; ipAddress: string | null }[];
  /** What the services write to system_logs (the writer side). */
  written: SystemLogEntry[];
  /** Tests: make the database ping fail. */
  pingFails?: boolean;
  /** Tests: make the user-audit write fail (the unit must roll the change back). */
  userAuditFails?: boolean;
}

const emptySystemAdminData = (): SystemAdminData => ({ systemLogs: [], forceLogs: [], payrollLogs: [], checks: [], errors: [], settings: {}, companies: [], masterItems: [], userAudit: [], written: [] });

type Row = { id: string; createdAt: Date } & Record<string, unknown>;

interface Spec {
  searchable: readonly string[];
  has: { status: boolean; entity: boolean; company: boolean };
}

const textOf = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

function matches(spec: Spec, r: Row, f: LogFilter): boolean {
  if (f.search && f.search.trim() !== "") {
    const needle = f.search.trim().toLowerCase();
    if (!spec.searchable.some((c) => textOf(r[c]).toLowerCase().includes(needle))) return false;
  }
  if (f.module && r.module !== f.module) return false;
  if (f.modules && !f.modules.includes(String(r.module))) return false;
  if (f.action && r.action !== f.action) return false;
  if (f.actions && !f.actions.includes(String(r.action))) return false;
  if (spec.has.entity && f.entity && r.entity !== f.entity) return false;
  if (spec.has.entity && f.entities && !f.entities.includes(String(r.entity))) return false;
  if (spec.has.status && f.status && r.status !== f.status) return false;
  if (f.user && r.userName !== f.user) return false;
  if (f.subjectId && (!("subjectId" in r) || r.subjectId !== f.subjectId)) return false;
  if (spec.has.company && f.companyId && r.companyId !== f.companyId) return false;
  if (f.fromAt && r.createdAt < f.fromAt) return false;
  if (f.toAt && r.createdAt >= f.toAt) return false;
  return true;
}

const FIELD: Readonly<Record<LogColumn, string>> = { module: "module", user_name: "userName", entity: "entity" };

function memoryReader<R extends { id: string; createdAt: Date }>(rows: () => R[], spec: Spec): LogReader<R> {
  const filtered = (f: LogFilter): R[] =>
    rows()
      .filter((r) => matches(spec, r as unknown as Row, f))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return {
    async list(filter, page) {
      const all = filtered(filter);
      return { rows: structuredClone(all.slice(page.offset, page.offset + page.limit)), total: all.length };
    },
    async count(filter) {
      return filtered(filter).length;
    },
    async distinct(column, filter = {}) {
      if (column === "entity" && !spec.has.entity) return [];
      const counts = new Map<string, number>();
      for (const r of filtered({ companyId: filter.companyId })) {
        const v = (r as unknown as Row)[FIELD[column]];
        if (typeof v === "string" && v !== "") counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([value, count]) => ({ value, count }));
    },
  };
}

const fold = (s: string | null): string => (s ?? "").toLowerCase();

function bindSystemAdmin(data: SystemAdminData): SystemAdminRepos {
  return {
    systemLogReader: memoryReader(() => data.systemLogs, { searchable: ["summary", "subjectLabel", "userName", "entity", "details"], has: { status: true, entity: true, company: false } }),
    forceLogReader: memoryReader(() => data.forceLogs, { searchable: ["summary", "userName", "path", "details"], has: { status: false, entity: false, company: false } }),
    payrollLogReader: memoryReader(() => data.payrollLogs, { searchable: ["summary", "subjectLabel", "userName", "companyName", "details"], has: { status: true, entity: true, company: true } }),
    health: {
      async ping() {
        if (data.pingFails) throw new Error("the database did not answer");
      },
      async record(rows, at) {
        for (const r of rows) {
          if (!["ok", "warn", "down"].includes(r.status)) throw new RepoError("check", "health_checks.status");
          data.checks.push({ ...r, message: r.message.slice(0, 400), checkedAt: at });
        }
      },
      async latest(since) {
        const newest = new Map<string, HealthCheckRecord>();
        for (const c of data.checks) if (c.checkedAt >= since && (!newest.has(c.name) || (newest.get(c.name) as HealthCheckRecord).checkedAt <= c.checkedAt)) newest.set(c.name, c);
        return structuredClone([...newest.values()]);
      },
      async uptime(since) {
        const by = new Map<string, { name: string; total: number; down: number }>();
        for (const c of data.checks.filter((x) => x.checkedAt >= since)) {
          const row = by.get(c.name) ?? { name: c.name, total: 0, down: 0 };
          row.total += 1;
          if (c.status === "down") row.down += 1;
          by.set(c.name, row);
        }
        return [...by.values()];
      },
      async errors(filter, page) {
        const all = data.errors
          .filter((e) => (filter.state === "all" || (filter.state === "open") === (e.resolvedAt === null)) && (!filter.feature || e.feature === filter.feature))
          .filter((e) => (filter.words ?? []).every((w) => [e.exception, e.feature, e.message, e.path, e.method, e.userName].filter(Boolean).join(' ').toLowerCase().includes(w.toLowerCase())))
          .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
        return { rows: structuredClone(all.slice(page.offset, page.offset + page.limit)), total: all.length };
      },
      async errorCounts() {
        return { open: data.errors.filter((e) => e.resolvedAt === null).length, resolved: data.errors.filter((e) => e.resolvedAt !== null).length };
      },
      async errorFeatures() {
        return [...new Set(data.errors.map((e) => e.feature))].sort();
      },
      async openSince(since) {
        return data.errors.filter((e) => e.resolvedAt === null && e.lastSeenAt !== null && e.lastSeenAt >= since).length;
      },
      async setResolved(id, at, by) {
        const e = data.errors.find((x) => x.id === id);
        if (!e) return null;
        e.resolvedAt = at;
        e.resolvedBy = by;
        return structuredClone(e);
      },
      async settings(keys) {
        return new Map(keys.filter((k) => k in data.settings).map((k) => [k, data.settings[k] ?? null]));
      },
    },
    payrollMaster: {
      async company(id) {
        const c = data.companies.find((x) => x.id === id);
        return c ? { ...c } : null;
      },
      async items(list, companyId, withShared) {
        return data.masterItems
          .filter((i) => i.list === list && (i.companyId === companyId || (withShared && i.companyId === null)))
          .sort((a, b) => Number(a.companyId !== null) - Number(b.companyId !== null) || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
          .map((i) => ({ ...i }));
      },
      async item(id) {
        const i = data.masterItems.find((x) => x.id === id);
        return i ? { ...i } : null;
      },
      async counts(companyId) {
        const out: Record<string, number> = {};
        for (const i of data.masterItems) if (i.companyId === companyId) out[i.list] = (out[i.list] ?? 0) + 1;
        return out;
      },
      async taken(list, companyId, field, text, except) {
        return data.masterItems.some((i) => i.id !== except && i.list === list && i.companyId === companyId && fold(field === "value" ? i.value : i.label) === text.toLowerCase());
      },
      async create(input) {
        // the unique keys: (list, label) among shared items, (company, list, label) within a company
        if (data.masterItems.some((i) => i.list === input.list && i.companyId === input.companyId && i.label === input.label)) throw new RepoError("unique", "payroll_master_items label");
        const sortOrder = data.masterItems.filter((i) => i.list === input.list && i.companyId === input.companyId).reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
        const item: PayrollMasterItemRecord = { id: randomUUID(), ...input, isActive: true, sortOrder };
        data.masterItems.push(item);
        return { ...item };
      },
      async update(id, patch) {
        const i = data.masterItems.find((x) => x.id === id);
        if (!i) return null;
        if (patch.label !== undefined && data.masterItems.some((o) => o.id !== id && o.list === i.list && o.companyId === i.companyId && o.label === patch.label)) throw new RepoError("unique", "payroll_master_items label");
        if (patch.label !== undefined) i.label = patch.label;
        if (patch.value !== undefined) i.value = patch.value;
        if (patch.isActive !== undefined) i.isActive = patch.isActive;
        return { ...i };
      },
      async remove(id) {
        const index = data.masterItems.findIndex((x) => x.id === id);
        if (index < 0) return false;
        data.masterItems.splice(index, 1);
        return true;
      },
    },
    userAudit: {
      write: async (e) => {
        if (data.userAuditFails) throw new Error("user audit write failed");
        data.userAudit.push(structuredClone(e));
      },
    },
    systemLogs: { write: async (e) => void data.written.push(e) },
  };
}

export function createMemorySystemAdmin(): { store: MemoryStore<SystemAdminData>; unit: ReturnType<typeof createMemoryUnit<SystemAdminData, SystemAdminRepos>> } {
  const store = new MemoryStore<SystemAdminData>(emptySystemAdminData);
  return { store, unit: createMemoryUnit(store, bindSystemAdmin) };
}
