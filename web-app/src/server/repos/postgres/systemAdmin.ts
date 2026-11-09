import "server-only";
// The system pages and payroll administration on PostgreSQL (repos/systemAdmin.ts). Table and column names are fixed in this file; every value is a
// parameter. Text search is a plain, case-insensitive substring (position in lower()), never a pattern.
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type {
  FeatureErrorRecord,
  ForceLogRecord,
  HealthRepo,
  LogColumn,
  LogFilter,
  LogReader,
  PayrollLogRecord,
  PayrollMasterItemRecord,
  PayrollMasterRepo,
  SystemAdminRepos,
  SystemLogRecord,
} from "../systemAdmin";
import type { Unit } from "../types";
import { asDate, asText, guard, wordsCondition } from "./shared";
import { pgCashSupport } from "./support";
import { createPgUnit } from "./unit";

interface ReaderSpec<R> {
  table: "system_logs" | "force_logs" | "payroll_logs";
  /** Columns the free-text search looks in (fixed SQL expressions). */
  searchable: readonly string[];
  has: { status: boolean; entity: boolean; company: boolean };
  read(row: Record<string, unknown>): R;
}

function whereOf(spec: ReaderSpec<unknown>, f: LogFilter, params: unknown[]): string {
  const where: string[] = ["true"];
  const add = (sql: (n: string) => string, value: unknown): void => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (f.search && f.search.trim() !== "") add((n) => `(${spec.searchable.map((c) => `position(lower(${n}::text) in lower(COALESCE(${c}, ''))) > 0`).join(" OR ")})`, f.search.trim());
  if (f.module) add((n) => `module = ${n}`, f.module);
  if (f.modules) add((n) => `module = ANY(${n}::text[])`, [...f.modules]);
  if (f.action) add((n) => `action = ${n}`, f.action);
  if (f.actions) add((n) => `action = ANY(${n}::text[])`, [...f.actions]);
  if (spec.has.entity && f.entity) add((n) => `entity = ${n}`, f.entity);
  if (spec.has.entity && f.entities) add((n) => `entity = ANY(${n}::text[])`, [...f.entities]);
  if (spec.has.status && f.status) add((n) => `status = ${n}`, f.status);
  if (f.user) add((n) => `user_name = ${n}`, f.user);
  if (spec.table !== "force_logs" && f.subjectId) add((n) => `subject_id = ${n}::uuid`, f.subjectId);
  if (spec.has.company && f.companyId) add((n) => `payroll_company_id = ${n}::uuid`, f.companyId);
  if (f.fromAt) add((n) => `created_at >= ${n}`, f.fromAt.toISOString());
  if (f.toAt) add((n) => `created_at < ${n}`, f.toAt.toISOString());
  return where.join(" AND ");
}

const COLUMNS: Readonly<Record<LogColumn, string>> = { module: "module", user_name: "user_name", entity: "entity" };

function pgLogReader<R>(tx: TxClient, spec: ReaderSpec<R>): LogReader<R> {
  return {
    async list(filter, page) {
      const params: unknown[] = [];
      const where = whereOf(spec as ReaderSpec<unknown>, filter, params);
      const total = Number((await tx.query(`SELECT count(*) AS n FROM ${spec.table} WHERE ${where}`, params)).rows[0].n);
      const rows = await tx.query(`SELECT * FROM ${spec.table} WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, page.limit, page.offset]);
      return { rows: rows.rows.map(spec.read), total };
    },
    async count(filter) {
      const params: unknown[] = [];
      const where = whereOf(spec as ReaderSpec<unknown>, filter, params);
      return Number((await tx.query(`SELECT count(*) AS n FROM ${spec.table} WHERE ${where}`, params)).rows[0].n);
    },
    async distinct(column, filter = {}) {
      if (column === "entity" && !spec.has.entity) return [];
      const params: unknown[] = [];
      const where = whereOf(spec as ReaderSpec<unknown>, { companyId: filter.companyId }, params);
      const c = COLUMNS[column];
      const r = await tx.query(`SELECT ${c} AS value, count(*) AS n FROM ${spec.table} WHERE ${where} AND ${c} IS NOT NULL AND ${c} <> '' GROUP BY ${c} ORDER BY ${c}`, params);
      return r.rows.map((x) => ({ value: String(x.value), count: Number(x.n) }));
    },
  };
}

const status = (v: unknown): "success" | "failed" => (v === "failed" ? "failed" : "success");

const systemSpec: ReaderSpec<SystemLogRecord> = {
  table: "system_logs",
  searchable: ["summary", "subject_label", "user_name", "entity", "details::text"],
  has: { status: true, entity: true, company: false },
  read: (r) => ({
    id: String(r.id),
    module: String(r.module),
    userId: asText(r.user_id),
    userName: asText(r.user_name),
    action: String(r.action),
    status: status(r.status),
    entity: String(r.entity),
    subjectId: asText(r.subject_id),
    subjectLabel: asText(r.subject_label),
    summary: String(r.summary),
    details: r.details ?? null,
    ipAddress: asText(r.ip_address),
    createdAt: asDate(r.created_at) as Date,
  }),
};

const forceSpec: ReaderSpec<ForceLogRecord> = {
  table: "force_logs",
  searchable: ["summary", "user_name", "path", "details::text"],
  has: { status: false, entity: false, company: false },
  read: (r) => ({
    id: String(r.id),
    userId: asText(r.user_id),
    userName: asText(r.user_name),
    action: String(r.action),
    module: String(r.module),
    summary: String(r.summary),
    details: r.details ?? null,
    route: asText(r.route),
    path: asText(r.path),
    method: asText(r.method),
    ipAddress: asText(r.ip_address),
    createdAt: asDate(r.created_at) as Date,
  }),
};

const payrollSpec: ReaderSpec<PayrollLogRecord> = {
  table: "payroll_logs",
  searchable: ["summary", "subject_label", "user_name", "company_name", "details::text"],
  has: { status: true, entity: true, company: true },
  read: (r) => ({
    id: String(r.id),
    companyId: asText(r.payroll_company_id),
    companyName: asText(r.company_name),
    userName: asText(r.user_name),
    action: String(r.action),
    status: status(r.status),
    entity: String(r.entity),
    subjectId: asText(r.subject_id),
    subjectLabel: asText(r.subject_label),
    summary: String(r.summary),
    details: r.details ?? null,
    createdAt: asDate(r.created_at) as Date,
  }),
};

const errorOf = (r: Record<string, unknown>): FeatureErrorRecord => ({
  id: String(r.id),
  feature: String(r.feature),
  exception: String(r.exception),
  message: asText(r.message),
  file: asText(r.file),
  line: r.line === null || r.line === undefined ? null : Number(r.line),
  trace: asText(r.trace),
  method: asText(r.method),
  path: asText(r.path),
  userName: asText(r.user_name),
  occurrences: Number(r.occurrences ?? 0),
  firstSeenAt: asDate(r.first_seen_at),
  lastSeenAt: asDate(r.last_seen_at),
  resolvedAt: asDate(r.resolved_at),
  resolvedBy: asText(r.resolved_by),
});

function pgHealth(tx: TxClient): HealthRepo {
  const stateSql = (state: "open" | "resolved" | "all"): string => (state === "open" ? "resolved_at IS NULL" : state === "resolved" ? "resolved_at IS NOT NULL" : "true");
  return {
    async ping() {
      await tx.query("SELECT 1");
    },
    async record(rows, at) {
      for (const r of rows) {
        await tx.query("INSERT INTO health_checks (name, status, message, latency_ms, checked_at) VALUES ($1, $2, $3, $4, $5)", [r.name, r.status, r.message.slice(0, 400), r.latencyMs, at.toISOString()]);
      }
    },
    async latest(since) {
      const r = await tx.query("SELECT DISTINCT ON (name) name, status, message, latency_ms, checked_at FROM health_checks WHERE checked_at >= $1 ORDER BY name, checked_at DESC, id DESC", [since.toISOString()]);
      return r.rows.map((x) => ({ name: String(x.name), status: x.status as "ok" | "warn" | "down", message: asText(x.message) ?? "", latencyMs: x.latency_ms === null ? null : Number(x.latency_ms), checkedAt: asDate(x.checked_at) as Date }));
    },
    async uptime(since) {
      const r = await tx.query("SELECT name, count(*) AS total, count(*) FILTER (WHERE status = 'down') AS down FROM health_checks WHERE checked_at >= $1 GROUP BY name", [since.toISOString()]);
      return r.rows.map((x) => ({ name: String(x.name), total: Number(x.total), down: Number(x.down) }));
    },
    async errors(filter, page) {
      const params: unknown[] = [];
      let where = stateSql(filter.state);
      if (filter.feature) {
        params.push(filter.feature);
        where += ` AND feature = $${params.length}`;
      }
      where += ` AND ${wordsCondition("concat_ws(' ', exception, feature, message, path, method, user_name)", filter.words, params)}`;
      const total = Number((await tx.query(`SELECT count(*) AS n FROM feature_errors WHERE ${where}`, params)).rows[0].n);
      const rows = await tx.query(`SELECT * FROM feature_errors WHERE ${where} ORDER BY last_seen_at DESC NULLS LAST, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, page.limit, page.offset]);
      return { rows: rows.rows.map(errorOf), total };
    },
    async errorCounts() {
      const r = await tx.query("SELECT count(*) FILTER (WHERE resolved_at IS NULL) AS open, count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved FROM feature_errors");
      return { open: Number(r.rows[0].open), resolved: Number(r.rows[0].resolved) };
    },
    async errorFeatures() {
      const r = await tx.query("SELECT DISTINCT feature FROM feature_errors ORDER BY feature");
      return r.rows.map((x) => String(x.feature));
    },
    async openSince(since) {
      const r = await tx.query("SELECT count(*) AS n FROM feature_errors WHERE resolved_at IS NULL AND last_seen_at >= $1", [since.toISOString()]);
      return Number(r.rows[0].n);
    },
    async setResolved(id, at, by) {
      const r = await tx.query("UPDATE feature_errors SET resolved_at = $2, resolved_by = $3 WHERE id = $1 RETURNING *", [id, at ? at.toISOString() : null, by]);
      return r.rows[0] ? errorOf(r.rows[0]) : null;
    },
    async settings(keys) {
      const r = await tx.query("SELECT key, value FROM app_settings WHERE key = ANY($1::text[])", [[...keys]]);
      return new Map(r.rows.map((x) => [String(x.key), asText(x.value)]));
    },
  };
}

const itemOf = (r: Record<string, unknown>): PayrollMasterItemRecord => ({
  id: String(r.id),
  companyId: asText(r.payroll_company_id),
  list: String(r.list),
  label: String(r.label),
  value: asText(r.value),
  isActive: r.is_active === true,
  sortOrder: Number(r.sort_order),
});

function pgPayrollMaster(tx: TxClient): PayrollMasterRepo {
  const scope = (companyId: string | null, n: number): string => (companyId === null ? "payroll_company_id IS NULL" : `payroll_company_id = $${n}::uuid`);
  return {
    async company(id) {
      const r = await tx.query("SELECT id, name, is_active FROM payroll_companies WHERE id = $1", [id]);
      return r.rows[0] ? { id: String(r.rows[0].id), name: String(r.rows[0].name), isActive: r.rows[0].is_active === true } : null;
    },
    async items(list, companyId, withShared) {
      const params: unknown[] = [list];
      let where: string;
      if (companyId === null) where = "payroll_company_id IS NULL";
      else {
        params.push(companyId);
        where = withShared ? "(payroll_company_id IS NULL OR payroll_company_id = $2::uuid)" : "payroll_company_id = $2::uuid";
      }
      const r = await tx.query(`SELECT * FROM payroll_master_items WHERE list = $1 AND ${where} ORDER BY (payroll_company_id IS NOT NULL), sort_order, label, id`, params);
      return r.rows.map(itemOf);
    },
    async item(id) {
      const r = await tx.query("SELECT * FROM payroll_master_items WHERE id = $1", [id]);
      return r.rows[0] ? itemOf(r.rows[0]) : null;
    },
    async counts(companyId) {
      const r = await tx.query(`SELECT list, count(*) AS n FROM payroll_master_items WHERE ${scope(companyId, 1)} GROUP BY list`, companyId === null ? [] : [companyId]);
      return Object.fromEntries(r.rows.map((x) => [String(x.list), Number(x.n)]));
    },
    async taken(list, companyId, field, text, except) {
      const column = field === "value" ? "value" : "label";
      const params: unknown[] = [list, text, except ?? null];
      if (companyId !== null) params.push(companyId);
      const r = await tx.query(`SELECT 1 FROM payroll_master_items WHERE list = $1 AND lower(${column}) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) AND ${scope(companyId, 4)} LIMIT 1`, params);
      return r.rows.length > 0;
    },
    async create(input) {
      const params: unknown[] = [input.list, input.companyId, input.label, input.value];
      const r = await guard(
        tx.query(
          `INSERT INTO payroll_master_items (list, payroll_company_id, label, value, sort_order)
           VALUES ($1::text, $2::uuid, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM payroll_master_items WHERE list = $1::text AND payroll_company_id IS NOT DISTINCT FROM $2::uuid))
           RETURNING *`,
          params,
        ),
      );
      return itemOf(r.rows[0]);
    },
    async update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [id];
      if (patch.label !== undefined) {
        params.push(patch.label);
        sets.push(`label = $${params.length}`);
      }
      if (patch.value !== undefined) {
        params.push(patch.value);
        sets.push(`value = $${params.length}`);
      }
      if (patch.isActive !== undefined) {
        params.push(patch.isActive);
        sets.push(`is_active = $${params.length}`);
      }
      if (sets.length === 0) {
        const r = await tx.query("SELECT * FROM payroll_master_items WHERE id = $1", [id]);
        return r.rows[0] ? itemOf(r.rows[0]) : null;
      }
      const r = await guard(tx.query(`UPDATE payroll_master_items SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params));
      return r.rows[0] ? itemOf(r.rows[0]) : null;
    },
    async remove(id) {
      const r = await tx.query("DELETE FROM payroll_master_items WHERE id = $1", [id]);
      return r.affectedRows > 0;
    },
  };
}

function pgSystemAdminRepos(tx: TxClient): SystemAdminRepos {
  return {
    systemLogReader: pgLogReader(tx, systemSpec),
    forceLogReader: pgLogReader(tx, forceSpec),
    payrollLogReader: pgLogReader(tx, payrollSpec),
    health: pgHealth(tx),
    payrollMaster: pgPayrollMaster(tx),
    userAudit: {
      async write(e) {
        await tx.query("INSERT INTO user_audit_logs (actor_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)", [e.actorId, e.action.slice(0, 50), JSON.stringify(e.details), e.ipAddress]);
      },
    },
    systemLogs: pgCashSupport(tx).systemLogs,
  };
}

/** The system-administration unit on the real database. */
export function createPgSystemAdminUnit(withHotel: WithHotel): Unit<SystemAdminRepos> {
  return createPgUnit(withHotel, pgSystemAdminRepos);
}
