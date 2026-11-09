// Super Admin A8: platform health over the real server (Frontend 1): /api/v1/platform/health (docs/BACKEND.md 14.6; Super Admin only; planned
// until Backend P5). Answer is PlatformHealth (passed through). Not to be confused with /system/health and /health/deep (one hotel's checks).
import * as api from '../../client';
import type { PlatformHealth } from '@shared/dashboards/platform';

import { platformPath, type PlatformApi } from './shared';

type HealthRealApi = Pick<PlatformApi, 'getPlatformHealth' | 'runHealthCheck'>;

export function createHealthRealApi(): HealthRealApi {
  return {
    getPlatformHealth: () => api.get<PlatformHealth>(platformPath('health')),
    runHealthCheck: () => api.post<PlatformHealth>(platformPath('health', 'check')),
  };
}
