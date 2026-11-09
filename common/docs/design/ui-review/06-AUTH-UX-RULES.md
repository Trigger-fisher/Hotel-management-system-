# 06 - Sign-in and account recovery: UX rules

Research done 2026-10-05 from GOV.UK Design System, NN/g, W3C WCAG, Apple, GitHub docs. **Frontend only**: what the screens show and how they behave. Server rules (lockout policy, rate limits, what the API reveals) belong to the Backend team and are not reviewed here. Each rule has its source. "(house)" = our own rule from the S02 agreement. "(unverified)" = good practice, no single source found.

**Project decisions win over these rules.** Where MJ or the agreement chose differently, the table in §11 records it so I don't flag it as a fault.

## 1. Sign in

| Check | Source |
|---|---|
| Visible label on every field; placeholder never the only label | WCAG 3.3.2; agreement §3 (house) |
| Identifier `autocomplete="username"` (iOS `username`), password `current-password` (iOS `password`) | [WCAG 1.3.5](https://www.w3.org/WAI/WCAG21/Understanding/identify-input-purpose.html), [Apple password autofill](https://developer.apple.com/documentation/security/enabling-password-autofill-on-a-text-input-view) |
| Paste and password managers work in every field | [WCAG 2.2 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) |
| Show/Hide toggle; hidden by default; spellcheck and auto-capitalise off | [GOV.UK password input](https://design-system.service.gov.uk/components/password-input/) |
| Wrong details shows `errorText.INVALID_CREDENTIALS` in a banner (not under one field). Keep the identifier, clear the password | GOV.UK; agreement |
| "Forgot password?" next to the password field | [NN/g login checklist](https://www.nngroup.com/articles/checklist-registration-login/) |
| One identifier field accepting mobile/email/username: plain text input (not `type=tel`), hint explains "+91 optional" | (house, `copy.signIn.identifierHint`) |

## 2. Security code (TOTP) and recovery code

| Check | Source |
|---|---|
| **One** input, `autocomplete="one-time-code"`, `inputmode="numeric"` (iOS `oneTimeCode`). **No 6 separate boxes**: they break paste and fail WCAG 2.2 3.3.8 | [GOV.UK confirm a phone number](https://design-system.service.gov.uk/patterns/confirm-a-phone-number/), W3C 3.3.8 |
| Accept spaces and hyphens. Error names the rule ("Enter the 6-digit code") | GOV.UK |
| **No auto-submit** on the 6th digit unless the user was told beforehand (WCAG 3.2.2 On Input) | [WCAG 3.2.2](https://www.w3.org/WAI/WCAG21/Understanding/on-input.html) |
| Recovery code: text keyboard (letters + digits), hyphen and paste allowed; clear links to switch between app code and recovery code | (unverified; agreement §5 matches) |

## 3. Two-step setup (QR + key)

| Check | Source |
|---|---|
| A manual key is offered as the text alternative to the QR | [GitHub 2FA docs](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication) |
| Key is copyable and grouped in 4s for reading | GitHub (grouping unverified; contract `secretDisplay` does it) |
| 2FA is switched on only after the user enters a current code | GitHub |

## 4. Recovery codes (shown once)

| Check | Source |
|---|---|
| Copy and Download (mobile: Share) available | GitHub |
| User must tick "I have saved these codes" before continuing | GitHub |
| Text says plainly: each works once, shown only this time, keep safe | GitHub; `copy.recoveryCodes.subtitle` |
| "Copied" confirmation is announced (`role="status"`) | [WCAG 4.1.3](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html) |

## 5. New password (forced change, reset, invite)

| Check | Source |
|---|---|
| `autocomplete="new-password"` (iOS `newPassword`) | GOV.UK |
| Requirements visible **before** typing, not only after an error | GOV.UK; NN/g |
| If there is a confirm field, its label and toggle differ ("Show re-entered password") | GOV.UK |
| After reset the user is **not** signed in automatically; goes to sign in | agreement (resetDone → Sign in ✅) |

## 6. Forgot password and "Check your email"

| Check | Source |
|---|---|
| The screen always shows the same "Check your email" text (`copy.forgotPasswordSent.body`) | agreement |
| Shows the typed address, mentions spam folder, offers resend | [GOV.UK confirm an email address](https://design-system.service.gov.uk/patterns/confirm-an-email-address/) |
| "Send again" shows busy then returns to idle; if the mock answers RATE_LIMITED, the banner shows and the button waits | agreement §7 |

## 7. Links: expired, invalid, used

| Check | Source |
|---|---|
| Say what happened and why; give **one** action to get a new link | GOV.UK |

## 8. Locked, session ended, screen lock

| Check | Source |
|---|---|
| Lock message gives a way out (wait time or reset) and does not blame the user | [NN/g hostile error messages](https://www.nngroup.com/articles/hostile-error-messages/) |
| **Warning before a timeout** with ≥ 20 s and one simple action to extend | [WCAG 2.2.1](https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html) (ours: 30 s + "Stay signed in") |
| Unlock screen shows who is locked and offers "Sign in as someone else" | (unverified; agreement matches) |
| Session-ended reason stated neutrally | (unverified; copy matches) |

## 9. Offline and rate limits

| Check | Source |
|---|---|
| Offline has its own message, not a credentials error; typed values are kept | GOV.UK error message (keep input) |
| Rate-limit message shows; submit blocks double submission | [GOV.UK button](https://design-system.service.gov.uk/components/button/) |

## 10. General

| Check | Source |
|---|---|
| One primary button per screen; buttons are verbs in sentence case ("Sign in", "Send reset link") | GOV.UK button |
| One task per screen | [GOV.UK question pages](https://design-system.service.gov.uk/patterns/question-pages/) |
| Error = what happened + how to fix, plain words. No "Oops", "invalid", "forbidden", jargon | [GOV.UK error message](https://design-system.service.gov.uk/components/error-message/), [NN/g error guidelines](https://www.nngroup.com/articles/error-message-guidelines/) |
| Errors sit next to the field; not shown while the user is still typing the first time | NN/g forms errors; agreement §7 |
| Icon + text for errors, never colour alone; status changes announced | Apple HIG accessibility; WCAG 4.1.3 |
| No shake as the only error signal; respect reduced motion (ours: no shake at all) | NN/g; agreement §4 |
| Touch targets: 44×44 pt iOS (Apple HIG); WCAG 2.2 minimum 24×24 CSS px; **ours 44 on both** | Apple HIG; [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| Indian context: "Sign in" wording, en-IN, IST shown where a time appears, mobile accepts +91/0 prefix, spaces and dashes | (house, MASTER §8) |

## 11. Where HMS chose differently (do NOT flag as faults)

| Topic | Best-practice source says | HMS decision | Reviewer action |
|---|---|---|---|
| Password composition rule | Some guides advise against composition rules | MJ (2026-10-05): 8-128, upper, lower, number, special | Check the 7-item checklist is shown up front and is the same on web and mobile |
| Confirm-password field | GOV.UK prefers one field + Show | Agreement: "Re-enter new password" field | Check its Show toggle has its own name |
| Error summary at top of form | GOV.UK: error summary that gets focus + "Error:" in page title | Agreement: banner for API errors; focus to first invalid field | Follow the agreement. Optional note: prefix tab title with "Error:" on web |
| Biometric sign-in on mobile | NN/g suggests offering it | Not in the plan for this feature | Do not flag (R1: one feature, no new scope) |
