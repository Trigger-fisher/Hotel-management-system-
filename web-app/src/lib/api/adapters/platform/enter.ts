// Enter hotel (read-only visit) over the real server (Frontend 1): POST /api/v1/platform/hotels/{id}/enter and /exit (docs/BACKEND.md 14.1
// and 14.7; planned until Backend P4). The server binds the 60-minute visit to the session itself and refuses every hotel write meanwhile.
// It answers PlatformEnterResult plus auditId / visitId / expiresAt / readOnly (the contract has them as optional keys): the adapter passes them on;
// the shell shows `expiresAt` as the end of the visit (banner and automatic exit) and falls back to its own 60-minute clock when it is absent (mock).
// The server REQUIRES a reason (5 to 500 characters; 422 details.fields.reason); the contract's reason is optional, so an absent one is sent
// as '' and the server's field error comes back to the screen.
import * as api from '../../client';
import type { PlatformEnterResult } from '@shared/dashboards/platform';

import { platformPath, type PlatformApi } from './shared';

type EnterRealApi = Pick<PlatformApi, 'enterHotel' | 'exitHotel' | 'extendHotelVisit'>;

const toEnterResult = (d: PlatformEnterResult): PlatformEnterResult => ({
  ok: true,
  hotel: d.hotel,
  ...(d.auditId !== undefined ? { auditId: d.auditId } : {}),
  ...(d.visitId !== undefined ? { visitId: d.visitId } : {}),
  ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}),
  ...(d.readOnly !== undefined ? { readOnly: d.readOnly } : {}),
  ...(d.access !== undefined ? { access: d.access } : {}),
});

export function createEnterRealApi(): EnterRealApi {
  return {
    enterHotel: (hotelId, reason) =>
      api.dashMap('POST', platformPath('hotels', hotelId, 'enter'), { body: { reason: reason?.trim() ?? '' } }, toEnterResult),
    exitHotel: (hotelId) => api.dashMap('POST', platformPath('hotels', hotelId, 'exit'), {}, toEnterResult),
    // "Extend 60 minutes": the server ends the live visit as extended and starts a linked one; the answer is the same shape as enter.
    extendHotelVisit: (hotelId) => api.dashMap('POST', platformPath('hotels', hotelId, 'extend'), {}, toEnterResult),
  };
}
