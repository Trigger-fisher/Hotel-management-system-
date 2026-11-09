"use client";

import { useRef, useState } from "react";
import { normaliseSignInName, validateSignInName } from "@shared/auth/validation";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { LinkButton, PrimaryButton, TextField } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { useBannerPage } from "../AuthBanner";
import { AuthCard, CardActions, CardFooter, FormNote, StepHeader } from "../AuthCard";
import { useSubmit } from "../useSubmit";
import { TurnstileWidget } from "../TurnstileWidget";
import { BackToSignIn } from "./BackToSignIn";

/**
 * Forgot password: ask for the username OR the email; a link (valid 15 minutes) is emailed. There is no code step: the page answers with the
 * same neutral message whether or not an account matches. The link opens /?reset=<token> (ResetLinkStep, shown by AuthApp).
 */
export function ForgotPasswordStep() {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const authWords = useCopy(authWordsCopyByLanguage);
  const t = pallavCopy.forgotPassword;
  const { state, api, setUsername } = useAuth();
  const { busy, error, blocked, run } = useSubmit();
  const [username, setUsernameValue] = useState(state.username);
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useBannerPage(sent ? "checkEmail" : null);

  const code = validateSignInName(username);
  const fieldError = submitted && code ? (code === "required" ? pallavCopy.requiredByField.username : authWords.fieldErrors[code]) : null;

  const onSubmit = () => {
    setSubmitted(true);
    if (code) {
      inputRef.current?.focus();
      return;
    }
    const clean = normaliseSignInName(username);
    void run(() => api.forgotPassword({ username: clean }), {
      onOk: () => {
        setUsername(clean);
        setSent(true);
      },
    });
  };

  if (sent) {
    return (
      <AuthCard aria-label={t.sent.title}>
        <StepHeader icon="check_circle" title={t.sent.title} lead={t.sent.body} focusTitle />
        <CardActions>
          <LinkButton onClick={() => setSent(false)}>{t.sent.again}</LinkButton>
          <BackToSignIn />
        </CardActions>
      </AuthCard>
    );
  }

  return (
    <AuthCard onSubmit={onSubmit} busy={busy} aria-label={t.title}>
      <StepHeader title={t.title} lead={t.subtitle} />
      <FormNote error={error} />
      <TextField
        id="forgot-username"
        name="username"
        label={t.usernameLabel}
        leadingIcon="person"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        inputRef={inputRef}
        value={username}
        onChange={(e) => setUsernameValue(e.target.value)}
        error={fieldError}
        readOnly={busy}
      />
      <TurnstileWidget />
      <PrimaryButton type="submit" className="mt-6" busy={busy} busyLabel={t.busy} disabled={blocked}>
        {t.submit}
      </PrimaryButton>
      <CardActions>
        <BackToSignIn disabled={busy} />
      </CardActions>
      <CardFooter>{t.noEmail}</CardFooter>
    </AuthCard>
  );
}
