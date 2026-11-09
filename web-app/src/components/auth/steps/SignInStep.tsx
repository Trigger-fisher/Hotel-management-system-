"use client";

import { useEffect, useRef, useState } from "react";
import { normaliseSignInName, validateExistingPassword, validateSignInName } from "@shared/auth/validation";
import type { FieldError } from "@shared/auth/validation";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { LinkButton, PrimaryButton, PasswordField, TextField, TextLink } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, CardFooter, FormNote, StepHeader } from "../AuthCard";
import { useSubmit } from "../useSubmit";
import { TurnstileWidget } from "../TurnstileWidget";
import { useEntryBrand } from "../useEntryBrand";

import { tr } from '@/lib/i18n/language';
/** The newest demo prefill already put into the form, so a later mount doesn't refill the password. */
let lastUsedPrefillNonce = -1;

function fieldText(code: FieldError | null, field: "username" | "password", pallavCopy: typeof pallavCopyByLanguage.en, authWords: typeof authWordsCopyByLanguage.en): string | null {
  if (!code) return null;
  if (code === "required") return field === "username" ? pallavCopy.requiredByField.username : authWords.requiredByField.password;
  return authWords.fieldErrors[code];
}

/**
 * Step 1: ONE sign-in page for every person (MJ): "Username or email" + password. The server finds the account and the app opens
 * that person's own dashboard by role. Accounts come from invitations only: there is no sign-up here.
 */
export function SignInStep() {
  return <SignInForm />;
}

function SignInForm() {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const authWords = useCopy(authWordsCopyByLanguage);
  const t = pallavCopy.signIn;
  const { state, send, setUsername, api, device, prefill } = useAuth();
  const { busy, error, blocked, run } = useSubmit();
  const brand = useEntryBrand();
  const [username, setUsernameValue] = useState(state.username);
  // Use the demo password only for a prefill this form hasn't used yet.
  const [usedNonce] = useState(() => (prefill && prefill.nonce > lastUsedPrefillNonce ? prefill.nonce : null));
  const [password, setPassword] = useState(() => (usedNonce !== null ? (prefill?.password ?? "") : ""));
  const [submitted, setSubmitted] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const usernameCode = validateSignInName(username);
  const passwordCode = validateExistingPassword(password);
  const usernameError = submitted ? fieldText(usernameCode, "username", pallavCopy, authWords) : null;
  const passwordError = submitted ? fieldText(passwordCode, "password", pallavCopy, authWords) : null;
  const startOnPassword = username.trim() !== "";

  useEffect(() => {
    if (usedNonce !== null && usedNonce > lastUsedPrefillNonce) lastUsedPrefillNonce = usedNonce;
  }, [usedNonce]);

  function onSubmit() {
    setSubmitted(true);
    if (usernameCode) {
      usernameRef.current?.focus();
      return;
    }
    if (passwordCode) {
      passwordRef.current?.focus();
      return;
    }
    const clean = normaliseSignInName(username);
    // Keep the flow's username in step with the field (it may come from the demo prefill).
    setUsername(clean);
    void run(() => api.signIn({ username: clean, password, device }), {
      onOk: (result) => send({ type: "RESULT", result, now: Date.now() }),
    });
  }

  return (
    <AuthCard onSubmit={onSubmit} busy={busy} aria-label={t.title}>
      <StepHeader
        title={brand ? `Sign in to ${brand.name}` : t.title}
        lead={
          brand ? (
            <>
              {brand.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- the hotel logo comes from the hotel's own public media route
                <img src={brand.logoUrl} alt="" className="mb-2 h-10 w-auto max-w-[160px] object-contain" />
              )}
              <span>{t.subtitle}</span>
              {brand.websiteUrl && (
                <TextLink className="mt-1 flex" href={brand.websiteUrl} rel="noopener noreferrer">
                  {tr("Back to")} {brand.name}
                </TextLink>
              )}
            </>
          ) : (
            t.subtitle
          )
        }
      />
      <FormNote error={error} />
      <div className="flex flex-col gap-4">
        <TextField
          id="username"
          name="username"
          label={t.usernameLabel}
          leadingIcon="person"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputRef={usernameRef}
          value={username}
          onChange={(e) => {
            setUsernameValue(e.target.value);
            setUsername(e.target.value);
          }}
          error={usernameError}
          readOnly={busy}
          autoFocus={!startOnPassword}
        />
        <PasswordField
          id="password"
          name="password"
          label={t.passwordLabel}
          labelAction={
            <LinkButton disabled={busy} onClick={() => send({ type: "GO", step: "forgotPassword" })}>
              {t.forgot}
            </LinkButton>
          }
          autoComplete="current-password"
          inputRef={passwordRef}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
          readOnly={busy}
          autoFocus={startOnPassword}
          capsLockHint
        />
      </div>
      <TurnstileWidget />
      <PrimaryButton type="submit" className="mt-6" busy={busy} busyLabel={t.busy} disabled={blocked}>
        {t.submit}
      </PrimaryButton>
      <CardFooter>{t.noAccount}</CardFooter>
    </AuthCard>
  );
}
