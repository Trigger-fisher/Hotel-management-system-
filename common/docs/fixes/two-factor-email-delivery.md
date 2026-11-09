# Two-factor sign-in email delivery

## Behavior

Sign-in codes are queued in the platform outbox with no hotel mail-server ID, so they use the platform SMTP transport configured by the deployment environment. The Vercel mail worker tries to drain the queue after the sign-in response; `/api/v1/cron/mail` is a recovery drain for queued messages.

For `login_code` messages, the sender address now comes directly from `SMTP_FROM`. A platform-settings `mail.from_email` value can no longer replace it. Other platform mail keeps the configured platform-settings sender behavior, and hotel-specific mail still uses that hotel's own SMTP settings.

## Production configuration

The Vercel Production environment needs `MAIL_DRIVER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and matching `SMTP_USER`/`SMTP_PASS` when the SMTP server requires authentication. Use `SMTP_SECURE=true` for implicit TLS (usually port 465); otherwise the transport requires STARTTLS. `HMS_MAIL_WORKER=cron` and `CRON_SECRET` enable Vercel's outbox worker route. The SMTP provider must allow the `SMTP_FROM` address as a verified sender for the configured SMTP account.

The repository currently schedules `/api/v1/cron/mail` daily. That schedule is a safety net, not the expected path for a new sign-in code; a delivery failure may wait for the next scheduled run. The sign-in request's post-response worker is intended to send the code immediately.
