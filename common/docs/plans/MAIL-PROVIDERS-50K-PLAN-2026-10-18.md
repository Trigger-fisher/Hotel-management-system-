# Mail providers per client, ready for 50,000 emails (PM, 18 Oct 2026)

MJ: each client (hotel) can choose which email service it uses; easy to use; the system must be ready for 50,000 mails (campaigns). The platform keeps its own sender for system mail.

## Decision on "GHL" (GoHighLevel)
GHL is a CRM / marketing-automation product (monthly subscription), not a mail provider: its email runs on Mailgun underneath and is used through GHL's own contacts and API. Wiring HMS to it would tie every hotel to a paid GHL account and a second customer database. NOT chosen. Providers are used directly.

## Providers offered (a picker, with presets)
1. **Gmail** (exists): small volume, 587 STARTTLS, app password.
2. **Brevo** (SMTP preset): easiest start; free daily allowance; has unsubscribe/bounce webhooks.
3. **Amazon SES** (API or SMTP preset): the choice for 50k and more, about $0.10 per 1,000 mails, Mumbai region; needs domain verification and sandbox exit.
4. **Other SMTP** (host, port, security, user, password): ZeptoMail, Postmark, Mailgun, a company mail server.
Each hotel picks one in Settings > Email; the platform picks one in Super Admin > Platform settings > Mail. The form shows only the fields of the chosen provider, a one-line help with the exact steps, a "Send test email" with plain failure hints, and a status line ("Sending from: Brevo, name@domain").
Domain mail: the hotel enters the from address on its own domain; the form shows the SPF / DKIM / DMARC records to add and checks them (DNS lookup, shows "ok / missing").

## Ready for 50,000 (backend)
- ONE provider interface (send, sendBatch, limits: per second, per day, max batch) used by the platform sender and every hotel; the existing shared mail module is the base. Gmail limit presets (about 500 / 2000 a day) are enforced, so a Gmail hotel is never over-queued: the rest is spread over the next days, with progress shown.
- Priority lanes in the outbox: system mail (codes, resets, invoices, receipts) always before campaign mail; a 50,000-row campaign can never delay a sign-in code. Test: queue 50,000 campaign rows, a login code is sent within seconds.
- Campaign engine: recipients are materialised in chunks (not one 50,000-row transaction); a drain pass sends within the provider's rate (token bucket per provider/hotel), uses the provider's batch API where it exists (SES, Brevo), keeps going on cron ticks / a worker loop until done; pause, resume, cancel; progress (queued / sent / failed / bounced); one failed address never stops the rest.
- Hosting: Vercel functions are short; sending 50,000 needs many passes. Use the cron route plus the same VPS-style loop idea as Pathik (an optional worker process) so a campaign finishes without a browser open; document the setup.
- Deliverability: bounce and complaint webhooks (SES via SNS, Brevo webhook) fill a suppression list; suppressed and opted-out addresses are never mailed; every campaign mail has the unsubscribe link and the List-Unsubscribe header; plain-text part; per-hotel sender identity.
- Limits and safety: per-hotel daily cap (settable by Super Admin), a confirmation step ("This will send 50,000 mails, about N hours"), audit log, secrets sealed as today (provider keys in the same sealed store).
- Migrations: new platform/hotel migrations with Neon SQL files, numbered after the highest in the tree; no local migrate without MJ's approval.

## Order of work
1. Provider interface + presets + per-hotel/platform picker (backend), then the UI (Session C).
2. Priority lanes + rate limits + daily caps.
3. Campaign engine (chunks, pause/resume, progress) + suppression and webhooks.
4. Load test: 50,000 queued rows locally with a fake provider; report sustained mails per second and the login-code delay.
5. DNS check helper and the help texts.

## MJ decisions
- Platform default provider to recommend: Brevo to start, Amazon SES for volume (MJ can change later; both are supported).
- Which domain sends mail (e.g. easyhotelsolutions.in) and who can change its DNS.
