# Security review, round 2 (B, 18 Oct 2026)

Scope: everything after `origin/main` `0cb12e4` up to `9753003`, plus the areas the PM named that came in earlier this round (mail safety webhooks, campaign engine, API keys).

**Read-only:** no code was changed by this review. Every finding names its owner, who decides the fix.

**Result: no HIGH finding**, so nothing here blocks the push. Three MEDIUM findings are worth fixing soon, and several LOW ones are listed as defence in depth.

**Fixed since (B, 18 Oct, PM-approved):** M1(a), L1, L2 and L7. See "Fixes" at the end. M1(b)/(c), M2, M3, L3 to L6 and L8 are with their owners.

Ranking: **High** = exploitable now by someone without special access, or a data leak between hotels or people; **Medium** = needs a leaked secret, an insider, or a second bug, but the damage is real; **Low** = defence in depth, or narrow.

## Medium

### M1. One hotel's desk can change a guest's or company's shared profile for every hotel, and the change then reaches the other hotels' own records
- **Owner:** B (central profiles; PM-approved design).
- **Where:**
  - `web-app/src/server/services/companies/customerService.ts` `syncCommon` (desk save writes the central row);
  - `companyService.ts` `syncCommon`;
  - `withCommon` on both (desk read shows the central row).
- **Attack.**
  1. A staff member of hotel A, with Companies edit, changes a shared guest's email or address, or a shared company's GSTIN or contacts. The central row changes.
  2. Hotel B's desk now shows A's values.
  3. As soon as B's staff save that record for any reason, the pre-filled shared values (A's edit) are written into **hotel B's own record**: bills, "email the bill", the invoice GSTIN.
- So one hotel can quietly change what another hotel invoices and where it sends mail, and nothing central records which hotel or person changed the shared profile.
- The guest's own portal edits behave the same way, but that is the person changing their own data.
- **Fix proposal.**
  - (a) Keep a central history: who changed a shared profile and from which hotel. For example a `platform.profile_changes` row per save, written in the same unit as the central update, or at least an audit row. Show "last changed by Hotel X" on the desk.
  - (b) Make B's staff confirm before shared values overwrite B's own copy; at least show "changed at another hotel since your copy".
  - (c) Optionally, let only the guest or company login, and the hotel that created the record, change the shared GSTIN.
  - MJ/PM to choose; (a) is cheap and should come first.

### M2. The mail-events webhook key is the only real protection, and it travels in the URL
- **Owner:** d3 (mail, after A).
- **Where:**
  - `web-app/src/app/api/v1/public/mail-events/[provider]/route.ts:18,44` (`?key=` in the query string);
  - `server/mail/events.ts:131-152` (`verifySns` checks AWS's signature but **not the TopicArn**);
  - `services/platform/mailSafetyService.ts:79-83, 142` (the key is derived from `HMS_HASH_KEY` and shown in the Super Admin view as part of the URL).
- **Attack.** Anyone who learns the URL can post events and suppress any address from every hotel's campaigns: a hard bounce suppresses an address for every hotel. They can also raise a hotel's bounce or complaint rate until it is **automatically held** (`checkHold`), stopping its campaigns. Ways to learn the URL:
  - request logs that keep query strings;
  - a browser history;
  - a screenshot of the Super Admin page.
- For Brevo the key is all there is. For SES, an attacker's **own** AWS account can sign SNS messages that pass `verifySns`, because the topic is not pinned. Within one hour any captured message can also be **replayed**: there is no MessageId de-duplication, and each replay counts toward the rates.
- **System mail is not affected:** suppressions apply to campaign mail only (`services/auth/mail.ts:384`), so sign-in codes and reset links still go.
- **Fix proposal.**
  - (a) Pin the SNS `TopicArn` to the configured topic (a platform setting), and refuse any other topic, including its SubscriptionConfirmation.
  - (b) Remember SNS `MessageId`s (or Brevo event ids) for a day and ignore repeats.
  - (c) Move the key out of the query string: Brevo supports HTTP Basic auth on webhooks (credentials in the Authorization header, not the path or query). Keep `?key=` only as a fallback.
  - (d) Make the key rotatable on its own: a stored random secret, not a value derived from `HMS_HASH_KEY`.

### M3. A full-access API key can create long-lived access that outlives the key
- **Owner:** d3 (API keys).
- **Where:** `web-app/src/server/auth/apiTokens.ts:49-73` (DENIED), `:84-88` (scope). These are allowed to a FULL key with console scope:
  - `POST /platform/staff` (a new Platform Admin);
  - `POST /platform/hotel-admins` and `/platform/hotels/{id}/admins` (new hotel admins);
  - `/platform/users/{id}/disable` (lock out real staff);
  - `PUT /platform/settings` (including the platform's outgoing mail server, which carries every sign-in code and reset link);
  - `/platform/mail-identities`.
- **Attack.** A leaked full key gives at most 24 hours from an allow-listed address, with the Super Admin's switch on. Inside that window it can create an admin account with its own email, or point platform mail at its own SMTP server and then reset passwords. Both outlive the key's revocation.
- The safeguards (IP allow-list, 24 h, reason, switch, audit row "API token: <name>") make this an insider or leaked-secret case, hence Medium.
- **Fix proposal:** add to DENIED for every key, whatever its level:
  - creating staff and admin accounts (`POST /platform/staff`, `POST /platform/hotel-admins`, `POST /platform/hotels/[^/]+/admins`);
  - `/platform/settings` (mail server), `/platform/mail-identities`, and the platform mail-safety writes.
  - A full key keeps the day-to-day console and hotel writes it exists for.

## Low

- **L1. RLS 0039, a company can re-point its own notification targets (B).** `db/migrations/hotel/0039_notifications.sql:55-63`: the UPDATE policy lets a company-scoped transaction change any column of its own `notification_targets` rows. That includes `notification_id`, which could be pointed at another company's notification, after which the SELECT policy shows it. The app only ever sets `read_at`, so this needs a second bug. **Fix:** a trigger that refuses a change of `notification_id` / `company_id`, or a column-level `GRANT UPDATE (read_at)` for the hotel role. This is a hotel migration, so it needs a number from the PM.
- **L2. RLS 0041 / 0042, one policy for every command (B).**
  - `0041_room_service_orders.sql:57-67` lets a guest-scoped transaction UPDATE or DELETE its own orders and order lines in any way (status, totals). The same applies to `pms_charges` through 0035.
  - `0042_support_requests.sql:32-35`: the guest side of support is gone (2660167), so guests no longer need to write there.
  - **Fix:** per-command policies (guests may SELECT; INSERT and UPDATE only where the app needs them), as 0039 does.
- **L3. The unsubscribe link changes state on a GET (d3).**
  - `app/api/v1/public/unsubscribe/route.ts:10-21`: mail security scanners (Outlook Safe Links and others) open links before people do, and unsubscribe them without their knowledge.
  - **Fix:** the GET shows a page with a "Confirm" button that POSTs. Also send `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click), so mail clients POST.
  - The HMAC check itself is correct: per hotel and address, constant time, and the page escapes the address.
- **L4. Re-sending an expired group invitation skips the group's hotel limit (c6 / A).**
  - `services/platform/invitationService.ts:197-212`: expired invitations no longer count toward `max_hotels`, and `resend` revives one without `checkGroupLimit` or a lock on the group row.
  - **Fix:** in `resend`, for `member_hotel` invitations, lock the group (`groups.get(..., { forUpdate: true })`) and call `checkGroupLimit(repos, groupId, at, inv.id)`.
- **L5. The Platform Admin's "add hotel to group" counts hotels but not open invitations (c6 / A).** `services/platform/groupService.ts:144-148` uses `countTowardLimit` only, while invitations count open invitations too, so the two disagree. **Fix:** use the same count as `checkGroupLimit`.
- **L6. The group console checks "is this person the group's admin" in one transaction and acts in another (c6 / A).**
  - `services/platform/groupConsoleService.ts:38-44, 152-154`: `groupIdOf` runs in one unit, then `sendToGroup` in another, without re-checking. An admin removed between the two can still send one invitation.
  - **Fix:** re-check the group's admin inside the sending unit, which already locks the group row.
- **L7. The profile photo may be cached by the browser for a day (B).**
  - `app/api/v1/profile/photo/route.ts:17-18` (`private, max-age=86400`). After sign-out on a shared computer, or after the photo is removed, the old picture can still come from that browser's cache for someone who knows its address.
  - **Fix:** `private, no-cache` (revalidate) and an ETag. The `?v=` already changes with each photo.
- **L8. Mail webhook key rotation (d3).** Part of M2(d): the key cannot be changed without changing `HMS_HASH_KEY`, which much else depends on.

## Checked and found sound
- **Central profiles and merge (B).**
  - Every portal read and write uses the session's own login and record (`byUser(session.userId)`, then the session's own hotel record); a guest or company cannot name another profile.
  - The desk overlay runs only after the hotel's own `get` found the record in that hotel.
  - Possible duplicates, merge and keep-apart are Super Admin only (`gate.superRead` / `superWrite`), audited in the same transaction, denied to API keys (ad43fab), and two profiles with their own logins are never merged.
  - A merge writes only platform tables: the db test checks the hotels byte for byte.
  - The platform tables carry no RLS by design: only `hms_app` reaches them, through these services.
- **Profile photos (B).**
  - Own photo only (the user id comes from the session; the file name is random and checked by `assertSafe`).
  - JPG/PNG/WebP sniffed by content (no SVG); size capped at 10 MB, with a 15 MB body limit and 20 changes an hour.
  - Re-encoded by sharp (metadata stripped, a pixel limit against decompression bombs).
  - Served `image/webp` with nosniff from a private store.
  - The 503 when storage is missing reveals nothing.
- **Sign-in speed changes (9753003, reviewed by d3).** Lock counting under FOR UPDATE, the dummy password check for unknown names, `assertMayEnter` before any code, temporary password or session, and every event and audit row are unchanged. `read()` is used for a single SELECT only. `hasSessionCookie` fails "true" (ask the server).
- **Sign-out mark (d3).** The `__Host-` prefix means only this origin can set it, never a subdomain or another site. It carries no secret, can only END a session, and a new sign-in clears it. Script injection could use it to sign someone out, but script injection can already do far more.
- **Campaign engine (d3, after A).**
  - The campaign row is locked (FOR UPDATE) while recipients are marked queued (`queued_at IS NULL` in the update), so two feeders cannot queue the same person twice.
  - Opt-outs and suppressions are checked at feed time.
  - (Reliability, not security: the outbox insert happens after the hotel's commit, so a failed enqueue leaves recipients marked queued but not sent.)
- **Group invitations.** Only the group's own admin may invite (`groupOf` matches `admin.id` to the session), and new invitations and the onboarding approval lock the group row before counting the limit.
- **API keys.** Key minting, the full-access switch, passwords, sign-in, the person's profile, guest/corporate portals, exports, permanent deletes, invitations, cron and the new `/platform/profiles` routes are denied to keys. Matching is on the path without the query, and Next routes are case-sensitive, so no simple bypass was found.

## Fixes (B, 18 Oct 2026)
- **M1(a), the central change history.**
  - Every change to a shared guest or company profile is recorded in the same transaction as the change: which hotel, who (user id and name), which fields (names only, never values), when, and whether it came from the desk or the portal.
    - This covers a desk save, a desk create, the guest's My profile and the company's My profile.
    - A save that changes no shared field records nothing.
  - The rows go into `platform.audit_log` (scope `hotel`; actions `profile_created` / `profile_updated`; entity `guest_profile` / `company_profile`). It is append-only, and no migration was needed.
  - The Super Admin's audit lists show scope `platform` only, so these rows do not appear there.
  - `lastChange` ({ at, hotelName, by, via, fields }) is sent on the desk's Customer and CompanyProfile, and on My profile (GuestProfile, PortalProfile).
  - `lastChangeLine()` in `ui-shared/dashboards/profileReview.ts` gives "Last changed by <hotel> · <person> · <time>".
  - M1(b) (confirm before shared values overwrite a hotel's copy) and M1(c) (who may change the GSTIN) are still for MJ/PM to decide.
- **L1 and L2, hotel migration 0045 (`0045_portal_rls_per_command`).**
  - Changes:
    - One policy per command on `room_service_orders`, `room_service_order_lines`, `pms_charges`, `guest_requests` and `support_requests`.
    - A trigger that lets a guest change an order only from placed to cancelled (the status fields only).
    - A trigger that lets a company change only the read mark of its notification targets.
    - A guest may now delete only the charges of its own room-service orders.
    - Unscoped transactions are not affected.
  - Neon: `NEON-SQL-0045-PORTAL-RLS-PER-COMMAND.sql`, RUN-ORDER step 29 (needs hotel 0044).
  - Tested on hms_test in `tests/db/portalRls.perCommand.test.ts`.
- **L7, the photo cache: confirmed, not a false positive.**
  - The wrapper's binary answer is `no-store`, but its `decorate()` step then put the route's `private, max-age=86400` over it.
  - The route no longer asks to be cached, so the photo is served `no-store`; `profilePhoto.test.ts` checks the header.
  - Fetching the photo again each time is cheap: at most 1 MB of WebP.
