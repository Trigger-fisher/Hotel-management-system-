// Dev-only mock for the v2 (Pallav) login. Never import outside dev-only code paths.

import type { ApiError, ApiResult, AuthErrorCode } from '../auth/types';
import type { HmsUser as AuthUser, PallavAuthApi, PallavBlockedReason, Session, SignInResult } from './types';
import { findPlatformAccount, platformSignInRefusal, setPlatformUsernameCheck, type PlatformAdminAccount } from './platformAccounts';
// Tiny module-level recorder only (common.ts has no imports): the admin mock merges these rows into its sign-in history.
import { recordMockSignInAttempt, UNKNOWN_SIGN_IN_USERNAME } from '../dashboards/common';
import { mockCodeRequired } from '../dashboards/signInCode.mock';

// The Platform console's onboarding accounts (store in platformAccounts.ts; the sign-in below reads it).
export { registerPlatformAdmin, approvePlatformAdmin, blockPlatformAdmin, findPlatformAccount, setHotelAccess } from './platformAccounts';
export type { PlatformAdminAccount, PlatformHotelAccess } from './platformAccounts';

declare function setTimeout(callback: () => void, ms?: number): unknown;

export const PALLAV_DEMO_TITLE = 'Demo accounts (development only)';
export const PALLAV_DEMO_PASSWORD = 'Demo@Pass2026';
export const PALLAV_DEMO_CODE = '123456';

/** Usernames only (MJ #9). */
export const PALLAV_DEMO_ACCOUNTS: { username: string; shows: string }[] = [
  { username: 'staff', shows: 'Signs straight in (Hotel User)' },
  { username: 'anita', shows: 'Hotel Admin (hotel super admin role): backdate; recycle bins (emailed code only if switched on in My Profile)' },
  { username: 'pooja.shah', shows: 'Hotel Admin of a brand-new hotel (Hotel Pearl, Surat; also typed as newhotel): Set up your hotel checklist' },
  { username: 'mihir', shows: 'Super Admin: Platform console (enters a hotel only by a visit); backdate, force mode, recycle bins' },
  { username: 'firsttime', shows: 'Temporary password: must set own password' },
  { username: 'guest', shows: 'Guest dashboard' },
  { username: 'corporate', shows: 'Corporate dashboard' },
  { username: 'group', shows: 'Group Hotel Admin of Sunrise Group: Group console' },
  { username: 'groupadmin', shows: 'Group Hotel Admin of Sunrise Group: Group console' },
  { username: 'platform', shows: 'Platform Admin: Platform console' },
  { username: 'superadmin', shows: 'Super Admin (platform): Platform console' },
  { username: 'locked', shows: 'Locked for 15 minutes' },
  { username: 'blocked', shows: 'Blocked by an admin' },
  { username: 'error', shows: 'Server error' },
  { username: 'busy', shows: 'Too many requests' },
  { username: 'slow', shows: 'Very slow answer (4 s), then signs in' },
];

export interface PallavMockOptions {
  latencyMs?: number;
  offline?: () => boolean;
  now?: () => number;
  /**
   * sessionStorage key under which the guests made by `registerGuest` (and their passwords) survive a page reload in this tab.
   * Unset (tests, any other caller) = memory only. Only the web app's gated mock passes it; real mode never creates this mock.
   */
  persistKey?: string;
}

/** The part of the browser's Storage the mock uses (ui-shared has no DOM types). */
interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** This tab's sessionStorage, or null where there is none or it is blocked (reading the property can throw). */
function tabStorage(): TabStorage | null {
  try {
    return (globalThis as { sessionStorage?: TabStorage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

type Registered = { user: AuthUser; password: string };

function loadRegistered(key: string | undefined): Map<string, Registered> {
  const out = new Map<string, Registered>();
  if (!key) return out;
  try {
    const raw = tabStorage()?.getItem(key);
    const rows: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) return out;
    for (const row of rows as Partial<Registered>[]) {
      const user = row?.user;
      if (user && typeof user.id === 'string' && typeof user.username === 'string' && user.role === 'guest_user' && typeof row.password === 'string') {
        out.set(user.username, { user, password: row.password });
      }
    }
  } catch {
    // unreadable or blocked: start with no registered guests
  }
  return out;
}

/** The mock session lives under `<persistKey>:session` in the tab (a reload of the demo keeps the person signed in, like the real cookie does). */
export const mockSessionKey = (persistKey: string): string => `${persistKey}:session`;

function loadSession(key: string | undefined): Session | null {
  if (!key) return null;
  try {
    const raw = tabStorage()?.getItem(mockSessionKey(key));
    const s = raw ? (JSON.parse(raw) as Partial<Session>) : null;
    return s && s.user && typeof s.user.id === 'string' && typeof s.expiresAt === 'string' && Date.parse(s.expiresAt) > Date.now() ? (s as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(key: string | undefined, session: Session | null): void {
  if (!key) return;
  try {
    if (session) tabStorage()?.setItem(mockSessionKey(key), JSON.stringify(session));
    else tabStorage()?.removeItem(mockSessionKey(key));
  } catch {
    // blocked storage: the session lasts until the page reloads
  }
}

function saveRegistered(key: string | undefined, registered: Map<string, Registered>): void {
  if (!key) return;
  try {
    // mock demo accounts only (never real people): kept for this tab, gone when it closes
    tabStorage()?.setItem(key, JSON.stringify([...registered.values()]));
  } catch {
    // storage full or blocked: the accounts still work until the page reloads
  }
}

const hotel = { id: 'h-1', name: 'Hotel Sunrise, Rajkot', foodName: 'Sunrise Foods' };

function u(id: string, displayName: string, username: string, role: AuthUser['role'], extra: Partial<AuthUser> = {}): AuthUser {
  return {
    id, displayName, username, role,
    email: `${username}@demo.hms`,
    // The demo has one hotel: the platform-level roles work inside it too, so the top-left brand reads its name (not just "Hotel").
    hotel: ['hotel_user', 'hotel_admin', 'guest_user', 'super_admin', 'platform_admin'].includes(role) ? hotel : null,
    group: null,
    ...extra,
  };
}

const users: Record<string, AuthUser> = {
  staff: u('u-staff', 'Ravi Kumar', 'staff', 'hotel_user'),
  anita: u('u-anita', 'Anita Shah', 'anita', 'hotel_admin', { abilities: ['system.backdate', 'system.recycle'] }),
  // A3/A10: the first and only user of a hotel just created (flagged new: ui-shared/dashboards/setup.ts isNewHotel). The rest of the
  // mock store is single, so the screens behind the checklist show the demo hotel's data. Same abilities as anita so Settings opens.
  // Typed login `newhotel` still works: USERNAME_ALIASES below.
  'pooja.shah': u('u-newhotel', 'Pooja Shah', 'pooja.shah', 'hotel_admin', { hotel: { id: 'h-new', name: 'Hotel Pearl, Surat', foodName: 'Hotel Pearl, Surat Foods' }, abilities: ['system.backdate', 'system.recycle'] }),
  mihir: u('u-mihir', 'Mihir', 'mihir', 'super_admin', { abilities: ['system.backdate', 'system.force', 'system.recycle'] }),
  firsttime: u('u-first', 'Arjun Mehta', 'firsttime', 'hotel_user'),
  guest: u('u-guest', 'Amit Joshi', 'guest', 'guest_user'),
  corporate: u('u-corp', 'Deepa Iyer', 'corporate', 'corporate_user', { group: { id: 'c-1', name: 'Tata Consultancy Services' } }),
  group: u('u-group', 'Kavita Desai', 'group', 'group_hotel_admin', { group: { id: 'g-1', name: 'Sunrise Group' } }),
  groupadmin: u('u-group', 'Kavita Desai', 'groupadmin', 'group_hotel_admin', { group: { id: 'g-1', name: 'Sunrise Group' } }),
  slow: u('u-slow', 'Sanjay Patel', 'slow', 'hotel_user'),
  platform: u('u-platform', 'Neha Kapoor', 'platform', 'platform_admin', { abilities: ['system.backdate', 'system.recycle'] }),
  superadmin: u('u-superadmin', 'Rajiv Malhotra', 'superadmin', 'super_admin', { abilities: ['system.backdate', 'system.force', 'system.recycle'] }),
};

/** Older typed logins that still sign in as a renamed demo user. */
const USERNAME_ALIASES: Record<string, string> = { newhotel: 'pooja.shah' };
/** Typed names the sign-in answers specially (no user record). */
const SPECIAL_NAMES = ['locked', 'blocked', 'error', 'busy'];

function builtIn(name: string): AuthUser | undefined {
  // as the real server: the one field takes a username or the account's email
  return users[USERNAME_ALIASES[name] ?? name] ?? (name.includes('@') ? Object.values(users).find((u) => u.email.toLowerCase() === name) : undefined);
}

/** Registered-guest maps of every mock instance (usually one), so a Platform-onboarded username never takes a guest's mobile. */
const guestMaps = new Set<Map<string, Registered>>();

// Platform-onboarded usernames must be unique across the demo users, aliases, special names and registered guests (platformAccounts.ts).
setPlatformUsernameCheck(
  (name) => !!builtIn(name) || SPECIAL_NAMES.includes(name) || [...guestMaps].some((m) => m.has(name) || m.has(mobileKey(name))),
);

/** The signed-in user of an APPROVED Platform-onboarded admin: an empty brand-new hotel ('h-new-<id>', setup.ts isNewHotel) or a group. */
function platformUser(a: PlatformAdminAccount): AuthUser {
  const base = { id: `u-pa-${a.admin.username.toLowerCase()}`, displayName: a.admin.name.trim() || a.admin.username, username: a.admin.username, email: a.admin.email.trim() };
  return a.kind === 'group'
    ? { ...base, role: 'group_hotel_admin', hotel: null, group: { id: a.groupId ?? '', name: a.hotelName } }
    : { ...base, role: 'hotel_admin', hotel: { id: `h-new-${a.hotelId}`, name: a.hotelName, foodName: `${a.hotelName} Foods` }, group: null, abilities: ['system.backdate', 'system.recycle'] };
}

/** Where a quick-login button sits in the dev panel. */
export type PallavQuickGroup = 'hotel' | 'portal' | 'platform' | 'other';

export interface PallavQuickUser {
  username: string;
  displayName: string;
  role: AuthUser['role'];
  group: PallavQuickGroup;
  /** Short extra hint shown under the name (optional). */
  note?: string;
}

const QUICK_ORDER: { username: string; group: PallavQuickGroup; note?: string }[] = [
  { username: 'mihir', group: 'platform', note: 'Super Admin: Platform console' },
  { username: 'platform', group: 'platform', note: 'Platform console: hotels, groups, hotel admins' },
  { username: 'superadmin', group: 'platform', note: 'Super Admin (platform): the same console' },
  { username: 'groupadmin', group: 'platform', note: 'Group Hotel Admin of Sunrise Group' },
  { username: 'anita', group: 'hotel', note: 'Hotel super admin role' },
  { username: 'pooja.shah', group: 'hotel', note: 'New hotel (Hotel Pearl, Surat): empty, shows the setup checklist' },
  { username: 'staff', group: 'hotel' },
  { username: 'firsttime', group: 'hotel', note: 'Temporary-password account' },
  { username: 'slow', group: 'hotel', note: 'Slow-answer account' },
  { username: 'guest', group: 'portal' },
  { username: 'corporate', group: 'portal' },
];

/**
 * Dev quick login (docs/UI.md): every mock user, one button each. Mock + dev/local-demo only;
 * loaded only through the gated DemoPanel chunk.
 */
export const PALLAV_QUICK_USERS: PallavQuickUser[] = QUICK_ORDER.flatMap((q) => {
  const user = users[q.username];
  return user ? [{ username: q.username, displayName: user.displayName, role: user.role, group: q.group, note: q.note }] : [];
});

/** The mock API plus the dev-only quick sign-in (no password, no code, no lock, no expiry). */
export interface PallavMockAuthApi extends PallavAuthApi {
  quickSignIn(username: string): Promise<ApiResult<SignInResult>>;
  /**
   * Portal "Create your account" (portal/register), mock only: a guest account signed in by its 10-digit mobile and its own password,
   * kept in memory, and across reloads of the tab when `persistKey` is set. The real auth contract has no register call yet.
   */
  registerGuest(input: { name: string; mobile: string; email: string; password: string }): Promise<ApiResult<{ username: string }>>;
  /** A registered guest changed their password in the guest portal (mock): sign-in and unlock now take the new one. No-op for other users. */
  setRegisteredPassword(username: string, password: string): void;
}

/** The mobile a registered guest signs in with: 10 digits, no +91. */
const mobileKey = (mobile: string) => mobile.replace(/\D/g, '').slice(-10);


export function createPallavMockAuthApi(opts: PallavMockOptions = {}): PallavMockAuthApi {
  const latency = opts.latencyMs ?? 600;
  const now = opts.now ?? (() => Date.now());
  /** Wrong passwords and the timed lock, per username (as the real server keeps them per account). */
  const failures = new Map<string, number>();
  const lockedUntil = new Map<string, number>();
  let session: Session | null = loadSession(opts.persistKey);
  let pending: { user: AuthUser } | null = null;
  let codeTries = 0;
  let trace = 0;
  /** Guests made by registerGuest: mobile -> account and its own password (read back from the tab when `persistKey` is set). */
  const registered = loadRegistered(opts.persistKey);
  guestMaps.add(registered);

  const err = (code: AuthErrorCode, details?: ApiError['details']) => ({
    ok: false as const,
    error: { code, message: code, traceId: `mock2-${++trace}`, details },
  });

  async function answer<T>(fn: () => { ok: true; data: T } | { ok: false; error: ApiError }, delay = latency) {
    if (opts.offline?.()) return err('NETWORK_OFFLINE');
    await new Promise<void>((r) => setTimeout(() => r(), delay));
    return fn();
  }

  function signedIn(user: AuthUser): SignInResult {
    session = {
      user,
      client: 'web',
      expiresAt: new Date(now() + 120 * 60_000).toISOString(),
      token: null,
    };
    failures.delete((user.username ?? '').toLowerCase());
    pending = null;
    saveSession(opts.persistKey, session);
    return { status: 'signed_in', session };
  }

  const codeRequired = (): SignInResult => ({ status: 'code_required', challengeId: 'ch2-1', maskedEmail: 'a****@demo.hms', resendAfterSeconds: 30 });

  return {
    signIn: (req) => {
      const name = req.username.trim().toLowerCase();
      return answer(() => {
        if (name === 'locked') return err('ACCOUNT_LOCKED', { retryAfterSeconds: 15 * 60 });
        if (name === 'expired') return { ok: false as const, error: { code: 'ACCOUNT_DISABLED' as const, message: 'This temporary password has expired. Ask your administrator to send a new one.', traceId: `mock2-${++trace}`, details: { reason: 'temp_password_expired' } as ApiError['details'] } };
        if (name === 'blocked') return err('ACCOUNT_BLOCKED');
        if (name === 'error') return err('SERVER_ERROR');
        if (name === 'busy') return err('RATE_LIMITED', { retryAfterSeconds: 60 });
        const own = registered.get(mobileKey(name));
        // A Platform-onboarded admin (username or email), only where no demo user or registered guest has that name.
        const onboarded = own || builtIn(name) ? null : findPlatformAccount(name);
        const refusal = onboarded && req.password === onboarded.account.admin.password ? platformSignInRefusal(onboarded) : null;
        if (refusal) {
          // Right password but not open (pending / disabled / hotel suspended or archived, + the staff's typed reason as details.reason):
          // the blocked screen with the reason (flow.ts blockedReasonOf / blockedReasonTextOf). Wrong password: the usual answer below.
          const reason: PallavBlockedReason = refusal.reason;
          const details = refusal.reasonText ? ({ reason: refusal.reasonText } as ApiError['details']) : undefined;
          return { ok: false as const, error: { code: 'ACCOUNT_BLOCKED' as const, message: reason, traceId: `mock2-${++trace}`, details } };
        }
        const user = own?.user ?? builtIn(name) ?? (onboarded ? platformUser(onboarded.account) : undefined);
        const expected = own ? own.password : onboarded ? onboarded.account.admin.password : PALLAV_DEMO_PASSWORD;
        // No such user: the sign-in history mock lists a failed '(unknown)' attempt (never the typed text).
        if (!user) recordMockSignInAttempt({ username: UNKNOWN_SIGN_IN_USERNAME, ok: false, reason: 'Unknown username', at: now() });
        // Same answer for a wrong username and a wrong password (never reveal which); a username's own lock counts only its own tries.
        if (!user) return err('INVALID_CREDENTIALS');
        // the account's own name, whether the username or the email was typed
        const account = (user.username ?? name).toLowerCase();
        const until = lockedUntil.get(account) ?? 0;
        if (until > now()) return err('ACCOUNT_LOCKED', { retryAfterSeconds: Math.ceil((until - now()) / 1000) });
        if (req.password !== expected) {
          const count = (failures.get(account) ?? 0) + 1;
          failures.set(account, count);
          if (count >= 5) {
            failures.delete(account);
            lockedUntil.set(account, now() + 15 * 60_000);
            return err('ACCOUNT_LOCKED', { retryAfterSeconds: 15 * 60 });
          }
          return err('INVALID_CREDENTIALS');
        }
        pending = { user };
        codeTries = 0;
        if (account === 'firsttime') return { ok: true as const, data: { status: 'password_change_required' as const, changeToken: 'chg2-1' } };
        // decision 46: the emailed code is the person's own choice (My Profile), off for everyone until they switch it on
        if (mockCodeRequired(account)) return { ok: true as const, data: codeRequired() };
        return { ok: true as const, data: signedIn(user) };
      }, name === 'slow' ? 4000 : latency);
    },

    verifyCode: (req) =>
      answer(() => {
        if (req.challengeId !== 'ch2-1' || !pending) return err('CHALLENGE_EXPIRED');
        if (req.code.replace(/[\s-]/g, '') !== PALLAV_DEMO_CODE) {
          codeTries += 1;
          return codeTries >= 5 ? err('CODE_ATTEMPTS_EXCEEDED') : err('INVALID_CODE', { attemptsLeft: 5 - codeTries });
        }
        return { ok: true as const, data: signedIn(pending.user) };
      }),

    resendCode: (challengeId) =>
      answer(() =>
        challengeId === 'ch2-1' && pending
          ? { ok: true as const, data: { maskedEmail: 'a****@demo.hms', resendAfterSeconds: 30 } }
          : err('CHALLENGE_EXPIRED'),
      ),

    // Always the same answer, whether or not the username exists.
    forgotPassword: () =>
      answer(() => ({ ok: true as const, data: { challengeId: 'rst2-1', sentTo: 'the email on that account', resendAfterSeconds: 30 } })),

    resendResetCode: () => answer(() => ({ ok: true as const, data: { maskedEmail: 'the email on that account', resendAfterSeconds: 30 } })),

    resetPassword: (req) =>
      answer(() => {
        if (req.challengeId !== 'rst2-1') return err('CHALLENGE_EXPIRED');
        if (req.code.replace(/\s/g, '') !== PALLAV_DEMO_CODE) return err('INVALID_CODE');
        if (req.newPassword.toLowerCase().includes('password')) return err('PASSWORD_TOO_WEAK');
        return { ok: true as const, data: { done: true as const } };
      }),

    changePassword: (req) =>
      answer(() => {
        if (req.changeToken !== 'chg2-1' || !pending) return err('CHALLENGE_EXPIRED');
        if (req.newPassword === PALLAV_DEMO_PASSWORD) return err('PASSWORD_REUSED');
        if (req.newPassword.toLowerCase().includes('password')) return err('PASSWORD_TOO_WEAK');
        return { ok: true as const, data: signedIn(pending.user) };
      }),

    unlockScreen: (req) =>
      answer(() => {
        if (!session) return err('SESSION_EXPIRED');
        // a registered guest unlocks with their own password; everyone else with the demo password
        const signedInId = session.user.id;
        const own = [...registered.values()].find((r) => r.user.id === signedInId);
        const onboarded = signedInId.startsWith('u-pa-') ? findPlatformAccount(session.user.username ?? '') : null;
        const expected = own ? own.password : onboarded ? onboarded.account.admin.password : PALLAV_DEMO_PASSWORD;
        return req.password === expected ? { ok: true as const, data: { unlocked: true as const } } : err('INVALID_CREDENTIALS');
      }),

    // Dev quick login: straight to signed in, marked devQuick, expiry a year away (the mock never expires it).
    quickSignIn: (username) =>
      answer(() => {
        const user = builtIn(username.trim().toLowerCase());
        if (!user) return err('INVALID_CREDENTIALS');
        const base = signedIn(user);
        if (base.status !== 'signed_in') return err('SERVER_ERROR');
        const quick: Session = { ...base.session, devQuick: true, expiresAt: new Date(now() + 365 * 86_400_000).toISOString() };
        session = quick;
        saveSession(opts.persistKey, session);
        codeTries = 0;
        return { ok: true as const, data: { status: 'signed_in' as const, session: quick } };
      }, 150),

    registerGuest: (input) =>
      answer(() => {
        const mobile = mobileKey(input.mobile);
        if (registered.has(mobile) || users[mobile] || findPlatformAccount(mobile)) return err('VALIDATION_FAILED', { fields: { mobile: 'This mobile number already has an account. Sign in instead.' } });
        const user = u(`u-reg-${mobile}`, input.name.trim(), mobile, 'guest_user', { email: input.email.trim() });
        registered.set(mobile, { user, password: input.password });
        saveRegistered(opts.persistKey, registered);
        return { ok: true as const, data: { username: mobile } };
      }),

    setRegisteredPassword: (username, password) => {
      const own = registered.get(mobileKey(username));
      if (own) {
        own.password = password;
        saveRegistered(opts.persistKey, registered);
      }
    },

    getSession: () => answer(() => (session ? { ok: true as const, data: session } : err('SESSION_EXPIRED'))),

    signOut: () =>
      answer(() => {
        session = null;
        pending = null;
        saveSession(opts.persistKey, null);
        return { ok: true as const, data: { signedOut: true as const } };
      }),
  };
}
