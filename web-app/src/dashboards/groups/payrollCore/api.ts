import { PAYROLL_TODAY, type PayrollCoreApi } from '@shared/dashboards/payrollCore';
import type { PayrollPayApi } from '@shared/dashboards/payrollPay';
import { portalToday } from '../portal/today';
import { createPayrollCoreRealApi } from '@/lib/api/adapters/payrollCore';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

/** `?data=s08` starts the mock from Hotel Pallav's own demo rows (payrollPay reads the same ones, same ids). */
const wantsFixtures = typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 's08';

let mocks: Promise<{ core: PayrollCoreApi; pay: PayrollPayApi }> | null = null;

/**
 * The two payroll mocks (core + pay) as ONE store per browser session: staff, salary, payments, advances and the master lists
 * are the same records on every Payroll screen. payrollPay/api.ts takes its half from here. Loaded through lib/api/mockLoader.ts.
 */
export function payrollMocks(): Promise<{ core: PayrollCoreApi; pay: PayrollPayApi }> {
  mocks ??= loadMocks().then((m) =>
    m.createPayrollMocks(
      { offline: () => typeof navigator !== 'undefined' && navigator.onLine === false },
      wantsFixtures ? m.s08PayrollSeed() : undefined,
    ),
  );
  return mocks;
}

/** The real /api/v1 server, or the shared mock store (edits stay while you move between screens). `?data=s08` only seeds the mock. */
export const payrollApi: PayrollCoreApi = chooseApi(
  () => createPayrollCoreRealApi(),
  () => lazyMock(async () => (await payrollMocks()).core),
);

/** Today for the payroll screens: the mock's fixed date (its data is built around it), the hotel's IST date against the real server. */
export const payrollToday = (): string => portalToday(PAYROLL_TODAY);
