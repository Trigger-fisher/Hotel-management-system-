"use client";

import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { PrimaryButton } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, StepHeader } from "../AuthCard";

/** Step 10: password changed, go and sign in. */
export function ResetDoneStep() {
  const { send } = useAuth();
  const t = useCopy(pallavCopyByLanguage).resetDone;
  return (
    <AuthCard aria-label={t.title}>
      <StepHeader icon="check_circle" title={t.title} lead={t.body} focusTitle />
      <PrimaryButton arrow onClick={() => send({ type: "GO", step: "signIn" })}>
        {t.action}
      </PrimaryButton>
    </AuthCard>
  );
}
