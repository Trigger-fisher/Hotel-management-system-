# Neon + Vercel deployment rehearsal on this PC (11 Oct 2026, Web UI 1 / d7)

Run on a clean export of origin/main 0027926 (git archive), a throwaway PostgreSQL 18 on its own port and data folder, a simulated Neon console role (CREATEROLE and CREATEDB, not a superuser). Nothing of the dev instance (port 5433) or the shared working tree was used. Everything started was stopped and deleted afterwards. No password, key or connection string is recorded here. This is a **simulated** Neon and Vercel: a real project can still differ (see `deploy/NEON-FIRST-DEPLOY.md` section 12).

| Step | Result |
|---|---|
| `db:cli setup --hosted` (run twice) | pass: roles `hms_owner`, `hms_app`, database `hms`, `HMS_HASH_KEY`, `HMS_SECRET_KEY`, `CRON_SECRET`; the second run changes nothing |
| `migrate --dry-run`, `migrate`, `seed`, `create-hotel`, `create-user` (Super Admin) | pass (22 platform files pending, then applied) |
| Production build with `VERCEL=1`, `next start` with exactly the Vercel variable names (DATABASE_URL = the `hms_app` string, DB_POOLED=1, DB_POOL_MAX=3, DB_POOL_MIN=0, DB_POOL_IDLE_SECONDS=10, HMS_PUBLIC_URL, HMS_HASH_KEY, HMS_SECRET_KEY, CRON_SECRET, MAIL_DRIVER=smtp + SMTP_*, HMS_MAIL_WORKER=cron; no MEDIA_DRIVER, no S3) | pass: boots, no refusal, no warning |
| `scripts/first-deploy-check.mjs` | pass, 15 lines OK |
| `scripts/smoke.mjs` | pass, 15 checks (HSTS, CSP, https included) |
| Sign-in by emailed code through a local SMTP sink | pass: first sign-in answers "password change required", the change answers "code required", the cron mail route (401 without or with a wrong secret, 200 with it) sends the mail, the code gives a session |

## Boot checks, one variable changed at a time
| Change | What the server does |
|---|---|
| `PG_OWNER_URL` in the app's environment | **refuses to start** ("script-only secret, must not be in the app's environment") |
| `CRON_SECRET` missing with `HMS_MAIL_WORKER=cron` | **refuses to start** ("required in production when HMS_MAIL_WORKER is cron") |
| the owner login (`hms_owner`) as `DATABASE_URL` | starts silently: no refusal, no warning (the app role must be `hms_app`) |
| no `MEDIA_DRIVER` (defaults to `local`) or `MEDIA_DRIVER=local` on Vercel | starts silently; photos would go to the host's disk (read-only or lost): needs `MEDIA_DRIVER=s3` and the five `S3_` variables |
| `HMS_MAIL_WORKER` missing | starts silently; on a serverless host nothing then sends sign-in codes |

## Mail needs STARTTLS
`mail/smtp.ts` sets `requireTLS` on a non-secure port, so a plain SMTP server makes every mail fail and retry. The mail service must offer STARTTLS (port 587) or `SMTP_SECURE=true` (port 465). The repository has no SMTP sink for tests; the rehearsal used one written for it (STARTTLS with a self-signed certificate, trusted only inside the rehearsal server).

## Open for Backend
Make "no S3 on Vercel" refuse to start, and the owner login as `DATABASE_URL` and a missing `HMS_MAIL_WORKER` warn or refuse.
