# S02 - Authentication UI agreement (web + mobile)

Written by **Web UI 1**, to be confirmed by **Mobile UI 1**. Both apps build to this file exactly.
Any change: message the other session first, then edit this file and add a line to the change log at the end.
Text comes only from `ui-shared/auth/copy.ts` and sizes and colours only from `ui-shared/tokens.ts`. Text or token changes go to the Lead (hms-c0).

Status: **v2.0 (Pallav design + night mode): confirmed by Mobile UI 1** (2026-10-05)

> **Lead note (2026-10-05): the LOOK in sections 1-4 is superseded by `docs/design/ui-review/09-PALLAV-DESIGN-SPEC.md`** (MJ: exact Hotel Pallav sign-in design, improved, on web and mobile, one SPA page). Behaviour, steps, states and copy keys in this file still apply. New copy keys: `brand.mark/name/tagline/copyright`, `stepPill.*`, `newPassword.passwordsMatch`. New tokens: `auth.*` in `ui-shared/tokens.ts`. Decision c (address line) is removed.

---

## 0. v2.0 - Pallav design (docs/design/ui-review/09-PALLAV-DESIGN-SPEC.md) + night mode (spec section 10)

**Overrides the look in sections 1-4 and 6** wherever they differ. Behaviour, states, copy keys and accessibility stay. The spec file has every value; this section fixes **names, placement and the web component API** so web agents and Mobile UI 1 build the same thing.

### 0.1 One page
AuthPage (violet page + 2 static rings, never remounts) → BrandRow (glass tile `copy.brand.mark`, name, uppercase tagline) → AuthCard (frame; 380 ms rise once on first load; content changes with the 220 ms fade + 8px slide and the card height eases) → Copyright (`fill(copy.brand.copyright, {year})`). Column max 420; phone ≤ 480 aligns to the top. No left brand panel, no full/compact header, no gold dot. Night mode follows the device (no toggle).

### 0.2 Order inside the card
OfflineNote → StepPill → StatusIcon (result screens only) → title → lead → Note (form error / carried notice) → WhoChip → fields → Checkbox + Aside (remember device) → PrimaryButton → secondary links (centred, mt 10) → FinePrint / Aside → CardFooter.

| Step | Pill (`copy.stepPill`) | StatusIcon | WhoChip | Aside | CardFooter |
|---|---|---|---|---|---|
| signIn | - | - | - | - | `noAccount` |
| twoFactor | yes | - | identifier (person) | rememberDeviceWarning (under the checkbox) | - |
| recoveryCode | yes | - | identifier (person) | rememberDeviceWarning; `lost` | - |
| setupTwoFactor | yes | - | - | - | - |
| recoveryCodes | yes | - | - | - | - |
| changePassword | yes | - | - | - | - |
| forgotPassword | - | - | - | - | `noEmail` |
| forgotPasswordSent | - | mail | - | `hint` | - |
| resetPassword | - | - | maskedEmail (mail), replaces `forAccount` | - | - |
| resetDone | - | check_circle | - | - | - |
| acceptInvite | - | - | the invite email (mail), replaces the `forAccount` line | - | - |
| linkProblem | - | schedule / link_off | - | - | - |
| locked | - | lock | - | `shareHint` | - |
| sessionEnded | - | logout / schedule | - | - (`hint` is a warning Note when not empty) | - |
| screenLocked | - | - | displayName, initials in the tile (replaces Avatar 56) | - | - |

Form steps lose their old StatusIcons. "Forgot password?" sits on the Password label row (right). Leading field icons: identifier person, password lock, email mail, code shield, recovery key. Show/Hide is an eye / eye-off icon button (accessible name `common.showPassword` / `hidePassword`). Trailing arrow on every forward PrimaryButton; none on "Back to sign in" (a link) or "Stay signed in" (idle dialog).

### 0.3 Web component API (`web-app/src/components`)
| File | Exports and props |
|---|---|
| ui/Icon.tsx | `Icon {name, size, className}`; adds `person`, `eye`, `eye_off`, `arrow_right` |
| ui/TextField.tsx | `TextField {label, hint?, error?, leadingIcon?, labelAction?, below?, trailing?, size?: "default" \| "code" \| "recovery", describedByExtra?, inputRef?, ...input}`; `PasswordField {same minus type/trailing, capsLockHint?}` (lock icon by default); `CodeField {kind: "totp" \| "recovery", ...}` (56 tall) |
| ui/Button.tsx | `PrimaryButton {busy?, busyLabel?, arrow?}`, `SecondaryButton {busy?, busyLabel?}`, `LinkButton {chevron?}`, `TextLink` |
| ui/Feedback.tsx | `Note {tone, title?, focusOnShow?}` (`Banner` = alias), `OfflineNote`, `StatusIcon {name}`, `StepPill`, `WhoChip {label, icon?, initials?}`, `Aside {icon?, id?}`, `PasswordRules {password, avoid, showErrors, id?}`, `MatchLine {password, confirm, id?}`, `Checkbox {checked, onChange, label, disabled?, describedBy?}`, `Avatar`, `initials` |
| ui/Spinner.tsx | `Spinner`, `LoadingBlock {label}` |
| auth/AuthCard.tsx | `AuthCard {onSubmit?, busy?, aria-label?}`, `StepHeader {title, lead?, pill?, icon?, focusTitle?}`, `FormNote {error}` (`FormBanner` = alias), `CardActions`, `FinePrint`, `CardFooter` |
| auth/AuthShell.tsx | `AuthShell` (AuthPage + BrandRow + card slot + Copyright + DemoAccounts), `BrandMark {tone}` |

### 0.4 Colours (web)
Screens use only the role names from `src/lib/theme.ts` as Tailwind classes (`bg-card`, `text-ink`, `text-ink-2`, `text-ink-muted`, `bg-inset`, `border-input`, `border-input-hover`, `border-input-focus`, `shadow-focus`, `text-field-icon`, `text-link`, `text-link-hover`, `bg-pill`, `text-pill-ink`, `bg-status`, `text-status-ink`, `bg-sec`, `text-sec-ink`, `border-sec-border`, `bg-note-{tone}-bg`, `border-note-{tone}-border`, `text-note-{tone}-fg`, `bg-aside`, `text-aside-ink`, `text-aside-icon`, `text-rule-met/unmet/bad`, `border-check-border`, `bg-check-fill`, `bg-codes`, `text-codes-ink`, `bg-chip-bg`, `border-chip-border`, `bg-chip-tile`, `text-chip-tile-ink`, `bg-app`, `bg-appbar`, `bg-role-card`, `border-dashed`, `bg-dialog`, `bg-scrim`, `border-hairline`), shadows `shadow-auth-card shadow-cta shadow-cta-hover shadow-tile shadow-focus`, radius `rounded-field` (11) `rounded-cta` (12) `rounded-tile` (14). Gradients via CSS classes `hms-auth-page` and `hms-cta`. **No `dark:` utilities and no hex in screens**: night mode swaps the role values in one place.

## 1. Shell and layout

| Part | Web | Mobile |
|---|---|---|
| Page background | `color.bg` (#FBF9FF) | same |
| Brand area | **≥1024px:** left panel, 45% width, full height, `brandGradient` (top-left #2A0F5E to bottom-right #6D28D9), with "HMS" wordmark, `copy.brand.headline`, the 3 `copy.brand.points` (check icon + text) and `copy.brand.footer` at the bottom. **<1024px:** same header as mobile | **Header** across the top, `brandGradient`. **Full** (signIn only): ~140px + safe area, wordmark + headline. **Compact** (all other steps): wordmark only, ~72px + safe area. Height animates full↔compact |
| Wordmark | "HMS", weight 800, 28px, letter-spacing -0.5, `onBrand`; a small gold (`color.gold`) dot after it | same |
| Form card | Right side on desktop (centred in the remaining space); on phone it overlaps the header by 24px | Overlaps the header by 24px |
| Card | white `surface`, 1px `border`, `radius.xl` 24, `shadow.lg`, max width `layout.authCardMaxWidth` 440, padding 24 (web ≥640px: 32) | padding 24, keyboard-safe scroll, safe areas |
| Under the card | DemoAccounts (dev only), then nothing else | same |

Theme: **light only** on all auth screens. No day/night toggle (MJ).

## 2. Card anatomy (top to bottom)

1. **OfflineBanner** (only when offline): Banner tone `info`, text `errorText.NETWORK_OFFLINE`.
2. **StatusIcon** (where listed in section 5): 48px circle, `violet.100` background, icon 24px in `primary`. Violet on every screen; the Banner carries the tone.
3. **Title** (`StepHeader`): `font.size.title` 24/30, bold 700, `text`. Gap 8 to subtitle.
4. **Subtitle**: `body` 15/22, `textSecondary`. Gap 24 to the form.
5. **Banner** (form-level error / notice): under the subtitle, above the fields. Gap 16 below.
6. **Fields**: gap 16 between fields.
7. **PrimaryButton**: full width, gap 24 above it.
8. **Secondary actions**: LinkButtons centred under the primary button, gap 12. The "‹ Back to sign in" link (`copy.common.backToSignIn`) is here on every sub-step.
9. **Footer note** (e.g. `signIn.noAccount`): `small` 13/18, `textMuted`, centred, gap 24 above, 1px `border` divider above it.

## 3. Components (same names in both apps)

| Component | Spec |
|---|---|
| **AuthShell** | Brand area + card slot + step transition + one hidden live region that announces the step title |
| **AuthCard** | The white card (section 1) |
| **StepHeader** | Optional StatusIcon/Avatar, title (focus target, `tabIndex -1`), subtitle. Also sets the browser tab title on web: `<title> · HMS` |
| **TextField** | Label above (`small` 13/18, semibold 600, `text`), hint under the label (`caption` 12/16, `textMuted`), input height `layout.inputHeight` 48, `radius.sm` 10, 1px `inputBorder`, padding 0 14, text `bodyLg` 16 (stops iOS zoom). Focus: 2px `primary` border + 3px `focusRing` outer ring. Error: `danger.fg` border, message under the input (`small`, `danger.fg`) with the alert icon, tied with `aria-describedby` / accessibilityHint. Label always visible; no placeholder used as a label |
| **PasswordField** | TextField + trailing text button `copy.common.show` / `hide`, 44x44 hit area, `link` colour, semibold. Paste allowed. Web only: Caps Lock warning under the field (caption, `warning.fg`) |
| **CodeField** | ONE input (not 6 boxes), `inputmode=numeric`, `autocomplete=one-time-code`, max 7 chars (allows "123 456"), letter-spacing 4, monospace digits, `bodyLg` 18 semibold. Accepts spaces and paste. Recovery code variant: text keyboard, `autocapitalize=characters`, max 11 |
| **PasswordChecklist** | Under a new-password field. One row per `newPasswordChecks` result: icon `check_circle` in `success.fg` when ok, `radio_button_unchecked` in `textMuted` when not; text `small` 13/18. Title `copy.newPassword.rulesTitle`. Updates live, announced politely |
| **Banner** | Tones danger / warning / info / success from tokens (`fg`, `bg`, `border`), `radius.sm` 10, padding 12, icon 20px + text `small` 13/18 (title line semibold if given). Danger is announced assertively (`role=alert`), others politely |
| **PrimaryButton** | Height 48, full width, `radius.md` 14, solid `primary`, text `onPrimary` 16 semibold. Hover `primaryHover` (web), pressed `primaryPressed` + scale 0.98. **Busy:** spinner + the screen's `busy` text, disabled, no double submit, fields read-only while busy. Disabled: 50% opacity |
| **SecondaryButton** | Same size, white background, 1px `borderStrong`, text `primary` semibold. Hover/pressed `surfaceMuted` |
| **LinkButton** | Text `link` colour, `body` 15 semibold, min height 44, underline on hover/focus (web only; mobile never underlines) |
| **Checkbox** | 24px box, radius 6, 2px `inputBorder`; checked = `primary` fill + white tick. Whole row is the hit area (min 44) |
| **StatusIcon** | Section 2 |
| **Avatar** | Circle with initials (first letters of first + last word of `displayName`), `violet.100` background, `violet.800` text, bold. 56px on screenLocked, 40px in the app bar |
| **OfflineBanner** | Section 2 |
| **DemoAccounts** | Dev builds only. Collapsed panel under the card ("Demo accounts"). Rows: identifier (monospace) + `shows` text; tap fills the identifier + `DEMO_PASSWORD` on signIn. Also: demo email links (reset valid/expired/invalid, invite valid/expired/used/invalid), and dev switches: Simulate offline, Simulate "signed in on another device", Lock screen now |

Spinner: web = 18px ring, 2px stroke, `onPrimary` (in buttons) or `primary` (elsewhere), 0.8s linear spin, static under reduced motion. Mobile = native ActivityIndicator; under reduced motion it is hidden and only the busy text shows.

## 4. Motion

| What | Spec |
|---|---|
| Step change | The card animates: forward = new card fades in and slides from 8px right to 0; back = from 8px left. `motion.base` 220ms, `motion.easeOut`. Outgoing card fades out in `motion.fast` 120ms |
| Reduced motion | Fade only, no movement. Spinner stops spinning (shows static ring) |
| Button press | Scale 0.98, 120ms |
| Mobile header | Height animates full ↔ compact, 220ms easeOut |
| Errors | No shake. Banner appears with a 120ms fade |

"Back" = browser Back (web), Android back button / "‹ Back to sign in" (both).

## 5. The 16 steps

Icons use Material Symbols names (mobile: expo-symbols; web: matching inline SVG line icons, 1.75 stroke).
"Fields" lists autocomplete values (web) / textContentType (mobile).

| # | Step | Top | Title / subtitle (copy key) | Body | Primary | Secondary |
|---|---|---|---|---|---|---|
| 1 | **signIn** | - (full brand header) | `signIn.title` / `signIn.subtitle` | TextField `identifierLabel` + hint `identifierHint` (`username`); PasswordField `passwordLabel` (`current-password`); LinkButton `forgot` right-aligned under the password field | `submit` / busy `busy` | Footer note `noAccount` |
| 2 | **twoFactor** | StatusIcon `shield` | `twoFactor.title` / `subtitle` | CodeField `codeLabel` (`one-time-code`) | `submit` / `busy` | LinkButton `useRecovery`; Back to sign in |
| 3 | **recoveryCode** | StatusIcon `key` | `recoveryCode.title` / `subtitle` | CodeField recovery variant `codeLabel` | `submit` / `busy` | LinkButton `useApp`; footer note `lost` |
| 4 | **setupTwoFactor** | StatusIcon `shield` | `setupTwoFactor.title` / `subtitle` | Numbered steps 1-3. Step 1 text. Step 2: web = QR (176px, white box, 1px border, radius sm) + LinkButton `manualLink` that reveals `keyLabel` + key (monospace, grouped) + SecondaryButton `copyKey`; mobile = `step2Mobile` + SecondaryButton `openApp` (otpauth link) + key + `copyKey`. Step 3: CodeField. While loading: spinner + `loading` | `submit` / `busy` | Back to sign in |
| 5 | **recoveryCodes** | StatusIcon `key` | `recoveryCodes.title` / `subtitle` | 10 codes in a 2-column monospace grid, `surfaceMuted` box, radius md, padding 16. SecondaryButtons side by side: `copy` (web+mobile), web `download` (.txt file) / mobile `share` (share sheet; uses `download` until the Lead adds `recoveryCodes.share`). Checkbox `confirm` | `submit` (disabled until ticked) | none (no Back: codes are shown once) |
| 6 | **changePassword** | StatusIcon `lock` | `changePassword.title` / `subtitle` | PasswordField `newPassword.label` (`new-password`) + PasswordChecklist; PasswordField `confirmLabel` (`new-password`) | `submit` / `busy` | Back to sign in |
| 7 | **forgotPassword** | StatusIcon `mail` | `forgotPassword.title` / `subtitle` | TextField `emailLabel` (`email`, email keyboard) | `submit` / `busy` | Back to sign in; footer note `noEmail` |
| 8 | **forgotPasswordSent** | StatusIcon `mail` | `forgotPasswordSent.title` / - | `body` (with the typed email, bold), `hint` in textMuted | PrimaryButton `common.backToSignIn` | SecondaryButton `resend` (busy: `forgotPassword.busy`; on success it just becomes idle again) |
| 9 | **resetPassword** | StatusIcon `lock` | `resetPassword.title` / `forAccount` | Loading: spinner + `loading` (whole card body). Then same fields as changePassword | `submit` / `busy` | Back to sign in |
| 10 | **resetDone** | StatusIcon `check_circle` | `resetDone.title` / `body` | - | `action` | - |
| 11 | **acceptInvite** | none | `acceptInvite.title` (place = hotel or group name) / `subtitle` | `forAccount` line (small, textSecondary); fields as changePassword. Loading: spinner + `loading` | `submit` / `busy` | - |
| 12 | **linkProblem** | StatusIcon `schedule` (expired) or `link_off` (invalid/used) | `linkProblem[code].title` / `body` | - | `action` (reset codes → forgotPassword; invite codes → signIn) | Back to sign in (reset codes only) |
| 13 | **locked** | StatusIcon `lock` | `locked.title` / `body` (minutes from `lockedUntil`, updates each minute) | `shareHint` as an info Banner | `reset` (→ forgotPassword) | Back to sign in |
| 14 | **sessionEnded** | StatusIcon `logout` (replaced) or `schedule` (expired) | `sessionEnded[code].title` / `body` | `hint` as a warning Banner when not empty | `action` (→ signIn, identifier kept) | - |
| 15 | **screenLocked** | Avatar 56px (initials) | `screenLocked.title` / `subtitle` | PasswordField `signIn.passwordLabel` (`current-password`). Username hidden field for password managers (web) | `submit` / `busy` | LinkButton `switchUser` (signs out, → signIn) |
| 16 | **signedIn** | see section 6 | | | | |

## 6. Role landing page (signedIn)

Every role lands on its own placeholder dashboard (MJ via Lead). It is **not** in the auth card; it uses an **AppFrame** layout:

| Part | Spec |
|---|---|
| App bar | White, 64px (mobile: 56px + safe area), 1px `border` bottom. Left: HMS wordmark in `primary`. Right: Avatar 40px + name (hidden under 640px) |
| Page | `bg`, content max width 960, padding 24 (phone 16) |
| Welcome | `signedIn.title` (title 24/30 bold), `signedIn.subtitle` ({role} = `roleLabel`, {place} = hotel or group) |
| Role card | white card, radius lg 18, shadow sm, padding 24: heading `roleHome[role].title` (20/28 semibold), scope line `roleHome[role].scope` (body, textSecondary), then a dashed `borderStrong` placeholder box (radius md, padding 32, centred) with `signedIn.placeholder` in textMuted |
| Actions | Row under the card: SecondaryButton `lockNow`, LinkButton `signOut` (busy: `signingOut`). Phone: stacked, full width |

Idle lock: after `SCREEN_LOCK_AFTER_MS` (30 min) without input → screenLocked. Session check: every 60 s and when the app comes back to the foreground → if SESSION_REPLACED / SESSION_EXPIRED → sessionEnded.

## 7. States (every screen)

| State | Look |
|---|---|
| Loading (link check, 2FA setup) | Card body = centred spinner (primary) + the screen's `loading` text, `aria-busy` |
| Submitting | PrimaryButton busy (spinner + `busy` text), fields read-only, links disabled |
| Field error | Shown after submit, then live as the user fixes it. Text from `copy.requiredByField` (empty) or `copy.fieldErrors`. Focus goes to the first invalid field |
| Server error | danger Banner with `errorText[code]` (recovery screen: `wrongRecoveryCode` for INVALID_CODE). Focus goes to the Banner. Never show `error.message` |
| Errors that restart the flow | CHALLENGE_EXPIRED, CODE_ATTEMPTS_EXCEEDED → back to signIn with a danger Banner of that text |
| ACCOUNT_LOCKED | → locked step |
| RATE_LIMITED | danger Banner; the PrimaryButton stays disabled for `retryAfterSeconds` |
| Offline | OfflineBanner at the top of the card; submitting while offline shows the same text as a danger Banner (no request sent) |
| Success | Move to the next step (no toast). Copy actions show `common.copied` on the button for 2 s |

## 8. Accessibility (both apps)

- WCAG 2.1 AA contrast (token pairs are pre-checked). 44px minimum touch targets.
- Visible focus on every control (web: 3px `focusRing` + 2px primary).
- Labels tied to inputs; errors tied with `aria-describedby` / accessibilityHint; error and Banner text announced.
- Step change: focus moves to the first field (form steps) or the title (status steps: forgotPasswordSent, resetDone, linkProblem, locked, sessionEnded, signedIn). The live region announces the new title.
- Language `en-IN`. Respect reduced motion.

## 9. Deep links and history

| | Web | Mobile |
|---|---|---|
| Reset link | `/?reset=<token>` → OPEN_RESET_LINK; the token is then removed from the address bar (kept in flow state) | `hms://reset?token=` |
| Invite link | `/?invite=<token>` → OPEN_INVITE_LINK; token removed from the address bar the same way | `hms://invite?token=` |
| Back | Browser Back returns to the previous safe step (signIn, forgotPassword, twoFactor, recoveryCode); other steps go to signIn. On recoveryCodes, signedIn and screenLocked, Back does nothing | Android back: same safe-step rule. recoveryCodes: blocked. signIn, signedIn, screenLocked: system default (app goes to the background) |
| Refresh (web) | Starts at signIn (mock keeps no session). Opening the email link again reopens the link step | - |

## 10. Open items (sent to the Lead)

See the change log; copy gaps are listed in the Web UI 1 report.

## 11. Additions in v1.2 (Lead contract changes, MJ approved)

| Item | Layout (both apps) |
|---|---|
| **Password rules** (8-128, upper, lower, number, special, not identifier, no hidden chars) | PasswordChecklist shows all 7 rows from `newPasswordChecks`, single column, inside a `surfaceMuted` box (radius sm, padding 12) under the new-password field. Field error `password_rules` text from `copy.fieldErrors` |
| **Remember this device** (twoFactor + recoveryCode) | Checkbox between the code field and the primary button, unticked by default, label `copy.twoFactor.rememberDevice`. Under it, always visible: `copy.twoFactor.rememberDeviceWarning` as a caption (12/16, textMuted), indented 36px to line up with the label text, tied to the checkbox with aria-describedby / accessibilityHint. Disabled while busy. Sent as `rememberDevice` |
| **Idle-lock warning** (`SCREEN_LOCK_WARNING_MS` = 30 s before the lock) | signedIn only. A **modal alert dialog** (web: native `<dialog>` + role=alertdialog; mobile: Modal with accessibilityViewIsModal): white card radius xl, shadow lg, padding 24, max 360 wide, dim backdrop (text colour at 40%). Content: `fill(screenLocked.warning, {seconds})` as the heading, counting down each second (screen readers hear a rounded value every 10 s), and a full-width PrimaryButton `screenLocked.staySignedIn` with focus. Esc / Android back = Stay signed in. Any input also closes it and restarts the timer |
| **Check the address** | **Removed by MJ** (2026-10-05). Not shown on any screen; `checkAddress` and `APP_DOMAIN` are gone from ui-shared |
| **Attempts left** | Never shown, on any screen (Lead decision d) |
| **Recovery codes save button** | Web `recoveryCodes.download` (.txt file), mobile `recoveryCodes.share` (share sheet) (Lead decision e) |
| **Password checklist for screen readers** | Each row reads "<rule>: Done" / "<rule>: Not yet" (`copy.newPassword.ruleMet` / `ruleNotMet`) |
| **Lockout during screen unlock** | `LOCKED` now clears the whole state in flow.ts, so no session is left behind |

## Change log

| Date | Who | Change |
|---|---|---|
| 2026-10-05 | Web UI 1 | v1 written from FINAL SPEC v1 agreed by message with Mobile UI 1 |
| 2026-10-05 | Mobile UI 1 | Confirmed v1 with 4 notes: Android back defaults, native spinner, no underline on mobile links, "Share codes" label on mobile (v1.1) |
| 2026-10-05 | Web UI 1 | v1.2: section 11 (7-rule checklist, remember device, idle-lock warning, check-address line) from Lead contract changes |
| 2026-10-05 | Web UI 1 | v1.3: Lead decisions a-e (remember-device position, idle warning as modal dialog, checkAddress at card bottom with lock icon, no attemptsLeft, download vs share), checklist SR words, LOCKED clears state |
| 2026-10-05 | Web UI 1 | v1.3: check-address line removed (MJ); web strips reset/invite tokens from the address bar after reading them |
| 2026-10-05 | Web UI 1 | v2.0: Pallav design (spec 09) + night mode (spec 09 section 10); section 0 adds placement table, web component API and colour roles |
