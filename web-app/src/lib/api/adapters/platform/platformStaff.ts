// Super Admin A8: Platform Admin accounts over the real server (Frontend 1): /api/v1/platform/staff (docs/BACKEND.md 14.6; Super Admin only;
// planned until Backend P5). Answers are the contract's types (passed through); the role is always platform_admin (server-side).
import * as api from '../../client';
import type { PlatformAdminHotelAccess, PlatformStaff, PlatformStaffCreated, PlatformStaffPage, PlatformStaffReset } from '@shared/dashboards/platform';

import { filterValue, pick, platformPath, searchWord, snapPageSize, type PlatformApi } from './shared';

type PlatformStaffRealApi = Pick<
  PlatformApi,
  | 'listPlatformStaff' | 'createPlatformStaff' | 'disablePlatformStaff' | 'enablePlatformStaff' | 'resetPlatformStaffPassword' | 'unlockPlatformStaff'
  | 'getPlatformStaffHotelAccess' | 'setPlatformStaffHotelAccess'
>;

const STAFF_KEYS = ['name', 'username', 'email', 'mobile'] as const;

export function createPlatformStaffRealApi(): PlatformStaffRealApi {
  const action = (id: string, verb: string) => api.post<PlatformStaff>(platformPath('staff', id, verb));
  return {
    listPlatformStaff: (q = {}) =>
      api.get<PlatformStaffPage>(platformPath('staff'), {
        search: searchWord(q.search),
        page: q.page,
        pageSize: snapPageSize(q.pageSize),
        status: filterValue(q.status),
      }),
    createPlatformStaff: (input) => api.post<PlatformStaffCreated>(platformPath('staff'), pick(input, STAFF_KEYS)),
    disablePlatformStaff: (id) => action(id, 'disable'),
    enablePlatformStaff: (id) => action(id, 'enable'),
    unlockPlatformStaff: (id) => action(id, 'unlock'),
    resetPlatformStaffPassword: (id) => api.post<PlatformStaffReset>(platformPath('staff', id, 'reset-password')),
    // What a platform admin may do when entering hotels (platform 0135, Super Admin only); the body is exactly the contract's input.
    getPlatformStaffHotelAccess: (id) => api.get<PlatformAdminHotelAccess>(platformPath('staff', id, 'hotel-access')),
    setPlatformStaffHotelAccess: (id, input) =>
      api.put<PlatformAdminHotelAccess>(platformPath('staff', id, 'hotel-access'), {
        level: input.level,
        allHotels: input.allHotels,
        ...(input.allHotels ? {} : { hotelIds: input.hotelIds ?? [] }),
        reason: input.reason.trim(),
      }),
  };
}
