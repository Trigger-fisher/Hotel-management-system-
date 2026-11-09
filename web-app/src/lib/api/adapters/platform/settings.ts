// Super Admin A8: platform settings over the real server (Frontend 1): /api/v1/platform/settings (docs/BACKEND.md 14.6; Super Admin only;
// planned until Backend P5). PUT is partial: only the keys given are sent (the server's body is strict). Answer PlatformSettings (passed through).
import * as api from '../../client';
import type { MailSenderIdentity } from '@shared/dashboards/mailProviders';
import type { PlatformMailUsage, PlatformMailUsageHotel, PlatformSettings, PlatformSmtpTestResult } from '@shared/dashboards/platform';

import { pick, platformPath, type PlatformApi } from './shared';

type SettingsRealApi = Pick<PlatformApi, 'getPlatformSettings' | 'updatePlatformSettings' | 'sendPlatformTestEmail' | 'getMailUsage' | 'setHotelMailCap' | 'listMailIdentities' | 'saveMailIdentity' | 'checkMailIdentity'>;

const SETTINGS_KEYS = ['roleKeys', 'defaultGstPercent', 'defaultTimeZone', 'mailFromName', 'mailFromEmail', 'mailSendingDomain', 'mailFilesKeepHours', 'smtp'] as const;

export function createSettingsRealApi(): SettingsRealApi {
  return {
    getPlatformSettings: () => api.get<PlatformSettings>(platformPath('settings')),
    updatePlatformSettings: (input) => api.put<PlatformSettings>(platformPath('settings'), pick(input, SETTINGS_KEYS)),
    // the test uses the SAVED settings; the recipient is the only input
    sendPlatformTestEmail: (to, which = 'primary') => api.post<PlatformSmtpTestResult>(platformPath('settings', 'smtp-test'), { to, which }),
    getMailUsage: (month) => api.get<PlatformMailUsage>(platformPath('mail-usage'), month ? { month } : undefined),
    listMailIdentities: () => api.get<MailSenderIdentity[]>(platformPath('mail-identities')),
    saveMailIdentity: (scope, input) => api.put<MailSenderIdentity>(platformPath('mail-identities', scope), input),
    checkMailIdentity: (scope) => api.post<MailSenderIdentity>(platformPath('mail-identities', scope, 'check'), {}),
    setHotelMailCap: (hotelId, input) => api.put<PlatformMailUsageHotel>(platformPath('hotels', hotelId, 'mail-cap'), input),
  };
}
