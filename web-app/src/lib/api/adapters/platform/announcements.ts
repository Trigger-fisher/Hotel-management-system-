// P4: announcements to the hotels over the real server: /api/v1/platform/announcements (Super Admin only). Answers PlatformAnnouncement (passed through).
import * as api from '../../client';
import type { PlatformAnnouncement } from '@shared/dashboards/platform';

import { platformPath, type PlatformApi } from './shared';

type AnnouncementsRealApi = Pick<PlatformApi, 'listAnnouncements' | 'createAnnouncement' | 'endAnnouncement'>;

export function createAnnouncementsRealApi(): AnnouncementsRealApi {
  return {
    listAnnouncements: () => api.get<PlatformAnnouncement[]>(platformPath('announcements')),
    createAnnouncement: (input) => api.post<PlatformAnnouncement>(platformPath('announcements'), { title: input.title, body: input.body, audience: input.audience, important: input.important === true, endsOn: input.endsOn || null }),
    endAnnouncement: (id) => api.post<PlatformAnnouncement>(platformPath('announcements', id, 'end'), {}),
  };
}
