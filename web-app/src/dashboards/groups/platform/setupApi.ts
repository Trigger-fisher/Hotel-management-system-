'use client';

// The Set-up centre's per-hotel services and the extra email addresses of a staff user (Super Admin only on the server: gate.superRead / gate.superWrite,
// audited). Real routes: /api/v1/platform/setup/hotels/{id}/payments (GET, PUT), /backup (GET, PUT), /website (GET, PATCH), /id-photos (GET, PUT) and /api/v1/platform/users/{id}/mail-addresses
// (patterns org_name, org_word, name_number, custom). A saved secret is never sent back: only whether it is set. The demo keeps everything in this tab.
import type { DashResult } from '@shared/dashboards/common';
import { setupCopy } from '@shared/dashboards/platform';

import { del, get, patch, post, put } from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';

export type PayBusiness = 'hotel' | 'food';
export type PayMode = 'test' | 'live';

export interface PaySetup {
  business: PayBusiness;
  mode: PayMode;
  keyId: string;
  keySecretSet: boolean;
  webhookUrl: string;
  webhookSecretSet: boolean;
  webhookSecretAt: string | null;
  /** Switched on for guests and companies. */
  enabled: boolean;
  lastWebhookAt: string | null;
  lastPaymentAt: string | null;
  lastTest: { at: string; ok: boolean; message: string } | null;
}

export interface BackupSetup {
  clientId: string;
  clientSecretSet: boolean;
  connected: boolean;
  keepDays: number;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
}

export interface WebsiteKeys {
  mapsKeySet: boolean;
  gbpClientId: string;
  gbpClientSecretSet: boolean;
}

export interface IdPhotos {
  exactCopy: boolean;
}

export interface MailAddress {
  id: string;
  address: string;
  kind: 'auto' | 'extra';
  createdAt: string | null;
  createdBy: string | null;
}

export interface TestResult {
  ok: boolean;
  message: string;
  hint?: string | null;
}

/** One hotel's overall state in the Set-up centre's list. */
export interface HotelOverall {
  state: 'not_set_up' | 'working' | 'attention';
  reason: string;
}

type ServiceState = { status: 'not_set_up' | 'working' | 'needs_attention'; name: string; reason: string | null };

/** The worst state of a hotel's services, in one plain sentence. */
export function overallOf(rows: readonly ServiceState[]): HotelOverall {
  const O = setupCopy.hotelOverall;
  const bad = rows.filter((r) => r.status === 'needs_attention');
  if (bad.length === 1) return { state: 'attention', reason: `${bad[0].name}: ${bad[0].reason ?? setupCopy.state.attention}` };
  if (bad.length) return { state: 'attention', reason: O.needs(bad.length) };
  const unset = rows.filter((r) => r.status === 'not_set_up').length;
  if (rows.length === 0 || unset === rows.length) return { state: 'not_set_up', reason: O.nothing };
  return { state: 'working', reason: unset ? O.some(unset) : O.allWorking };
}

export interface SetupApi {
  /** Each hotel's overall state, by hotel id. */
  hotelStates(hotelIds: readonly string[]): Promise<DashResult<Record<string, HotelOverall>>>;
  payments(hotelId: string): Promise<DashResult<{ items: PaySetup[] }>>;
  savePayments(hotelId: string, input: { business: PayBusiness; mode?: PayMode; keyId?: string; keySecret?: string; enabled?: boolean }): Promise<DashResult<PaySetup>>;
  makeWebhookSecret(hotelId: string, business: PayBusiness): Promise<DashResult<{ secret: string; setup: PaySetup }>>;
  testPayments(hotelId: string, business: PayBusiness): Promise<DashResult<TestResult>>;
  backup(hotelId: string): Promise<DashResult<BackupSetup>>;
  saveBackup(hotelId: string, input: { clientId?: string; clientSecret?: string; keepDays?: number }): Promise<DashResult<BackupSetup>>;
  backupStep(hotelId: string, step: 'test' | 'run'): Promise<DashResult<TestResult>>;
  website(hotelId: string): Promise<DashResult<WebsiteKeys>>;
  saveWebsite(hotelId: string, input: { mapsKey?: string; gbpClientId?: string; gbpClientSecret?: string }): Promise<DashResult<WebsiteKeys>>;
  /** How the hotel's guest ID pictures are stored: false = a sharp copy under 500 KB, true = an exact copy (bigger files). */
  idPhotos(hotelId: string): Promise<DashResult<IdPhotos>>;
  saveIdPhotos(hotelId: string, exactCopy: boolean): Promise<DashResult<IdPhotos>>;
  mailAddresses(userId: string): Promise<DashResult<{ items: MailAddress[]; patterns: { id: string; label: string; preview: string; free: boolean }[] }>>;
  addMailAddress(userId: string, pattern: string): Promise<DashResult<MailAddress>>;
  removeMailAddress(userId: string, addressId: string): Promise<DashResult<{ removed: true }>>;
  restoreMailAddress(userId: string, address: string): Promise<DashResult<MailAddress>>;
}

const enc = encodeURIComponent;
const H = (id: string) => `/platform/setup/hotels/${enc(id)}`;
const NO_KEY = { idempotent: false } as const;

type ServerBackup = { connected: boolean; lastAt: string | null; lastResult: string | null; clientId: string; clientSecretSet: boolean; keepDays: number };
type ServerSite = { googleMapsApiKeySet: boolean; gbpOauthClientId: string; gbpOauthClientSecretSet: boolean };
type ServerAddresses = { auto: { address: string | null; usable: boolean }; extras: { id: string; address: string; createdAt: string }[]; domain: string | null };
type ServerPattern = { pattern: 'org_name' | 'org_word' | 'name_number' | 'custom'; word?: string };

/** The choices offered under "Give another address", as the server's patterns. */
export const ADDRESS_PATTERNS: readonly { id: string; label: string; body: ServerPattern }[] = [
  { id: 'frontdesk', label: 'frontdesk', body: { pattern: 'org_word', word: 'frontdesk' } },
  { id: 'name.n', label: 'name.n', body: { pattern: 'name_number' } },
  { id: 'reservations', label: 'reservations', body: { pattern: 'org_word', word: 'reservations' } },
];

const SITE_FIELDS: Record<string, string> = { newGoogleMapsApiKey: 'mapsKey', gbpOauthClientId: 'gbpClientId', newGbpOauthClientSecret: 'gbpClientSecret' };

const mapResult = <S, T>(r: DashResult<S>, f: (s: S) => T): DashResult<T> => (r.ok ? { ok: true, data: f(r.data) } : r);
const backupOf = (b: ServerBackup): BackupSetup => ({ clientId: b.clientId, clientSecretSet: b.clientSecretSet, connected: b.connected, keepDays: b.keepDays, lastRunAt: b.lastAt, lastRunOk: b.lastResult === null ? null : !/fail|error|not/i.test(b.lastResult) });
const siteOf = (s: ServerSite): WebsiteKeys => ({ mapsKeySet: s.googleMapsApiKeySet, gbpClientId: s.gbpOauthClientId, gbpClientSecretSet: s.gbpOauthClientSecretSet });
const addressesOf = (v: ServerAddresses): MailAddress[] => [
  ...(v.auto.address ? [{ id: 'auto', address: v.auto.address, kind: 'auto' as const, createdAt: null, createdBy: null }] : []),
  ...v.extras.map((x) => ({ id: x.id, address: x.address, kind: 'extra' as const, createdAt: x.createdAt, createdBy: null })),
];

function real(): SetupApi {
  const addrPath = (userId: string) => `/platform/users/${enc(userId)}/mail-addresses`;
  return {
    hotelStates: async (ids) => {
      const r = await get<{ rows: (ServiceState & { scope: string; hotelId: string | null })[] }>('/platform/setup', undefined, undefined, { fresh: true });
      if (!r.ok) return r;
      return { ok: true, data: Object.fromEntries(ids.map((id) => [id, overallOf(r.data.rows.filter((x) => x.scope === 'hotel' && x.hotelId === id))])) };
    },
    payments: (id) => get(`${H(id)}/payments`, undefined, undefined, { fresh: true }),
    savePayments: (id, input) => put(`${H(id)}/payments`, input, NO_KEY),
    makeWebhookSecret: (id, business) => post(`${H(id)}/payments/${business}/webhook-secret`, {}, NO_KEY),
    testPayments: (id, business) => post(`${H(id)}/payments/${business}/test`, {}, NO_KEY),
    backup: async (id) => mapResult(await get<ServerBackup>(`${H(id)}/backup`, undefined, undefined, { fresh: true }), backupOf),
    saveBackup: async (id, input) => mapResult(await put<ServerBackup>(`${H(id)}/backup`, input, NO_KEY), backupOf),
    backupStep: async (id, step) => {
      const r = await post<{ message?: string }>(`${H(id)}/backup/${step}`, {}, NO_KEY);
      if (r.ok) return { ok: true, data: { ok: true, message: r.data.message ?? '' } };
      return r.error.code === 'CONFLICT' ? { ok: true, data: { ok: false, message: r.error.message } } : r;
    },
    website: async (id) => mapResult(await get<ServerSite>(`${H(id)}/website`, undefined, undefined, { fresh: true }), siteOf),
    saveWebsite: async (id, input) => {
      const r = await patch<ServerSite>(
        `${H(id)}/website`,
        { ...(input.mapsKey ? { newGoogleMapsApiKey: input.mapsKey } : {}), ...(input.gbpClientId !== undefined ? { gbpOauthClientId: input.gbpClientId } : {}), ...(input.gbpClientSecret ? { newGbpOauthClientSecret: input.gbpClientSecret } : {}) },
        NO_KEY,
      );
      if (r.ok) return { ok: true, data: siteOf(r.data) };
      const fields = r.error.details?.fields;
      return fields ? { ok: false, error: { ...r.error, details: { ...r.error.details, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [SITE_FIELDS[k] ?? k, v])) } } } : r;
    },
    idPhotos: (id) => get(`${H(id)}/id-photos`, undefined, undefined, { fresh: true }),
    saveIdPhotos: (id, exactCopy) => put(`${H(id)}/id-photos`, { exactCopy }, NO_KEY),
    mailAddresses: async (userId) => {
      const r = await get<ServerAddresses>(addrPath(userId), undefined, undefined, { fresh: true });
      if (!r.ok) return r;
      const patterns = r.data.domain
        ? await Promise.all(
            ADDRESS_PATTERNS.map(async (p) => {
              const pr = await post<{ address: string }>(`${addrPath(userId)}/preview`, p.body, NO_KEY);
              return { id: p.id, label: p.label, preview: pr.ok ? pr.data.address : '', free: pr.ok };
            }),
          )
        : [];
      return { ok: true, data: { items: addressesOf(r.data), patterns: patterns.filter((p, i, all) => all.findIndex((q) => q.preview === p.preview) === i) } };
    },
    addMailAddress: async (userId, pattern) => {
      const p = ADDRESS_PATTERNS.find((x) => x.id === pattern);
      if (!p) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Pick one of the addresses offered.', traceId: 'client' } };
      const r = await post<ServerAddresses & { added: string }>(addrPath(userId), p.body, NO_KEY);
      return mapResult(r, (v) => addressesOf(v).find((a) => a.address === v.added) ?? { id: v.added, address: v.added, kind: 'extra', createdAt: null, createdBy: null });
    },
    removeMailAddress: async (userId, addressId) => mapResult(await del<ServerAddresses>(`${addrPath(userId)}/${enc(addressId)}`, undefined, NO_KEY), () => ({ removed: true as const })),
    restoreMailAddress: async (userId, address) => {
      const r = await post<ServerAddresses & { added: string }>(addrPath(userId), { pattern: 'custom', word: address.split('@')[0] }, NO_KEY);
      return mapResult(r, (v) => addressesOf(v).find((a) => a.address === v.added) ?? { id: v.added, address: v.added, kind: 'extra', createdAt: null, createdBy: null });
    },
  };
}

function demo(): SetupApi {
  const ok = <T>(data: T): Promise<DashResult<T>> => Promise.resolve({ ok: true, data });
  const now = () => new Date().toISOString();
  const pay = new Map<string, PaySetup>();
  const backups = new Map<string, BackupSetup>();
  const sites = new Map<string, WebsiteKeys>();
  const addrs = new Map<string, MailAddress[]>();
  const exact = new Set<string>();
  const payOf = (id: string, b: PayBusiness): PaySetup => {
    const k = `${id}:${b}`;
    if (!pay.has(k)) pay.set(k, { business: b, mode: 'test', keyId: '', keySecretSet: false, webhookUrl: `https://www.easyhotelsolutions.in/api/v1/webhooks/razorpay/${id}/${b}`, webhookSecretSet: false, webhookSecretAt: null, enabled: false, lastWebhookAt: null, lastPaymentAt: null, lastTest: null });
    return pay.get(k)!;
  };
  const backupOf = (id: string): BackupSetup => {
    if (!backups.has(id)) backups.set(id, { clientId: '', clientSecretSet: false, connected: false, keepDays: 30, lastRunAt: null, lastRunOk: null });
    return backups.get(id)!;
  };
  const siteOf = (id: string): WebsiteKeys => {
    if (!sites.has(id)) sites.set(id, { mapsKeySet: false, gbpClientId: '', gbpClientSecretSet: false });
    return sites.get(id)!;
  };
  const addrOf = (u: string): MailAddress[] => {
    if (!addrs.has(u)) addrs.set(u, [{ id: `${u}-auto`, address: `${u.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user'}@mail.easyhotelsolutions.in`, kind: 'auto', createdAt: null, createdBy: null }]);
    return addrs.get(u)!;
  };
  const local = (u: string) => addrOf(u)[0].address.split('@')[0];
  const patterns = (u: string) => {
    const base = local(u);
    const taken = new Set(addrOf(u).map((a) => a.address));
    const list = [
      { id: 'frontdesk', label: 'frontdesk' },
      { id: 'name.n', label: `${base}.2` },
      { id: 'reservations', label: 'reservations' },
    ];
    return list.map((p) => {
      const preview = `${p.id === 'name.n' ? p.label : `${base}.${p.label}`}@mail.easyhotelsolutions.in`;
      return { id: p.id, label: p.label, preview, free: !taken.has(preview) };
    });
  };
  const statesOf = (id: string): ServiceState[] => {
    const S = setupCopy.services;
    const pays = (['hotel', 'food'] as const).map((b): ServiceState => {
      const p = payOf(id, b);
      const name = `${S.payments.title}: ${setupCopy.payments.business[b]}`;
      return !p.keyId && !p.keySecretSet ? { status: 'not_set_up', name, reason: null } : !p.keySecretSet || !p.keyId ? { status: 'needs_attention', name, reason: setupCopy.reasons.keysMissing } : { status: 'working', name, reason: null };
    });
    const b = backupOf(id);
    const s = siteOf(id);
    return [...pays, { status: b.connected ? 'working' : 'not_set_up', name: S.hotelBackup.title, reason: null }, { status: s.mapsKeySet || s.gbpClientSecretSet ? 'working' : 'not_set_up', name: S.website.title, reason: null }];
  };
  return {
    hotelStates: (ids) => ok(Object.fromEntries(ids.map((id) => [id, overallOf(statesOf(id))]))),
    payments: (id) => ok({ items: [payOf(id, 'hotel'), payOf(id, 'food')] }),
    savePayments: (id, input) => {
      const p = payOf(id, input.business);
      const next: PaySetup = { ...p, ...(input.mode ? { mode: input.mode } : {}), ...(input.keyId !== undefined ? { keyId: input.keyId } : {}), ...(input.keySecret ? { keySecretSet: true } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) };
      pay.set(`${id}:${input.business}`, next);
      return ok(next);
    },
    makeWebhookSecret: (id, business) => {
      const next = { ...payOf(id, business), webhookSecretSet: true, webhookSecretAt: now() };
      pay.set(`${id}:${business}`, next);
      const secret = Array.from({ length: 32 }, (_, i) => 'abcdefghjkmnpqrstuvwxyz23456789'[(i * 7 + id.length * 3) % 31]).join('');
      return ok({ secret, setup: next });
    },
    testPayments: (id, business) => {
      const p = payOf(id, business);
      if (!p.keyId || !p.keySecretSet) return ok({ ok: false, message: 'The keys are not saved yet.', hint: 'Go back to the Keys step and save the Key ID and the Key secret.' });
      const next = { ...p, lastTest: { at: now(), ok: true, message: 'The keys work.' }, lastWebhookAt: now() };
      pay.set(`${id}:${business}`, next);
      return ok({ ok: true, message: 'The keys work and a test payment reached the app. Nobody was charged.' });
    },
    backup: (id) => ok(backupOf(id)),
    saveBackup: (id, input) => {
      const b = backupOf(id);
      const next: BackupSetup = { ...b, ...(input.clientId !== undefined ? { clientId: input.clientId } : {}), ...(input.clientSecret ? { clientSecretSet: true } : {}), ...(input.keepDays ? { keepDays: input.keepDays } : {}) };
      next.connected = next.clientId !== '' && next.clientSecretSet;
      backups.set(id, next);
      return ok(next);
    },
    backupStep: (id, step) => {
      const b = backupOf(id);
      if (!b.connected) return ok({ ok: false, message: 'Google Drive is not connected yet.', hint: 'Save the client ID and the client secret in the first step.' });
      if (step === 'run') backups.set(id, { ...b, lastRunAt: now(), lastRunOk: true });
      return ok({ ok: true, message: step === 'run' ? 'The backup ran and was saved in Google Drive.' : 'A small file was written to Google Drive and read back.' });
    },
    website: (id) => ok(siteOf(id)),
    saveWebsite: (id, input) => {
      const s = siteOf(id);
      const next: WebsiteKeys = { mapsKeySet: s.mapsKeySet || Boolean(input.mapsKey), gbpClientId: input.gbpClientId ?? s.gbpClientId, gbpClientSecretSet: s.gbpClientSecretSet || Boolean(input.gbpClientSecret) };
      sites.set(id, next);
      return ok(next);
    },
    idPhotos: (id) => ok({ exactCopy: exact.has(id) }),
    saveIdPhotos: (id, on) => {
      if (on) exact.add(id);
      else exact.delete(id);
      return ok({ exactCopy: on });
    },
    mailAddresses: (u) => ok({ items: addrOf(u), patterns: patterns(u) }),
    addMailAddress: (u, pattern) => {
      const p = patterns(u).find((x) => x.id === pattern);
      if (!p || !p.free) return Promise.resolve({ ok: false, error: { code: 'CONFLICT', message: 'This address is already taken. Pick another.', traceId: 'demo' } });
      const a: MailAddress = { id: `${u}-${Date.now()}`, address: p.preview, kind: 'extra', createdAt: now(), createdBy: 'You' };
      addrs.set(u, [...addrOf(u), a]);
      return ok(a);
    },
    removeMailAddress: (u, addressId) => {
      addrs.set(u, addrOf(u).filter((a) => a.id !== addressId || a.kind === 'auto'));
      return ok({ removed: true as const });
    },
    restoreMailAddress: (u, address) => {
      const a: MailAddress = { id: `${u}-${Date.now()}`, address, kind: 'extra', createdAt: now(), createdBy: 'You' };
      addrs.set(u, [...addrOf(u), a]);
      return ok(a);
    },
  };
}

export const setupApi: SetupApi = chooseApi<SetupApi>(real, demo);
