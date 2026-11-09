"use client";

import { useEffect, useState } from "react";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import type { ApiResult } from "@shared/auth-pallav";
import { PrimaryButton, Spinner } from "@/components/ui";
import { resetLinkApi } from "@/lib/auth/resetLink";
import { useAuth } from "../AuthContext";
import { useBannerPage } from "../AuthBanner";
import { AuthCard, FormNote, StepHeader } from "../AuthCard";
import { NewPasswordFields, useNewPassword } from "../NewPasswordFields";
import { PasswordSuggest } from "../PasswordSuggest";
import { useSubmit } from "../useSubmit";
import { TurnstileWidget } from "../TurnstileWidget";
import { BackToSignIn } from "./BackToSignIn";

/**
 * The page an emailed "forgot password" link opens (/?reset=<token>): checks the link, then asks for a new password (with a suggestion button).
 * An expired or used link gets its own state with a button to ask for a new one. Done: back to sign in with "Password changed".
 */
export function ResetLinkStep({ token, onClose }: { token: string; onClose: () => void }) {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const t = pallavCopy.resetLink;
  const { send } = useAuth();
  const [link, setLink] = useState<"checking" | "good" | "bad">("checking");
  const { busy, error, blocked, run } = useSubmit();
  const form = useNewPassword([]);
  useBannerPage("newPassword");

  useEffect(() => {
    let live = true;
    void resetLinkApi.check(token).then((r) => {
      if (live) setLink(r.ok ? "good" : "bad");
    });
    return () => {
      live = false;
    };
  }, [token]);

  const askAgain = () => {
    onClose();
    send({ type: "GO", step: "forgotPassword" });
  };

  if (link === "checking") {
    return (
      <AuthCard aria-label={t.checkingTitle} busy>
        <StepHeader title={t.checkingTitle} lead={t.checking} />
        <div className="mt-6 flex justify-center">
          <Spinner label={t.checkingTitle} />
        </div>
      </AuthCard>
    );
  }
  if (link === "bad") {
    return (
      <AuthCard aria-label={t.expired.title}>
        <StepHeader icon="warning" title={t.expired.title} lead={t.expired.body} focusTitle />
        <PrimaryButton className="mt-6" onClick={askAgain}>
          {t.expired.action}
        </PrimaryButton>
      </AuthCard>
    );
  }

  const onSubmit = () => {
    const newPassword = form.check();
    if (newPassword === null) return;
    let ruleText: string | undefined;
    void run(async (): Promise<ApiResult<{ done: boolean }>> => {
      const r = await resetLinkApi.reset(token, newPassword);
      if (r.ok) return { ok: true, data: { done: true } };
      // The link was used or ran out while the form was open: show the expired state, not a field error.
      if (r.error.code === "NOT_FOUND") return { ok: true, data: { done: false } };
      // The password rules answer (422) comes with the rule's own sentence for the new password: show that one.
      const fields = (r.error.details as { fields?: { newPassword?: string; captcha?: string } } | undefined)?.fields;
      const rule = fields?.newPassword ?? fields?.captcha;
      ruleText = rule === undefined ? undefined : (form.serverErrorOf(r.error.code) ?? rule);
      return { ok: false, error: { code: "UNKNOWN", message: r.error.message, traceId: r.error.traceId } };
    }, {
      onError: () => {
        if (ruleText === undefined) return;
        form.setServerError(ruleText);
        return true;
      },
      onOk: ({ done }) => {
        if (!done) {
          setLink("bad");
          return;
        }
        onClose();
        send({ type: "GO", step: "signIn" }, { notice: { tone: "success", text: t.changed } });
      },
    });
  };
  return (
    <AuthCard onSubmit={onSubmit} busy={busy} aria-label={t.title}>
      <StepHeader title={t.title} lead={t.subtitle} />
      <FormNote error={error} />
      <div className="flex flex-col gap-4">
        <PasswordSuggest onUse={(pw) => { form.setPassword(pw); form.setConfirm(pw); }} disabled={busy} />
        <NewPasswordFields form={form} busy={busy} autoFocus />
      </div>
      <TurnstileWidget />
      <PrimaryButton type="submit" className="mt-6" busy={busy} busyLabel={t.busy} disabled={blocked}>
        {t.submit}
      </PrimaryButton>
      <div className="mt-2.5 flex flex-col items-center">
        <BackToSignIn disabled={busy} />
      </div>
    </AuthCard>
  );
}
