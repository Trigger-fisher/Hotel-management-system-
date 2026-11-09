// The three Administration "system" pages in Hotel Pallav's own shape: System Log, Force Log and System Health (SuperAdmin only).
// Contract only: types, labels, the api the screens call and small pure helpers. The demo rows live in adminSystem.mock.ts (dev and
// local-demo builds only, loaded through ui-shared/mocks); the real server is web-app/src/lib/api/adapters/systemAdmin.ts.
// Server: GET /system/log, GET /system/force-log (+ /pdf), GET /system/health, POST /system/health/checks, GET /system/errors,
// POST /system/errors/{id}/resolve|reopen (docs/BACKEND.md section 7, "System (SuperAdmin only)").
// Separate from admin.ts (other sessions edit that file).
import type { DashResult, Page } from './common';

/* ------------------------------------------------------------------ shared lookups (SystemLog model) */

export const SYSTEM_PDF_ROUTES = {
  systemLog: () => '/api/v1/system/log/pdf',
  forceLog: () => '/api/v1/system/force-log/pdf',
  /** The Payroll Log as a PDF (Super Admin): the same query as GET /payroll/log (scope, search, view, action, entity, status, user, from, to) without paging. */
  payrollLog: () => '/api/v1/payroll/log/pdf',
} as const;

/** A PDF route with the page's filters (empty ones left out): the printed log shows what the page shows, without paging. */
export function pdfHref(base: string, q: Record<string, string | undefined>): string {
  const parts = Object.entries(q)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `${base}?${parts.join('&')}` : base;
}

export const logActions: Record<string, string> = { created: 'Created', updated: 'Updated', deleted: 'Deleted', 'signed-in': 'Signed in', emailed: 'Emailed', error: 'Error' };

export const logModules: Record<string, [string, string]> = {
  revenue: ['Revenue', 'cash-stack'],
  expense: ['Expenses', 'cart3'],
  handover: ['Handover', 'arrow-left-right'],
  bills: ['Billing', 'receipt'],
  companies: ['Companies', 'buildings'],
  website: ['Website', 'globe2'],
  frontdesk: ['Front desk', 'grid-3x3-gap'],
  masters: ['Lists and rates', 'list-check'],
  users: ['Users', 'people'],
  access: ['Roles', 'key'],
  account: ['Sign-in and profile', 'person-circle'],
  system: ['System', 'gear'],
};

export const systemLogViews: [string, string, string][] = [
  ['today', 'Today', 'brightness-high'],
  ['week', 'Last 7 days', 'calendar-week'],
  ['money', 'Money', 'cash-coin'],
  ['access', 'Accounts', 'shield-lock'],
  ['deletions', 'Deletions', 'trash'],
  ['problems', 'Problems', 'exclamation-triangle'],
];

export const forceActions: Record<string, string> = { armed: 'Armed', disarmed: 'Disarmed', lock: 'Lock bypassed', checks: 'Checks bypassed' };
export const forceIcons: Record<string, string> = { armed: 'lightning-charge-fill', disarmed: 'power', lock: 'unlock', checks: 'shield-x' };
export const forceLogViews: [string, string, string][] = [
  ['today', 'Today', 'brightness-high'],
  ['week', 'Last 7 days', 'calendar-week'],
  ['locks', 'Locks bypassed', 'unlock'],
  ['checks', 'Checks bypassed', 'shield-x'],
  ['sessions', 'Armed and disarmed', 'lightning-charge'],
];

/** SystemLogController::MONEY_MODULES / ACCESS_MODULES (the "Money" and "Accounts" views). */
export const MONEY_MODULES = ['revenue', 'expense', 'handover', 'bills'];
export const ACCESS_MODULES = ['users', 'access', 'account'];

/** The server's page sizes (10/25/50/100; 25 by default). */
export const SYSTEM_PAGE_SIZES = [10, 25, 50, 100];

/* ------------------------------------------------------------------ System Log and Force Log */

export interface SystemLogRow {
  /** A UUID from the server (the mock numbers its rows: "1", "2", ...). */
  id: string;
  module: string;
  userName: string | null;
  action: string;
  status: 'success' | 'failed';
  entity: string;
  subject: string | null;
  summary: string;
  details: Record<string, string> | null;
  ip: string | null;
  /** An ISO instant. */
  at: string;
}

export interface ForceLogRow {
  id: string;
  module: string;
  userName: string | null;
  action: 'armed' | 'disarmed' | 'lock' | 'checks';
  summary: string;
  details: Record<string, string> | null;
  method: string | null;
  path: string | null;
  route: string | null;
  ip: string | null;
  at: string;
}

/** GET /system/log: every key optional; empty ones are not sent. */
export interface SystemLogQuery {
  search?: string;
  view?: string;
  module?: string;
  action?: string;
  /** System Log only. */
  status?: 'success' | 'failed' | '';
  user?: string;
  /** Plain days "YYYY-MM-DD" (IST). */
  from?: string;
  to?: string;
  page?: number;
  /** 10, 25, 50 or 100. */
  pageSize?: number;
}

export type ForceLogQuery = Omit<SystemLogQuery, 'status'>;

export interface SystemLogStats { total: number; today: number; people: number; failed: number }
export interface ForceLogStats { total: number; today: number; locks: number; checks: number }

/** The page plus the numbers on top (whole log, not the filter), the modules that have lines (with counts) and everyone who did something. */
export type SystemLogPage = Page<SystemLogRow> & { stats: SystemLogStats; modules: { key: string; count: number }[]; people: string[] };
export type ForceLogPage = Page<ForceLogRow> & { stats: ForceLogStats; modules: { key: string; count: number }[]; people: string[] };

/** The modules that have lines, in the sidebar's order (a module nothing happened in is not offered); one the list does not know goes last. */
export function moduleOptions(modules: { key: string }[]): [string, string][] {
  const seen = new Set(modules.map((m) => m.key));
  const known = Object.entries(logModules).filter(([k]) => seen.has(k)).map(([k, v]): [string, string] => [k, v[0]]);
  const other = [...seen].filter((k) => !logModules[k]).sort().map((k): [string, string] => [k, k.charAt(0).toUpperCase() + k.slice(1)]);
  return [...known, ...other];
}

/** "#24" for a numbered row, the first 8 characters of a UUID. */
export function entryNo(id: string): string {
  return `#${/^\d+$/.test(id) ? id : id.slice(0, 8)}`;
}

/* ------------------------------------------------------------------ System Health */

export type FeatureStatus = 'healthy' | 'degraded' | 'down' | 'idle';
export type CheckStatus = 'ok' | 'warn' | 'down';
export type OverallStatus = 'healthy' | 'degraded' | 'down';

export interface DailyUse { day: string; hits: number; errors: number; avgMs: number }

export interface HealthFeature {
  key: string;
  label: string;
  icon: string;
  group: string;
  status: FeatureStatus;
  hits7: number;
  hits30: number;
  /** Percent change against the week before. */
  trend: number;
  users7: number;
  avgMs: number | null;
  maxMs: number;
  errors7: number;
  openFaults: number;
  depends: string[];
  reasons: string[];
  routes: string[];
  /** Thirty days of visits, oldest first. */
  daily: DailyUse[];
  /** Where "Open <feature>" goes (a menu id), when there is a page. */
  openMenu?: string;
}

export interface HealthCheckRow {
  name: string;
  label: string;
  icon: string;
  status: CheckStatus;
  message: string;
  latencyMs: number | null;
  /** Share of the last 7 days' results that were not down (percent); null when none were filed yet. */
  uptime: number | null;
  /** When the check ran (ISO). */
  checkedAt?: string;
}

export interface HealthFault {
  /** A UUID from the server. */
  id: string;
  exception: string;
  feature: string;
  message: string;
  occurrences: number;
  /** ISO instant. */
  lastSeen: string;
  method: string | null;
  path: string | null;
  userName: string | null;
  file: string;
  line: number;
  trace: string | null;
  resolvedBy: string | null;
  resolved: boolean;
}

/**
 * GET /system/health. `features`, `tables` and `flows` are the per-feature usage map (visits, speed, shared tables, journeys); a server that
 * does not measure usage sends them empty and the screen says so instead of drawing the feature cards and the map.
 */
export interface SystemHealthOverview {
  overall: OverallStatus;
  checks: HealthCheckRow[];
  openErrors: number;
  /** The newest open faults (a few). */
  recentErrors: HealthFault[];
  features: HealthFeature[];
  /** Feature key -> the tables it uses. */
  tables: Record<string, string[]>;
  /** [from feature, to feature, how many people moved between them]. */
  flows: [string, string, number][];
  /** Real server only (GET /system/health/usage): what the numbers above are and what HMS does not measure. */
  usage?: HealthUsageExtra;
  /** Real server only: deployment warnings in plain English sentences (photo storage not set up on a serverless host, the database login is not hms_app); empty when all is well. */
  notices?: string[];
}

/** What GET /system/health/usage adds to the feature map: record counts and the server's own numbers (no request timings exist). */
export interface HealthUsageExtra {
  /** A fixed sentence: uses are recorded actions, speed is not measured. */
  note: string;
  activity: { key: string; label: string; last24h: number; last7d: number; last30d: number }[];
  server: { poolTotal: number | null; poolIdle: number | null; poolWaiting: number | null; hotelDataBytes: number | null; dbConnections: number | null; requestP50Ms: null; requestP95Ms: null; timing: string };
}

export type FaultShow = 'open' | 'resolved' | 'all';

export interface FaultQuery {
  show?: FaultShow;
  feature?: string;
  /** The page search (decision 51): every word must appear in the exception, feature, message, path or user. */
  search?: string;
  page?: number;
  pageSize?: number;
}

/** GET /system/errors: one page, the open/fixed counts (all features) and every feature that has faults. */
export interface FaultPage {
  page: Page<HealthFault>;
  counts: { open: number; resolved: number };
  features: string[];
}

/** One line of a record's history (GET /system/log/record?id=): who did what to it and when. */
export interface RecordHistoryItem {
  id: string;
  /** ISO instant. */
  at: string;
  userName: string | null;
  action: string;
  status: 'success' | 'failed';
  summary: string;
  details: Record<string, string> | null;
}
export interface RecordHistory {
  /** Newest first, at most 50. */
  items: RecordHistoryItem[];
  /** More than 50 lines exist: the System Log has the rest. */
  more: boolean;
}

export const recordHistoryCopy = {
  title: 'History',
  hint: 'Who changed this and when, from the System Log.',
  hintPayroll: 'Who changed this and when, from the Payroll Log.',
  empty: 'No changes recorded for this yet.',
  more: 'Older lines are in the System Log.',
  by: (who: string | null) => who ?? 'System',
  failed: 'failed',
  /** The modal's button and the icon button on a table row. */
  close: 'Close',
  open: 'History',
} as const;

export interface SystemAdminApi {
  /** The history of one record by its id (any hotel account; lines of modules the person may view). */
  recordHistory(id: string): Promise<DashResult<RecordHistory>>;
  listSystemLog(q: SystemLogQuery): Promise<DashResult<SystemLogPage>>;
  listForceLog(q: ForceLogQuery): Promise<DashResult<ForceLogPage>>;
  getHealth(): Promise<DashResult<SystemHealthOverview>>;
  /** Runs every check now. */
  runHealthChecks(): Promise<DashResult<{ checks: HealthCheckRow[]; message: string }>>;
  listFaults(q: FaultQuery): Promise<DashResult<FaultPage>>;
  /** Mark fixed (a SET: twice changes nothing). */
  resolveFault(id: string): Promise<DashResult<{ fault: HealthFault; message: string }>>;
  reopenFault(id: string): Promise<DashResult<{ fault: HealthFault; message: string }>>;
}

/** Features that share a system with this one (the "Others that stand on the same systems" list). */
export function dependentsOf(f: HealthFeature, all: HealthFeature[]): HealthFeature[] {
  return all.filter((o) => o.key !== f.key && o.depends.some((dep) => dep !== 'database' && f.depends.includes(dep)));
}

export interface MapNode { key: string; label: string; status: FeatureStatus; hits: number; x: number; y: number; r: number; angle: number }
export interface MapEdge { a: MapNode; b: MapNode; kinds: ('data' | 'journey')[]; width: number }

/** "How features connect": nodes round a circle, bigger when used more; edges for shared tables and journeys. */
export function connectionMap(feats: HealthFeature[], tables: Record<string, string[]>, flows: [string, string, number][], size = 560): { nodes: MapNode[]; edges: MapEdge[]; size: number } {
  const max = Math.max(1, ...feats.map((f) => f.hits30));
  const c = size / 2;
  const nodes = feats.map((f, i) => {
    const angle = (i / feats.length) * Math.PI * 2 - Math.PI / 2;
    return { key: f.key, label: f.label, status: f.status, hits: f.hits30, angle, x: Math.round(c + Math.cos(angle) * (c - 20)), y: Math.round(c + Math.sin(angle) * (c - 20)), r: 4 + Math.round((f.hits30 / max) * 9) };
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges = new Map<string, MapEdge>();
  const add = (x: string, y: string, kind: 'data' | 'journey', w: number) => {
    const a = byKey.get(x);
    const b = byKey.get(y);
    if (!a || !b) return;
    const id = [x, y].sort().join('|');
    const e = edges.get(id) ?? { a, b, kinds: [], width: 1 };
    if (!e.kinds.includes(kind)) e.kinds.push(kind);
    e.width = Math.min(5, Math.max(e.width, w));
    edges.set(id, e);
  };
  const keys = Object.keys(tables);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ki = keys[i] as string;
      const kj = keys[j] as string;
      const shared = (tables[ki] ?? []).filter((t: string) => t !== 'system_logs' && (tables[kj] ?? []).includes(t));
      if (shared.length) add(ki, kj, 'data', 1 + shared.length * 0.6);
    }
  }
  flows.forEach(([a, b, n]) => add(a, b, 'journey', 1 + n / 25));
  return { nodes, edges: [...edges.values()], size };
}
