// Authentication API contract (Feature: Authentication, S02).
// Owned by the Lead. web-app and the real API follow this file.
// Only the Lead changes it, and tells every team when it does.

export type Role =
  | 'super_admin'
  | 'platform_admin'
  | 'group_hotel_admin'
  | 'hotel_admin'
  | 'hotel_user'
  | 'corporate_user'
  | 'guest_user';

export type Platform = 'web';

export interface DeviceInfo {
  platform: Platform;
  /** Friendly name shown in "signed in on another device", e.g. "Chrome on Windows". */
  name: string;
}

export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
  username: string | null;
  role: Role;
  /** foodName: the hotel's food business name (hotel setting general.food_name, default "<hotel name> Foods"). */
  hotel: { id: string; name: string; foodName: string } | null;
  group: { id: string; name: string } | null;
  twoFactorEnabled: boolean;
}

export interface Session {
  accessToken: string;
  /** ISO 8601 UTC. Access token lives 15 minutes. */
  accessTokenExpiresAt: string;
  /** Always null: the web session lives in an httpOnly cookie. */
  refreshToken: string | null;
  user: AuthUser;
}

// ---------- Responses that move the flow forward ----------

export type SignInResult =
  | { status: 'signed_in'; session: Session }
  | { status: 'two_factor_required'; challengeId: string; maskedEmail: string }
  | { status: 'two_factor_setup_required'; setupToken: string }
  | { status: 'password_change_required'; changeToken: string };

// ---------- Requests ----------

export interface SignInRequest {
  /** Username, Indian mobile number or email. */
  identifier: string;
  password: string;
  device: DeviceInfo;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface ChangePasswordRequest {
  changeToken: string;
  newPassword: string;
  device: DeviceInfo;
}

export interface UnlockScreenRequest {
  password: string;
}

// ---------- Errors (MASTER.md section 7 format) ----------

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'INVALID_CODE'
  | 'CODE_ATTEMPTS_EXCEEDED'
  | 'CHALLENGE_EXPIRED'
  | 'RESET_LINK_INVALID'
  | 'RESET_LINK_EXPIRED'
  /** 403: an admin blocked the account. */
  | 'ACCOUNT_BLOCKED'
  /** 403: temporary password; the client goes to the set-password step. */
  | 'PASSWORD_CHANGE_REQUIRED'
  /** 401: session ended by an admin block or a password change (SESSION_REPLACED = signed in elsewhere). */
  | 'SESSION_REVOKED'
  /** 422: the same Idempotency-Key was sent with a different request. */
  | 'IDEMPOTENCY_KEY_REUSED'
  /** 409: the same request is still being processed. */
  | 'REQUEST_IN_PROGRESS'
  | 'PASSWORD_TOO_WEAK'
  | 'PASSWORD_REUSED'
  /** 423: the person locked the screen; only the session check, unlock and sign-out answer until the password unlocks it. */
  | 'SCREEN_LOCKED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REPLACED'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'NETWORK_OFFLINE'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export interface ApiError {
  code: AuthErrorCode;
  message: string;
  traceId: string;
  details?: {
    /** ACCOUNT_LOCKED, RATE_LIMITED */
    retryAfterSeconds?: number;
    /** VALIDATION_FAILED: field name -> problem */
    fields?: Record<string, string>;
    /** INVALID_CREDENTIALS / INVALID_CODE */
    attemptsLeft?: number;
    /** CONFLICT ("someone else changed this, please reload"): the record's version now. */
    currentVersion?: number;
  };
}

/** Every API call resolves to this. Calls never throw, so screens always have a fallback (R8). */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };
