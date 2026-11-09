// Browser history rules for the one-route auth app (S02 agreement, section 9; steps from S05).
// Pure functions, so they are easy to test.
import type { PallavAuthState, PallavAuthStep } from "@shared/auth-pallav";

/**
 * The sign-in page's address (MJ, 25 Oct 2026): "/" is the public website for a signed-out visitor, sign-in lives at "/login".
 * Kept as a literal so this module stays dependency-free (its unit test runs it in plain Node); the same value is `siteCopy.signInPath`
 * (ui-shared/site/copy.ts) and `SIGN_IN_PATH` in src/proxy.ts.
 */
export const SIGN_IN_PATH = "/login";

/** Steps Back may return to with their saved state. They hold no session, password or code. */
export const SAFE_STEPS: ReadonlySet<PallavAuthStep> = new Set(["signIn", "forgotPassword", "emailCode", "resetPassword"]);

/** Steps where Back must not leave (a live session). */
const PINNED_STEPS: ReadonlySet<PallavAuthStep> = new Set(["signedIn", "screenLocked"]);

export type PopDecision =
  /** Back must not leave this step: put the entry back. */
  | { kind: "stay" }
  | { kind: "restore"; state: PallavAuthState }
  | { kind: "signIn" }
  /** Already on signIn: keep the entry the browser moved to, so further Backs leave the app. */
  | { kind: "adopt" };

/** What to do when the browser moves to another history entry while on `current`. */
export function decidePop(current: PallavAuthState, target: PallavAuthState | undefined): PopDecision {
  if (PINNED_STEPS.has(current.step)) return { kind: "stay" };
  if (target && SAFE_STEPS.has(target.step)) {
    // A saved code step is only valid while its challenge is.
    if ((target.step === "emailCode" || target.step === "resetPassword") && !target.challengeId) {
      return { kind: "signIn" };
    }
    return { kind: "restore", state: target };
  }
  return current.step === "signIn" ? { kind: "adopt" } : { kind: "signIn" };
}

/** The address bar for a state: always the sign-in page (there are no email links any more, so nothing to keep in the URL). */
export function urlFor(state: PallavAuthState): string {
  void state;
  return SIGN_IN_PATH;
}
