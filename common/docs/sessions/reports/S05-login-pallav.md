# S05 - Login screens v2: Hotel Pallav's login (brief from the Lead)

MJ (2026-10-05): #9 = follow Hotel Pallav's login; #13 = fix all sign-in safety issues. MASTER.md 4.2 is updated.
MJ: never stop work; proceed. No subagents. No commit/push.

## Contract (new, owned by the Lead): `ui-shared/auth-pallav/`
- `types.ts` (`PallavAuthApi`, results, endpoints), `flow.ts` (`pallavAuthReducer`, 11 steps), `copy.ts` (`pallavCopy`, only the NEW texts; everything shared stays in `ui-shared/auth/copy.ts`), `mock.ts` (dev-only `createPallavMockAuthApi`, demo usernames; import only in dev code paths), `index.ts` (no mock re-export).
- Username rule and field error: `validateUsername` / `normaliseUsername` and `fieldErrors.invalid_username` in `ui-shared/auth/`.

## Steps (both apps, same order, same text)
| Step | What the user sees |
|---|---|
| signIn | Username + Password (+ Show), "Forgot password?" on the password label row, Sign in |
| emailCode | "Check your email", 6-digit code field (paste, spaces OK, one-time-code autocomplete), Verify, "Send a new code" with a countdown, "Sign in with a different account" |
| changePassword | Temporary password: new + confirm with the live 7-rule checklist (as today) |
| forgotPassword | Username, "Send code" |
| resetPassword | Emailed code + new password + confirm (checklist), "Send a new code" countdown. Text never confirms whether the username exists |
| resetDone | Password changed, Sign in |
| locked | Timed lock: "try again at {time} (in {minutes})", Reset password link |
| blocked | Blocked by an admin: contact your hotel admin |
| sessionEnded | SESSION_REPLACED / SESSION_EXPIRED (existing texts) and SESSION_REVOKED (new `pallavCopy.sessionRevoked`) |
| screenLocked, signedIn | As today (signedIn renders the role dashboard) |

**Remove** from both apps: authenticator-app setup (QR, key), recovery-code entry, recovery-codes screen, "Remember this device", invite link screens and link-problem screens, and sign-in by mobile number or email. Keep the Pallav look (spec 09), night mode, all states, the idle-lock warning, the dev demo panel (use `PALLAV_DEMO_ACCOUNTS`, `PALLAV_DEMO_TITLE` from the mock, dev builds only).

## Done when
Both apps use `ui-shared/auth-pallav` only; the old `ui-shared/auth` flow/mock and TOTP/invite screens are no longer imported (the Lead then deletes the old files and the INVITE_* codes); lint, type check, build/bundle and the existing login tests (updated) pass; screenshots of every step day + night to the reviewer ("Backend review"); 3-line status to the Lead.
