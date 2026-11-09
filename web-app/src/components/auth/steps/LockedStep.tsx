"use client";

import { useEffect, useState } from "react";
import { fill } from "@shared/auth/copy";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { minutesTextIn } from "@shared/auth/copy.lang";
import { formatDateTime } from "@shared/dashboards/format";
import { useCopy, useLanguage } from "@/lib/i18n/language";
import { PrimaryButton, Aside } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, CardActions, StepHeader } from "../AuthCard";
import { BackToSignIn } from "./BackToSignIn";

const TICK_MS = 15_000;

/** Timed lock: shows when it opens again ("05 Nov 2026, 3:05 pm", as every date in the app) and the minutes left (updated as time passes). */
export function LockedStep() {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const [language] = useLanguage();
  const t = pallavCopy.locked;
  const { state, send } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const until = state.lockedUntil ? Date.parse(state.lockedUntil) : NaN;
  const known = Number.isFinite(until);
  const secondsLeft = known ? Math.max(0, (until - now) / 1000) : 0;
  const body = fill(t.body, { time: known ? formatDateTime(new Date(until).toISOString()) : "", minutes: minutesTextIn(secondsLeft, language) });

  return (
    <AuthCard aria-label={t.title}>
      <StepHeader icon="lock" title={t.title} lead={body} focusTitle />
      <PrimaryButton arrow onClick={() => send({ type: "GO", step: "forgotPassword" })}>
        {t.reset}
      </PrimaryButton>
      <CardActions>
        <BackToSignIn />
      </CardActions>
      <Aside>{t.shareHint}</Aside>
    </AuthCard>
  );
}
