"use client";

import { useRef, useState } from "react";
import { normaliseTotp } from "@shared/auth/validation";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { CodeField, PrimaryButton } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, CardActions, FormNote, StepHeader } from "../AuthCard";
import { NewPasswordFields, useNewPassword } from "../NewPasswordFields";
import { useSubmit } from "../useSubmit";
import { BackToSignIn } from "./BackToSignIn";
import { ResendButton, useResend } from "./ResendCode";

/** Reset step 2: the emailed code and the new password together. The text never says whether the username exists. */
export function ResetPasswordStep() {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const authWords = useCopy(authWordsCopyByLanguage);
  const t = pallavCopy.resetPassword;
  const { state, api, send } = useAuth();
  const { busy, error, blocked, run, clearError } = useSubmit();
  const resend = useResend(api.resendResetCode, clearError);
  const form = useNewPassword([state.username]);
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const normalised = normaliseTotp(code);
  const codeError = !submitted
    ? null
    : !code.trim()
      ? pallavCopy.requiredByField.code
      : normalised
        ? null
        : authWords.fieldErrors.invalid_code;

  const onSubmit = () => {
    setSubmitted(true);
    const newPassword = form.check();
    if (!normalised) {
      codeRef.current?.focus();
      return;
    }
    if (newPassword === null) return;
    void run(() => api.resetPassword({ challengeId: state.challengeId ?? "", code: normalised, newPassword }), {
      onOk: () => send({ type: "RESET_DONE" }),
    });
  };

  return (
    <AuthCard onSubmit={onSubmit} busy={busy} aria-label={t.title}>
      <StepHeader pill={pallavCopy.stepPill.resetPassword} title={t.title} lead={t.subtitle} />
      <FormNote error={error ?? resend.error} />
      <div className="flex flex-col gap-4">
        <CodeField
          kind="totp"
          id="reset-code"
          name="reset-code"
          label={t.codeLabel}
          inputRef={codeRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={codeError}
          readOnly={busy}
          autoFocus
        />
        <NewPasswordFields form={form} busy={busy} />
      </div>
      <PrimaryButton type="submit" className="mt-6" busy={busy} busyLabel={t.busy} disabled={blocked || resend.busy} arrow>
        {t.submit}
      </PrimaryButton>
      <div className="mt-2.5">
        <ResendButton resend={resend} texts={t} disabled={busy} />
      </div>
      <CardActions>
        <BackToSignIn disabled={busy || resend.busy} />
      </CardActions>
    </AuthCard>
  );
}
