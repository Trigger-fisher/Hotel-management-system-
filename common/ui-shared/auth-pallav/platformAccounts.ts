// Mock only: the Hotel Admin / Group Hotel Admin accounts the Platform console's onboarding flow creates (invite -> the hotel fills the
// onboarding form with its admin's name, username, email, mobile and own password -> Platform Admin approves -> that admin signs in).
// A small pure store, synchronous, no demo data: the platform mock (through the gated wrappers in web-app/src/lib/auth/api.ts) writes it,
// the auth mock (mock.ts) reads it at sign-in. Kept in this tab's sessionStorage (guarded; mock demo accounts only, never real people)
// so it survives the reload the mock sign-out does; memory only where there is no sessionStorage (node tests). Not re-exported by index.ts.

export interface PlatformAdminAccount {
  /** The new hotel's id in ui-shared/dashboards/platform.ts (kind 'hotel'); '' for a group. */
  hotelId: string;
  /** The hotel name, or the group name for kind 'group'. */
  hotelName: string;
  kind: 'hotel' | 'group';
  /** The group id (kind 'group', or the group of a member hotel). */
  groupId?: string;
  admin: { name: string; username: string; email: string; mobile: string; password: string };
}

export type PlatformAccountStatus = 'pending' | 'approved' | 'blocked';

export interface PlatformAccountRecord {
  account: PlatformAdminAccount;
  status: PlatformAccountStatus;
}

/** sessionStorage key of the store (this tab only). */
export const PLATFORM_ACCOUNTS_KEY = 'hms-mock-platform-admins';

interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function tabStorage(): TabStorage | null {
  try {
    return (globalThis as { sessionStorage?: TabStorage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

const lower = (s: string) => s.trim().toLowerCase();

let store: Map<string, PlatformAccountRecord> | null = null;

function isRecord(row: unknown): row is PlatformAccountRecord {
  const r = row as Partial<PlatformAccountRecord> | null;
  const a = r?.account;
  return (
    !!a && typeof a.hotelId === 'string' && typeof a.hotelName === 'string' && (a.kind === 'hotel' || a.kind === 'group') &&
    !!a.admin && typeof a.admin.username === 'string' && typeof a.admin.password === 'string' &&
    (r?.status === 'pending' || r?.status === 'approved' || r?.status === 'blocked')
  );
}

/** username (lower case) -> record; read from the tab on first use. */
function accounts(): Map<string, PlatformAccountRecord> {
  if (store) return store;
  store = new Map();
  try {
    const raw = tabStorage()?.getItem(PLATFORM_ACCOUNTS_KEY);
    const rows: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(rows)) for (const row of rows) if (isRecord(row)) store.set(lower(row.account.admin.username), row);
  } catch {
    // unreadable or blocked: start empty
  }
  return store;
}

function save(): void {
  try {
    tabStorage()?.setItem(PLATFORM_ACCOUNTS_KEY, JSON.stringify([...accounts().values()]));
  } catch {
    // storage full or blocked: the accounts still work until the page reloads
  }
}

/** Usernames the auth mock already uses (built-in demo users, registered guests): set by mock.ts so this file holds no demo data. */
let takenElsewhere: (usernameLower: string) => boolean = () => false;
export function setPlatformUsernameCheck(check: (usernameLower: string) => boolean): void {
  takenElsewhere = check;
}

/** Same hotel (or same group) re-submitting its form: it replaces its own earlier entry instead of colliding with it. */
function sameOwner(a: PlatformAdminAccount, b: PlatformAdminAccount): boolean {
  return a.kind === b.kind && (a.kind === 'hotel' ? a.hotelId === b.hotelId : (a.groupId ?? '') === (b.groupId ?? ''));
}

/** Stores the onboarding admin as PENDING. The username must be unique (case-insensitive) across the mock's users and these accounts. */
export function registerPlatformAdmin(a: PlatformAdminAccount): { ok: true } | { ok: false; reason: 'username_taken' } {
  const key = lower(a.admin.username);
  if (!key) return { ok: false, reason: 'username_taken' };
  const existing = accounts().get(key);
  if ((existing && !sameOwner(existing.account, a)) || takenElsewhere(key)) return { ok: false, reason: 'username_taken' };
  accounts().set(key, { account: { ...a, admin: { ...a.admin, username: a.admin.username.trim() } }, status: 'pending' });
  save();
  return { ok: true };
}

/** hotelId '' (a group): matched by username alone; otherwise hotelId and username must both match. */
function find(hotelId: string, username: string): PlatformAccountRecord | undefined {
  const rec = accounts().get(lower(username));
  if (!rec) return undefined;
  return hotelId === '' || rec.account.hotelId === hotelId ? rec : undefined;
}

function setStatus(hotelId: string, username: string, status: PlatformAccountStatus): void {
  const rec = find(hotelId, username);
  if (!rec) return;
  rec.status = status;
  save();
}

export function approvePlatformAdmin(hotelId: string, username: string): void {
  setStatus(hotelId, username, 'approved');
}

/** Rejected or archived: sign-in then answers "This account is disabled." */
export function blockPlatformAdmin(hotelId: string, username: string): void {
  setStatus(hotelId, username, 'blocked');
}

/** The account typed at sign-in, by username or email (case-insensitive), or null. */
export function findPlatformAccount(usernameOrEmail: string): PlatformAccountRecord | null {
  const key = lower(usernameOrEmail);
  if (!key) return null;
  const byName = accounts().get(key);
  if (byName) return byName;
  for (const rec of accounts().values()) if (lower(rec.account.admin.email) === key) return rec;
  return null;
}

// ---- Hotel-level access (the Platform console's suspend / reactivate / archive / restore of a HOTEL) ----

export type PlatformHotelAccess = 'active' | 'suspended' | 'archived';

/** sessionStorage key of the hotel access states (this tab only); only hotels that are not active are kept. */
export const PLATFORM_HOTEL_ACCESS_KEY = 'hms-mock-platform-hotel-access';

interface HotelAccessRow {
  hotelId: string;
  state: Exclude<PlatformHotelAccess, 'active'>;
  reasonText?: string;
}

let access: Map<string, HotelAccessRow> | null = null;

function isAccessRow(row: unknown): row is HotelAccessRow {
  const r = row as Partial<HotelAccessRow> | null;
  return (
    !!r && typeof r.hotelId === 'string' && r.hotelId !== '' && (r.state === 'suspended' || r.state === 'archived') &&
    (r.reasonText === undefined || typeof r.reasonText === 'string')
  );
}

/** hotel id -> its not-active state; read from the tab on first use. */
function hotelAccess(): Map<string, HotelAccessRow> {
  if (access) return access;
  access = new Map();
  try {
    const raw = tabStorage()?.getItem(PLATFORM_HOTEL_ACCESS_KEY);
    const rows: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(rows)) for (const row of rows) if (isAccessRow(row)) access.set(row.hotelId, row);
  } catch {
    // unreadable or blocked: every hotel active
  }
  return access;
}

function saveAccess(): void {
  try {
    tabStorage()?.setItem(PLATFORM_HOTEL_ACCESS_KEY, JSON.stringify([...hotelAccess().values()]));
  } catch {
    // storage full or blocked: the state still holds until the page reloads
  }
}

/**
 * The hotel's access: while it is 'suspended' or 'archived' every APPROVED admin account of that hotel id refuses sign-in with
 * hotel_suspended / hotel_archived (+ the typed reason text, when given); 'active' lets them sign in again. Each account keeps its own
 * approved / pending / blocked status separately (a blocked account stays disabled, a pending one keeps its pending message).
 * hotelId '' (a group) is ignored. May be called before the hotel has any account (the state then applies once one registers).
 */
export function setHotelAccess(hotelId: string, state: PlatformHotelAccess, reasonText?: string): void {
  if (!hotelId) return;
  if (state === 'active') hotelAccess().delete(hotelId);
  else {
    const text = reasonText?.trim();
    hotelAccess().set(hotelId, text ? { hotelId, state, reasonText: text } : { hotelId, state });
  }
  saveAccess();
}

/** The hotel's access now ('active' when nothing is kept for it). */
export function hotelAccessOf(hotelId: string): { state: PlatformHotelAccess; reasonText?: string } {
  const row = hotelId ? hotelAccess().get(hotelId) : undefined;
  return row ? { state: row.state, ...(row.reasonText ? { reasonText: row.reasonText } : {}) } : { state: 'active' };
}

/** Why an onboarded account may not sign in (after the right password), or null = it may. Same strings as types.ts PallavBlockedReason. */
export type PlatformRefusal = 'hotel_pending' | 'group_pending' | 'disabled' | 'hotel_suspended' | 'hotel_archived';

/** Precedence: disabled (blocked account) > pending (its own message) > hotel archived > hotel suspended > signs in. */
export function platformSignInRefusal(rec: PlatformAccountRecord): { reason: PlatformRefusal; reasonText?: string } | null {
  if (rec.status === 'blocked') return { reason: 'disabled' };
  if (rec.status === 'pending') return { reason: rec.account.kind === 'group' ? 'group_pending' : 'hotel_pending' };
  if (rec.account.kind !== 'hotel') return null;
  const hotel = hotelAccessOf(rec.account.hotelId);
  if (hotel.state === 'active') return null;
  return { reason: hotel.state === 'archived' ? 'hotel_archived' : 'hotel_suspended', ...(hotel.reasonText ? { reasonText: hotel.reasonText } : {}) };
}

/** Tests and 'Reset demo data': forget every account and every hotel access state (memory; the tab copy too when there is one). */
export function resetPlatformAccounts(): void {
  store = new Map();
  save();
  access = new Map();
  saveAccess();
}
