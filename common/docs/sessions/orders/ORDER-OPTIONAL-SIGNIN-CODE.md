# Order: the emailed sign-in code becomes OPTIONAL (decision 46, MJ, 12 Oct 2026). FAST, up to 3 agents.

Today every sign-in needs the emailed 6-digit code and an admin account cannot switch it off (database rule `users_admin_code_required`). MJ wants it NOT mandatory for anyone: default OFF, a person may turn it ON for their own account.

## Backend [f948b5]
1. New hotel/platform migration (platform schema; next free platform number, check db/migrations/platform): drop the CHECK `users_admin_code_required`, set `platform.users.code_required` default to `false`, and set it to `false` for every existing account (one UPDATE, audited as one audit_log row with the count). Applied migrations are immutable: this is a NEW file.
2. Sign-in service: when `code_required = false`, a correct username and password finishes the sign-in with a session right away (same session rules, same lock after wrong tries, same rate limits, same audit rows, same must-change-password flow); when `true`, behave as today (emailed code). The reset-password flow is unchanged (the reset link is still emailed).
3. A self-service route (e.g. `PUT /auth/profile/sign-in-code`, session auth, the person's own account only): `{ enabled: boolean }`. Turning it OFF needs the current password in the body (wrong password = the same 401/lock counting as sign-in). Turning it ON needs nothing extra. Audit "sign-in code switched on/off" (no secrets). The profile read (`GET /auth/session` and the profile route) returns `codeRequired`.
4. Nobody can change another person's flag; admin screens (Platform console users, hotel Users) never show a way to force it; new accounts are created with it off. `create-user` and `export-hosted-sql` paths: default off.
5. Tests: sign-in with and without the code, wrong password still locks, turning off needs the password, turning on works, another user's flag cannot be changed, the migration (constraint gone, existing rows false), no code is queued in the outbox for an account with it off. Update docs/BACKEND.md and write the plain risk statement in docs/SECURITY.md (create the file if it does not exist): "A stolen password is enough to sign in on an account with the code off."
6. Tell me when the migration is final: I make the Neon SQL with the checksum.

## UI [be5337]
1. My Profile (and the Platform / Super Admin account page, wherever the person edits their own account): a switch "Ask for an emailed code when I sign in" with one plain sentence under it ("Off: your password is enough. On: we also email you a 6-digit code."), default off, saves at once with a toast; turning it OFF opens a small confirm with a password field. Shared kit only.
2. The sign-in page: when the account has the code off, the code step never appears (the server finishes the sign-in); when on, as today. Remove any text that says the code is always required (sign-in help, tours, docs/UI.md).
3. Mock mode simulates both; tests; day and night, 1280 and 390 px; UI.md.

## Rules
Local commits only, nothing pushed; I push after the clean-copy check. Agree the route and field names between you. Report to Project Manager 2 [7485b3] with hashes, tests and what is not proven.
