// Bounces and holds (Platform settings > Mail; platform migration 0130) against the real server: /api/v1/platform/mail-safety.
import type { MailSafetyApi, MailSafetyView } from '@shared/dashboards/mailSafety';

import { get, post } from '../client';

export function createHttpMailSafetyApi(): MailSafetyApi {
  return {
    view: (query = {}) => {
      const q = new URLSearchParams();
      if (query.search) q.set('search', query.search);
      if (query.cursor) q.set('cursor', query.cursor);
      const s = q.toString();
      return get<MailSafetyView>(`/platform/mail-safety${s ? `?${s}` : ''}`);
    },
    suppress: (input) => post<{ suppressed: boolean }>('/platform/mail-safety', input),
    unsuppress: (id) => post<{ removed: boolean }>(`/platform/mail-safety/suppressions/${encodeURIComponent(id)}/remove`),
    hold: (hotelId, reason) => post<{ held: boolean }>(`/platform/mail-safety/hotels/${encodeURIComponent(hotelId)}/hold`, { reason }),
    release: (hotelId, reason) => post<{ released: boolean }>(`/platform/mail-safety/hotels/${encodeURIComponent(hotelId)}/release`, { reason }),
    rotateKey: (provider) => post<{ provider: 'ses' | 'brevo'; previousUntil: string }>(`/platform/mail-safety/webhooks/${encodeURIComponent(provider)}/rotate`),
  };
}
