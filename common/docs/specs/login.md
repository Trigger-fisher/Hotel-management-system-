# Behaviour spec: the login backend

Targets `ui-shared/auth-pallav` (`PallavAuthApi`, `PALLAV_AUTH_ENDPOINTS`) and Hotel Pallav's sign-in. Pallav source paths are relative to the Pallav repo; line numbers are from the clone used for this port. Where HMS deliberately differs (MJ #9, #13) the row says **HMS (#13)** and names the test that proves it. Tests: `tests/server/auth.golden.test.ts` (real PHP fixtures), `tests/server/auth.login.test.ts` (through the real route files).

## 1. The sign-in, step by step

| # | Rule | Pallav | HMS |
|---|---|---|---|
| 1 | Username (max 50, trimmed, case-insensitive) and password (max 128) | `AuthController.php:60-65` | same; empty or too long is 422 `VALIDATION_FAILED` |
| 2 | A wrong username and a wrong password say the same thing | `:80-89` | `INVALID_CREDENTIALS`; an unknown username spends a dummy Argon2 verify so the time is the same (test: "a wrong username and a wrong password give the SAME answer") |
| 3 | A locked or blocked account is announced BEFORE the password is checked, even for the right password | `:76-78` | `ACCOUNT_LOCKED` (+ `retryAfterSeconds`) / `ACCOUNT_BLOCKED` |
| 4 | Five wrong passwords | `:352-365`: BLOCKS the account, no timer | **HMS (#13)**: a TIMED lock, 15 min, 30 min, 1 h, 3 h, 8 h, 24 h, then 24 h again (`PasswordPolicy::LOCK_STEPS`, golden-tested); a good sign-in resets the count and the level. The first four wrong tries answer only `INVALID_CREDENTIALS`. Test: "each lock lasts longer" |
| 5 | A deactivated account is refused after the right password | `:91-93` | `ACCOUNT_DISABLED`, only after the right password |
| 6 | A temporary password opens no session | `:101-103`, `:257-262` | `password_change_required` + a signed `changeToken` valid 15 minutes (`CHANGE_MINUTES`), bound to the password hash so it works once |
| 7 | The emailed code is optional (`two_factor_enabled`) | `:107` | **HMS (#13)**: ALWAYS for administrators (`users.code_required`, a CHECK keeps it true for admin roles) |
| 8 | The code: 6 digits, valid 10 minutes, kept as a hash | `OneTimeCode.php:31,78-87` | same; the hash is the keyed HMAC bound to purpose, user and code (`hashAuthCode`); the code lives only inside the encrypted outbox payload |
| 9 | Five wrong codes | `OneTimeCode.php:185-189`: BLOCKS the account | **HMS (#13)**: the CODE is cancelled (sign in again for a new one); the account is not blocked. Test: "five wrong codes CANCEL that code" |
| 10 | Resend: once a minute, five emails then a wait that grows to 24 h | `OneTimeCode.php:34,37,135-142,97-113` | **HMS (#13)**: 30 s between sends (the contract's `resendAfterSeconds`), five emails per hour, then refused until the hour is over (`rate_limits`); the SAME challenge stays valid (the row's `resend_count` and `last_sent_at`) |
| 11 | A half-finished sign-in is good for ten minutes | `:341-343` | the code row's age (10 minutes) |
| 12 | Masked address on the code screen: first two characters, stars, domain | `:382-392` | `an***@demo.hms` (golden-tested against the real function) |
| 13 | A good sign-in clears the per-address counter and the account's counters | `:96`, `:201-214` | same (`login-ip` cleared; failed attempts, lock level and lock reset). An admin BLOCK stays |
| 14 | Per-address brakes | `:67-72` 20 per 15 min; `routes/web.php:76` `throttle:30,1` | both, as route `limits` (`login` 30 per minute, `login-ip` 20 per 15 minutes, by address) |

## 2. Forgot password

| Rule | Pallav | HMS |
|---|---|---|
| Step one answers differently for a real account (masked address) and an unknown one | `:483-485` | **HMS (#13)**: ALWAYS the same answer: a challenge id that looks real (a stateless dummy when there is no row), `sentTo: "the email on that account"`, `resendAfterSeconds: 30`. A disabled account, one with no email, one inside a wait and an unknown one are indistinguishable. Test: "a real account, an unknown username, a disabled account and one with no email all get the SAME shape" |
| Email sent inline | `:473` | the mail goes through `platform.outbox` (encrypted address and payload), sent by a worker, so the timing says nothing |
| A locked or blocked account may still ask for a code | `:473` (only `is_active` and email) | same |
| Throttles | `routes/web.php:85-87,91`; `:464-468` | `forgot` 10/min, `reset-ip` 10 per 15 min, `forgot-resend` 6/min, `reset-code` 30/min, `reset-change` 10/min, all by address |
| The code and the new password | two steps (`checkResetCode`, `changePassword`) | one call: `{ challengeId, code, newPassword }` |
| Password rule | `PasswordPolicy::REGEX`, max 128 (`PasswordPolicy.php:11-13,90`) | same, golden-tested over 469 candidates against real PCRE (bytes, ASCII `\S`, `$` before a final newline); checked BEFORE the code, the same for a real account and a dummy |
| Same password again | `:285-289` | `PASSWORD_REUSED` with Pallav's two messages ("different from the temporary one" / "from your old one") |
| A wrong reset code | `:500-511` | `INVALID_CODE` (no tries-left detail: a dummy has none); five wrong cancel the code; a dummy challenge is counted the same way so the fifth wrong try is `CODE_ATTEMPTS_EXCEEDED` for a real account AND a dummy. Test: "a wrong code on a REAL account and on a DUMMY look the same" |
| Nothing | none | **HMS (#13)**: ten wrong reset codes in 24 hours stop new reset codes (and further tries) for the account for 24 hours (`rate_limits`) |
| A reset unblocks the account | `:302-308` | **HMS (#13)**: a reset clears a TIMED lock but does NOT lift an administrator's block (otherwise a rogue employee could undo it). Test: "a reset clears a timed lock but does NOT lift an administrator's block" |
| After a change every other session ends | `:298-300` | all sessions revoked (reason `password_changed`); "your password changed" is mailed |

## 3. Sessions (MASTER 4.2)

- **Web:** one httpOnly cookie, `__Host-hms_session`, `Path=/; HttpOnly; Secure; SameSite=Lax`, no `Domain`, no `Max-Age`; the value is 256 random bits, only its SHA-256 is stored. A new web sign-in revokes the old web session (reason `replaced`, Pallav's "one device", `EnsureSingleSession.php`). Idle expiry 120 minutes, moved forward by real requests (at most once a minute) and NOT by `GET /auth/session`.
- **Phone:** the token (same shape) in `session.token` and sent as `Authorization: Bearer`; one active token per (user, device id); 90 days from issue, never extended (Pallav's `MobileToken::DAYS`). A device id is required on phones and forbidden on the web.
- Doors are separate: a cookie value sent as a bearer token is refused, and the reverse.
- No refresh tokens, no families, no reuse detection (nothing to rotate).
- **What ends a session:** sign-out, a newer sign-in, a password change or reset, an administrator's block, a disabled or deleted account, expiry. **HMS (#13):** a stranger's wrong attempts only ever LOCK; they never end the owner's session (Pallav's `EnsureAccountIsUsable` logged a locked account out). Test: "a stranger's wrong attempts lock the account but NEVER end the owner's session".
- A new phone (a device id this person never used) mails them once.
- Same-origin: a cookie session's writes must come from our own pages; a PUBLIC write (sign-in) with a cross-site `Origin` or `Sec-Fetch-Site: cross-site` is refused too (login CSRF); an app sends neither and passes.

## 4. What the apps receive

`HmsUser`: id, display name, email, username, account role (the dashboard), hotel, group, and **`abilities`**: the one-off abilities (`system.backdate`, `system.force`, `users.password`, `users.set-password`, ...) the person holds in THIS hotel, taken from the permission snapshot (role grants with the roles below folded in, then the person's own grants and revokes for the hotel), never from input. Read fresh on every `GET /auth/session`, so a role change shows at once. Test: "abilities in the answer".

## 5. Notifications and the trail

Every email is a row in `platform.outbox`: address and payload AES-256-GCM under the contexts `outbox.to_email` and `outbox.payload`; the one-time code is only ever inside the encrypted payload and is removed when the mail is sent or has failed for good (five tries). Mails: sign-in code, reset code, password changed, account locked, account blocked, new phone. A fake sender is used in tests; nodemailer comes later behind `MailSender`.
`auth_events` rows: `login_success`, `login_failed`, `code_sent`, `code_failed`, `password_reset_requested`, `password_reset_done`, `password_changed`, `account_locked`, `account_blocked`, `account_unblocked`, `session_replaced`, `logout`. `audit_log` rows for first password, reset, block and unblock. Never a password, code or token (test: "the trail holds no secret").

## 6. Counters that must survive a refusal

What is counted (wrong passwords, wrong codes, sends) is committed in a unit of its own BEFORE the error is thrown, so a refusal never rolls its own counter back; the audit rows and notification mails of a failure go through the wrapper's `failAfterCommit`.

## 7. Not in this slice

The administrator's screens that call `blockUser` / `unblockUser` (the users module), changing one's own password while signed in, "my sign-ins" history, the real PostgreSQL repositories, nodemailer, the purge of expired sessions, codes and counters, `withHotelAs` for platform staff.
