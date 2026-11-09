// The in-memory mock of groupConsole.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import { type PlatformApi, MOCK_GROUPADMIN_GROUP_ID } from './platform';
import { mockError } from './common';
import { groupConsoleCopy, type GroupConsoleApi } from './groupConsole';

// ---------------------------------------------------------------- the mock

/**
 * The group console over the platform mock. `platform.setActor({ name, role: 'group_admin', groupId })` must have been called at sign-in (the mock
 * api then scopes lists, details, invitations, admin actions and visits to that group by itself); this adds the group-only pieces
 * (overview, unlink with its own guard, the fixed-type invite) and refuses anything outside `groupId`.
 */
export function createGroupConsoleMock(platform: PlatformApi, groupId: string = MOCK_GROUPADMIN_GROUP_ID): GroupConsoleApi {
  // Demo only: `?limit=4` in the address gives the group that maximum, so the at-limit state can be seen (the seed group has no limit).
  const demoLimit = (): number | null => {
    if (typeof location === 'undefined') return null;
    const n = Number(new URLSearchParams(location.search).get('limit'));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  // What the server counts against the limit: waiting + active + suspended hotels and the open invitations into the group.
  const counted = async (): Promise<number> => {
    const [hotels, invs] = await Promise.all([platform.listHotels({ groupId, status: 'all', pageSize: 100 }), platform.listInvitations({ groupId, status: 'pending', pageSize: 100 })]);
    const h = hotels.ok ? hotels.data.items.filter((x) => x.status === 'active' || x.status === 'suspended' || x.status === 'pending_approval').length : 0;
    return h + (invs.ok ? invs.data.items.filter((i) => i.type === 'member_hotel').length : 0);
  };
  const own = async (hotelId: string): Promise<boolean> => {
    const g = await platform.getGroup(groupId);
    return g.ok && g.data.group.hotelIds.includes(hotelId);
  };

  return {
    async groupOverview() {
      const g = await platform.getGroup(groupId);
      if (!g.ok) return g;
      const [hotels, invs, admins, activity] = await Promise.all([
        platform.listHotels({ groupId, status: 'all', pageSize: 100 }),
        platform.listInvitations({ groupId, status: 'pending', pageSize: 100 }),
        platform.listHotelAdmins({ groupId, liveOnly: true, pageSize: 100 }),
        platform.listActivity({ groupId, page: 1, pageSize: 5 }),
      ]);
      if (!hotels.ok) return hotels;
      if (!invs.ok) return invs;
      if (!admins.ok) return admins;
      if (!activity.ok) return activity;
      const gr = g.data.group;
      const live = hotels.data.items.filter((h) => h.status === 'active' || h.status === 'suspended');
      return {
        ok: true as const,
        data: {
          group: { id: gr.id, name: gr.name, status: gr.status, createdAt: gr.createdAt, legalName: gr.legalName, gstin: gr.gstin, city: gr.city, state: gr.state, phone: gr.phone, email: gr.email, maxHotels: demoLimit() ?? gr.maxHotels, isPrimaryAdmin: true },
          tiles: {
            hotels: live.length,
            hotelsActive: live.filter((h) => h.status === 'active').length,
            hotelsSuspended: live.filter((h) => h.status === 'suspended').length,
            invitationsOpen: invs.data.items.filter((i) => i.type === 'member_hotel').length,
            hotelAdmins: admins.data.items.filter((a) => a.status !== 'pending').length,
            lockedAccounts: admins.data.items.filter((a) => a.status === 'locked').length,
            hotelsCounted: hotels.data.items.filter((h) => h.status === 'active' || h.status === 'suspended' || h.status === 'pending_approval').length + invs.data.items.filter((i) => i.type === 'member_hotel').length,
          },
          recentHotels: [...live].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5),
          recentActivity: activity.data.items,
          setup: {
            hotelsWithoutAdmin: live.filter((h) => h.status === 'active' && h.adminCount === 0).length,
            mail: { state: 'not_set_up' as const, reason: null },
            payments: { ready: live.filter((h) => h.status === 'active').length, of: live.filter((h) => h.status === 'active').length },
          },
        },
      };
    },

    myHotels: (q = {}) => platform.listHotels({ ...q, groupId }),
    getMyHotel: (hotelId) => platform.getHotel(hotelId),

    async unlinkHotel(hotelId) {
      if (!(await own(hotelId))) return mockError('NOT_FOUND');
      const r = await platform.removeHotelFromGroup(groupId, hotelId);
      if (!r.ok) return r;
      const h = await platform.getHotel(hotelId);
      if (!h.ok) return h;
      return { ok: true as const, data: { hotel: h.data.hotel, message: `${h.data.hotel.name} is no longer in the group. It keeps all its data.` } };
    },
    async archiveMemberHotel(hotelId) {
      if (!(await own(hotelId))) return mockError('NOT_FOUND');
      return mockError('FORBIDDEN', undefined, { message: groupConsoleCopy.archiveSuperOnly });
    },

    async inviteHotelToMyGroup(input) {
      // like the server: at the limit the answer is a `limit` field error (not a field of the form)
      const max = demoLimit() ?? (await platform.getGroup(groupId).then((g) => (g.ok ? g.data.group.maxHotels : null)));
      if (max !== null && (await counted()) >= max) return mockError('VALIDATION_FAILED', { limit: groupConsoleCopy.groupHotel.atLimit(max) });
      return platform.sendInvitation({ ...input, type: 'member_hotel', groupId });
    },
    myInvitations: (q = {}) => platform.listInvitations({ ...q, groupId, type: 'member_hotel' }),
    resendInvitation: (id) => platform.resendInvitation(id),
    cancelInvitation: (id) => platform.cancelInvitation(id),

    myHotelAdmins: (q = {}) => platform.listHotelAdmins({ ...q, groupId }),
    resetAdminPassword: (id) => platform.resetAdminPassword(id),
    unlockAdmin: (id) => platform.unlockAdmin(id),
    disableAdmin: (id) => platform.disableAdmin(id),
    enableAdmin: (id) => platform.enableAdmin(id),

    enterMemberHotel: (hotelId, reason) => platform.enterHotel(hotelId, reason),
    exitMemberHotel: (hotelId) => platform.exitHotel(hotelId),
    extendMemberHotel: (hotelId) => platform.extendHotelVisit(hotelId),

    myActivity: (q = {}) => platform.listActivity({ groupId, page: q.page, pageSize: q.pageSize }),
  };
}
