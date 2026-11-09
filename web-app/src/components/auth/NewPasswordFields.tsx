"use client";

import { useState } from "react";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { validateNewPassword } from "@shared/auth/validation";
import { MatchLine, PasswordRules, PasswordField } from "@/components/ui";
import { useAuth } from "./AuthContext";

/**
 * New password + confirm with the live 7-rule checklist. Used by changePassword and
 * resetPassword. Field errors show after the first submit, then live.
 */
export function useNewPassword(avoid: string[]) {
  const copy = useCopy(authWordsCopyByLanguage);
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerErrorText] = useState<string | null>(null);
  const result = validateNewPassword(password, confirm, avoid);
  const errors = {
    password: serverError ?? (submitted && result.password ? fieldText(result.password, "password", copy) : null),
    confirm: submitted && result.confirm ? fieldText(result.confirm, "confirm", copy) : null,
  };

  function setPassword(value: string) {
    setPasswordValue(value);
    setServerErrorText(null);
  }

  /** The server refused the new password: show why under the field and put the cursor back in it. */
  function setServerError(text: string) {
    setServerErrorText(text);
    document.getElementById("new-password")?.focus();
  }

  /** Maps the server's refusal of a new password to a sentence for the field; null when the error is not about the password. */
  function serverErrorOf(code: string): string | null {
    if (code === "PASSWORD_TOO_WEAK") return copy.fieldErrors.password_rules;
    if (code === "PASSWORD_REUSED") return copy.errorText.PASSWORD_REUSED;
    return null;
  }

  /** Call on submit. Returns the password when valid; else shows errors and focuses the first bad field. */
  function check(): string | null {
    setSubmitted(true);
    if (result.password) {
      document.getElementById("new-password")?.focus();
      return null;
    }
    if (result.confirm) {
      document.getElementById("confirm-password")?.focus();
      return null;
    }
    return password;
  }

  return { password, setPassword, confirm, setConfirm, errors, check, avoid, submitted, setServerError, serverErrorOf };
}

function fieldText(code: NonNullable<ReturnType<typeof validateNewPassword>["password"]>, field: "password" | "confirm", copy: typeof authWordsCopyByLanguage.en): string {
  if (code === "required") return field === "password" ? copy.requiredByField.password : copy.requiredByField.confirmPassword;
  return copy.fieldErrors[code];
}

export function NewPasswordFields({
  form,
  busy,
  autoFocus = false,
}: {
  form: ReturnType<typeof useNewPassword>;
  busy: boolean;
  autoFocus?: boolean;
}) {
  const { state } = useAuth();
  const copy = useCopy(authWordsCopyByLanguage);
  return (
    <div className="flex flex-col gap-4">
      {/* Lets password managers save the new password against the right account. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={state.username}
        readOnly
        hidden
      />
      <PasswordField
        id="new-password"
        name="new-password"
        label={copy.newPassword.label}
        autoComplete="new-password"
        value={form.password}
        onChange={(e) => form.setPassword(e.target.value)}
        error={form.errors.password}
        readOnly={busy}
        autoFocus={autoFocus}
        capsLockHint
        aria-describedby="password-rules"
        below={<PasswordRules id="password-rules" password={form.password} avoid={form.avoid} showErrors={form.submitted} />}
      />
      <PasswordField
        id="confirm-password"
        name="confirm-password"
        label={copy.newPassword.confirmLabel}
        autoComplete="new-password"
        value={form.confirm}
        onChange={(e) => form.setConfirm(e.target.value)}
        error={form.errors.confirm}
        readOnly={busy}
        aria-describedby="password-match"
        below={<MatchLine id="password-match" password={form.password} confirm={form.confirm} />}
      />
    </div>
  );
}
