"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { refusalEvent } from "@shared/auth-pallav/flow";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import type { ApiError, ApiResult } from "@shared/auth-pallav";
import { isOffline } from "@/lib/auth/api";
import { resetTurnstile } from "@/lib/auth/turnstile";
import { pickCopy } from "@shared/i18n/copy";
import { readLanguage } from "@/lib/i18n/language";
import { useAuth } from "./AuthContext";

interface RunOptions<T> {
  onOk(data: T): void;
  /**
   * Screen-specific handling. Return a message to show it in the Banner,
   * `true` when the screen handled the error itself, or nothing for the default.
   */
  onError?(error: ApiError): string | true | void;
}

/** RATE_LIMITED cooldown shared by every step, so leaving and coming back does not lift it. */
let rateLimitedUntil = 0;

/**
 * One submit at a time, with every failure turned into a friendly Banner message (R8).
 * Errors that end the flow (expired challenge, lock, session end) move the flow for the screen.
 */
export function useSubmit() {
  const { send } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(() => Date.now() < rateLimitedUntil);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const blockTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    const left = rateLimitedUntil - Date.now();
    if (left > 0) blockTimer.current = window.setTimeout(() => setBlocked(false), left);
    return () => {
      // The step closed (e.g. browser Back while busy): a late answer must not move the flow.
      alive.current = false;
      window.clearTimeout(blockTimer.current);
    };
  }, []);

  const run = useCallback(
    async <T,>(call: () => Promise<ApiResult<T>>, opts: RunOptions<T>) => {
      if (inFlight.current) return;
      // The card already shows the offline note; a second red banner with the same sentence would only repeat it.
      if (isOffline()) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      let result: ApiResult<T>;
      try {
        result = await call();
      } catch {
        result = { ok: false, error: { code: "UNKNOWN", message: "UNKNOWN", traceId: "client" } };
      }
      inFlight.current = false;
      // a Turnstile token works once: the widget (where one is shown) makes a new one
      resetTurnstile();
      if (!alive.current) return;
      setBusy(false);

      if (result.ok) {
        opts.onOk(result.data);
        return;
      }
      const e = result.error;
      // read when the answer arrives, so a language chosen meanwhile is used
      const errorText = pickCopy(authWordsCopyByLanguage, readLanguage()).errorText;
      const custom = opts.onError?.(e);
      if (custom === true) return;
      if (typeof custom === "string") {
        setError(custom);
        return;
      }
      // the security check was missing or refused (server/http/turnstile.ts): say so in its own words
      const captcha = e.details?.fields?.captcha;
      if (captcha) {
        setError(captcha);
        return;
      }
      switch (e.code) {
        case "CHALLENGE_EXPIRED":
        case "CODE_ATTEMPTS_EXCEEDED":
          send({ type: "CHALLENGE_ENDED", code: e.code }, { direction: "back", notice: { tone: "danger", text: pickCopy(pallavCopyByLanguage, readLanguage()).challengeEnded[e.code] } });
          return;
        case "ACCOUNT_LOCKED":
          send({ type: "LOCKED", retryAfterSeconds: e.details?.retryAfterSeconds ?? 15 * 60, now: Date.now() });
          return;
        case "ACCOUNT_BLOCKED":
        case "ACCOUNT_DISABLED":
          send(refusalEvent(e) as NonNullable<ReturnType<typeof refusalEvent>>);
          return;
        case "SESSION_EXPIRED":
        case "SESSION_REPLACED":
        case "SESSION_REVOKED":
          send({ type: "SESSION_ENDED", code: e.code });
          return;
        case "RATE_LIMITED": {
          setError(errorText.RATE_LIMITED);
          const ms = (e.details?.retryAfterSeconds ?? 60) * 1000;
          rateLimitedUntil = Date.now() + ms;
          setBlocked(true);
          window.clearTimeout(blockTimer.current);
          blockTimer.current = window.setTimeout(() => setBlocked(false), ms);
          return;
        }
        case "NETWORK_OFFLINE":
          // Offline per the browser: the card's offline note says so. Otherwise it is a real failed request: say it.
          if (!isOffline()) setError(errorText.NETWORK_OFFLINE);
          return;
        default:
          setError(errorText[e.code] ?? errorText.UNKNOWN);
      }
    },
    [send],
  );

  const clearError = useCallback(() => setError(null), []);

  return { busy, error, blocked, run, clearError, setError };
}
