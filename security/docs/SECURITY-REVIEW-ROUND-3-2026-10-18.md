# Security review, round 3 (B, 18 Oct 2026)

Scope: everything after round 2's base up to `1c96548` (`9753003..1c96548`, 38 commits, about 115 source and migration files): Enter-hotel access levels (platform 0135), the API key deny list (30e4d45), the mail webhooks, receipts and unsubscribe (10fb421, platform 0136), the Pathik option A routes, the central profiles with M1(a)/(b)/(c) and hotel 0045, the HTML mail layout, the region-move runbook, and the wrapper, session and platform-service changes in between.

**Read-only, done by me alone** (no helper agents): no code was changed, no test or database was run, no secret was read or printed. Every finding names its owner, who decides the fix. Round 2 is `SECURITY-REVIEW-ROUND-2-2026-10-18.md`.

**Result: no HIGH finding**, so nothing here blocks a push. Three MEDIUM findings, all of the same family as round 2's M2 and M3 (a deny list that names paths where the danger is in a value, or that does not cover a sibling route). Several LOW ones.

Ranking: **High** = exploitable now by someone without special access, or a data leak between hotels or people; **Medium** = needs a leaked secret, an insider, or a second bug, but the damage is real; **Low** = defence in depth, or narrow.

## Medium

### R3-1. The hotel's secret settings are guarded by the URL path, but they are saved through one route chosen by a group name
- **Owner:** d3 (the API key rules and the wrapper); the Enter-hotel owner for the visit list.
- **Where:**
  - `web-app/src/server/http/visitAccess.ts:19-30` (`FULL_VISIT_DENIED`) and `web-app/src/server/auth/apiTokens.ts:49-73` (`DENIED`);
  - the save route `PATCH /api/v1/admin/settings/[group]` (`app/api/v1/admin/settings/[group]/route.ts`), service `services/admin/settingsService.ts:228` (`update`), groups in `services/admin/settingsDefs.ts:54-120`.
- **What is wrong.** The hotel settings groups `razorpay_hotel`, `razorpay_food`, `backup` and `email` are all saved by that ONE route; the group is a path segment. The deny lists match other paths:
  - a full visit refuses `/admin/razorpay`, `/admin/backup` and `/admin/settings/email`, but **not** `/admin/settings/razorpay_hotel`, `/admin/settings/razorpay_food` or `/admin/settings/backup`;
  - an API key refuses `/admin/razorpay` and `/admin/backup`, but **no** `/admin/settings/...` group at all, including `email`.
  - The service only asks `requireSuperAdmin`, which looks at the role key, and a full visit and a full key both carry the hotel's SuperAdmin role.
- **Attack 1: a FULL visit (a platform admin the Super Admin gave "full", or the Super Admin).**
  - `PATCH /api/v1/admin/settings/razorpay_hotel` (or `_food`) with the person's own Razorpay `key_id`, `key_secret` and `webhook_secret`.
  - The stated hard limit of 0135 ("no payments, saved secrets, backups") is bypassed. Payment links the hotel makes afterwards go to the other account.
  - `PATCH .../backup` can switch the nightly backup off, shorten `keep_days`, or swap the Google client id and secret (the owner's next "Connect" would then authorise someone else's app).
  - The write is audited (`hotel_write`), but it is not stopped.
- **Attack 2: a FULL API key (leaked key plus an allow-listed address).**
  - The same, plus `PATCH /api/v1/admin/settings/email`: the hotel's own mail server.
  - `mail/hotelSmtp.ts` sends **every mail that names a hotel** (staff sign-in codes, password-reset links, invitations) through that server. So the key holder reads the codes and links, and takes over hotel accounts.
  - This is round 2's M3 (the platform's mail server) again, one level down. The visit list already refuses `settings/email` for this reason; the key list was not given the same line.
- **Why the test did not catch it.** `tests/server/visit.access.test.ts` picks "sensitive" routes by a keyword in the route path (`razorpay|backup|...`). The route is `.../settings/group-x`, so no keyword matches.
- **Fix.**
  - Deny by group, in both lists and in the service: refuse `razorpay_hotel`, `razorpay_food`, `backup` and `email` in a full visit (the service sees `session.visit?.access`) and for any key (`session.token`).
  - Make the inventory test walk `SETTING_GROUPS` and require every group that holds a `secret` field to be refused.

### R3-2. A full API key can still create lasting access in a hotel (round 2 M3 is only half closed)
- **Owner:** d3 (API keys).
- **Where:** `auth/apiTokens.ts:81-90` (`WRITE_DENIED`) against `app/api/v1/admin/users/**` and `admin/roles/**`; `services/admin/userService.ts:200-257`.
- **What is wrong.**
  - 30e4d45 denies keys the platform-level account routes (`platform/staff`, `hotel-admins`, `users`, group admin).
  - A full key in a hotel (scope hotel or all) is the hotel's SuperAdmin and may still call `POST /admin/users`, `PATCH /admin/users/{id}` (including a new email address), `toggle`, `unlock`, `override`, and `/admin/roles`. Nothing refuses a token session there.
- **Attack.**
  1. `POST /api/v1/admin/users` with an Admin role (one rung below SuperAdmin), the attacker's own email and any username.
  2. The invitation mail is not queued while the key is in test mode, which is the default for a full key. That does not stop the account: the public `POST /auth/password/forgot` (unkeyed) works for an account in "invited" status with an email and sends a real reset link; the password reset makes it active.
  3. The new Admin account outlives the key. The same works on an existing Admin by changing its email first (`PATCH /admin/users/{id}`), or by editing a role's permissions.
- **Needs** a leaked full key, from an allow-listed address, inside its 1/6/24 hours, with "full keys" switched on: the same threat as M3, hence Medium.
- **Fix.** Add `^/api/v1/admin/(users|roles)(/|$)` to `WRITE_DENIED`. Reading stays open.

### R3-3. A READ-ONLY API key can read the live mail-webhook secret addresses
- **Owner:** d3 (key rules), A (mail safety).
- **Where:** `services/platform/mailSafetyService.ts:227` (`view` builds `.../mail-events/ses/{key}` and `.../brevo/{key}`); route `GET /api/v1/platform/mail-safety`; `apiTokens.ts` (`DENIED` and `WRITE_DENIED` leave it readable: "Reading these stays open").
- **What is wrong.**
  - An API key acts through the Super Admin, so `gate.superRead` passes for it.
  - A read key is the "safe" kind: up to 30 days, no IP allow-list required (only full keys need one), 60 calls a minute.
  - So the weakest key hands out the secret that lets someone **write** to the webhook (round 2 M2).
- **Attack.** Read the two addresses, then post forged Brevo events or, with an own AWS account, SNS events: any address is suppressed for every hotel's campaigns, or a hotel is put on hold by fake bounces.
- **Fix.** Return `webhooks: null` (and no key anywhere) when `session.token` is set, as `apiTokens/view` does with `browserOnly`. Keep holds and suppressions readable.

## Low

- **R3-4. Rotating the SES key clears the SNS topic pin while the old address still works for a day (A, mail safety).**
  - `mailSafetyService.ts:159` (`rotateWebhookKey`) empties the pin; `checkWebhookKey` still accepts the previous key for 24 hours; the next signed report pins its topic.
  - Someone who holds the OLD key and an AWS account of their own can send a signed report first and pin THEIR topic. After that the hotel's real SES reports are refused (403) and bounce and complaint protection silently stops until someone rotates again.
  - **Fix:** do not clear the pin on rotation (the topic does not change when the endpoint address does), or let only the CURRENT key pin.
- **R3-5. The "last changed" line and `sharedHotels` tell one hotel about another (B; ordered by the PM, for MJ to confirm).**
  - `lastChange` shows the other hotel's name, a staff member's name and the time; `sharedHotels` shows how many hotels share the record.
  - Hotel B's desk learns that its guest or company is also a customer of hotel A, and who there changed it. It is the point of M1(a), but it is a disclosure between tenants.
  - **Option:** show "another hotel" (and the person's name only for the viewer's own hotel); the Super Admin's audit keeps the full names.
- **R3-6. The caller's address is the FIRST `x-forwarded-for` entry everywhere (d3).**
  - `http/meta.ts:13`, `http/wrapper.ts:196` (every limit by IP, including the sign-in throttles) and `sessionResolver.ts:62` (the full-key allow-list).
  - Right on Vercel (it overwrites the header) and Caddy (replaces it by default). Wrong behind any proxy that appends the client's own header (nginx `$proxy_add_x_forwarded_for`): a caller could pick their address, and so slip an IP limit or an allow-list.
  - `docs/deploy/DEPLOY-VPS.md` says only "pass X-Forwarded-For".
  - **Fix:** write "the proxy must replace it, not append" in that file, or count the trusted hops from the right.
- **R3-7. The region-move runbook makes a full unencrypted dump and does not say where it lives or when it goes (the runbook's author).**
  - `docs/deploy/REGION-MOVE-INDIA-2026-10-18.md` A3 step 3: `db:cli backup --out <folder>`. The dump holds every hotel's data (guest ID numbers in plain text, password hashes, token hashes, sealed secrets).
  - The default folder (`db/dumps/`) is git-ignored and the roles script carries no password, which is good; but nothing says to keep it off shared or synced folders, to encrypt a copy, or to delete it (the old Neon project is kept two weeks; the dump should have the same end date).
  - **Fix:** add those lines to A3 and A6. **Done** (B, PM-approved): A3 step 3 now says MJ's machine only, outside the project folder, encrypted (BitLocker drive or encrypted archive), never a synced folder; the rehearsal's dump goes the same day; the move-day dump goes with the old Neon project (at most 14 days).
- **R3-8. A full-visit write is audited after it has been done, best effort (Enter-hotel owner).**
  - `http/wrapper.ts` `visitEvent` runs after the work; a failed audit write is only logged, so a write can commit with no platform-log row. (The hotel's own system log still has its line.) Refused writes and starts and ends of visits are audited in their own units.
  - **Fix:** write the "intent" row before the work, or in the same transaction.
- **R3-9. Hotel 0045: a guest's DELETE policy on `pms_charges` does not look at the order's status (B).**
  - The policy lets a guest transaction delete the charge of any of its own order lines. The service only cancels a "placed" order, so this is defence in depth. I will tighten it with a hotel migration if the PM wants it (`... AND the line's order is still 'placed'`).

## Checked and found sound
- **Enter hotel.**
  - Who may enter, and with which access, is decided in the service and again by the database trigger (0135); access is fixed on the visit row and is decided again on Extend.
  - A view visit has a READ ONLY transaction (every unit goes through `createPgUnit`) plus the wrapper's method check.
  - A group admin can only enter and extend their own group's hotels (checked before the visit service; the trigger repeats it).
  - A platform admin cannot touch accounts, roles or reset routes; the Super Admin sets the level, audited with before and after.
  - Force mode is never set on a session. The hotel setup checklist refuses visit sessions.
  - Token sessions cannot enter or extend (`WRITE_DENIED`).
  - Console, group, auth and profile prefixes were each checked: none of their routes acts on a visited hotel.
- **API key rules.**
  - Every platform write route was listed against `WRITE_DENIED`: staff, hotel admins, users, a group's admin, platform settings, mail identities, webhook keys, enter, exit and extend are covered; invitations, onboarding, API keys and profiles are in `DENIED`.
  - A new group takes no admin account.
  - An API key cannot reach cron routes, and the Pathik worker has its own key.
- **Mail webhooks.**
  - The key is a path segment per provider, compared in constant time; wrong = 404; the old `?key=` route is gone.
  - SNS: certificate and subscribe address only from `sns.<region>.amazonaws.com` over https, no redirects; version 1 and 2 signatures; an hour's window; the topic is pinned.
  - Each delivery is remembered by a keyed hash and old receipts are removed after 7 days.
  - Unsubscribe: GET only asks, POST records, the signed link is checked first, and the address is escaped.
- **Pathik.**
  - Every route needs the Hotel Admin or the Front Office grant and never a portal account; every row is read in the caller's own hotel schema.
  - The cron route needs CRON_SECRET (constant time; 404 without one); the self-call address comes from configuration, never from the request's Host.
  - The saved Pathik browser session is sealed per hotel; notes cannot carry guest data.
- **Central profiles and 0045.**
  - M1(c): a GSTIN or name change needs Full Access on every desk path that writes the profile; the check runs inside the hotel's save.
  - M1(b): `confirmShared` is a prompt, not a boundary, by design; a refused save changes nothing.
  - Merges and keep-apart are Super Admin only and denied to keys.
  - Each 0045 policy and trigger was re-read: no scope can do more than before, and company scopes can no longer insert charges.
  - The photo is served `no-store`.
- **HTML mail.** Every person's text is escaped; buttons and links are http(s) only with no quotes; the logo is https only.
- **Runbook SQL.** `REGION-MOVE-VERIFY.sql` is `BEGIN READ ONLY`, quotes every name, and shows counts and sums only. The runbook never asks for a connection string to be shown.

## Not verified (needs a running server, which I may not use)
- How Next.js turns a percent-encoded static segment (`/api/v1/admin/%72azorpay`) into a route match, against the deny lists, which test `new URL(request.url).pathname` as received. The static segments should not be decoded before matching, so a mismatch gives a 404, not a bypass; the owner of the wrapper should try one request on a dev server.
