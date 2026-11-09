'use client';

// One mock store for every Payroll screen (pay AND core), so a change shows on the others.
import { MOCK_TODAY, type PayrollPayApi } from '@shared/dashboards/payrollPay';
import { portalToday } from '../portal/today';
import { payrollMocks } from '../payrollCore/api';
import { createPayrollPayRealApi } from '@/lib/api/adapters/payrollPay';
import { lazyMock } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

/** The real /api/v1 server, or the pay half of the one shared payroll mock (payrollCore/api.ts builds both; `?data=s08` seeds it). */
export const payApi: PayrollPayApi = chooseApi(
  () => createPayrollPayRealApi(),
  () => lazyMock(async () => (await payrollMocks()).pay),
);

/** Today for the pay screens: the mock's fixed date (its data is built around it), the hotel's IST date against the real server. */
export const payToday = (): string => portalToday(MOCK_TODAY);
