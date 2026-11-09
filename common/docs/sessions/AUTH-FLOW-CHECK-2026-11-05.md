# Sign-in flow check, 5 Nov 2026

Branch `redesign/auth` (worktree `HMS Redesign-roles/auth`). Dev server on port 3210 in mock mode (webpack, because Turbopack refuses the worktree's linked `node_modules`), driven by playwright-core with Chromium. Every demo login used the demo password and the demo code. No password, code or token is written here.

Screenshots (not committed): `web-app/.auth-proof/` holds the login page and the code page at 390 px and 1280 px, in day and night.

## Every demo login

The emailed code was switched on for each account first (the demo keeps that switch for the tab now), so each sign-in went through the code step.

| Login | Kind | Code step | Dashboard opened | First heading | Reload | Sign out | Back button |
|---|---|---|---|---|---|---|---|
| mihir | Super Admin | shown, demo code accepted | Platform | Overview | stays signed in | sign-in page | no dashboard (stays on /login) |
| superadmin | Super Admin | shown, accepted | Platform | Overview | stays signed in | sign-in page | no dashboard |
| platform | Platform Admin | shown, accepted | Platform | Overview | stays signed in | sign-in page | no dashboard |
| group | Group Hotel Admin | shown, accepted | Group | Overview | stays signed in | sign-in page | no dashboard |
| groupadmin | Group Hotel Admin | shown, accepted | Group | Overview | stays signed in | sign-in page | no dashboard |
| anita | Hotel Admin | shown, accepted | Hotel | Overview | stays signed in | sign-in page | no dashboard |
| staff | Hotel User | shown, accepted | Hotel | Overview | stays signed in | sign-in page | no dashboard |
| corporate | Company | shown, accepted | Company Portal | Overview | stays signed in | sign-in page | no dashboard |
| guest | Guest | shown, accepted | Guest Portal | Home | stays signed in | sign-in page | no dashboard |

Each kind opened only its own dashboard. `dashboardForRole` is now pinned by a table test for all seven roles.

## Other checks

| Check | Result |
|---|---|
| Wrong password | "Those details didn't match. Check them and try again." |
| Wrong code, three times | Each try shows the message under the code box with the tries left (4, then 3, then 2). The cursor stays in the box, so a phone keeps its number keyboard |
| Forgot password | "Check your email". The words are the same whether or not the account exists |
| Screen lock, then reload (390 px) | The lock screen comes back after the reload. The demo password unlocks it and the dashboard returns |
| Language buttons, 390 px | 73 x 44 px each. No sideways scroll at 390 px |
| Hotel User calls a Hotel Admin route and a platform route | 403 on both (`GET /api/v1/admin/users`, `GET /api/v1/platform/hotels`). This is a server test in `tests/server/auth.signInFixes.test.ts`, because mock mode has no server session |

## Findings fixed on this branch

| Finding | Commit |
|---|---|
| ease-password-checklist-green-server-refuses (high) | ecf7c84f |
| flow-disabled-account-says-details-wrong (high) | 1092152e |
| flow-screen-lock-bypassed-by-reload + security-screen-lock-client-only (high, medium) | a795ddd6 |
| security-portal-account-can-hold-hotel-grants (medium) | 1aa47f85 |
| flow-portal-accounts-cannot-be-invited (high, server side) | b640ce8a |
| flow-group-admin-session-has-no-group, flow-console-role-can-sit-inside-a-hotel, flow-multi-hotel-account-blocked-by-default-hotel (medium) | 5c070418 |
| flow-sign-out-leaves-hotel-visit-open (medium), security-no-absolute-session-lifetime (low) | b34b826a |
| flow-invite-mails-have-no-sign-in-link (medium), flow-locked-mail-shows-raw-utc (low) | dbe224b9 |
| ease-role-neutral-wording (medium), flow-blocked-and-locked-copy-wrong-audience (low), ease-english-only-strings-in-translated-screens (medium), both change-password copy findings (low), ease-inconsistent-auth-words (low) | 9a58e2e1 |
| ease-code-focus-lost-after-wrong-code (medium), ease-code-paste-tolerance (low) | 62ae6a0f |
| ease-language-switch-small-targets (medium) | 4ac9a6b2 |
| ease-no-ui-tests-for-sign-in-screens (medium, in part: role table and password parity) | 17445148 |
| flow-mock-sign-in-rejects-email, flow-mock-two-step-code-unreachable (low) | 46cb197d |

## Not fixed here, and why

- **security-third-party-setup-not-super-admin-only (high).** Another agent owns the set-up permission helpers and routes. Its work in progress, "Super Admin only: a hotel's secret settings", covers this finding. Nothing was changed on this branch.
- **security-email-change-without-reauth (medium).** The profile form (a dashboard page) would have to send the current password and confirm the new address. That needs a contract change and a UI change.
- **security-targeted-lockout-dos (medium).** The lock design needs MJ's decision: a lock per account and address, an emailed unlock link, or both.
- **flow-links-ignored-while-signed-in (medium).** Needs an interstitial ("Sign out and continue"), designed together with page.tsx and /login. Not done.
- **ease-no-ui-tests (rest).** No React Testing Library or jsdom is installed. Component tests need that tool added.
- **ease-server-field-errors-only-in-banner (low, in part).** The new-password and code errors now show next to their field. A general field mapping in useSubmit is not done.
- **security-lock-state-before-password-enumeration (low).** This changes Pallav's golden behaviour, which the golden tests pin. MJ decides.
- **security-temp-password-never-expires (low).** Done on 5 Nov 2026 evening (see the update at the end).
- **security-login-ip-limit-reset-by-own-account (low).** Needs a per (address, username) counter in the shared rate-limit store.
- **security-onboarding-admin-email-unbound (low).** This is the platform onboarding flow. It needs a confirmation code to the new address.
- **security-profile-password-no-lock (low).** Same area as the email change, so it should be done together with it.
- **security-forgot-timing-difference (low).** Padding or after() changes the route's timing in every test. Left for a separate change.
- **flow-signed-out-root-shows-marketing-site (low).** "/" as the website is MJ's decision of 25 Oct. Opening it on the lock screen for a locked session is done.
- **flow-suspended-hotel-signout-says-account-changed (low).** Needs new revoke reasons, which means a sessions CHECK change in migrations.
- **flow-mock-console-users-carry-a-hotel, flow-group-visit-says-platform-staff (low).** These are dashboard shell and demo data owned by the page agents.
- **ease-sign-in-ignores-chosen-night-theme (low).** MJ decided (5 Nov 2026): the sign-in screens are always day; the device is never followed.
- **ease-locked-screen-stale-after-lock-ends, ease-password-manager-username-missing-on-reset-link, flow-dead-code-reset-step-and-routes / ease-dead-reset-code-step (low).** Not reached in this pass.

## For the lead and MJ

- Migration `0191_session_screen_lock.sql` (renumbered from 0188 at merge) adds `platform.sessions.locked_at`. The code reads the column through `to_jsonb`, so it works before the migration is applied.
- New route `POST /api/v1/admin/users/portal-invite` is ready. The "Invite to the guest portal" button on the guest record and "Invite to the company portal" on the company record belong to those pages' owners.
- New route `POST /api/v1/auth/lock`. The route flag `whileLocked` marks the routes that answer while the screen is locked.
- Absolute session lifetime: now set by the Super Admin per user kind (see the update below).

## Update, 5 Nov 2026 evening: MJ's sign-in and security decisions (branch `redesign/dec-auth`)

| Rule | Where it lives |
|---|---|
| Session time per user kind (Super Admin, Platform Admin, Group Hotel Admin, Hotel Admin, Hotel User, company, guest). Defaults 12 hours for staff, 7 days for company and guest; 15 minutes to 30 days. | `platform_settings` key `security.session_minutes` (migration 0192). The session resolver reads it in its one statement on every request (`policy.ts maxLifeEnd`), so a change reaches open sessions at their next request (other instances within the 10 s cache). The 120 idle minutes still apply on top. Screen: Platform settings > Sign-in security. API: `GET/PUT /api/v1/platform/security`, Super Admin only, audited (`settings_updated`). |
| Temporary password expires (invite or admin reset), default 30 minutes, 5 minutes to 24 hours | `logins.temp_password_at` (0193), `security.temp_password_minutes` (0192). Refused as `ACCOUNT_DISABLED` with `details.reason = temp_password_expired`; the sign-in screen says "This temporary password has expired. Ask your administrator to send a new one." First sign-in with a valid one still forces a new password. An account made by the operator's command line has no time recorded and is not timed. |
| Lock: 5 wrong passwords lock for 15 minutes, every time (Pallav's growing steps kept only as the golden reference) | `policy.ts HMS_LOCK_MINUTES`. The lock screen shows "05 Nov 2026, 3:05 pm". Every lock (`account_locked`, also from the profile's code switch) and every admin unlock (`account_unlocked` with `detail.by`: hotel Users screen, platform All users, Hotel admins) is in the sign-in history and the audit. |
| Vault re-check before a Show (My vault and every hotel vault), good 5 minutes | `sessions.rechecked_at` and code purpose `recheck` (0194). `POST /api/v1/auth/recheck` (password; a wrong one counts toward the lock), `POST /api/v1/auth/recheck/code` and `/recheck/code/verify` (emailed 6-digit code, five wrong cancel it). A Show without a fresh re-check answers 403 `FORBIDDEN` with `details.reason = recheck_required`; an API key can never Show. Every Show is audited with the item's name, never the secret. |
| Theme always day | The app never reads `prefers-color-scheme`; night values sit under `html[data-theme="dark"]`, set only by the person's moon button and remembered per person (`logins.ui_theme`). The sign-in frame resets to day. |

Tests: `tests/server/auth.security.test.ts`, `tests/server/theme.alwaysLight.test.ts`, plus the updated `auth.login`, `vault`, `personalVault`, `admin.users`.

Review of the same evening:
- The "Confirm it is you" calls now keep the session on a 401: before, one wrong password or code in the dialog signed the person out (`recheckApi.ts`, `tests/recheckClient.test.ts`).
- The invitation and reset emails say how long the temporary password works ("works for 30 minutes. After that, ask your administrator to send a new one.").
- The Security service is part of the composed platform services, so the route is in the route inventory test (Super Admin only, checked for every other kind) and has its own route test in `platform.superadmin.test.ts`.
- Merge order: migrations 0192-0194 go in before this code. Until 0193 is applied every password write fails (invite, admin reset, first password, reset by code or link, profile change); until 0194, the vault re-check fails and nothing in a vault can be shown.
