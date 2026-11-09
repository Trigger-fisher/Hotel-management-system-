// Hotel mail and group mail over the real server: /api/v1/platform/hotel-mail and /api/v1/platform/group-mail (Super Admin only). A hotel's or a group's own Amazon SES and Google login;
// the answers never hold a password.
import * as api from '../../client';
import type { PlatformGroupMail, PlatformGroupMailSummary, PlatformHotelMail, PlatformHotelMailSummary, PlatformInboundMail, PlatformSmtpTestResult } from '@shared/dashboards/platform';

import { platformPath, type PlatformApi } from './shared';

type HotelMailRealApi = Pick<PlatformApi, 'getInboundMail' | 'listHotelMail' | 'getHotelMail' | 'saveHotelMail' | 'testHotelMail' | 'listGroupMail' | 'getGroupMail' | 'saveGroupMail' | 'testGroupMail' | 'setHotelMailPause' | 'setGroupMailPause'>;

export function createHotelMailRealApi(): HotelMailRealApi {
  return {
    getInboundMail: () => api.get<PlatformInboundMail>(platformPath('mail-inbound')),
    listHotelMail: () => api.get<PlatformHotelMailSummary[]>(platformPath('hotel-mail')),
    getHotelMail: (hotelId) => api.get<PlatformHotelMail>(platformPath('hotel-mail', hotelId)),
    saveHotelMail: (hotelId, input) => api.put<PlatformHotelMail>(platformPath('hotel-mail', hotelId), input),
    testHotelMail: (hotelId, which, to) => api.post<PlatformSmtpTestResult>(platformPath('hotel-mail', hotelId, 'test'), { which, to }),
    listGroupMail: () => api.get<PlatformGroupMailSummary[]>(platformPath('group-mail')),
    getGroupMail: (groupId) => api.get<PlatformGroupMail>(platformPath('group-mail', groupId)),
    saveGroupMail: (groupId, input) => api.put<PlatformGroupMail>(platformPath('group-mail', groupId), input),
    testGroupMail: (groupId, which, to) => api.post<PlatformSmtpTestResult>(platformPath('group-mail', groupId, 'test'), { which, to }),
    setHotelMailPause: (hotelId, input) => api.put<PlatformHotelMail>(platformPath('hotel-mail', hotelId, 'pause'), input),
    setGroupMailPause: (groupId, input) => api.put<PlatformGroupMail>(platformPath('group-mail', groupId, 'pause'), input),
  };
}
