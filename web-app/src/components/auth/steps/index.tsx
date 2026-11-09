"use client";

import type { PallavAuthStep } from "@shared/auth-pallav";
import { BlockedStep } from "./BlockedStep";
import { ChangePasswordStep } from "./ChangePasswordStep";
import { EmailCodeStep } from "./EmailCodeStep";
import { ForgotPasswordStep } from "./ForgotPasswordStep";
import { LockedStep } from "./LockedStep";
import { ResetDoneStep } from "./ResetDoneStep";
import { ResetPasswordStep } from "./ResetPasswordStep";
import { ScreenLockedStep } from "./ScreenLockedStep";
import { SessionEndedStep } from "./SessionEndedStep";
import { SignInStep } from "./SignInStep";

/** Renders the card for one auth step. `signedIn` uses its own AppFrame (see AuthApp). */
export function StepView({ step, prefillNonce }: { step: Exclude<PallavAuthStep, "signedIn">; prefillNonce: number }) {
  switch (step) {
    case "signIn":
      // A new key when DemoAccounts fills the form, so the form starts from the prefill.
      return <SignInStep key={prefillNonce} />;
    case "emailCode":
      return <EmailCodeStep />;
    case "changePassword":
      return <ChangePasswordStep />;
    case "forgotPassword":
      return <ForgotPasswordStep />;
    case "resetPassword":
      return <ResetPasswordStep />;
    case "resetDone":
      return <ResetDoneStep />;
    case "locked":
      return <LockedStep />;
    case "blocked":
      return <BlockedStep />;
    case "sessionEnded":
      return <SessionEndedStep />;
    case "screenLocked":
      return <ScreenLockedStep />;
  }
}
