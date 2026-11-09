# 07 - Review checklist: Authentication UI (S02, step 3)

Source of truth, in order: `MASTER.md` → `docs/sessions/reports/S02-authentication-ui.md` (brief) → `docs/sessions/reports/S02-ui-agreement.md` (agreement, "§" below) → `ui-shared/` (contract).
Tick each box for **Web (W)** and **Mobile (M)**. Every unticked box becomes a finding (see [08-REVIEW-PROCESS.md](08-REVIEW-PROCESS.md)).
Scope: **frontend only** (MJ). This checklist is the **floor**. Passing it is not enough: the screens must also pass the premium scorecard in [00-PREMIUM-STANDARD.md](00-PREMIUM-STANDARD.md).

## A. Gates (check first; stop if any fails)

| # | Check | W | M |
|---|---|---|---|
| A1 | Lint passes (`npm run lint` / `npx expo lint`; mobile: team runs it and shows output, because it can install packages) | ☐ | ☐ |
| A2 | Type check passes (`npx tsc --noEmit`), TypeScript strict, **no `any`**, no `@ts-ignore` / `@ts-expect-error` without a reason | ☐ | ☐ |
| A3 | Web: `npm run build` passes. Mobile: runs in Expo Go and on Expo web | ☐ | ☐ |
| A4 | No new libraries in `package.json` without MJ's OK (R11). Compare with the starting package.json | ☐ | ☐ |
| A5 | Template leftovers removed: web `page.tsx` Next starter, Geist font/"Create Next App" title, dark-mode CSS; mobile Expo welcome screen, `AppTabs`, template `components/`, dark theme provider | ☐ | ☐ |
| A6 | Team stayed in its own folder; `ui-shared/` and the other app untouched | ☐ | ☐ |
| A7 | Imports the contract via `@shared/*`; nothing copied out of `ui-shared/` | ☐ | ☐ |

## B. Contract use

| # | Check | W | M |
|---|---|---|---|
| B1 | Every on-screen word comes from `copy.ts` (search for string literals in JSX) | ☐ | ☐ |
| B2 | Every colour/size/radius/motion value comes from `tokens.ts` (search for `#`, `px`, raw numbers) | ☐ | ☐ |
| B3 | Screen changes go through `authReducer` with `useReducer`; no second, parallel step state | ☐ | ☐ |
| B4 | API calls use `createMockAuthApi()` through the `AuthApi` interface (easy swap to the real API in step 6) | ☐ | ☐ |
| B5 | Errors shown with `errorText[code]` (recovery screen: `wrongRecoveryCode`). **Never** `error.message` | ☐ | ☐ |
| B6 | Field errors: `requiredByField` for empty, `fieldErrors` otherwise; validation from `validation.ts` | ☐ | ☐ |
| B7 | Placeholders filled with `fill()` ({email}, {minutes}, {name}, {place}, {role}, {inviterName}, {seconds}) - no `{raw}` braces visible | ☐ | ☐ |
| B8 | Password data never stored in reducer state, logs or storage | ☐ | ☐ |

## C. The 16 steps (agreement §5)

Walk each with the demo accounts (password `Demo@Pass2026`, code `123456`, recovery `ABCDE-12345`).

| # | Step | How to reach | Must see | W | M |
|---|---|---|---|---|---|
| C1 | signIn | Start | Full brand area; identifier field + hint (`username` autocomplete); password + Show/Hide (`current-password`); "Forgot password?" right under password; Sign in; footer note `noAccount` with divider | ☐ | ☐ |
| C2 | twoFactor | `mihir` | Shield icon; CodeField one input, numeric, `one-time-code`, max 7, accepts "123 456" and paste; Verify; recovery link; Back. **Plus "Remember this device" checkbox (unticked) + shared-PC warning** (`twoFactor.rememberDevice` / `rememberDeviceWarning`, contract `rememberDevice`) | ☐ | ☐ |
| C3 | recoveryCode | twoFactor → link | Key icon; text keyboard, caps, max 11; Continue; "Use authenticator app instead"; footer `lost`; wrong code uses `wrongRecoveryCode` | ☐ | ☐ |
| C4 | setupTwoFactor | `new.admin@demo.hms` | Loading state with `loading` text; numbered steps 1-3; **web**: QR 176px (alt = `qrAlt`) + "Can't scan?" reveals key + Copy key; **mobile**: `step2Mobile` + Open authenticator app (otpauth) + key + Copy key; `noApp` text if no app opens; CodeField; Turn on | ☐ | ☐ |
| C5 | recoveryCodes | after C4 | 10 codes, 2-column monospace grid; Copy codes; **web** Download (.txt named `fileName`, starts with `fileHeading`); **mobile** Share (`share` label, same text); checkbox `confirm`; Continue disabled until ticked; **no Back** | ☐ | ☐ |
| C6 | changePassword | `firsttime@demo.hms` | Lock icon; New password + live 7-item checklist; Re-enter; Save and continue; reused password (`Demo@Pass2026`) → `PASSWORD_REUSED` banner | ☐ | ☐ |
| C7 | forgotPassword | "Forgot password?" | Mail icon; email field (`email` keyboard/autocomplete); Send reset link; footer `noEmail` | ☐ | ☐ |
| C8 | forgotPasswordSent | after C7 | Title focus; body with the typed email in bold; hint; primary "Back to sign in"; secondary "Send again" (busy then idle; same text every time) | ☐ | ☐ |
| C9 | resetPassword | W: `/?reset=valid-reset` · M: `hms://reset?token=valid-reset` | Loading `Checking your link…`; title + `For r****@demo.hms`; new-password fields + checklist; a password containing "password" → `PASSWORD_TOO_WEAK` | ☐ | ☐ |
| C10 | resetDone | after C9 | Check icon; title + body; Sign in | ☐ | ☐ |
| C11 | acceptInvite | `?invite=valid-invite` / `hms://invite?token=valid-invite` | No icon; "Join Hotel Sunrise, Rajkot on HMS"; subtitle with inviter + role label; `forAccount` line; fields + checklist; lands on signedIn | ☐ | ☐ |
| C12 | linkProblem | `expired-reset`, `bad-reset`, `expired-invite`, `used-invite`, `bad-invite` | Clock icon (expired) / link_off (invalid, used); right title/body/action per code; reset codes → forgotPassword + Back; invite codes → signIn, no Back | ☐ | ☐ |
| C13 | locked | `locked@demo.hms`, or 5 wrong passwords | Lock icon; minutes from `lockedUntil`, **updates each minute**, correct singular/plural shown sensibly; info banner `shareHint`; Reset password; Back | ☐ | ☐ |
| C14 | sessionEnded | dev switch "signed in on another device"; expired | logout icon (replaced) / clock (expired); warning banner `hint` only when not empty; "Sign in again" keeps the identifier | ☐ | ☐ |
| C15 | screenLocked | dev "Lock screen now", or 30 min idle | Avatar 56 with initials; title + subtitle with name; password field (`current-password`); web hidden username field for password managers; Unlock; "Not {name}? Sign in as someone else". **Idle warning 30 s before lock with "Stay signed in"** (`screenLocked.warning`, WCAG 2.2.1) | ☐ | ☐ |
| C16 | signedIn | `staff`, `9876543210`, `group@`, `employee@`, `corporate@`, `guest@` | AppFrame: app bar (wordmark, avatar 40, name hidden < 640px); "Welcome, {name}"; role + place line (`placeAt` hotel / `placeFor` group / none); role card from `roleHome[role]` with dashed placeholder; Lock screen + Sign out (busy `signingOut`); phone: stacked full width | ☐ | ☐ |

## D. States (R8, agreement §7)

| # | Check | W | M |
|---|---|---|---|
| D1 | Loading (link check, 2FA setup): centred spinner + the step's `loading` text, busy flag for screen readers | ☐ | ☐ |
| D2 | Submitting: primary button shows spinner + `busy` text, disabled; fields read-only; links disabled; **double tap / double Enter sends one request** | ☐ | ☐ |
| D3 | Field errors show after first submit, then update live; focus goes to the first invalid field | ☐ | ☐ |
| D4 | Server error: danger Banner, focus moves to it, announced | ☐ | ☐ |
| D5 | `CHALLENGE_EXPIRED`, `CODE_ATTEMPTS_EXCEEDED` → back to signIn with a danger banner of that text | ☐ | ☐ |
| D6 | `ACCOUNT_LOCKED` → locked step | ☐ | ☐ |
| D7 | `RATE_LIMITED` (`busy@demo.hms`): danger banner and primary button stays disabled for `retryAfterSeconds` (60 s), then re-enables | ☐ | ☐ |
| D8 | `SERVER_ERROR` (`error@demo.hms`): friendly banner, user can retry | ☐ | ☐ |
| D9 | Slow answer (`slow@demo.hms`, 4 s): busy state holds the whole time; no timeout crash | ☐ | ☐ |
| D10 | Offline (dev switch): OfflineBanner at top of card; submitting shows the offline text as a danger banner; **no request sent** | ☐ | ☐ |
| D11 | Success moves to the next step (no toast); copy actions show `Copied` for 2 s; copy failure shows `copyFailed` | ☐ | ☐ |
| D12 | Nothing ever crashes to a blank or raw error screen (web error boundary / mobile fallback) | ☐ | ☐ |

## E. Fields and forms

| # | Check | W | M |
|---|---|---|---|
| E1 | Labels always visible above the field; no placeholder used as a label | ☐ | ☐ |
| E2 | Autocomplete / textContentType: `username`, `current-password`, `new-password`, `one-time-code`, `email` on the right fields | ☐ | ☐ |
| E3 | Paste allowed everywhere (password, codes) | ☐ | ☐ |
| E4 | Show/Hide on every password field, 44×44 hit area, screen reader name says what it does ("Show password") | ☐ | ☐ |
| E5 | Web: Caps Lock warning under password fields (`capsLock`, caption, warning colour) | ☐ | n/a |
| E6 | New password rule = **8 to 128 chars, upper, lower, number, special** (`PASSWORD_REGEX`, MJ 2026-10-05). 7-row live checklist from `newPasswordChecks(pw, [identifier/email])`, updates on each key, announced politely | ☐ | ☐ |
| E7 | iOS `passwordRules` (if used) matches the rule: `minlength: 8; maxlength: 128; required: upper; required: lower; required: digit; required: special;`. **Known: mobile `TextField.tsx:99` says minlength 12 - must fix** | n/a | ☐ |
| E8 | Text inputs ≥ 16px (no iOS zoom on focus) | ☐ | ☐ |
| E9 | Enter / "Go" key submits the form; Next moves between fields on mobile | ☐ | ☐ |
| E10 | Identifier kept when going Back or after sign out; password cleared | ☐ | ☐ |
| E11 | Inputs reject invisible characters (shown as `invisible_characters` error), per LESSONS 9 | ☐ | ☐ |

## F. Accessibility (details in [03-ACCESSIBILITY.md](03-ACCESSIBILITY.md))

| # | Check | W | M |
|---|---|---|---|
| F1 | Every control has a name, role and state a screen reader can read | ☐ | ☐ |
| F2 | Step change: focus to first field (form steps) or title (status steps); live region announces the new title | ☐ | ☐ |
| F3 | Errors tied to fields (`aria-describedby` / hint) and announced; danger banners assertive, others polite | ☐ | ☐ |
| F4 | Visible focus on every control (web: 2px primary + 3px ring) | ☐ | n/a |
| F5 | Keyboard only: whole flow works with Tab/Shift+Tab/Enter/Space; no traps | ☐ | n/a |
| F6 | Touch targets ≥ 44 (links, Show/Hide, checkbox rows, demo panel rows) | ☐ | ☐ |
| F7 | Reduced motion honoured (fade only, static spinner) | ☐ | ☐ |
| F8 | Zoom/text size: web 200% zoom and 320px width with no sideways scroll; mobile large text up to the 1.6x cap without clipping | ☐ | ☐ |
| F9 | Page language `en-IN`; web tab title `<Step title> · HMS` | ☐ | ☐ |
| F10 | Icons are decorative (hidden from screen readers) unless they carry meaning alone | ☐ | ☐ |

## G. Layout and look (agreement §1-§4, §6)

| # | Check | W | M |
|---|---|---|---|
| G1 | **No day/night toggle**. Night mode follows the device on every screen, per 09 §10; QR stays dark-on-white; both modes pass AA | ☐ | ☐ |
| G2 | Web ≥ 1024px: brand panel 45% left with gradient, wordmark + gold dot, headline, 3 points with check icons, footer. < 1024px: header like mobile | ☐ | n/a |
| G3 | Mobile: gradient header full on signIn (~140 + safe area), compact elsewhere (~72 + safe area), height animates 220 ms | n/a | ☐ |
| G4 | Card overlaps header by 24 (phone); radius 24; shadow lg; max width 440; padding 24 (web ≥ 640: 32) | ☐ | ☐ |
| G5 | Card anatomy order: offline banner → icon → title → subtitle → banner → fields → primary → secondary → footer note | ☐ | ☐ |
| G6 | Gaps 8 / 24 / 16 / 16 / 24 / 12 / 24 as §2 | ☐ | ☐ |
| G7 | Same icon meaning on both apps (shield, key, lock, mail, schedule, link_off, logout, check_circle) | ☐ | ☐ |
| G8 | Motion as §4 (forward from right, back from left, 220/120 ms, no shake) | ☐ | ☐ |
| G9 | Mobile: keyboard never covers the focused field or the primary button; safe areas respected (notch, home bar) | n/a | ☐ |
| G10 | Works on phone (360), tablet (768) and desktop (1280+) widths | ☐ | ☐ |
| G11 | No `checkAddress` line anywhere (removed by MJ; see L3) | ☐ | ☐ |

## H. Navigation and links (agreement §9)

| # | Check | W | M |
|---|---|---|---|
| H1 | Web: one route `/`; steps change without reload; each step pushes history | ☐ | n/a |
| H2 | Back rules: safe steps (signIn, forgotPassword, twoFactor, recoveryCode) go back; others → signIn; recoveryCodes, signedIn, screenLocked: Back does nothing | ☐ | ☐ |
| H3 | Mobile: Android back button follows H2; never exits the app from a sub-step | n/a | ☐ |
| H4 | Reset/invite links open the right step from a cold start and from a running app | ☐ | ☐ |
| H5 | Web: token removed from the address bar after it is read (replaceState), so it is not left in history or shared by copy-paste | ☐ | n/a |
| H6 | Refresh (web) starts at signIn; link URLs reopen their link step | ☐ | n/a |

## I. Session behaviour (agreement §6)

| # | Check | W | M |
|---|---|---|---|
| I1 | Idle 30 min (`SCREEN_LOCK_AFTER_MS`) → screenLocked, with the 30 s warning first | ☐ | ☐ |
| I2 | Session check every 60 s and on return to the app/tab; SESSION_REPLACED / SESSION_EXPIRED → sessionEnded | ☐ | ☐ |
| I3 | Timers cleaned up on sign out and unmount (no duplicate intervals after several sign-ins) | ☐ | ☐ |

## J. Dev-only helper (DemoAccounts)

| # | Check | W | M |
|---|---|---|---|
| J1 | Collapsed panel under the card, title `demo.title` | ☐ | ☐ |
| J2 | Lists all 13 `DEMO_ACCOUNTS`; tap fills identifier + `DEMO_PASSWORD` on signIn | ☐ | ☐ |
| J3 | Demo links for reset (valid/expired/invalid) and invite (valid/expired/used/invalid) | ☐ | ☐ |
| J4 | Switches: Simulate offline, Simulate "signed in on another device", Lock screen now | ☐ | ☐ |
| J5 | **Not in production builds** (web: `process.env.NODE_ENV !== 'production'`, check the built bundle; mobile: `__DEV__`) | ☐ | ☐ |

## K. Web vs mobile consistency (needs both reports)

| # | Check |
|---|---|
| K1 | Same 16 steps reachable the same way, in the same order |
| K2 | Same text on every screen (both straight from `copy.ts`) |
| K3 | Same component names (AuthShell, AuthCard, StepHeader, TextField, PasswordField, CodeField, PasswordChecklist, Banner, PrimaryButton, SecondaryButton, LinkButton, Checkbox, StatusIcon, Avatar, OfflineBanner, DemoAccounts) and same behaviour |
| K4 | Same states and the same error per demo account |
| K5 | Allowed differences only: QR vs Open-app (setup), Download vs Share (codes), Caps Lock and hover sheen (web), hidden username field (web) |
| K6 | Screenshots of the same step side by side look like one product |

## L. Lead decisions (2026-10-05) - now part of the checklist

| # | Check | W | M |
|---|---|---|---|
| L1 | "Remember this device" checkbox on **twoFactor and recoveryCode**, between the code field and the primary button, **unticked** by default, warning (`rememberDeviceWarning`) always visible under it (Pallav aside style) | ☐ | ☐ |
| L2 | Idle warning = **modal dialog** (`role="alertdialog"`), signedIn only, 30 s before lock, live countdown, primary "Stay signed in"; any activity closes it | ☐ | ☐ |
| L3 | **No "check the web address" line anywhere** (MJ removed it). Any trace = must fix | ☐ | ☐ |
| L4 | `attemptsLeft` **not shown** anywhere | ☐ | ☐ |
| L5 | Recovery codes: web `download`, mobile `share` ("Share codes") | ☐ | ☐ |
| L6 | Approved libraries only (MJ via Lead): expo-clipboard, eslint / eslint-config-expo, expo-network, Inter font. Anything else = must ask | ☐ | ☐ |
| L7 | Test links in Expo Go use `exp://<host>:8081/--/reset?token=...` (`hms://` needs a dev build) | n/a | ☐ |

## M. Pallav design (MJ, 2026-10-05)

The look is now [09-PALLAV-DESIGN-SPEC.md](09-PALLAV-DESIGN-SPEC.md). Where it differs from section G above (left brand panel, mobile gradient header, gold dot, link under the password field, text Show button, avatar on screenLocked), **09 wins**.

| # | Check | W | M |
|---|---|---|---|
| M1 | One page: violet page, rings, brand row, card frame and copyright never reload; only the card content changes | ☐ | ☐ |
| M2 | Background: the 3 gradient layers and 2 rings, static, exact values | ☐ | ☐ |
| M3 | Brand row above the card (46px glass tile, name, uppercase tagline) | ☐ | ☐ |
| M4 | Card: max 420, radius 24/18, Pallav shadow, padding 34/32/26 (phone 26/20/20), first-load rise 380 ms | ☐ | ☐ |
| M5 | Step pill, title 25/800/-0.03em (phone 22), lead 13.5 muted | ☐ | ☐ |
| M6 | Inputs: leading icon, eye reveal button, 48 tall, 16px text, radius 11, Pallav hover/focus ring | ☐ | ☐ |
| M7 | Label row: "Forgot password?" on the Password label line | ☐ | ☐ |
| M8 | Primary button: p600→p800 gradient, trailing arrow, Pallav shadows, hover lift + one sheen (web), press .97, 48 tall | ☐ | ☐ |
| M9 | Notes, aside, "who" chip, 2-column rules (1 column < 400px, no shake), match line, card footer, copyright 72% white | ☐ | ☐ |
| M10 | Mobile = the Pallav phone layout made native (safe areas, keyboard keeps the button visible, press states, deep shadows) | n/a | ☐ |
