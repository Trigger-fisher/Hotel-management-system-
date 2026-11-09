"use client";

import { useRef, useState } from "react";
import { fill } from "@shared/auth/copy";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { validateExistingPassword } from "@shared/auth/validation";
import { LinkButton, PrimaryButton, initials, WhoChip, PasswordField } from "@/components/ui";
import { apiMode } from "@/lib/api/mode";
import { useCopy } from "@/lib/i18n/language";
import { signOutInBackground } from "@/lib/auth/signOut";
import { useAuth } from "../AuthContext";
import { noteSignedOut } from "../AuthBanner";
import { AuthCard, CardActions, FormNote, StepHeader } from "../AuthCard";
import { useSubmit } from "../useSubmit";

/** Step 15: idle screen lock; unlock with the password or sign out (agreement section 5, row 15). The lock is the session's on the server too. */
export function ScreenLockedStep() {
  const words = useCopy(authWordsCopyByLanguage);
  const t = words.screenLocked;
  const { state, send, api } = useAuth();
  const { busy, error, blocked, run } = useSubmit();
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const user = state.session?.user;
  const name = user?.displayName ?? "";
  const passwordError = submitted && validateExistingPassword(password) ? words.requiredByField.password : null;
  const locked = busy || signingOut;

  function onSubmit() {
    setSubmitted(true);
    if (validateExistingPassword(password)) {
      passwordRef.current?.focus();
      return;
    }
    void run(() => api.unlockScreen({ password }), {
      onOk: () => send({ type: "SCREEN_UNLOCKED" }),
    });
  }

  async function switchUser() {
    setSigningOut(true);
    if (apiMode() !== "mock") {
      // the real server: the sign-in page at once; the session is ended on the server in the background (lib/auth/signOut.ts)
      signOutInBackground();
      noteSignedOut();
      send({ type: "SIGNED_OUT" }, { direction: "back" });
      return;
    }
    try {
      await api.signOut();
    } catch {
      // Signed out locally either way.
    }
    noteSignedOut();
    send({ type: "SIGNED_OUT" }, { direction: "back" });
  }

  return (
    <AuthCard onSubmit={onSubmit} busy={busy} aria-label={t.title}>
      <StepHeader title={t.title} lead={fill(t.subtitle, { name })} />
      <FormNote error={error} />
      {name && (
        <div className="mb-4">
          <WhoChip label={name} initials={initials(name)} />
        </div>
      )}
      {/* Lets password managers match the saved login. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={user?.username ?? user?.email ?? ""}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <PasswordField
        id="unlock-password"
        name="password"
        label={words.passwordLabel}
        autoComplete="current-password"
        inputRef={passwordRef}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={passwordError}
        readOnly={locked}
        autoFocus
        capsLockHint
      />
      <PrimaryButton type="submit" arrow className="mt-6" busy={busy} busyLabel={t.busy} disabled={blocked || signingOut}>
        {t.submit}
      </PrimaryButton>
      <CardActions>
        <LinkButton disabled={locked} aria-busy={signingOut || undefined} onClick={() => void switchUser()}>
          {signingOut ? words.signingOut : fill(t.switchUser, { name })}
        </LinkButton>
      </CardActions>
    </AuthCard>
  );
}
