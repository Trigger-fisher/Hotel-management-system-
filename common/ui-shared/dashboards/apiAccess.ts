// API access keys (Super Admin > Platform settings > API access; platform migration 0129; docs/plans/API-ACCESS-TOKENS-PLAN-2026-10-18.md). The contract the screen, the HTTP
// adapter and the mock share. A key is sent as `Authorization: Bearer hms_pat_...`; it is shown ONCE when it is made and never again.
import type { DashResult } from './common';

/** read = GET only, with the private data blocked; full = read and write; ai = GET only for the other developer's AI: everything readable except secrets, no short life (MJ, 4 Nov 2026). */
export type ApiKeyLevel = 'read' | 'full' | 'ai';
export type ApiKeyScope = 'platform' | 'hotel' | 'all';

/** One key as the list shows it (never the key itself: only its first characters). */
export interface ApiKey {
  id: string;
  name: string;
  /** "hms_pat_ab12" */
  prefix: string;
  level: ApiKeyLevel;
  scope: ApiKeyScope;
  hotelId: string | null;
  hotelName: string | null;
  ipAllow: string[];
  testMode: boolean;
  callsPerMinute: number;
  reason: string | null;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  /** Hours left when the list was read (0 when expired or revoked): the list shows "expires in N days", red under 24 hours. */
  expiresInHours: number;
  lastUsedAt: string | null;
  lastIp: string | null;
  /** Calls made today (UTC). */
  callsToday: number;
  /** The addresses the key was used from (newest 20). */
  ipSeen: string[];
  status: 'active' | 'expired' | 'revoked';
  revokedAt: string | null;
}

export interface ApiAccessView {
  keys: ApiKey[];
  /** The Super Admin's switch for full access keys (off until turned on, with a reason). */
  fullAccess: { enabled: boolean; changedAt: string | null; changedByName: string | null; reason: string | null };
  activeCount: number;
  maxActive: number;
}

export interface ApiKeyCreate {
  name: string;
  level: ApiKeyLevel;
  scope: ApiKeyScope;
  /** Needed for scope "hotel". */
  hotelId?: string | null;
  /** Read keys: 1, 7 or 30 days. Full keys: 1, 6 or 24 hours. */
  expiresInHours: number;
  /** Required (at least one) for full keys; optional for read keys. */
  ipAllow: string[];
  /** Full keys: why (3 to 300 characters). */
  reason?: string | null;
  /** Full keys: the second confirmation ("I understand"). */
  confirmFull?: boolean;
  /** Full keys: on by default; turning it off needs testModeOffReason. */
  testMode?: boolean;
  testModeOffReason?: string | null;
  /** Full keys: 10 to 3000 (default 600). Read keys are always 60. */
  callsPerMinute?: number;
}

/** The answer to "Create": the key, shown once. */
export interface ApiKeyCreated {
  key: string;
  apiKey: ApiKey;
}

export interface ApiAccessApi {
  view(): Promise<DashResult<ApiAccessView>>;
  create(input: ApiKeyCreate): Promise<DashResult<ApiKeyCreated>>;
  revoke(id: string): Promise<DashResult<{ revoked: boolean }>>;
  revokeAll(reason: string): Promise<DashResult<{ revoked: number }>>;
  setFullAccess(input: { enabled: boolean; reason: string; confirm: boolean }): Promise<DashResult<ApiAccessView['fullAccess']>>;
}

export const API_ACCESS_LIMITS = {
  maxActive: 5,
  readExpiryHours: [24, 24 * 7, 24 * 30] as const,
  fullExpiryHours: [1, 6, 24] as const,
  defaultReadExpiryHours: 24 * 7,
  defaultFullExpiryHours: 6,
  readCallsPerMinute: 60,
  fullCallsPerMinute: { min: 10, max: 3000, default: 600 },
  /** An AI key: read only, no short life (stored as 10 years and shown as "Never"). */
  aiCallsPerMinute: { min: 10, max: 3000, default: 600 },
  aiExpiryHours: 24 * 3650,
  maxIps: 10,
  nameMax: 60,
  reasonMin: 3,
  reasonMax: 300,
} as const;

export const apiAccessCopy = {
  tab: 'API access',
  intro:
    'Keys let a tool (for example Claude, for testing) use this site without a browser. A key acts as you, the Super Admin, within its level and scope. Sign-in, passwords, payments, saved secrets, backups and key management are never available to a key.',
  levels: { read: 'Read only', full: 'Full access', ai: 'AI (read all)' } as Record<ApiKeyLevel, string>,
  levelHelp: {
    ai: 'For the other developer\'s AI. Reads ALL data of the console and of every hotel (guests, bills, staff, messages), only secrets are blocked. It can change nothing. No expiry: it works until you revoke it. Needs a reason.',
    read: 'Can look at everything its scope reaches, change nothing.',
    full: 'Can read AND change everything its scope reaches, in the console and in hotels. For heavy testing only. Needs the switch below, an IP address, a reason and a short life.',
  } as Record<ApiKeyLevel, string>,
  scopes: { platform: 'Platform console only', hotel: 'One hotel', all: 'Console and every hotel' } as Record<ApiKeyScope, string>,
  scopeHelp: 'With "Console and every hotel", the tool names the hotel in each call (header X-HMS-Hotel: <hotel id>).',
  ipHelp: 'Only these addresses may use the key (one per line). Recommended for every key; required for full access.',
  testMode: 'Test mode',
  testModeHelp: 'While on, calls made with this key never send real mail. Keep it on for load tests.',
  testModeOffReason: 'Why turn test mode off?',
  shownOnce: 'Copy this key now. It is shown only once.',
  shownOnceWarning: 'Anyone with this key can read your data until it expires or you revoke it.',
  shownOnceWarningFull: 'Anyone with this key can read AND CHANGE your data until it expires or you revoke it.',
  neverExpires: 'No expiry',
  shownOnceWarningAi: 'Anyone with this key can read ALL your data (every hotel, every guest) until you revoke it. It never expires. Give it only to the developer, over a safe channel.',
  expiresIn: (hours: number) => (hours < 24 ? `Expires in ${hours} hour${hours === 1 ? '' : 's'}` : `Expires in ${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? '' : 's'}`),
  fullAccessSwitch: 'Allow full access keys',
  fullAccessHelp: 'Off by default. While off, no full access key works (existing ones stop at once).',
  revokeAll: 'Revoke all keys',
  revokeAllConfirm: 'Every key stops working at once. Tools using them will get "not signed in".',
  confirmFull: 'I understand this key can change real data in the console and in hotels.',
  staging:
    'For a load test with many users, use a staging copy of the site and database rather than the live site: a test on the live site shares the database with your hotels and can slow them down.',
  newIp: 'Used from a new address',
} as const;
