# Mail routing plan: system mail from the platform email, hotel mail from the hotel's email (PM, 17 Oct 2026)

MJ's rule: mail the SYSTEM sends uses the platform's email (set in Super Admin > Platform settings > Mail); invoices and every mail that carries a hotel's data use THAT HOTEL's email (Hotel Settings > Email).

## What exists today (checked in the code)
- Router `web-app/src/server/mail/hotelSmtp.ts`: a queued mail that names a hotel (`hotelId`) goes through that hotel's own SMTP (pooled, settings cached 60 s); a mail without a hotel, or of a hotel with no mail set up, goes through the platform sender.
- Platform sender: `mail/smtp.ts` from server env (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM) + sender name/email in platform settings. Session A is already adding the full SMTP form (migration 0123, SMTP_SECRET_KEY).
- Outbox kinds (platform.outbox, `services/auth/mail.ts`): login_code, reset_code, reset_link, password_changed, email_changed, account_locked, account_blocked, new_device, temp_password, admin_reset, invitation, onboarding_*, enquiry_*, enquiry_new, daily_summary, campaign.
- Gaps: no invoice mail at all (guest "Email me a copy" answers 422 "sending waits for bill emails"); the mail is text only (no attachment); nothing guarantees that a hotel-data mail names its hotel; a hotel with no mail set up silently uses the platform sender.

## The rule table (one place, tested)
| Route | Mail kinds |
|---|---|
| PLATFORM email (no hotelId) | login_code, reset_code, reset_link, password_changed, email_changed, account_locked, account_blocked, new_device, temp_password, admin_reset, invitation, onboarding_waiting/approved/rejected |
| HOTEL email (hotelId required) | NEW bill_invoice (bill / invoice as PDF), NEW advance_receipt, enquiry_confirmed, enquiry_declined, enquiry_new, daily_summary, campaign, staff letters and salary slips (staffEmailService), guest request replies, reservation confirmations |
A single table `MAIL_ROUTE: Record<MailKind, 'platform' | 'hotel'>` in `services/auth/mail.ts`. `queueMail` refuses a hotel kind without hotelId and a platform kind with one. A unit test fails when a new kind has no route.

## Fallback when a hotel has not set its email up (MJ to confirm; default below)
Default: the mail still goes, through the platform sender, but with the From NAME = the hotel's name, Reply-To = the hotel's address (if it set one), and the hotel admin sees a notice "Set up Settings > Email so mail comes from your own address". Nothing is dropped. (Alternative: hold the mail until set up.)

## Work, in order (Session A, after the SMTP form)
1. Router: `MailMessage` gets `replyTo`, `attachments` (name, type, bytes); the fallback above; a clear outbox error code when the hotel's SMTP refuses (wrong password etc.) shown in the hotel's Settings > Email page ("last mail failed: ...").
2. `MAIL_ROUTE` table + queueMail guard + audit of EVERY queueMail call site (add hotelId where the data is a hotel's). Test.
3. Invoices: kind `bill_invoice` (+ `advance_receipt`) with payload `{ billId, to }`; the worker renders the PDF at send time with the existing bill PDF code (no PDF stored in the outbox); migration 0124 widens `outbox_kind_known` (applied migrations are never edited) + docs/neon-sql/NEON-SQL-0124-*.sql.
4. API: staff `POST .../bills/{id}/email` (permission as for viewing the bill; the address defaults to the guest's, editable; a log row), and the guest portal's existing `/guest/bills/{id}/email` now queues it (own bill only, rate limited, the hotel's email sends it).
5. Tests: routing per kind, hotel SMTP used for invoice, platform used for login code, fallback sender name/reply-to, attachment present, no secret in logs, rate limit.
## UI (Session C after A's API)
Bills page: "Email bill" button + address dialog + status ("queued / sent / failed"); guest portal bill: "Email me a copy" works; Settings > Email shows the last mail result and the fallback notice. Existing look, no redesign.

## Not in this plan
Hotel SMTP password encryption (hotel Settings > Email keeps its current storage: ask MJ later); WhatsApp (removed); SMS.
