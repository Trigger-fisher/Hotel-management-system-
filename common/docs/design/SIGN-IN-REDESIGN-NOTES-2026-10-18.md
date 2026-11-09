# Sign-in redesign: where it lives and what must not change (claude-32, 18 Oct 2026)

Prep note for MJ's new sign-in page (EasyHotelSolutions, purple, with a tagline). No code changed yet; build starts when the PM sends MJ's choice.

## 1. Parts of the current sign-in (all one client app on "/", web-app/src/app/page.tsx)
| Part | File (web-app/src/components/auth/...) | Notes |
|---|---|---|
| Page frame: violet background, 2 rings, brand row (tile + name + tagline), copyright, demo accounts | AuthShell.tsx (`AuthPage`, `BrandRow`, `BrandMark`, `Copyright`, `AuthShell`, `AuthShellSkeleton`, `AuthShellUnreachable`) | Frame never remounts between steps; only the card changes. |
| Card frame, step title/lead, error note, footer | AuthCard.tsx (`AuthCard`, `StepHeader`, `FormNote`, `CardActions`, `FinePrint`, `CardFooter`) | `StepHeader` also sets the tab title as `<title> · productName`. |
| Username or email + password, "Forgot password?" | steps/SignInStep.tsx | ONE page for every role (staff, admins, guest, company); no sign-up. |
| 2-step code (emailed 6 digits, auto-submit, resend) | steps/EmailCodeStep.tsx, steps/ResendCode.tsx, steps/useCountdown.ts | |
| Forgot password -> code + new password -> done | steps/ForgotPasswordStep.tsx, steps/ResetPasswordStep.tsx, steps/ResetDoneStep.tsx, NewPasswordFields.tsx, PasswordSuggest.tsx | |
| Emailed reset link (/?reset=token) | steps/ResetLinkStep.tsx (+ lib/auth/resetLink.ts) | |
| Forced password change | steps/ChangePasswordStep.tsx | |
| Too many tries / account blocked / session ended | steps/LockedStep.tsx, steps/BlockedStep.tsx, steps/SessionEndedStep.tsx, steps/BackToSignIn.tsx | |
| Idle screen lock (unlock with password, or switch user) | steps/ScreenLockedStep.tsx | "Switch user" uses d3's fast sign-out. |
| "Portal logins" (guest / company from a hotel website) | SignInStep.tsx brand branch + useEntryBrand.ts | Not a separate page: `/?hotel=<slug>` shows "Sign in to <hotel>", the hotel logo and "Back to <hotel>". |
| Demo accounts (mock / dev only) | DemoAccounts.tsx, DemoPanel.tsx | Uses `--hms-auth-tile-*` tokens. |

Look and text sources:
- Text: ui-shared/auth/copy.ts (`productName = 'HMS'`, `brand.mark 'H'`, `brand.name 'HMS'`, `brand.tagline 'Hotel Management Suite'`, `brand.copyright`) and ui-shared/auth-pallav/copy.ts (`pallavCopy.signIn` etc.).
- Colours/sizes: ui-shared/tokens.ts (`auth.*`: background stops, glows, rings, brand tile, card, input, button, title, notes) -> web-app/src/lib/theme.ts (`--hms-auth-*` CSS variables) -> web-app/src/app/globals.css (`.hms-auth-page`, `.hms-ring-*`, `.hms-brand-glass`, `.hms-auth-card`, `.hms-rise`, `.hms-sk-auth`).
- Field and button look: components/ui (TextField, PasswordField, CodeField, PrimaryButton, LinkButton, Note, WhoChip) read the same `--hms-auth-*` tokens.

## 2. What a redesign changes (expected)
1. ui-shared/auth/copy.ts: brand name -> EasyHotelSolutions, new tagline, mark (e.g. "E" or "EHS"), copyright. Decide whether `productName` (tab titles: "Sign in · HMS") changes too; it is used across the app.
2. ui-shared/tokens.ts `auth` block: purple background, glows, button gradient, card radius/shadow (only if the chosen option differs from today's violet).
3. AuthShell.tsx: layout of the frame (e.g. split screen with a brand panel on desktop, brand above the card on phone), BrandRow / BrandMark / Copyright.
4. globals.css auth classes, only for new layout pieces.
5. The step files only if the chosen option moves things inside the card (title style, footer text). The logic in them stays.
6. Logo file (if MJ gives one): web-app/public/, referenced from BrandMark.

Also touched by a brand change, check after (other owners, ask first):
- steps/SignedInStep.tsx uses `BrandMark tone="tile"` + `copy.brand.name` in the signed-in app bar.
- dashboards/groups/platform/Onboarding.tsx (B's lane) copies the auth page, BrandMark and `.hms-auth-card` for invitation onboarding.
- components/ui/AppShellSkeleton.tsx and the `data-shell` switch in layout.tsx/globals.css (reload never flashes the violet page for a signed-in browser).
- Mail templates and PDFs that say "HMS" are NOT part of this page; leave unless MJ says so.

## 3. What must NOT change
- Cookies: `__Host-hms_session` (HttpOnly, Secure, SameSite=Lax; server/auth/tokens.ts) and the sign-out mark `__Host-hms_out`. No token in localStorage, no reading the session in page code.
- CSRF: the same-origin check on cookie-session writes (server/http/wrapper.ts) and SameSite=Lax. Sign-in forms keep posting through lib/auth/httpApi.ts -> lib/api/client.ts (`credentials: 'same-origin'`); no plain HTML form posts, no new endpoints.
- Rate limits: server/http/limits.ts + the route `limits` (429 RATE_LIMITED with Retry-After; counter cleared after a good sign-in). The UI keeps showing the wait via useSubmit.ts (`blocked`) and LockedStep.
- 2-step code: challengeId flow, 6-digit auto-submit once, resend countdown, "use a different account". Same API calls.
- Fast sign-out (d3, 859d1ac): lib/auth/signOut.ts `signOutInBackground()` (mark first, keepalive POST with retries) used by ScreenLockedStep and SignedInStep. Do not await the server again.
- The state machine and history: @shared/auth-pallav reducer, AuthApp.tsx (restore on reload, R48 server seed, unreachable page, idle lock timers, session checks, Back/Forward between steps, address kept for copied links). Redesign stays inside AuthShell / AuthCard / step markup.
- `?hotel=` entry (decision 55) and `?invite=` onboarding (AuthEntry.tsx), `?reset=` link.
- Accessibility: one h1 per step, focus moves to title on status steps, aria-live announcements, labels above fields, autocomplete attributes (username, current-password, one-time-code), 44 px targets, caps-lock hint, the hidden username field on the lock screen (password managers).
- No layout shift on load: AuthShellSkeleton must match the new frame's size so the first paint does not jump.
- Mobile plan rules: 16 px inputs (no iOS zoom), no sideways scroll at 360/390/430, light and dark, reduced motion.

## 4. Checks after the build
- npm test for tests/server/auth.*.test.ts (login, golden, entryHotel, recycle); typecheck and lint.
- Walk every step in mock mode: sign-in, wrong password, locked, code, resend, forgot -> reset -> done, reset link, change password, blocked, session ended, screen lock + switch user, `?hotel=` branded entry, `?invite=` page still looks right.
- d3 sweep at 360/390/430 px, light and dark, desktop unchanged in behaviour.
