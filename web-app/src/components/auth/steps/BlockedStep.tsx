"use client";

import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { tr, useCopy } from "@/lib/i18n/language";
import { PrimaryButton } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, StepHeader } from "../AuthCard";

/**
 * The account was blocked by an admin: no timer, contact the hotel admin. Mock Platform-onboarded admins carry a reason
 * (state.blockedReason: hotel/group waiting for approval, disabled, hotel suspended or no longer active) and show that sentence
 * instead; a suspended/archived hotel may add the platform staff's typed reason (state.blockedReasonText) as a small 'Reason: ...' line.
 */
export function BlockedStep() {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const t = pallavCopy.blocked;
  const { send, state } = useAuth();
  // MJ, 5 Nov 2026: a temporary password past the Super Admin's time (default 30 minutes) is refused with its own plain sentence
  const why =
    state.blockedReason === "temp_password_expired"
      ? { title: tr("Temporary password expired"), body: tr("This temporary password has expired. Ask your administrator to send a new one.") }
      : state.blockedReason
        ? pallavCopy.blockedReason[state.blockedReason]
        : null;
  const title = why?.title ?? t.title;
  const body = why?.body ?? t.body;
  const reasonText = why ? state.blockedReasonText : null;
  return (
    <AuthCard aria-label={title}>
      <StepHeader
        icon="lock"
        title={title}
        lead={
          reasonText ? (
            <>
              {body}
              <span className="mt-1.5 block text-[12.5px] text-ink-muted">{pallavCopy.blockedReasonLine(reasonText)}</span>
            </>
          ) : (
            body
          )
        }
        focusTitle
      />
      <PrimaryButton arrow onClick={() => send({ type: "GO", step: "signIn" }, { direction: "back" })}>
        {t.action}
      </PrimaryButton>
    </AuthCard>
  );
}
