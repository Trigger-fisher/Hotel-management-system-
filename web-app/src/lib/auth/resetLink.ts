// The "forgot password" link flow: the emailed link opens /?reset=<token>. Two calls: is the link still good, and set the new password with it.
// Real mode talks to the server; mock mode (dev preview and the local demo build) keeps links in memory: the token "expired" or "used" is
// refused, any other token works once. ROUTES is the one place to rename when Backend settles the paths.
import type { DashResult } from '@shared/dashboards/common';
import { dash } from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';
import { turnstileHeaders } from './turnstile';

export const RESET_LINK_ROUTES = {
  check: '/auth/password/reset-link/check',
  reset: '/auth/password/reset-link',
} as const;

export interface ResetLinkApi {
  /** Is this link still good (not expired, not used)? Never says anything about the account. */
  check(token: string): Promise<DashResult<{ valid: true }>>;
  /** Sets the new password with the link; the link is used up. */
  reset(token: string, newPassword: string): Promise<DashResult<{ done: true }>>;
}

function http(): ResetLinkApi {
  return {
    check: (token) => dash<{ valid: true }>('GET', RESET_LINK_ROUTES.check, { query: { token } }),
    reset: (token, newPassword) => dash<{ done: true }>('POST', RESET_LINK_ROUTES.reset, { body: { token, newPassword }, headers: turnstileHeaders() }),
  };
}

function mock(): ResetLinkApi {
  const used = new Set<string>();
  const gone = (token: string) => token === 'expired' || token === 'used' || used.has(token);
  const refuse = <T,>(): DashResult<T> => ({ ok: false, error: { code: 'NOT_FOUND', message: 'This link has expired or was already used.', traceId: 'mock-reset' } });
  const wait = () => new Promise<void>((r) => setTimeout(r, 300));
  return {
    check: async (token) => { await wait(); return gone(token) ? refuse() : { ok: true, data: { valid: true } }; },
    reset: async (token) => { await wait(); if (gone(token)) return refuse(); used.add(token); return { ok: true, data: { done: true } }; },
  };
}

export const resetLinkApi: ResetLinkApi = chooseApi(http, mock, { guard: false });

/** The token of an emailed link (`/?reset=<token>`), taken out of the address bar at once so it is not kept in history or shared by accident. */
export function takeResetToken(): string | null {
  if (typeof window === 'undefined') return null;
  // React may run a state initializer twice (development): the second call must see the same token, not the already cleaned address.
  if (taken !== undefined) return taken;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('reset');
  taken = token || null;
  if (!token) return null;
  params.delete('reset');
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  return token;
}

let taken: string | null | undefined;

/** Forget the token once its page is closed, so a later start of the sign-in app never shows it again. */
export function clearResetToken(): void {
  taken = null;
}
