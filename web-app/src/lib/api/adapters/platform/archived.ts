// Super Admin A8: archived hotels, export, permanent delete over the real server (Frontend 1): docs/BACKEND.md 14.6 (Super Admin only;
// planned until Backend P5). Answers are the contract's types (passed through). restoreHotel stays with the hotel status changes
// (platformConsole.ts, Frontend 2).
import * as api from '../../client';
import type { PlatformArchivedHotel, PlatformHotelDeleted, PlatformHotelExport } from '@shared/dashboards/platform';

import { platformPath, searchWord, type PlatformApi } from './shared';

type ArchivedRealApi = Pick<PlatformApi, 'listArchivedHotels' | 'exportHotelData' | 'deleteHotelPermanently'>;

export function createArchivedRealApi(): ArchivedRealApi {
  return {
    listArchivedHotels: (q = {}) => api.get<PlatformArchivedHotel[]>(platformPath('archived-hotels'), { search: searchWord(q.search) }),
    exportHotelData: (id) => api.post<PlatformHotelExport>(platformPath('hotels', id, 'export')),
    deleteHotelPermanently: (id, confirmSlug) => api.post<PlatformHotelDeleted>(platformPath('hotels', id, 'delete-permanently'), { confirmSlug }),
  };
}
