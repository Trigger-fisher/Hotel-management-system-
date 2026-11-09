import "server-only";
import type { SystemLogRepo } from "./cashSupport";

// The SuperAdmin's system pages and the payroll administration, all inside the hotel's own schema: the three log readers (system_logs, force_logs,
// payroll_logs: read only, insert-only tables), System Health (health_checks, feature_errors and a few settings), Payroll Master (payroll_master_items,
// hard delete as Pallav PayrollMasterController.php:115) and the user-audit trail (user_audit_logs). Plain records, no SQL. The in-memory double is
// repos/memory/systemAdmin.ts; PostgreSQL repos/postgres/systemAdmin.ts.

/* ---------------------------------------------------------------- the log readers */

/** One filter for every log table; a field a table does not have is ignored by that reader (force_logs has no status or entity). */
export interface LogFilter {
  /** Plain text, case ignored, anywhere in the reader's searchable columns (summary, subject, who, entity/path/company, details). */
  search?: string;
  module?: string;
  modules?: readonly string[];
  action?: string;
  actions?: readonly string[];
  entity?: string;
  entities?: readonly string[];
  status?: string;
  /** The person's name as written on the line. */
  user?: string;
  /** system_logs and payroll_logs: the lines about ONE record (subject_id); force_logs has no subject. */
  subjectId?: string;
  /** payroll_logs only: one company. */
  companyId?: string;
  /** created_at >= fromAt and < toAt (the service turns IST days into instants). */
  fromAt?: Date;
  toAt?: Date;
}

interface LogPage {
  offset: number;
  limit: number;
}

export interface SystemLogRecord {
  id: string;
  module: string;
  userId: string | null;
  userName: string | null;
  action: string;
  status: "success" | "failed";
  entity: string;
  subjectId: string | null;
  subjectLabel: string | null;
  summary: string;
  details: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

export interface ForceLogRecord {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  module: string;
  summary: string;
  details: unknown;
  route: string | null;
  path: string | null;
  method: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface PayrollLogRecord {
  id: string;
  companyId: string | null;
  companyName: string | null;
  userName: string | null;
  action: string;
  status: "success" | "failed";
  entity: string;
  /** The record the line is about (an employee, an advance), so a record's History can read payroll lines too (N9). */
  subjectId: string | null;
  subjectLabel: string | null;
  summary: string;
  details: unknown;
  createdAt: Date;
}

export type LogColumn = "module" | "user_name" | "entity";

export interface LogReader<R> {
  /** Newest first (created_at, then id), one page. */
  list(filter: LogFilter, page: LogPage): Promise<{ rows: R[]; total: number }>;
  count(filter: LogFilter): Promise<number>;
  /** The distinct non-empty values of a column with how many lines each (payroll: within the company when given). */
  distinct(column: LogColumn, filter?: Pick<LogFilter, "companyId">): Promise<{ value: string; count: number }[]>;
}

/* ---------------------------------------------------------------- health */

export interface HealthCheckRecord {
  name: string;
  status: "ok" | "warn" | "down";
  message: string;
  latencyMs: number | null;
  checkedAt: Date;
}

export interface FeatureErrorRecord {
  id: string;
  feature: string;
  exception: string;
  message: string | null;
  file: string | null;
  line: number | null;
  trace: string | null;
  method: string | null;
  path: string | null;
  userName: string | null;
  occurrences: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface HealthRepo {
  /** A round trip to the database (SELECT 1). */
  ping(): Promise<void>;
  /** Files one result per check (append-only). */
  record(rows: readonly Omit<HealthCheckRecord, "checkedAt">[], at: Date): Promise<void>;
  /** The newest result of each check filed at or after `since`. */
  latest(since: Date): Promise<HealthCheckRecord[]>;
  /** Per check since `since`: how many results and how many were down. */
  uptime(since: Date): Promise<{ name: string; total: number; down: number }[]>;
  /** Newest last-seen first; `state` open (unresolved), resolved or all; optionally one feature. */
  errors(filter: { state: "open" | "resolved" | "all"; feature?: string; words?: readonly string[] }, page: LogPage): Promise<{ rows: FeatureErrorRecord[]; total: number }>;
  errorCounts(): Promise<{ open: number; resolved: number }>;
  errorFeatures(): Promise<string[]>;
  /** Unresolved faults last seen at or after `since`. */
  openSince(since: Date): Promise<number>;
  /** Marks a fault fixed (at + by) or open again (both null). Null when there is no such fault. */
  setResolved(id: string, at: Date | null, by: string | null): Promise<FeatureErrorRecord | null>;
  /** Plain setting values (app_settings) for these keys; a missing key is absent from the map. Never sent to an app as such. */
  settings(keys: readonly string[]): Promise<Map<string, string | null>>;
}

/* ---------------------------------------------------------------- payroll master */

export interface PayrollCompanyRef {
  id: string;
  name: string;
  isActive: boolean;
}

export interface PayrollMasterItemRecord {
  id: string;
  /** null = shared by every company. */
  companyId: string | null;
  list: string;
  label: string;
  value: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface PayrollMasterRepo {
  company(id: string): Promise<PayrollCompanyRef | null>;
  /** The list's items of this scope and, with `withShared`, the shared ones too: shared first, then sort_order, then label (PayrollMasters::visible). */
  items(list: string, companyId: string | null, withShared: boolean): Promise<PayrollMasterItemRecord[]>;
  item(id: string): Promise<PayrollMasterItemRecord | null>;
  /** Items per list in exactly this scope. */
  counts(companyId: string | null): Promise<Record<string, number>>;
  /** Another item of the same list and scope already has this label (or value, for an email list), case ignored. */
  taken(list: string, companyId: string | null, field: "label" | "value", text: string, except?: string): Promise<boolean>;
  /** Added last in its list and scope (sort_order = max + 1). */
  create(input: { list: string; companyId: string | null; label: string; value: string | null }): Promise<PayrollMasterItemRecord>;
  update(id: string, patch: { label?: string; value?: string | null; isActive?: boolean }): Promise<PayrollMasterItemRecord | null>;
  remove(id: string): Promise<boolean>;
}

/** One row of user_audit_logs (Pallav UserAuditLog::record). */
interface UserAuditRepo {
  write(entry: { actorId: string; action: string; details: Record<string, unknown>; ipAddress: string | null }): Promise<void>;
}

export interface SystemAdminRepos {
  systemLogReader: LogReader<SystemLogRecord>;
  forceLogReader: LogReader<ForceLogRecord>;
  payrollLogReader: LogReader<PayrollLogRecord>;
  health: HealthRepo;
  payrollMaster: PayrollMasterRepo;
  userAudit: UserAuditRepo;
  systemLogs: SystemLogRepo;
}
