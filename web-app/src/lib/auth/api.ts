// The one PallavAuthApi instance the web app talks to. Mock now (ui-shared/auth-pallav/mock.ts);
// step 6 (Connect) swaps in the real /api/v1 client with the same interface.
import type { ApiResult, PallavAuthApi, Platform, Session, SignInResult } from "@shared/auth-pallav";
import { loadMocks } from "@/lib/api/mockLoader";
import { apiMode, chooseApi } from "@/lib/api/mode";
import { createHttpAuthApi } from "./httpApi";
import { setTabLocked, withLock } from "./screenLock";
import {
  approvePlatformAdmin,
  blockPlatformAdmin,
  registerPlatformAdmin,
  resetPlatformAccounts,
  setHotelAccess,
  type PlatformAdminAccount,
  type PlatformHotelAccess,
} from "@shared/auth-pallav/platformAccounts";

let devOffline = false;
let endNextSessionCheck: "SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED" | null = null;
const listeners = new Set<() => void>();

function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isOffline(): boolean {
  return devOffline || browserOffline();
}

/**
 * The mock (with its demo passwords) must never ship. The literal NODE_ENV check lets the build
 * drop it entirely; until the real API is connected (S02 step 6), production builds get a client
 * that always reports a server problem, so every screen shows its friendly error.
 */

function unavailable<T>(): Promise<ApiResult<T>> {
  return Promise.resolve({ ok: false, error: { code: "SERVER_ERROR", message: "SERVER_ERROR", traceId: "no-api" } });
}

const noApi: PallavAuthApi = {
  signIn: unavailable,
  verifyCode: unavailable,
  resendCode: unavailable,
  forgotPassword: unavailable,
  resendResetCode: unavailable,
  resetPassword: unavailable,
  changePassword: unavailable,
  unlockScreen: unavailable,
  getSession: unavailable,
  signOut: unavailable,
};

// Real server (cookie session) or the mock: one switch, `NEXT_PUBLIC_API=real|mock` (src/lib/api/mode.ts). The mock is loaded lazily through
// lib/api/mockLoader.ts inside a literal NODE_ENV branch, so production bundles never contain it (production without the real switch gets the
// always-failing stub). Gate (docs/UI.md, dev quick login / local demo): the mock exists only in dev builds or local-demo builds
// (NEXT_PUBLIC_HMS_LOCAL_DEMO=1). Both are literal expressions so Next inlines them and a normal production build drops the mock.
/** The tab key of the mock's remembered guests and session (ui-shared/auth-pallav/mock.ts). */
const MOCK_PERSIST_KEY = "hms-mock-registered-guests";

/** Mock mode: this tab holds a mock session from before a reload, so the page restores it like the real cookie session (AuthApp). */
export function hasStoredMockSession(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(`${MOCK_PERSIST_KEY}:session`) !== null;
  } catch {
    return false;
  }
}

const mockPromise = (): Promise<PallavAuthApi> =>
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === "1"
    ? // persistKey: registered mock guests survive a reload of this tab (sessionStorage, guarded inside the mock)
      loadMocks().then((m) => m.createPallavMockAuthApi({ offline: isOffline, persistKey: MOCK_PERSIST_KEY }))
    : Promise.resolve(noApi);
const basePromise: Promise<PallavAuthApi> = chooseApi(() => Promise.resolve(createHttpAuthApi()), mockPromise, { guard: false });

/** A new sign-in is a new, unlocked session: the tab's lock of the one before it is forgotten. */
function freshSession(r: ApiResult<SignInResult>): ApiResult<SignInResult> {
  if (r.ok && r.data.status === "signed_in") setTabLocked(false);
  return r;
}

export const authApi: PallavAuthApi = {
  signIn: (req) => basePromise.then((b) => b.signIn(req)).then(freshSession),
  verifyCode: (req) => basePromise.then((b) => b.verifyCode(req)).then(freshSession),
  resendCode: (id) => basePromise.then((b) => b.resendCode(id)),
  forgotPassword: (req) => basePromise.then((b) => b.forgotPassword(req)),
  resendResetCode: (id) => basePromise.then((b) => b.resendResetCode(id)),
  resetPassword: (req) => basePromise.then((b) => b.resetPassword(req)),
  changePassword: (req) => basePromise.then((b) => b.changePassword(req)).then(freshSession),
  unlockScreen: (req) =>
    basePromise.then(async (b) => {
      const r = await b.unlockScreen(req);
      if (r.ok) setTabLocked(false);
      return r;
    }),
  lockScreen: () => {
    setTabLocked(true);
    return basePromise.then((b) => (b.lockScreen ? b.lockScreen() : Promise.resolve({ ok: true as const, data: { locked: true as const } })));
  },
  signOut: () => {
    setTabLocked(false);
    return basePromise.then((b) => b.signOut());
  },
  getSession(signal?: AbortSignal): Promise<ApiResult<Session>> {
    if (endNextSessionCheck) {
      const code = endNextSessionCheck;
      endNextSessionCheck = null;
      return Promise.resolve({ ok: false, error: { code, message: code, traceId: "dev-session-end" } });
    }
    return basePromise.then(async (b) => withLock(await b.getSession(signal)));
  },
};

// ---- Online status as an external store (useSyncExternalStore) ----

function notify() {
  for (const l of listeners) l();
}

export function subscribeOnline(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export const getOnlineSnapshot = () => !isOffline();
export const getOnlineServerSnapshot = () => true;

// ---- Dev-only switches (DemoAccounts panel) ----

export function setDevOffline(value: boolean) {
  devOffline = value;
  notify();
}

export function getDevOffline(): boolean {
  return devOffline;
}

/** The next session check ends the session: replaced (signed in elsewhere), revoked (admin change) or expired (idle). */
export function simulateSessionEnd(code: "SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED") {
  endNextSessionCheck = code;
}

// ---- Dev quick login (docs/UI.md) ----

/**
 * Gate (docs/UI.md, dev quick login): mock mode AND (dev build OR local-demo build). The env part is literal so a
 * normal production build folds it to false. Real mode (?api=real / NEXT_PUBLIC_API=real) is always false.
 */
export function quickLoginAllowed(): boolean {
  return (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === "1") && apiMode() === "mock";
}

type QuickCapable = PallavAuthApi & { quickSignIn?: (username: string, platform: Platform) => Promise<ApiResult<SignInResult>> };

type RegisterCapable = PallavAuthApi & {
  registerGuest?: (input: { name: string; mobile: string; email: string; password: string }) => Promise<ApiResult<{ username: string }>>;
};

/**
 * Portal "Create your account" against the mock (same gate as quick login): the new guest can then sign in with mobile + password.
 * null where there is no register call (the real API has none yet), so the screen keeps its UI-only behaviour there.
 */
export function mockRegisterGuest(input: { name: string; mobile: string; email: string; password: string }): Promise<ApiResult<{ username: string }>> | null {
  if (!quickLoginAllowed()) return null;
  return basePromise.then((b) => {
    const register = (b as RegisterCapable).registerGuest;
    return register ? register(input) : unavailable<{ username: string }>();
  });
}

/** Mock only (same gate): a registered guest's new password from the guest portal, so the mock sign-in and unlock take it. No-op elsewhere. */
export function mockSetGuestPassword(username: string, password: string): void {
  if (!quickLoginAllowed()) return;
  void basePromise.then((b) => (b as PallavAuthApi & { setRegisteredPassword?: (u: string, p: string) => void }).setRegisteredPassword?.(username, password));
}

// Mock only (same gate as quick login): the Platform console's onboarding admins (groups/platform/api.ts) written into the small pure store
// the auth mock's sign-in reads (ui-shared/auth-pallav/platformAccounts.ts: no demo data, sessionStorage of this tab). Synchronous.
// Outside the gate (real mode, normal production build) they do nothing and register answers { ok: true }.
export function mockRegisterPlatformAdmin(info: PlatformAdminAccount): { ok: true } | { ok: false; reason: "username_taken" } {
  if (!quickLoginAllowed()) return { ok: true };
  return registerPlatformAdmin(info);
}
/** hotelId '' (a group's admin): matched by username alone. */
export function mockApprovePlatformAdmin(hotelId: string, username: string): void {
  if (!quickLoginAllowed()) return;
  approvePlatformAdmin(hotelId, username);
}
/** Rejected or archived: that admin's sign-in then says "This account is disabled." hotelId '' = a group's admin (by username). */
export function mockBlockPlatformAdmin(hotelId: string, username: string): void {
  if (!quickLoginAllowed()) return;
  blockPlatformAdmin(hotelId, username);
}
/**
 * The Platform console's suspend / reactivate / archive / restore of a HOTEL: while 'suspended' or 'archived' every approved admin of that
 * hotel id gets the blocked screen 'This hotel is suspended. ...' / 'This hotel is no longer active. ...' (+ 'Reason: <reasonText>' when given);
 * 'active' lets them sign in again. Each account keeps its own pending / approved / blocked status. No-op outside the gate.
 */
export function mockSetPlatformHotelAccess(hotelId: string, state: PlatformHotelAccess, reasonText?: string): void {
  if (!quickLoginAllowed()) return;
  setHotelAccess(hotelId, state, reasonText);
}
/** The Super Admin's 'Reset demo data' (Platform dashboard): forgets every onboarded admin's account together with the platform mock's data. */
export function mockResetPlatformAdmins(): void {
  if (!quickLoginAllowed()) return;
  resetPlatformAccounts();
}

/** One-click sign-in as a mock user: no password, no code. Fails (SERVER_ERROR) outside the gate or against the real API. */
export function devQuickSignIn(username: string): Promise<ApiResult<SignInResult>> {
  if (!quickLoginAllowed()) return unavailable();
  return basePromise.then((b) => {
    const quick = (b as QuickCapable).quickSignIn;
    return quick ? quick(username, "web") : unavailable<SignInResult>();
  });
}
