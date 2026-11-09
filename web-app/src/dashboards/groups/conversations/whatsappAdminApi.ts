'use client';

// The Console's WhatsApp connection manager and Rules (plan parts 15 and 28), over /api/v1/platform/whatsapp/*. In the demo mode the screens show clearly labelled SAMPLE data (a number, a token
// and a switch are never real there and nothing is saved), as the other Console screens do; on the live server every call is the real route. Every answer is a DashResult.
import type { DashResult } from '@shared/dashboards/common';

import { get, post, put, del } from '@/lib/api/client';
import { apiMode } from '@/lib/api/mode';

export type WaLineKind = 'platform' | 'shared' | 'hotel' | 'group' | 'person';
export type WaLineStatus = 'test' | 'active' | 'paused' | 'needs_reconnect' | 'banned';

export interface WaLineView {
  id: string;
  kind: WaLineKind;
  label: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string | null;
  displayName: string | null;
  status: WaLineStatus;
  tokenState: 'valid' | 'unchecked' | 'failing' | 'needs_reconnect' | 'disconnected';
  tokenSavedAt: string | null;
  tokenSavedBy: string | null;
  tokenCheckedAt: string | null;
  quality: 'green' | 'yellow' | 'red' | 'unknown';
  nameStatus: string | null;
  messagingTier: string | null;
  registered: boolean;
  webhookSubscribed: boolean;
  subscribedFields: string[];
  lastEventAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  lastErrorText: string | null;
  lastErrorAt: string | null;
  hotelsAttached: number;
  managed: boolean;
  createdAt: string;
}

export interface WaStepResult {
  ok: boolean;
  code: string | null;
  message: string | null;
  line: WaLineView;
  accepted?: boolean;
}

export interface WaAppStatus {
  appSecret: boolean;
  verifyToken: boolean;
  sealKey: boolean;
  graphVersion: string;
  callbackUrl: string | null;
  fields: string[];
  lastVerifiedAt: string | null;
  lines: number;
}

export interface WaCreateLine {
  kind: WaLineKind;
  phoneNumberId: string;
  wabaId: string;
  token: string;
  hotelId?: string;
}

export interface WaRuleView {
  key: string;
  label: string;
  type: 'boolean' | 'number';
  value: boolean | number | null;
  builtIn: boolean | number | null;
  locked: boolean;
  lockedReason: string | null;
}

export interface WaProfileView {
  id: 'shared' | 'platform' | 'own_default';
  label: string;
  rules: WaRuleView[];
}

export interface WaNumberField {
  key: string;
  label: string;
  value: number | string;
  min?: number;
  max?: number;
  options?: string[];
  optionLabels?: Record<string, string>;
}

export interface WaRulesView {
  numbers: Record<string, number | string>;
  numberFields: WaNumberField[];
  killSwitch: { global: { killed: boolean } };
  profiles: WaProfileView[];
  lines: { id: string; kind: WaLineKind; displayName: string | null; status: WaLineStatus; paused: boolean; quality: string }[];
  lockedNotes: string[];
}

export interface WaHotelRuleView {
  key: string;
  label: string;
  type: 'boolean' | 'number';
  locked: boolean;
  lockedReason: string | null;
  effective: boolean | number | null;
  inherited: boolean | number | null;
  inheritedFrom: string;
  override: boolean | number | null;
  source: string;
}

export interface WaHotelRulesView {
  hotelId: string;
  line: WaLineView | null;
  profile: string;
  hotelPaused: boolean;
  rules: WaHotelRuleView[];
}

export interface WaLineHotel {
  hotelId: string;
  hotelName: string;
  hotelCode: string | null;
  since: string;
  chatText: string | null;
}

export interface WaLineHotels {
  attached: WaLineHotel[];
  available: { hotelId: string; hotelName: string }[];
}

/** A hotel's move to its own number (plan part 14), as the Rules screen shows it. */
export interface WaMoveStatus {
  hotelId: string;
  hotelName: string;
  state: 'none' | 'pending' | 'transition' | 'active';
  ownPhone: string | null;
  transitionEndsAt: string | null;
  approvedMessages: number;
  can: { cutOver: boolean; finish: boolean; undo: boolean };
  cutOverBlockedBy: string | null;
}

let demoMove: WaMoveStatus = { hotelId: 'demo', hotelName: 'Sample hotel', state: 'pending', ownPhone: '+91 98765 43210', transitionEndsAt: null, approvedMessages: 2, can: { cutOver: true, finish: false, undo: false }, cutOverBlockedBy: null };

const BASE = '/platform/whatsapp';
const enc = encodeURIComponent;
const FRESH = { fresh: true } as const;
const NO_KEY = { idempotent: false } as const;

export const whatsappAdminAvailable = (): boolean => apiMode() === 'real';

// ---- the demo (mock mode): sample numbers and rules; nothing is connected and nothing is saved ----
const DEMO_LINES: WaLineView[] = [
  { id: 'demo-1', kind: 'platform', label: 'EasyHotelSolutions', phoneNumberId: '105550001111', wabaId: '205550002222', displayPhone: '+1 555 000 1111', displayName: 'EasyHotelSolutions', status: 'test', tokenState: 'valid', tokenSavedAt: '2026-11-04T09:10:00Z', tokenSavedBy: 'Rajiv Malhotra', tokenCheckedAt: '2026-11-04T09:12:00Z', quality: 'green', nameStatus: 'named', messagingTier: 'TIER_250', registered: true, webhookSubscribed: true, subscribedFields: ['messages'], lastEventAt: '2026-11-04T09:30:00Z', lastVerifiedAt: '2026-11-04T09:12:00Z', lastErrorCode: null, lastErrorText: null, lastErrorAt: null, hotelsAttached: 0, managed: false, createdAt: '2026-11-04T09:05:00Z' },
  { id: 'demo-2', kind: 'shared', label: 'Shared guest number', phoneNumberId: '105550003333', wabaId: '205550002222', displayPhone: '+1 555 000 3333', displayName: null, status: 'test', tokenState: 'unchecked', tokenSavedAt: '2026-11-04T09:20:00Z', tokenSavedBy: 'Rajiv Malhotra', tokenCheckedAt: null, quality: 'unknown', nameStatus: null, messagingTier: null, registered: false, webhookSubscribed: false, subscribedFields: [], lastEventAt: null, lastVerifiedAt: null, lastErrorCode: 'token_invalid', lastErrorText: 'Meta did not accept the token for this number. Replace the token and check again.', lastErrorAt: '2026-11-04T09:21:00Z', hotelsAttached: 3, managed: false, createdAt: '2026-11-04T09:18:00Z' },
];
const META_RULE = "Meta's own rule: free text only inside the 24-hour window, a template for anything else.";
const rule = (key: string, label: string, value: boolean | number | null, locked = false, type: 'boolean' | 'number' = 'boolean'): WaRuleView => ({ key, label, type, value, builtIn: value, locked, lockedReason: locked ? META_RULE : null });
const DEMO_RULES: WaRulesView = {
  numbers: { routing_timeframe_minutes: 120, default_daily_cap: 50, hold_minutes: 10, routing_mode: 'strict', transition_days: 30, media_max_mb: 16, media_keep_days: 30, media_keep_days_platform: 30, backup_keep_days: 14, default_language: 'en' },
  numberFields: [
    { key: 'routing_timeframe_minutes', label: 'Routing time (minutes a guest stays with the hotel they chose)', value: 120, min: 5, max: 1440 },
    { key: 'default_daily_cap', label: 'Messages a hotel may start per day (0 = no limit)', value: 50, min: 0, max: 100000 },
    { key: 'hold_minutes', label: 'Minutes a message waits for the guest to choose a hotel', value: 10, min: 1, max: 60 },
    { key: 'routing_mode', label: 'Routing on the shared number', value: 'strict', options: ['strict', 'balanced'] },
    { key: 'transition_days', label: 'Days a hotel keeps both numbers when it moves', value: 30, min: 1, max: 365 },
    { key: 'media_max_mb', label: 'Largest guest file kept (MB)', value: 16, min: 1, max: 50 },
    { key: 'media_keep_days', label: "Days a hotel's guest files are kept", value: 30, min: 1, max: 365 },
    { key: 'media_keep_days_platform', label: "Days the Super Admin's and Platform Admin's files are kept", value: 30, min: 1, max: 365 },
    { key: 'backup_keep_days', label: 'Days the nightly encrypted backups of WhatsApp chats are kept', value: 14, min: 1, max: 365 },
    { key: 'default_language', label: 'Language HMS uses with a guest until it knows theirs', value: 'en', options: ['en', 'hinglish', 'hi', 'gu'], optionLabels: { en: 'English', hinglish: 'Hinglish', hi: 'Hindi', gu: 'Gujarati' } },
  ],
  killSwitch: { global: { killed: true } },
  profiles: [
    {
      id: 'shared',
      label: 'Our shared number',
      rules: [rule('hotel_may_start_chats', 'Hotels may start chats', false), rule('recipients_stay_guests_only', 'Only guests with a stay may be messaged', true), rule('templates_only_for_new_messages', 'Templates only for new messages', true, true), rule('marketing_allowed', 'Marketing messages allowed', false), rule('daily_cap', 'Messages a hotel may start per day', 50, false, 'number'), rule('consent_required_for_automatic', 'Consent needed for automatic messages', true), rule('hotel_label_on_messages', 'Hotel name on the first line', true)],
    },
    { id: 'platform', label: 'Platform number', rules: [rule('hotel_may_start_chats', 'Staff may start chats', true), rule('recipients_stay_guests_only', 'Only guests with a stay may be messaged', false), rule('templates_only_for_new_messages', 'Templates only for new messages', true, true), rule('marketing_allowed', 'Marketing messages allowed', false)] },
    { id: 'own_default', label: "Hotels' own numbers (default)", rules: [rule('hotel_may_start_chats', 'Hotels may start chats', true), rule('recipients_stay_guests_only', 'Only guests with a stay may be messaged', false), rule('templates_only_for_new_messages', 'Templates only for new messages', true, true), rule('marketing_allowed', 'Marketing messages allowed', false)] },
  ],
  lines: DEMO_LINES.map((l) => ({ id: l.id, kind: l.kind, displayName: l.displayName, status: l.status, paused: false, quality: l.quality })),
  lockedNotes: ['Meta’s own rules stay locked: free text only inside the 24-hour window, approved templates only, nothing to a number that said STOP.'],
};
const demoHotel = (hotelId: string): WaHotelRulesView => ({
  hotelId,
  line: DEMO_LINES[1],
  profile: 'shared',
  hotelPaused: false,
  rules: DEMO_RULES.profiles[0].rules.map((r) => ({ key: r.key, label: r.label, type: r.type, locked: r.locked, lockedReason: r.lockedReason, effective: r.value, inherited: r.value, inheritedFrom: 'line_profile', override: r.key === 'daily_cap' ? 20 : null, source: r.key === 'daily_cap' ? 'hotel_override' : 'line_profile' })),
});
const DEMO_LINE_HOTELS: WaLineHotels = {
  attached: [
    { hotelId: 'demo-h1', hotelName: 'Hotel Sunrise, Rajkot', hotelCode: 'sunrise', since: '2026-11-03T10:00:00Z', chatText: 'sunrise: ' },
    { hotelId: 'demo-h2', hotelName: 'Hotel Pearl, Surat', hotelCode: 'pearl', since: '2026-11-03T10:05:00Z', chatText: 'pearl: ' },
  ],
  available: [
    { hotelId: 'demo-h3', hotelName: 'Harbour Court, Kochi' },
    { hotelId: 'demo-h4', hotelName: 'Blue Lagoon Residency, Panaji' },
  ],
};
const demoStep = (id: string): WaStepResult => ({ ok: true, code: null, message: null, line: DEMO_LINES.find((l) => l.id === id) ?? DEMO_LINES[0] });
const live = <T>(run: () => Promise<DashResult<T>>, demo: () => T): Promise<DashResult<T>> => (whatsappAdminAvailable() ? run() : Promise.resolve({ ok: true, data: demo() }));

export const whatsappAdminApi = {
  appStatus: () => live(() => get<WaAppStatus>(`${BASE}/app-status`, undefined, undefined, FRESH), (): WaAppStatus => ({ appSecret: false, verifyToken: true, sealKey: true, graphVersion: 'v22.0', callbackUrl: 'https://www.easyhotelsolutions.in/api/v1/whatsapp/webhook', fields: ['messages'], lastVerifiedAt: '2026-11-04T09:12:00Z', lines: 2 })),
  storageCheck: () => live(() => post<{ ok: boolean; message: string }>(`${BASE}/storage-check`, {}, NO_KEY), () => ({ ok: true, message: 'Sample: file storage works (a test file was written, read back and deleted).' })),
  backupStep: (step: 'run' | 'verify') => live(() => post<{ ok: boolean; message: string }>(`${BASE}/backup`, { step }, NO_KEY), () => ({ ok: true, message: step === 'run' ? 'Sample: 8 backups written.' : 'Sample: 8 backups opened and checked (the newest is from today, 240 rows in all). Nothing was changed.' })),
  lines: () => live(() => get<{ lines: WaLineView[] }>(`${BASE}/lines`, undefined, undefined, FRESH), () => ({ lines: DEMO_LINES })),
  createLine: (input: WaCreateLine) => live(() => post<{ line: WaLineView }>(`${BASE}/lines`, input, NO_KEY), () => ({ line: DEMO_LINES[0] })),
  step: (id: string, step: 'verify' | 'subscribe' | 'register') => live(() => post<WaStepResult>(`${BASE}/lines/${enc(id)}/${step}`, {}, NO_KEY), () => demoStep(id)),
  test: (id: string, to: string) => live(() => post<WaStepResult>(`${BASE}/lines/${enc(id)}/test`, { to }, NO_KEY), () => ({ ...demoStep(id), accepted: true })),
  replaceToken: (id: string, token: string, confirm?: string) => live(() => put<{ line: WaLineView }>(`${BASE}/lines/${enc(id)}/token`, { token, ...(confirm ? { confirm } : {}) }, NO_KEY), () => ({ line: demoStep(id).line })),
  setPaused: (id: string, paused: boolean) => live(() => post<{ line: WaLineView }>(`${BASE}/lines/${enc(id)}/${paused ? 'pause' : 'resume'}`, {}, NO_KEY), () => ({ line: demoStep(id).line })),
  disconnect: (id: string, confirm: string) => live(() => post<{ line: WaLineView }>(`${BASE}/lines/${enc(id)}/disconnect`, { confirm }, NO_KEY), () => ({ line: demoStep(id).line })),

  lineHotels: (id: string) => live(() => get<WaLineHotels>(`${BASE}/lines/${enc(id)}/hotels`, undefined, undefined, FRESH), () => DEMO_LINE_HOTELS),
  attachHotel: (id: string, hotelId: string, hotelCode: string | null) => live(() => post<WaLineHotel>(`${BASE}/lines/${enc(id)}/hotels`, { hotelId, hotelCode }, NO_KEY), () => DEMO_LINE_HOTELS.attached[0]),
  setHotelCode: (id: string, hotelId: string, hotelCode: string | null) => live(() => put<{ hotelCode: string | null }>(`${BASE}/lines/${enc(id)}/hotels/${enc(hotelId)}`, { hotelCode }, NO_KEY), () => ({ hotelCode })),
  detachHotel: (id: string, hotelId: string) => live(() => del<{ detached: true }>(`${BASE}/lines/${enc(id)}/hotels/${enc(hotelId)}`, undefined, NO_KEY), () => ({ detached: true as const })),

  moveStatus: (hotelId: string) => live(() => get<WaMoveStatus>(`${BASE}/hotels/${enc(hotelId)}/move`, undefined, undefined, FRESH), () => demoMove),
  moveStep: (hotelId: string, step: 'cut_over' | 'finish' | 'undo') =>
    live(() => post<WaMoveStatus>(`${BASE}/hotels/${enc(hotelId)}/move`, { step }, NO_KEY), () => {
      demoMove = step === 'cut_over' ? { ...demoMove, state: 'transition', transitionEndsAt: '2026-12-04T00:00:00Z', can: { cutOver: false, finish: true, undo: true } } : step === 'finish' ? { ...demoMove, state: 'active', transitionEndsAt: null, can: { cutOver: false, finish: false, undo: true } } : { ...demoMove, state: 'pending', transitionEndsAt: null, can: { cutOver: true, finish: false, undo: false } };
      return demoMove;
    }),

  rules: () => live(() => get<WaRulesView>(`${BASE}/rules`, undefined, undefined, FRESH), () => DEMO_RULES),
  saveRules: (patch: { numbers?: Record<string, number | string>; profiles?: Record<string, Record<string, boolean | number | null>>; confirm?: boolean }) => live(() => put<WaRulesView>(`${BASE}/rules`, patch, NO_KEY), () => DEMO_RULES),
  hotelRules: (hotelId: string) => live(() => get<WaHotelRulesView>(`${BASE}/rules/hotels/${enc(hotelId)}`, undefined, undefined, FRESH), () => demoHotel(hotelId)),
  saveHotelRules: (hotelId: string, overrides: Record<string, boolean | number | null>, confirm?: boolean) => live(() => put<WaHotelRulesView>(`${BASE}/rules/hotels/${enc(hotelId)}`, { overrides, ...(confirm ? { confirm } : {}) }, NO_KEY), () => demoHotel(hotelId)),
  resetHotelRule: (hotelId: string, key: string, confirm?: boolean) => live(() => del<WaHotelRulesView>(`${BASE}/rules/hotels/${enc(hotelId)}?key=${enc(key)}${confirm ? '&confirm=true' : ''}`, undefined, NO_KEY), () => demoHotel(hotelId)),
  killSwitch: (target: { scope: 'global' } | { scope: 'line' | 'hotel'; id: string }, on: boolean, confirm?: boolean) =>
    live(() => post<{ scope: string; id: string | null; killed: boolean }>(`${BASE}/rules/kill-switch`, { ...target, on, ...(confirm ? { confirm } : {}) }, NO_KEY), () => ({ scope: target.scope, id: 'id' in target ? target.id : null, killed: on })),
};
