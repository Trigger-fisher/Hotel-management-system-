// The reads a view's frame makes as soon as it mounts, started by the shell together with the view's chunk load (shell/RoleDashboard.tsx useScreen) so the
// answers are in the 20 s memory of GET answers (lib/api/getCache.ts) by the time the frame asks: its `useAsync` answers at once and the screen's own data
// request goes out one round trip earlier. Real api mode only (the mock adapters do not read through `get`).
import { get } from '../lib/api/client';

/** The two company lists every payroll frame reads (payrollCore/shared.tsx PayrollPage, payrollPay/shared.tsx PayPage): the same addresses as their adapters. */
export const PAYROLL_FRAME_PATHS = ['/payroll/companies', '/payroll/company-refs'] as const;

/** Starts the frame reads of `viewId`; nothing for a view whose frame reads nothing before its screen. Never throws, never waited for. */
export function prefetchFor(viewId: string): void {
  if (viewId.startsWith('hotel.payroll.')) for (const path of PAYROLL_FRAME_PATHS) void get(path);
}
