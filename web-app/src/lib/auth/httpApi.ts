// The real sign-in client: PallavAuthApi (ui-shared/auth-pallav) over /api/v1/auth/*, with the httpOnly cookie session (no token in script).
// A 401 here is an answer ("wrong password", "session over"), not a reason to end the session, so the shared 401 handler is bypassed;
// the sign-in flow decides what each code means.
import type { ApiResult, AuthErrorCode, PallavAuthApi, Session, SignInResult } from "@shared/auth-pallav";
import type { ApiError } from "@shared/auth/types";
import { portalHotelStore } from "@shared/dashboards/portalHotel";

import { turnstileHeaders } from "./turnstile";
import { http, type Method, type RawError, type RequestOptions } from "@/lib/api/client";

const KNOWN = new Set<string>([
  "INVALID_CREDENTIALS", "ACCOUNT_LOCKED", "ACCOUNT_DISABLED", "INVALID_CODE", "CODE_ATTEMPTS_EXCEEDED", "CHALLENGE_EXPIRED", "RESET_LINK_INVALID",
  "RESET_LINK_EXPIRED", "ACCOUNT_BLOCKED", "PASSWORD_CHANGE_REQUIRED", "PASSWORD_TOO_WEAK", "PASSWORD_REUSED", "VALIDATION_FAILED", "RATE_LIMITED",
  "SESSION_REPLACED", "SESSION_REVOKED", "SESSION_EXPIRED", "SCREEN_LOCKED", "NETWORK_OFFLINE", "SERVER_ERROR", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
]);

function toApiError(e: RawError): ApiError {
  const code = (KNOWN.has(e.code) ? e.code : e.status === 401 ? "SESSION_EXPIRED" : e.status === 429 ? "RATE_LIMITED" : "SERVER_ERROR") as AuthErrorCode;
  return { code, message: e.message || code, traceId: e.traceId, ...(e.details ? { details: e.details } : {}) };
}

/** The calls the Turnstile security check protects (server/http/turnstile.ts is called by exactly these routes). */
const TURNSTILE_PATHS = new Set<string>(["/sign-in", "/password/forgot"]);

async function call<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  const opts: RequestOptions = { body, idempotent: false, keepSessionOn401: true, signal, ...(TURNSTILE_PATHS.has(path) ? { headers: turnstileHeaders() } : {}) };
  const r = await http<T>(method, `/auth${path}`, opts);
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: toApiError(r.error) };
}

/**
 * Decision 55: a hotel's own website sends the person to `/?hotel=<hotel-slug>`. The slug is only a hint: it goes along with BOTH sign-in calls (sign-in and code
 * verify) as `entryHotel`, and the server applies it only when the hotel is live and the person is linked to it. Read once per page load; nothing is stored.
 */
export function entryHotelFromAddress(): string | undefined {
  try {
    const slug = new URLSearchParams(window.location.search).get("hotel")?.trim().toLowerCase();
    return slug && /^[a-z0-9-]{1,63}$/.test(slug) ? slug : undefined;
  } catch {
    return undefined;
  }
}

/** A guest or company login that came from a hotel website opens with that hotel chosen in the sidebar selector, for this session only. */
function applyEntryHotel<T>(r: ApiResult<T>): ApiResult<T> {
  if (!r.ok) return r;
  const result = r.data as unknown as SignInResult;
  if (result.status === "signed_in" && result.session.entryHotelId && (result.session.user.role === "guest_user" || result.session.user.role === "corporate_user")) {
    portalHotelStore.set(result.session.entryHotelId);
  }
  return r;
}

export function createHttpAuthApi(): PallavAuthApi {
  return {
    signIn: async (req) => {
      const entryHotel = entryHotelFromAddress();
      return applyEntryHotel(await call<SignInResult>("POST", "/sign-in", entryHotel ? { ...req, entryHotel } : req));
    },
    verifyCode: async (req) => {
      const entryHotel = entryHotelFromAddress();
      return applyEntryHotel(await call<SignInResult>("POST", "/code/verify", entryHotel ? { ...req, entryHotel } : req));
    },
    resendCode: (challengeId) => call("POST", "/code/resend", { challengeId }),
    forgotPassword: (req) => call("POST", "/password/forgot", req),
    resendResetCode: (challengeId) => call("POST", "/password/forgot/resend", { challengeId }),
    resetPassword: (req) => call("POST", "/password/reset", req),
    changePassword: (req) => call("POST", "/password/change", req),
    unlockScreen: (req) => call("POST", "/unlock", req),
    lockScreen: () => call("POST", "/lock", {}),
    getSession: (signal) => call<Session>("GET", "/session", undefined, signal),
    signOut: () => call("POST", "/sign-out"),
  };
}
