// The Group Hotel Admin console over the real server: /api/v1/group/* (route table: GROUP_CONSOLE_ROUTES in ui-shared/dashboards/groupConsole.ts).
// The group is NEVER sent: the server takes it from the session, so a group admin cannot name another group. A hotel, invitation or admin outside
// the group answers 404. Lists of the screens ask for one big page (500, 1000): getEveryPage joins pages of 100 (the server's largest).
import type { GroupConsoleApi } from '@shared/dashboards/groupConsole';
import type { PlatformAdminPage, PlatformHotelPage, PlatformInvitationPage } from '@shared/dashboards/platform';

import * as api from '../client';
import { getEveryPage, snapPageSize } from './payrollShared';

const id = encodeURIComponent;
const G = '/group';

const word = (s: string | undefined) => s?.trim() || undefined;
const flag = (b: boolean | undefined) => (b ? 'true' : undefined);
const notAll = (v: string | undefined) => (v && v !== 'all' ? v : undefined);

export function createHttpGroupApi(): GroupConsoleApi {
  return {
    groupOverview: () => api.get(`${G}/overview`),

    myHotels: (q = {}) => getEveryPage<PlatformHotelPage>(`${G}/hotels`, { search: word(q.search), status: notAll(q.status), createdMonth: q.createdMonth }, q.pageSize, q.page),
    getMyHotel: (hotelId) => api.get(`${G}/hotels/${id(hotelId)}`),
    unlinkHotel: (hotelId) => api.post(`${G}/hotels/${id(hotelId)}/unlink`),
    archiveMemberHotel: (hotelId, reason) => api.post(`${G}/hotels/${id(hotelId)}/archive`, reason?.trim() ? { reason: reason.trim() } : {}),

    inviteHotelToMyGroup: (input) => api.post(`${G}/invitations`, { hotelName: input.hotelName, contactName: input.contactName, email: input.email }),
    myInvitations: (q = {}) => getEveryPage<PlatformInvitationPage>(`${G}/invitations`, { search: word(q.search), status: notAll(q.status) }, q.pageSize, q.page),
    resendInvitation: (invId) => api.post(`${G}/invitations/${id(invId)}/resend`),
    cancelInvitation: (invId) => api.post(`${G}/invitations/${id(invId)}/cancel`),

    myHotelAdmins: (q = {}) =>
      getEveryPage<PlatformAdminPage>(
        `${G}/hotel-admins`,
        { search: word(q.search), status: notAll(q.status), hotelId: q.hotelId, liveOnly: flag(q.liveOnly), includeArchived: flag(q.includeArchived) },
        q.pageSize,
        q.page,
      ),
    resetAdminPassword: (adminId) => api.post(`${G}/hotel-admins/${id(adminId)}/reset-password`),
    unlockAdmin: (adminId) => api.post(`${G}/hotel-admins/${id(adminId)}/unlock`),
    disableAdmin: (adminId) => api.post(`${G}/hotel-admins/${id(adminId)}/disable`),
    enableAdmin: (adminId) => api.post(`${G}/hotel-admins/${id(adminId)}/enable`),

    enterMemberHotel: (hotelId, reason) => api.post(`${G}/hotels/${id(hotelId)}/enter`, { reason: reason.trim() }),
    exitMemberHotel: (hotelId) => api.post(`${G}/hotels/${id(hotelId)}/exit`),
    extendMemberHotel: (hotelId) => api.post(`${G}/hotels/${id(hotelId)}/extend`),

    myActivity: (q = {}) => api.get(`${G}/activity`, { page: q.page, pageSize: snapPageSize(q.pageSize) }),
  };
}
