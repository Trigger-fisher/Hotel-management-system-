// A call the real server has no route for yet: the adapter answers NOT_FOUND "No route yet" and the gap goes in the session report.
import type { DashResult } from '@shared/dashboards/common';

export function notYet<T = never>(name: string): Promise<DashResult<T>> {
  return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: `No route yet (${name})`, traceId: 'no-trace' } });
}
