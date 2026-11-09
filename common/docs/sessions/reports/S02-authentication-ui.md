# S02 - Authentication UI (web + mobile) - brief from the Lead

MJ approved (2026-10-05): build ALL authentication screens as a **full SPA**, web and mobile side by side. Web UI 1 builds `web-app/`, Mobile UI 1 builds `Mobile App/`. Lead (session hms-c0) owns `ui-shared/` and this file.

## Read first
1. `MASTER.md` (rules R1-R12, sections 4.2, 6, 7, 8)
2. `ui-shared/` - the contract. Use it, do not copy it:
   - `auth/copy.ts` every word on screen (researched). Do not invent text.
   - `tokens.ts` colours, spacing, radius, fonts, motion.
   - `auth/flow.ts` `authReducer` - the screen state machine. Both apps use it with `useReducer`.
   - `auth/types.ts` API contract, `auth/validation.ts` field checks, `auth/mock.ts` mock API + demo accounts (password `Demo@Pass2026`, code `123456`).
3. `docs/design/PALLAV_UI_REVIEW_2026-10-04.md` - look and feel to keep and improve.

## What "full SPA" means here
- Web: ONE route (`/`). All auth steps and the signed-in placeholder switch on the client with a short fade/slide transition. No page reloads. Each step pushes browser history so Back works. Email links open as `/?reset=<token>` and `/?invite=<token>`.
- Mobile: ONE screen (`src/app/index.tsx`) driving the same reducer with animated step changes. Deep links `hms://reset?token=` and `hms://invite?token=` (set scheme `hms` in app.json). Android back button = step back.

## Screens (all 16 `AuthStep`s)
signIn, twoFactor, recoveryCode, setupTwoFactor (web: QR; mobile: "Open authenticator app" button + key), recoveryCodes (copy/download, must tick "saved"), changePassword, forgotPassword, forgotPasswordSent, resetPassword, resetDone, acceptInvite, linkProblem, locked, sessionEnded, screenLocked (after 30 min idle), signedIn (placeholder: name, role, hotel, Lock screen, Sign out).

## Must have (R8 and MASTER)
- Every screen: loading, error, success; offline message; no raw errors (use `errorText`).
- Busy buttons with copy `busy` labels; no double submit.
- Password show/hide; paste allowed; code fields accept spaces and paste; numeric keyboard for codes; `autocomplete` (`username`, `current-password`, `new-password`, `one-time-code`).
- Live new-password checklist from `newPasswordChecks`.
- WCAG 2.1 AA, 44px touch targets, visible focus, labels tied to fields, errors announced (aria-live / accessibilityLiveRegion).
- Light theme only on auth screens. **No day/night toggle** (MJ).
- Web layout: brand panel left (gradient + `copy.brand`), form card right; on phones the panel shrinks to a header. Mobile: brand header + card, keyboard-safe, safe areas.
- Placeholder logo: "HMS" wordmark.
- Dev-only "Demo accounts" helper listing `DEMO_ACCOUNTS` (hidden in production builds).
- TypeScript strict, no `any`. **No new libraries** without MJ's OK (R11) - ask the Lead first.

## Import ui-shared
- Web: tsconfig path `"@shared/*": ["../ui-shared/*"]`; next.config `turbopack.root` = parent folder so files outside `web-app/` compile.
- Mobile: tsconfig path `"@shared/*": ["../ui-shared/*"]`; `metro.config.js` adds `watchFolders: [path.resolve(__dirname, '../ui-shared')]`.

## Team work
- Use all your agents in parallel: research, design, builder, tests, code-reviewer, accessibility/security review. Each agent its own files.
- **Research first** (online + this project): best hotel/SaaS sign-in screens, mobile auth patterns (Expo/iOS/Android). Share findings with the other UI session.
- **Talk to each other** (MJ wants a consistent UI): agree on layout, component names, spacing, animations, icon style and every state before building; send screenshots/notes when a screen is done. Web UI 1 and Mobile UI 1 message each other directly.
- Need a change in `ui-shared/` (text, token, type)? Message the Lead (hms-c0). Do not edit `ui-shared/` yourself.
- Do not touch the other app's folder. No commit, no push (R9).

## Lead decisions added 2026-10-05 (fill gaps in the UI agreement v1)
| # | Item | Decision |
|---|---|---|
| a | Remember this device (MJ approved) | Checkbox on twoFactor AND recoveryCode, between the code field and the Verify button. Unticked by default. `rememberDeviceWarning` always visible under it in muted small text. Sends `rememberDevice` in the verify request. |
| b | Idle-lock warning (MJ approved) | Modal dialog (web `role="alertdialog"`, mobile Modal with accessibilityViewIsModal) shown on `signedIn` only, `SCREEN_LOCK_WARNING_MS` (30 s) before the lock, live countdown in `screenLocked.warning`, primary button `staySignedIn` (resets the idle timer). Any user activity also closes it. |
| c | "Check the address" line | **Removed by MJ (2026-10-05).** Not built in either app. |
| d | attemptsLeft | Not shown anywhere in the pilot (keeps errors generic; nothing reveals that an account exists). |
| e | Mobile recovery-codes button | Mobile uses `recoveryCodes.share` ("Share codes", share sheet). Web uses `download`. Both use `copy`. |

| f | Night mode (MJ 2026-10-05, via hms-7e) | Follows the device's dark mode automatically, **no toggle**, on all 16 steps + signedIn, web and mobile. Replaces "light theme only". Tokens: `auth.night` in ui-shared/tokens.ts; spec section 10 of `docs/design/ui-review/09-PALLAV-DESIGN-SPEC.md`. |
| g | Look | Exact Hotel Pallav sign-in design, improved (spec 09). The review session hms-7e gives the UI teams their tasks (MJ). |

## Libraries approved by MJ (R11)
| Library | App | Date |
|---|---|---|
| eslint, eslint-config-expo (dev) | Mobile App | 2026-10-05 |
| expo-clipboard (~57.0.2) | Mobile App | 2026-10-05 |
| expo-network | Mobile App | 2026-10-05 |
| @expo-google-fonts/inter | Mobile App | 2026-10-05 |
| expo-secure-store | Mobile App | Approved for step 6 (Connect), not before |

## Done when
- All 16 steps work on the mock in both apps, matching each other.
- Web: `npm run lint`, `npx tsc --noEmit`, `npm run build` pass. Mobile: `npx expo lint`, `npx tsc --noEmit` pass, runs in Expo Go / web.
- Report to the Lead: what was built, how to run it, screenshots, open questions. Then MJ reviews the screens live.
