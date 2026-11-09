"use client";

import { useRef, useState } from "react";
import { normaliseTotp } from "@shared/auth/validation";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { fill } from "@shared/auth/copy";
import { useCopy } from "@/lib/i18n/language";
import { LinkButton, PrimaryButton, WhoChip, CodeField } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { AuthCard, CardActions, FormNote, StepHeader } from "../AuthCard";
import { useSubmit } from "../useSubmit";
import { ResendButton, useResend } from "./ResendCode";

/** Step 2: the 6-digit code emailed to the user, only when the account has switched it on, with "Send a new code". */
export function EmailCodeStep() {
  const pallavCopy = useCopy(pallavCopyByLanguage);
  const authWords = useCopy(authWordsCopyByLanguage);
  const t = pallavCopy.emailCode;
  const { state, send, api } = useAuth();
  const { busy, error, blocked, run, clearError } = useSubmit();
  const resend = useResend(api.resendCode, clearError);
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  // The code that was already sent by itself: typing or pasting all 6 digits submits once, and the same digits are never sent twice.
  const autoSent = useRef<string | null>(null);

  // A wrong code is said under the box (with the tries left), and the cursor stays in the box, so a phone keeps its number keyboard open.
  const [wrongCode, setWrongCode] = useState<string | null>(null);
  const normalised = normaliseTotp(code);
  const codeError = wrongCode ?? (!submitted
    ? null
    : !code.trim()
      ? pallavCopy.requiredByField.code
      : normalised
        ? null
        : authWords.fieldErrors.invalid_code);

  /** One verify call; a wrong code shows the error under the box, empties it and keeps the cursor in it, so the person can type again. */
  function verify(digits: string) {
    // A missing challenge is answered with CHALLENGE_EXPIRED, which useSubmit sends back to sign in.
    void run(() => api.verifyCode({ challengeId: state.challengeId ?? "", code: digits }), {
      onOk: (result) => send({ type: "RESULT", result, now: Date.now() }),
      onError: (e) => {
        autoSent.current = null;
        setCode("");
        setSubmitted(false);
        codeRef.current?.focus();
        if (e.code !== "INVALID_CODE") return;
        const left = e.details?.attemptsLeft;
        const tries = typeof left === "number" ? (left === 1 ? t.lastTry : fill(t.triesLeft, { count: left })) : "";
        setWrongCode(`${authWords.errorText.INVALID_CODE}${tries ? ` ${tries}` : ""}`);
        return true;
      },
    });
  }

  function onSubmit() {
    setSubmitted(true);
    if (!normalised) {
      codeRef.current?.focus();
      return;
    }
    // The Verify button still works; it does not send the same digits a second time while the first call runs or after the box submitted them.
    if (autoSent.current === normalised) return;
    autoSent.current = normalised;
    verify(normalised);
  }

  function onCodeChange(value: string) {
    setCode(value);
    setWrongCode(null);
    const digits = normaliseTotp(value);
    // All 6 digits typed or pasted ("123456" or "123 456"): submit by itself, once.
    if (digits && !busy && !resend.busy && !blocked && autoSent.current !== digits) {
      autoSent.current = digits;
      setSubmitted(true);
      verify(digits);
    }
  }

  // Same text as fill(t.subtitle, { email }), split so the address can be bold.
  const [before = "", after = ""] = t.subtitle.split("{email}");
  const working = busy || resend.busy;

  return (
    <AuthCard onSubmit={onSubmit} busy={busy} aria-label={t.title}>
      <StepHeader
        title={t.title}
        lead={
          <>
            {before}
            <strong className="font-bold break-all text-ink-2">{state.sentTo ?? ""}</strong>
            {after}
          </>
        }
      />
      <FormNote error={error ?? resend.error} />
      <div className="flex flex-col gap-4">
        {state.username && <WhoChip label={state.username} icon="person" />}
        <CodeField
          kind="totp"
          id="email-code"
          name="email-code"
          label={t.codeLabel}
          inputRef={codeRef}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          error={codeError}
          readOnly={busy}
          autoFocus
        />
      </div>
      <PrimaryButton type="submit" arrow className="mt-6" busy={busy} busyLabel={t.busy} disabled={blocked || resend.busy}>
        {t.submit}
      </PrimaryButton>
      <div className="mt-2.5">
        <ResendButton resend={resend} texts={t} disabled={busy} />
      </div>
      <CardActions>
        <LinkButton chevron disabled={working} onClick={() => send({ type: "GO", step: "signIn" }, { direction: "back" })}>
          {t.useDifferent}
        </LinkButton>
      </CardActions>
    </AuthCard>
  );
}
