// Groups over the real server (Frontend 1): /api/v1/platform/groups (docs/BACKEND.md 14.3; planned until Backend P2/P3).
// The server answers the contract's own types (PlatformGroup[], PlatformGroupDetail, PlatformGroupChange): passed through.
import * as api from '../../client';
import type { PlatformGroup, PlatformGroupChange, PlatformGroupDetail } from '@shared/dashboards/platform';

import { filterValue, platformPath, type PlatformApi } from './shared';

type GroupsRealApi = Pick<PlatformApi, 'listGroups' | 'getGroup' | 'createGroup' | 'addHotelToGroup' | 'removeHotelFromGroup' | 'setGroupAdmin' | 'approveGroup' | 'rejectGroup' | 'setGroupMaxHotels'>;

export function createGroupsRealApi(): GroupsRealApi {
  return {
    listGroups: (q = {}) => api.get<PlatformGroup[]>(platformPath('groups'), { status: filterValue(q.status) }),
    getGroup: (id) => api.get<PlatformGroupDetail>(platformPath('groups', id)),
    createGroup: (input) =>
      api.post<PlatformGroup>(platformPath('groups'), { name: input.name, ...(input.hotelIds?.length ? { hotelIds: input.hotelIds } : {}) }),
    addHotelToGroup: (groupId, hotelId) => api.post<PlatformGroupDetail>(platformPath('groups', groupId, 'hotels'), { hotelId }),
    removeHotelFromGroup: (groupId, hotelId) => api.del<PlatformGroupDetail>(platformPath('groups', groupId, 'hotels', hotelId)),
    setGroupAdmin: (groupId, adminId) => api.put<PlatformGroupDetail>(platformPath('groups', groupId, 'admin'), { adminId }),
    setGroupMaxHotels: (groupId, maxHotels) => api.put<PlatformGroupDetail>(platformPath('groups', groupId, 'max-hotels'), { maxHotels }),
    approveGroup: (id) => api.post<PlatformGroupChange>(platformPath('groups', id, 'approve')),
    rejectGroup: (id, reason) => api.post<PlatformGroupChange>(platformPath('groups', id, 'reject'), { reason }),
  };
}
