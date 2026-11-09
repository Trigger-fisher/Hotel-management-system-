'use client';

// The Set-up centre's calls (MJ, 5 Nov 2026), the Super Admin only: one hotel's secret set-up (mail server, online payments for the hotel and the food business, backup).
// Secrets go up and never come back: a saved one reads as `set: true` with no value.
import type { SettingGroup } from '@shared/dashboards/admin';
import type { DashResult } from '@shared/dashboards/common';
import type { MailConnectionTest } from '@shared/dashboards/conversations';
import type { MailSenderIdentity } from '@shared/dashboards/mailProviders';

import { del, get, patch, post } from './client';
import { chooseApi } from './mode';

export type HotelSetupGroup = 'email' | 'razorpay_hotel' | 'razorpay_food' | 'backup';
export type BackupStep = 'connect' | 'disconnect' | 'test' | 'run';
export interface WebsiteGoogleSetup {
  googleStatus: 'notSetUp' | 'ready' | 'connected';
  googleMapsApiKeySet: boolean;
  gbpOauthClientId: string;
  gbpOauthClientSecretSet: boolean;
  gbpRedirectUrl: string;
}
export interface HotelBackupStatus {
  connected: boolean;
  redirectUri: string;
  lastAt: string | null;
  lastResult: string | null;
}

const FRESH = { fresh: true } as const;
const NO_KEY = { idempotent: false } as const;
const hotelPath = (hotelId: string) => `/platform/setup/hotels/${encodeURIComponent(hotelId)}`;

const realHotelSetup = {
  /** One group as the hotel's Settings would draw it (fields, saved values, `set` for a saved secret). */
  getSettings: (hotelId: string, group: HotelSetupGroup): Promise<DashResult<SettingGroup>> => get<SettingGroup>(`${hotelPath(hotelId)}/settings/${group}`, undefined, undefined, FRESH),
  /** Saves one group; a secret left empty keeps what is saved, `clear` removes the named secrets. A Razorpay Key ID must match the mode (rzp_test_ / rzp_live_). */
  saveSettings: (hotelId: string, group: HotelSetupGroup, values: Record<string, string | boolean | null>, clear?: string[]) =>
    patch<{ group: SettingGroup; message: string }>(`${hotelPath(hotelId)}/settings/${group}`, { values, ...(clear?.length ? { clear } : {}) }, NO_KEY),
  /** One test email through the hotel's own mail server (default: to the hotel's own From address). */
  testEmail: (hotelId: string, to?: string) => post<{ sent: boolean; to: string; message: string; at: string; hint?: string }>(`${hotelPath(hotelId)}/email/test`, to ? { to } : {}, NO_KEY),
  testMailConnection: (hotelId: string) => post<MailConnectionTest>(`${hotelPath(hotelId)}/email/connection-test`, {}, NO_KEY),
  checkDomain: (hotelId: string) => post<MailSenderIdentity>(`${hotelPath(hotelId)}/email/check-domain`, {}, NO_KEY),
  backupStatus: (hotelId: string) => get<HotelBackupStatus>(`${hotelPath(hotelId)}/backup`, undefined, undefined, FRESH),
  backupStep: (hotelId: string, step: BackupStep) => post<HotelBackupStatus & { message?: string }>(`${hotelPath(hotelId)}/backup/${step}`, {}, NO_KEY),
  /** The website's Google keys (Maps key, Business Profile sign-in client); secrets go up only. */
  websiteGoogle: (hotelId: string) => get<WebsiteGoogleSetup>(`${hotelPath(hotelId)}/website`, undefined, undefined, FRESH),
  saveWebsiteGoogle: (hotelId: string, input: { gbpOauthClientId?: string; newGoogleMapsApiKey?: string; newGbpOauthClientSecret?: string }) => patch<WebsiteGoogleSetup>(`${hotelPath(hotelId)}/website`, input, NO_KEY),
  websiteGoogleStep: (hotelId: string, step: 'connect' | 'disconnect') => post<WebsiteGoogleSetup>(`${hotelPath(hotelId)}/website/google/${step}`, {}, NO_KEY),
};

export type HotelSetupApi = typeof realHotelSetup;

/** The demo: nothing leaves the browser; every test answers that it is simulated. */
function mockHotelSetup(): HotelSetupApi {
  const saved = new Map<string, Record<string, string | boolean | null>>();
  const ok = <T>(data: T): DashResult<T> => ({ ok: true, data });
  const SIM = 'Simulated in the demo: nothing was sent. On the real server this test ';
  const group = (hotelId: string, key: HotelSetupGroup): SettingGroup => {
    const v = saved.get(`${hotelId}:${key}`) ?? {};
    return { key, label: key, icon: 'gear', about: '', fields: Object.entries(v).map(([k, value]) => ({ key: k, label: k, type: 'text', secret: /secret|password/.test(k), options: null, help: null, placeholder: null, value: /secret|password/.test(k) ? null : (value as string | null), set: /secret|password/.test(k) && Boolean(value), savedAt: null })) } as unknown as SettingGroup;
  };
  const status: HotelBackupStatus = { connected: false, redirectUri: '', lastAt: null, lastResult: null };
  const google: WebsiteGoogleSetup = { googleStatus: 'notSetUp', googleMapsApiKeySet: false, gbpOauthClientId: '', gbpOauthClientSecretSet: false, gbpRedirectUrl: '' };
  return {
    getSettings: async (hotelId, key) => ok(group(hotelId, key)),
    saveSettings: async (hotelId, key, values) => {
      saved.set(`${hotelId}:${key}`, { ...(saved.get(`${hotelId}:${key}`) ?? {}), ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== null)) });
      return ok({ group: group(hotelId, key), message: 'Saved.' });
    },
    testEmail: async (_hotelId, to) => ok({ sent: true, to: to ?? 'you@example.in', message: `${SIM}sends one email.`, at: new Date().toISOString() }),
    testMailConnection: async () => ok({ at: new Date().toISOString(), imap: { ok: true, message: `${SIM}signs in to read mail.` }, smtp: { ok: true, message: `${SIM}signs in to send mail.` } } as unknown as MailConnectionTest),
    checkDomain: async () => ({ ok: false, error: { code: 'CONFLICT', message: 'Simulated in the demo: the domain is not looked up.', traceId: 'mock' } }),
    backupStatus: async () => ok(status),
    websiteGoogle: async () => ok(google),
    saveWebsiteGoogle: async (_hotelId, input) => ok(Object.assign(google, { gbpOauthClientId: input.gbpOauthClientId ?? google.gbpOauthClientId, googleMapsApiKeySet: google.googleMapsApiKeySet || Boolean(input.newGoogleMapsApiKey), gbpOauthClientSecretSet: google.gbpOauthClientSecretSet || Boolean(input.newGbpOauthClientSecret) })),
    websiteGoogleStep: async () => ({ ok: false, error: { code: 'CONFLICT', message: 'Simulated in the demo: Google is not contacted.', traceId: 'mock' } }),
    backupStep: async (_hotelId, step) => ok({ ...status, message: `${SIM}${step === 'run' ? 'backs the hotel up now' : step === 'test' ? 'writes and reads a small file' : 'connects Google Drive'}.` }),
  };
}

export const hotelSetupApi: HotelSetupApi = chooseApi<HotelSetupApi>(() => realHotelSetup, mockHotelSetup);

/** A staff login's email addresses (rule 4): the automatic <username>@<domain> and the extra ones the Super Admin gave. */
export interface MailAddressesView {
  auto: { address: string | null; usable: boolean };
  extras: { id: string; address: string; createdAt: string }[];
  /** null while the platform has no sending domain (nothing can be added). */
  domain: string | null;
}
/** org_name: <hotel or group>.<first name>; org_word: <hotel or group>.<word> (frontdesk, accounts); name_number: <first name>.<n>; custom: the word typed is the whole part before the @. */
export type AddressPattern = 'org_name' | 'org_word' | 'name_number' | 'custom';

const userPath = (loginId: string) => `/platform/users/${encodeURIComponent(loginId)}/mail-addresses`;
const realMailAddresses = {
  list: (loginId: string) => get<MailAddressesView>(userPath(loginId), undefined, undefined, FRESH),
  /** The address the pattern gives now, checked to be free; nothing saved. */
  preview: (loginId: string, pattern: AddressPattern, word?: string) => post<{ address: string }>(`${userPath(loginId)}/preview`, { pattern, ...(word ? { word } : {}) }, NO_KEY),
  add: (loginId: string, pattern: AddressPattern, word?: string) => post<MailAddressesView & { added: string }>(userPath(loginId), { pattern, ...(word ? { word } : {}) }, NO_KEY),
  /** Undo of a removal: add again with pattern custom and the part before the @. */
  remove: (loginId: string, addressId: string) => del<MailAddressesView>(`${userPath(loginId)}/${encodeURIComponent(addressId)}`, undefined, NO_KEY),
};
export type MailAddressesApi = typeof realMailAddresses;

function mockMailAddresses(): MailAddressesApi {
  const domain = 'mail.example.in';
  const byLogin = new Map<string, { id: string; address: string; createdAt: string }[]>();
  const ok = <T>(data: T): DashResult<T> => ({ ok: true, data });
  const view = (loginId: string): MailAddressesView => ({ auto: { address: `you@${domain}`, usable: true }, extras: byLogin.get(loginId) ?? [], domain });
  const make = (loginId: string, pattern: AddressPattern, word?: string) => {
    const base = pattern === 'custom' ? (word ?? '').toLowerCase() : pattern === 'org_word' ? `hotel.${(word ?? 'desk').toLowerCase()}` : pattern === 'org_name' ? 'hotel.you' : 'you.1';
    const used = new Set((byLogin.get(loginId) ?? []).map((x) => x.address));
    let local = base;
    for (let i = 2; used.has(`${local}@${domain}`); i++) local = `${base}${i}`;
    return `${local}@${domain}`;
  };
  return {
    list: async (loginId) => ok(view(loginId)),
    preview: async (loginId, pattern, word) => ok({ address: make(loginId, pattern, word) }),
    add: async (loginId, pattern, word) => {
      const address = make(loginId, pattern, word);
      byLogin.set(loginId, [...(byLogin.get(loginId) ?? []), { id: `${Date.now()}`, address, createdAt: new Date().toISOString() }]);
      return ok({ ...view(loginId), added: address });
    },
    remove: async (loginId, addressId) => {
      byLogin.set(loginId, (byLogin.get(loginId) ?? []).filter((x) => x.id !== addressId));
      return ok(view(loginId));
    },
  };
}

export const mailAddressesApi: MailAddressesApi = chooseApi<MailAddressesApi>(() => realMailAddresses, mockMailAddresses);

/** The Set-up centre's list (rule 6): every outside service, platform-wide then per hotel, with one plain reason and the wizard step its button opens. */
export type SetupStatus = 'not_set_up' | 'working' | 'needs_attention';
export type SetupServiceKey = 'mail' | 'whatsapp' | 'storage' | 'hotel_mail' | 'payments_hotel' | 'payments_food' | 'backup';
export interface SetupRow {
  id: string;
  service: SetupServiceKey;
  scope: 'platform' | 'hotel';
  hotelId: string | null;
  hotelName: string | null;
  name: string;
  status: SetupStatus;
  reason: string | null;
  step: string;
}
export interface SetupOverview {
  demo: boolean;
  rows: SetupRow[];
  counts: Record<SetupStatus, number>;
}
export interface SetupTestResult {
  ok: boolean;
  message: string;
  simulated: boolean;
}
/** mail: `to` is the Super Admin's own address; whatsapp: `lineId` and the mobile `to`; hotel services: `hotelId`. */
export interface SetupTestInput {
  to?: string;
  hotelId?: string;
  lineId?: string;
}

const realSetupCentre = {
  overview: () => get<SetupOverview>('/platform/setup', undefined, undefined, FRESH),
  test: (service: Exclude<SetupServiceKey, 'storage'>, input: SetupTestInput = {}) => post<SetupTestResult>(`/platform/setup/${service}/test`, input, NO_KEY),
};
export type SetupCentreApi = typeof realSetupCentre;

function mockSetupCentre(): SetupCentreApi {
  const ok = <T>(data: T): DashResult<T> => ({ ok: true, data });
  const rows: SetupRow[] = [
    { id: 'mail', service: 'mail', scope: 'platform', hotelId: null, hotelName: null, name: 'Email for the platform', status: 'working', reason: null, step: 'mail' },
    { id: 'whatsapp', service: 'whatsapp', scope: 'platform', hotelId: null, hotelName: null, name: 'WhatsApp numbers', status: 'needs_attention', reason: 'Shared number needs a new token.', step: 'whatsapp' },
    { id: 'storage', service: 'storage', scope: 'platform', hotelId: null, hotelName: null, name: 'Photo storage', status: 'not_set_up', reason: 'Photos are kept on this server only. Give the storage bucket details to keep them safe.', step: 'storage' },
    { id: 'payments_hotel:demo', service: 'payments_hotel', scope: 'hotel', hotelId: 'demo', hotelName: 'Hotel Sunrise', name: 'Online payments (rooms)', status: 'not_set_up', reason: 'Not set up. Guests and companies pay at the hotel.', step: 'payments_hotel' },
    { id: 'backup:demo', service: 'backup', scope: 'hotel', hotelId: 'demo', hotelName: 'Hotel Sunrise', name: 'Backup', status: 'not_set_up', reason: 'Google Drive is not connected for this hotel.', step: 'backup' },
  ];
  const counts = { not_set_up: 0, working: 0, needs_attention: 0 } as Record<SetupStatus, number>;
  for (const r of rows) counts[r.status]++;
  return {
    overview: async () => ok({ demo: true, rows, counts }),
    test: async () => ok({ ok: true, simulated: true, message: 'Simulated in the demo: nothing was sent and no outside service was called. On the real server this test runs for real.' }),
  };
}

export const setupCentreApi: SetupCentreApi = chooseApi<SetupCentreApi>(() => realSetupCentre, mockSetupCentre);

/** Test an API key just made (shown once): `This key works for <hotel>` or why not. The key goes up only. */
export const apiKeyTestApi = chooseApi(
  () => ({ test: (token: string) => post<{ ok: boolean; message: string }>('/platform/api-tokens/test', { token }, NO_KEY) }),
  () => ({ test: async (): Promise<DashResult<{ ok: boolean; message: string }>> => ({ ok: true, data: { ok: true, message: 'Simulated in the demo: no key was checked.' } }) }),
);
