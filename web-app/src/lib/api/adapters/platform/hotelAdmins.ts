// Hotel Admin accounts over the real server (Frontend 1): /api/v1/platform/hotel-admins and /platform/hotels/{id}/admins (docs/BACKEND.md 14.2;
// planned until Backend P2). Answers are the contract's types (passed through). The temporary password is emailed, never returned.
import * as api from '../../client';
import type { PlatformAdminCreated, PlatformAdminPage, PlatformHotelAdmin, PlatformPasswordReset } from '@shared/dashboards/platform';

import { getEveryPage } from '../payrollShared';
import { filterValue, pick, platformPath, searchWord, trueFlag, type PlatformApi } from './shared';

type HotelAdminsRealApi = Pick<PlatformApi, 'listHotelAdmins' | 'addHotelAdmin' | 'resetAdminPassword' | 'unlockAdmin' | 'disableAdmin' | 'enableAdmin'>;

const ADMIN_KEYS = ['name', 'username', 'email', 'mobile'] as const;

export function createHotelAdminsRealApi(): HotelAdminsRealApi {
  const action = (id: string, verb: string) => api.post<PlatformHotelAdmin>(platformPath('hotel-admins', id, verb));
  return {
    listHotelAdmins: (q = {}) =>
      // the screens ask for one big page (1000); the server's largest is 100, so every page is joined (payrollShared getEveryPage)
      getEveryPage<PlatformAdminPage>(platformPath('hotel-admins'), { search: searchWord(q.search), status: filterValue(q.status), hotelId: q.hotelId, groupId: q.groupId, liveOnly: trueFlag(q.liveOnly), includeArchived: trueFlag(q.includeArchived) }, q.pageSize, q.page),
    addHotelAdmin: (hotelId, input) => api.post<PlatformAdminCreated>(platformPath('hotels', hotelId, 'admins'), pick(input, ADMIN_KEYS)),
    resetAdminPassword: (adminId) => api.post<PlatformPasswordReset>(platformPath('hotel-admins', adminId, 'reset-password')),
    unlockAdmin: (adminId) => action(adminId, 'unlock'),
    disableAdmin: (adminId) => action(adminId, 'disable'),
    enableAdmin: (adminId) => action(adminId, 'enable'),
  };
}
