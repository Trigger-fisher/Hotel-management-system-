// System Log, Force Log and System Health over the real server (docs/BACKEND.md section 7, "System (SuperAdmin only)"):
// GET /system/log, GET /system/force-log, GET /system/health, POST /system/health/checks, GET /system/errors, POST /system/errors/{id}/resolve|reopen.
// The query schemas are strict (an unknown key is a 422): only known, non-empty keys are sent, and the page size is snapped to 10/25/50/100.
// HMS has no request log: the per-feature usage map comes from GET /system/health/usage (recorded actions from the system log, see BACKEND.md); if that call fails the
// health answer still arrives, with no features, tables or flows, and the screen says so.
import type {
  FaultPage, ForceLogPage, ForceLogRow, HealthCheckRow, HealthFault, HealthFeature, HealthUsageExtra, RecordHistory, SystemAdminApi, SystemHealthOverview, SystemLogPage,
} from '@shared/dashboards/adminSystem';

import * as api from '../client';
import { snapPageSize } from './payrollShared';

/** GET /system/health/usage (services/systemAdmin/healthUsage.ts). */
interface UsageAnswer extends HealthUsageExtra {
  features: HealthFeature[];
  tables: Record<string, string[]>;
  flows: [string, string, number][];
}

const enc = encodeURIComponent;
const blank = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);

/** The server's /system/health answer (healthService.ts HealthOverview). */
interface ServerHealth { overall: SystemHealthOverview['overall']; checks: HealthCheckRow[]; openErrors: number; recentErrors: HealthFault[] }
type ServerForceRow = Omit<ForceLogRow, 'action'> & { action: string };

export function createSystemAdminRealApi(): SystemAdminApi {
  return {
    recordHistory: (id) => api.get<RecordHistory>('/system/log/record', { id }),
    listSystemLog: (q) =>
      api.get<SystemLogPage>('/system/log', {
        search: blank(q.search), view: blank(q.view), module: blank(q.module), action: blank(q.action), status: q.status || undefined, user: blank(q.user),
        from: blank(q.from), to: blank(q.to), page: q.page, pageSize: snapPageSize(q.pageSize),
      }),
    listForceLog: (q) =>
      api.dashMap<Omit<ForceLogPage, 'items'> & { items: ServerForceRow[] }, ForceLogPage>(
        'GET',
        '/system/force-log',
        { query: { search: blank(q.search), view: blank(q.view), module: blank(q.module), action: blank(q.action), user: blank(q.user), from: blank(q.from), to: blank(q.to), page: q.page, pageSize: snapPageSize(q.pageSize) } },
        (r) => ({ ...r, items: r.items.map((x) => ({ ...x, action: x.action as ForceLogRow['action'] })) }),
      ),
    getHealth: async () => {
      // both parts at once (each can take a few seconds on a slow line); the page needs the checks, the usage only adds to them
      const [health, usage] = await Promise.all([
        api.dashMap<ServerHealth, SystemHealthOverview>('GET', '/system/health', {}, (h) => ({ ...h, features: [], tables: {}, flows: [] })),
        api.get<UsageAnswer>('/system/health/usage'),
      ]);
      if (!health.ok) return health;
      if (!usage.ok) return health;
      const { features, tables, flows, note, activity, server } = usage.data;
      return { ok: true, data: { ...health.data, features, tables, flows, usage: { note, activity, server } } };
    },
    runHealthChecks: () => api.post<{ checks: HealthCheckRow[]; message: string }>('/system/health/checks'),
    listFaults: (q) => api.get<FaultPage>('/system/errors', { show: q.show, feature: blank(q.feature), search: blank(q.search?.trim()), page: q.page, pageSize: snapPageSize(q.pageSize) }),
    resolveFault: (id) => api.post<{ fault: HealthFault; message: string }>(`/system/errors/${enc(id)}/resolve`),
    reopenFault: (id) => api.post<{ fault: HealthFault; message: string }>(`/system/errors/${enc(id)}/reopen`),
  };
}
