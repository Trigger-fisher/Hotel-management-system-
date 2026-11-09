// Login screens v2 as one state machine (web and mobile both use it with useReducer).
// Steps follow Hotel Pallav's login (MJ #9) with the safety fixes (MJ #13).

import type { ApiError } from '../auth/types';
import { PALLAV_BLOCKED_REASONS } from './types';
import type { PallavBlockedReason, Session, SignInResult } from './types';

/** Screen lock after this much inactivity (client-side; separate from the 120-min server idle). */
export const SCREEN_LOCK_AFTER_MS = 30 * 60 * 1000;
/** Warning with "Stay signed in" shown this long before the lock. */
export const SCREEN_LOCK_WARNING_MS = 30 * 1000;

export type PallavAuthStep =
  | 'signIn' // username + password
  | 'emailCode' // "Enter the 6-digit code we emailed" + Resend
  | 'changePassword' // temporary password: set your own (first sign-in or admin reset)
  | 'forgotPassword' // step 1: username
  | 'resetPassword' // step 2: emailed code + new password
  | 'resetDone'
  | 'locked' // timed lock, shows when it ends
  | 'blocked' // blocked by an admin, no timer
  | 'sessionEnded' // replaced / revoked / expired
  | 'screenLocked'
  | 'signedIn';

export interface PallavAuthState {
  step: PallavAuthStep;
  /** Kept so Back does not wipe it. The password is never kept. */
  username: string;
  challengeId: string | null;
  /** e.g. "m****@gmail.com" (sign-in) or a generic phrase (forgot password). */
  sentTo: string | null;
  /** Epoch ms when Resend becomes available. */
  resendAt: number | null;
  changeToken: string | null;
  lockedUntil: string | null;
  problem: ApiError['code'] | null;
  /** Step 'blocked' only: why (mock Platform-onboarded admins); null = blocked by an admin (the usual text). */
  blockedReason: PallavBlockedReason | null;
  /** Step 'blocked' only: the reason text the platform staff typed (suspended / archived hotel), shown as 'Reason: <text>'; else null. */
  blockedReasonText: string | null;
  session: Session | null;
}

export const initialPallavAuthState: PallavAuthState = {
  step: 'signIn',
  username: '',
  challengeId: null,
  sentTo: null,
  resendAt: null,
  changeToken: null,
  lockedUntil: null,
  problem: null,
  blockedReason: null,
  blockedReasonText: null,
  session: null,
};

export type PallavAuthEvent =
  | { type: 'USERNAME_CHANGED'; username: string }
  | { type: 'RESULT'; result: SignInResult; now: number }
  | { type: 'CODE_RESENT'; sentTo: string; resendAfterSeconds: number; now: number }
  | { type: 'FORGOT_SENT'; challengeId: string; sentTo: string; resendAfterSeconds: number; now: number }
  | { type: 'RESET_DONE' }
  | { type: 'LOCKED'; retryAfterSeconds: number; now: number }
  | { type: 'BLOCKED'; reason?: PallavBlockedReason | null; reasonText?: string | null }
  | { type: 'GO'; step: 'signIn' | 'forgotPassword' }
  | { type: 'SESSION_ENDED'; code: 'SESSION_EXPIRED' | 'SESSION_REPLACED' | 'SESSION_REVOKED' }
  | { type: 'CHALLENGE_ENDED'; code: 'CHALLENGE_EXPIRED' | 'CODE_ATTEMPTS_EXCEEDED' }
  | { type: 'SCREEN_LOCK' }
  | { type: 'SCREEN_UNLOCKED' }
  | { type: 'SIGNED_OUT' };

/** ACCOUNT_BLOCKED's reason when the error carries one (mock Platform-onboarded admins: see types.ts PallavBlockedReason), else null. */
export function blockedReasonOf(error: Pick<ApiError, 'message'> & Partial<Pick<ApiError, 'details'>>): PallavBlockedReason | null {
  const known = PALLAV_BLOCKED_REASONS as readonly string[];
  if (known.includes(error.message)) return error.message as PallavBlockedReason; // mock: the key is the message
  const key: unknown = (error.details as { reason?: unknown } | undefined)?.reason; // real server: the key is details.reason
  return typeof key === 'string' && known.includes(key) ? (key as PallavBlockedReason) : null;
}

/**
 * ACCOUNT_BLOCKED's `details.reason` as free text (what the platform staff typed when they suspended / archived the hotel), trimmed, or null.
 * The real server puts the reason KEY there (hotel_suspended, ...): that is not text to show.
 */
export function blockedReasonTextOf(error: Pick<ApiError, 'details'>): string | null {
  const text: unknown = (error.details as { reason?: unknown } | undefined)?.reason;
  return typeof text === 'string' && text.trim() && !(PALLAV_BLOCKED_REASONS as readonly string[]).includes(text.trim()) ? text.trim() : null;
}

/**
 * The screen a refusal AFTER the right password opens: ACCOUNT_BLOCKED and ACCOUNT_DISABLED both go to the blocked step with their reason
 * (a disabled account without one is 'disabled'), never to "Those details don't match", which would send the person round the reset loop.
 */
export function refusalEvent(error: Pick<ApiError, 'code' | 'message'> & Partial<Pick<ApiError, 'details'>>): Extract<PallavAuthEvent, { type: 'BLOCKED' }> | null {
  if (error.code === 'ACCOUNT_BLOCKED') return { type: 'BLOCKED', reason: blockedReasonOf(error), reasonText: blockedReasonTextOf({ details: error.details }) };
  if (error.code === 'ACCOUNT_DISABLED') return { type: 'BLOCKED', reason: blockedReasonOf(error) ?? 'disabled', reasonText: null };
  return null;
}

function fresh(state: PallavAuthState): PallavAuthState {
  return { ...initialPallavAuthState, username: state.username };
}

function applyResult(state: PallavAuthState, r: SignInResult, now: number): PallavAuthState {
  switch (r.status) {
    case 'signed_in':
      return { ...fresh(state), step: 'signedIn', session: r.session };
    case 'code_required':
      return {
        ...state,
        step: 'emailCode',
        challengeId: r.challengeId,
        sentTo: r.maskedEmail,
        resendAt: now + r.resendAfterSeconds * 1000,
        problem: null,
      };
    case 'password_change_required':
      return { ...state, step: 'changePassword', changeToken: r.changeToken, problem: null };
  }
}

export function pallavAuthReducer(state: PallavAuthState, e: PallavAuthEvent): PallavAuthState {
  switch (e.type) {
    case 'USERNAME_CHANGED':
      return { ...state, username: e.username };
    case 'RESULT':
      return applyResult(state, e.result, e.now);
    case 'CODE_RESENT':
      return { ...state, sentTo: e.sentTo, resendAt: e.now + e.resendAfterSeconds * 1000 };
    case 'FORGOT_SENT':
      return {
        ...state,
        step: 'resetPassword',
        challengeId: e.challengeId,
        sentTo: e.sentTo,
        resendAt: e.now + e.resendAfterSeconds * 1000,
        problem: null,
      };
    case 'RESET_DONE':
      return { ...fresh(state), step: 'resetDone' };
    case 'LOCKED':
      // Fresh state: no session or challenge left behind.
      return { ...fresh(state), step: 'locked', lockedUntil: new Date(e.now + e.retryAfterSeconds * 1000).toISOString() };
    case 'BLOCKED':
      return { ...fresh(state), step: 'blocked', blockedReason: e.reason ?? null, blockedReasonText: e.reason ? e.reasonText?.trim() || null : null };
    case 'GO':
      return e.step === 'signIn' ? fresh(state) : { ...fresh(state), step: 'forgotPassword' };
    case 'SESSION_ENDED':
      return { ...fresh(state), step: 'sessionEnded', problem: e.code };
    case 'CHALLENGE_ENDED':
      // Code expired or too many wrong codes: back to sign-in with the reason shown.
      return { ...fresh(state), problem: e.code };
    case 'SCREEN_LOCK':
      return state.session ? { ...state, step: 'screenLocked' } : state;
    case 'SCREEN_UNLOCKED':
      return state.session ? { ...state, step: 'signedIn' } : state;
    case 'SIGNED_OUT':
      return fresh(state);
  }
}
