"use client";

import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { PrimaryButton } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, CardActions, FinePrint, FormNote, StepHeader } from "../AuthCard";
import { NewPasswordFields, useNewPassword } from "../NewPasswordFields";
import { useSubmit } from "../useSubmit";
import { BackToSignIn } from "./BackToSignIn";

/** Temporary password: set your own before continuing (first sign-in or admin reset). */
export function ChangePasswordStep() {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const t = pallavCopy.changePassword;
  const { state, send, api, device } = useAuth();
  const { busy, error, blocked, run } = useSubmit();
  const form = useNewPassword([state.username]);

  function onSubmit() {
    const newPassword = form.check();
    if (!newPassword) return;
    void run(() => api.changePassword({ changeToken: state.changeToken ?? "", newPassword, device }), {
      onOk: (result) => send({ type: "RESULT", result, now: Date.now() }),
      onError: (e) => {
        const text = form.serverErrorOf(e.code);
        if (text === null) return;
        form.setServerError(text);
        return true;
      },
    });
  }

  return (
    <AuthCard onSubmit={onSubmit} busy={busy} aria-label={t.title}>
      <StepHeader title={t.title} lead={t.subtitle} />
      <FormNote error={error} />
      <NewPasswordFields form={form} busy={busy} autoFocus />
      <PrimaryButton type="submit" arrow className="mt-6" busy={busy} busyLabel={t.busy} disabled={blocked}>
        {t.submit}
      </PrimaryButton>
      <FinePrint>{t.fine}</FinePrint>
      <CardActions>
        <BackToSignIn disabled={busy} />
      </CardActions>
    </AuthCard>
  );
}
