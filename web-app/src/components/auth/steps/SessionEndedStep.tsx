"use client";

import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { PrimaryButton, Note } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, StepHeader } from "../AuthCard";

/** Signed out because the session was replaced (another device), revoked (admin block or password change) or expired. */
export function SessionEndedStep() {
  const { state, send } = useAuth();
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const authWords = useCopy(authWordsCopyByLanguage);
  const code = state.problem === "SESSION_REPLACED" || state.problem === "SESSION_REVOKED" ? state.problem : "SESSION_EXPIRED";
  const t = code === "SESSION_REVOKED" ? { ...pallavCopy.sessionRevoked, hint: "" } : authWords.sessionEnded[code];

  return (
    <AuthCard aria-label={t.title}>
      <StepHeader icon={code === "SESSION_EXPIRED" ? "schedule" : "logout"} title={t.title} lead={t.body} focusTitle />
      {t.hint !== "" && (
        <Note tone="warning" className="mb-4">
          {t.hint}
        </Note>
      )}
      <PrimaryButton arrow onClick={() => send({ type: "GO", step: "signIn" })}>
        {authWords.sessionEnded.action}
      </PrimaryButton>
    </AuthCard>
  );
}
