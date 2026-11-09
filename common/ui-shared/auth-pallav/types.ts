// Login contract v2 = Hotel Pallav's login (MJ #9) with the sign-in safety fixes (MJ #13).
// Username + password, then a 6-digit code sent by EMAIL only when the account has switched it on (decision 46: off by default, the person's own choice).
// No authenticator app, no recovery codes, no invite links, no "remember this device".
// Replaces ui-shared/auth/{types,flow,mock} once both apps have switched (then the old files are deleted).
// Owned by the Lead.

import type { ApiResult, Platform, Role } from '../auth/types';

export type { ApiResult, Platform, Role };
export type { AuthErrorCode, ApiError } from '../auth/types';

/**
 * The signed-in person. Same as the v1 AuthUser minus `twoFactorEnabled` (the emailed code is the person's own
 * choice, off by default, switched in My Profile: decision 46). A v1 AuthUser is assignable to HmsUser.
 */
export interface HmsUser {
  id: string;
  displayName: string;
  email: string;
  username: string | null;
  role: Role;
  /** foodName: the hotel's food business name (hotel setting general.food_name, default "<hotel name> Foods"); the server and the mock always send it. */
  hotel: { id: string; name: string; foodName: string } | null;
  group: { id: string; name: string } | null;
  /**
   * Special abilities from the user's hotel role (Pallav), e.g. 'system.backdate' (set an entry's
   * date/time by hand) and 'system.force' (force mode, super admin only). Screens use them to show or
   * hide controls; the server always re-checks.
   */
  abilities?: string[];
  /**
   * What the hotel role may open: module key (bills, revenue, expense, handover, companies, payroll, reports, pms, website, users, access, masters)
   * to its level ('view' | 'edit' | 'full'); a module the role has no level in is left out. The menu lists only these; absent = no filtering
   * (mock, old sessions). The server always re-checks (403).
   */
  grants?: Record<string, string>;
}

export interface DeviceInfo {
  platform: Platform;
  /** Friendly name, e.g. "Chrome on Windows". */
  name: string;
}

/**
 * MASTER 4.2: ONE httpOnly-cookie session that ends after 120 minutes idle. No access tokens and no refresh tokens anywhere.
 */
export interface Session {
  user: HmsUser;
  client: 'web';
  /** ISO. The current idle expiry. */
  expiresAt: string;
  /** Always null: the cookie carries the session. */
  token: string | null;
  /**
   * Only while platform or group staff are INSIDE a hotel (Enter hotel): which hotel, when the visit ends (ISO, the server's clock) and what it allows
   * ('view' = read only, 'full' = the hotel's screens save within the server's deny list). A reload reads it to resume the visit and its banner.
   */
  visit?: { id: string; hotelId: string; hotelName: string; expiresAt: string; readOnly: boolean; access: 'view' | 'full' };
  /** Decision 55: the id of the hotel the sign-in page was opened for (`?hotel=<slug>` from a hotel website) when the person is linked to it and its website is live; else null/absent. Sent on the sign-in and code-verify answers only. */
  entryHotelId?: string | null;
  /**
   * Dev quick login marker (mock only, docs/UI.md). Set ONLY by the ui-shared mock's quickSignIn; the real
   * server never sends it. The web app skips the idle lock and the periodic session check for such sessions.
   */
  devQuick?: true;
  /** The screen is locked (server: sessions.locked_at; the tab's own lock in mock mode): the app opens on the lock screen, never the dashboard. */
  locked?: true;
}

export type SignInResult =
  | { status: 'signed_in'; session: Session }
  /** A 6-digit code was emailed. `resendAfterSeconds` = when "Resend" may be used. */
  | { status: 'code_required'; challengeId: string; maskedEmail: string; resendAfterSeconds: number }
  /** Temporary password (new account or admin reset): set your own before continuing. */
  | { status: 'password_change_required'; changeToken: string };

export interface SignInRequest {
  username: string;
  password: string;
  device: DeviceInfo;
}

export interface VerifyCodeRequest {
  challengeId: string;
  code: string;
}

export interface ResendCodeResult {
  maskedEmail: string;
  resendAfterSeconds: number;
}

/** Forgot password step 1. ALWAYS answers the same way, whether or not the username exists (MJ #13). */
export interface ForgotPasswordRequest {
  username: string;
}

export interface ForgotPasswordResult {
  /** Present even for unknown usernames (a dummy), so nothing reveals whether an account exists. */
  challengeId: string;
  /** Generic hint, e.g. "the email on your account". Never confirms an address for an unknown username. */
  sentTo: string;
  resendAfterSeconds: number;
}

/** Forgot password step 2: the emailed code and the new password together. */
export interface ResetPasswordRequest {
  challengeId: string;
  code: string;
  newPassword: string;
}

export interface ChangePasswordRequest {
  changeToken: string;
  newPassword: string;
  device: DeviceInfo;
}

/**
 * Why ACCOUNT_BLOCKED (mock only, sent as the error `message`): the blocked screen then shows pallavCopy.blockedReason[reason].
 * hotel_suspended / hotel_archived (the admin's HOTEL is not live) may carry `details.reason` = the text the platform staff typed;
 * the blocked screen shows it under the sentence as 'Reason: <text>' (flow.ts blockedReasonTextOf, state.blockedReasonText).
 */
export type PallavBlockedReason = 'hotel_pending' | 'group_pending' | 'disabled' | 'hotel_suspended' | 'hotel_archived' | 'hotel_rejected' | 'group_rejected' | 'no_email' | 'temp_password_expired';
export const PALLAV_BLOCKED_REASONS: readonly PallavBlockedReason[] = ['hotel_pending', 'group_pending', 'disabled', 'hotel_suspended', 'hotel_archived', 'hotel_rejected', 'group_rejected', 'no_email', 'temp_password_expired'];

export interface UnlockScreenRequest {
  password: string;
}

/**
 * Error details the login screens use (all codes are in ui-shared/auth/types AuthErrorCode):
 * - ACCOUNT_LOCKED: details.retryAfterSeconds (timed lock, 15 minutes after 5 wrong passwords; never forever)
 * - ACCOUNT_BLOCKED: blocked by an admin (no timer; contact the hotel admin). Mock only: `message` may carry a PallavBlockedReason
 *   (a Platform-onboarded admin whose hotel/group is still waiting for approval, or was rejected/archived); see flow.ts blockedReasonOf.
 * - INVALID_CREDENTIALS: same text for wrong username or wrong password (never reveal which)
 * - INVALID_CODE / CODE_ATTEMPTS_EXCEEDED / CHALLENGE_EXPIRED: emailed code problems
 * - RATE_LIMITED: details.retryAfterSeconds
 * - SESSION_REPLACED (signed in elsewhere), SESSION_REVOKED (admin block or password change), SESSION_EXPIRED (idle 120 min)
 * - PASSWORD_TOO_WEAK, PASSWORD_REUSED, VALIDATION_FAILED, NETWORK_OFFLINE, SERVER_ERROR
 */
export interface PallavAuthApi {
  signIn(req: SignInRequest): Promise<ApiResult<SignInResult>>;
  verifyCode(req: VerifyCodeRequest): Promise<ApiResult<SignInResult>>;
  resendCode(challengeId: string): Promise<ApiResult<ResendCodeResult>>;
  forgotPassword(req: ForgotPasswordRequest): Promise<ApiResult<ForgotPasswordResult>>;
  resendResetCode(challengeId: string): Promise<ApiResult<ResendCodeResult>>;
  resetPassword(req: ResetPasswordRequest): Promise<ApiResult<{ done: true }>>;
  changePassword(req: ChangePasswordRequest): Promise<ApiResult<SignInResult>>;
  unlockScreen(req: UnlockScreenRequest): Promise<ApiResult<{ unlocked: true }>>;
  /** Locks the screen on the server, so a reload or another tab opens on the lock screen too. Optional: the mock keeps the lock in the tab. */
  lockScreen?(): Promise<ApiResult<{ locked: true }>>;
  /**
   * NON-EXTENDING read: reports the session and its `expiresAt` but does NOT extend the 120-minute
   * idle window (otherwise polling would keep a session alive forever). Only real activity (any other
   * request) extends it. The 30-minute screen-lock timer is separate and client-side.
   */
  getSession(signal?: AbortSignal): Promise<ApiResult<Session>>;
  signOut(): Promise<ApiResult<{ signedOut: true }>>;
}
