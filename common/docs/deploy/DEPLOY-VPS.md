# Deploy on a VPS (your own Linux server)

Everything runs on one server you control: Node.js, PostgreSQL, the app. Nothing here is specific to a provider. Read `docs/ENVIRONMENT.md` (settings) and `docs/OPERATIONS.md` (running it) first. Hosting is MJ's decision; this runbook is complete for the VPS choice.

## What you need

- A Linux VPS (2 vCPU / 4 GB is enough for a few hotels), a domain name pointing at it, and an HTTPS certificate (Let's Encrypt with Caddy or nginx).
- Node.js 22 LTS or newer, PostgreSQL 18 (the migrations use `uuidv7()`, so 18 is required), `git`.
- An SMTP account for real mail (the app refuses to start without one in production).

## 1. PostgreSQL

1. Install PostgreSQL 18 from the PostgreSQL apt/yum repository. Listen on `127.0.0.1` only unless the app runs on another machine; allow `scram-sha-256` in `pg_hba.conf`.
2. Put a superuser login in `db/.env.local` as `PGSUPERUSER_URL=postgresql://postgres:<password>@127.0.0.1:5432/postgres` (this file never leaves the server and is never read by the app).
3. From `web-app`: `npm ci`, then `npm run db:cli -- setup --external`. It creates the roles `hms_owner` and `hms_app` (never superusers), the database `hms` (and `hms_test`, which you can drop on a server), the extensions, the app's query limits, and writes `PG_OWNER_URL` (db/.env.local) and `DATABASE_URL` + `HMS_HASH_KEY` (web-app/.env.local). It prints names only.
4. `npm run db:cli -- migrate` and `npm run db:cli -- seed`.
5. Create the first people: `npm run db:cli -- create-user --username owner --name "Your Name" --email you@example.in --account-role super_admin --role super_admin --write-file` (the temporary password goes to `db/.dev-login.txt`; read it once, delete the file). Hotels then come in through the product (Platform Admin invites a hotel).

## 2. The app

1. `git clone` the repository to `/srv/hms`, then in `web-app`: `npm ci`, `npm run build`.
2. Production settings (a root-only `EnvironmentFile`, mode 600; names in `docs/ENVIRONMENT.md`): `NODE_ENV=production`, `DATABASE_URL`, `HMS_HASH_KEY` (already in `web-app/.env.local` from setup; move it into the service file), `HMS_PUBLIC_URL=https://your.domain`, `MAIL_DRIVER=smtp`, `SMTP_HOST`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASS`, `HMS_MEDIA_DIR=/var/lib/hms/media` (create it, owned by the service user). Do NOT put `PG_OWNER_URL` or `PGSUPERUSER_URL` in this file.
3. A systemd unit (`/etc/systemd/system/hms.service`):

```
[Unit]
Description=HMS
After=network.target postgresql.service

[Service]
User=hms
WorkingDirectory=/srv/hms/web-app
EnvironmentFile=/etc/hms/hms.env
ExecStart=/usr/bin/npm run start -- -p 3000 -H 127.0.0.1
Restart=on-failure
TimeoutStopSec=30
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

   `systemctl enable --now hms`. If a setting is wrong the service exits 1 and `journalctl -u hms` shows the NAMES of what is wrong.
4. HTTPS reverse proxy (Caddy, the simplest): `your.domain { encode zstd gzip
   reverse_proxy 127.0.0.1:3000 }`. The proxy compresses (the app does not: compressing in Node would spend the one thread that answers requests; a 350 KB payroll list becomes about 30 KB). With nginx: `gzip on; gzip_types application/json text/css application/javascript;`. The app sets HSTS and the content policy itself; the proxy must pass the `Host` header, must SET or APPEND the caller's address to `X-Forwarded-For` (Caddy replaces it, nginx `$proxy_add_x_forwarded_for` appends: both are right, the app reads the LAST entry), must be the only way to reach the app (otherwise a caller can write the header himself), and must not buffer uploads above 12 MB. Two proxies in a row (a CDN in front of Caddy): set `HMS_PROXY_HOPS=2`; `HMS_PROXY_HOPS=0` means no proxy and the address is then unknown.
5. Smoke test from anywhere: `node web-app/scripts/smoke.mjs https://your.domain`. Then sign in as the owner, change the password, set up the mail sender (Platform settings), and send yourself a test invitation.

## 3. Backups and updates

- Daily backup: a systemd timer or cron running `npm run db:cli -- backup` in `web-app`, then copying `db/dumps/backups/*` and the media folder off the server (rsync/rclone to another machine or object storage). Monthly: `npm run db:cli -- restore-check`.
- Update: `git pull`, `npm ci`, `npm run db:cli -- backup`, `npm run db:cli -- migrate`, `npm run build`, `systemctl restart hms`, smoke test (full list in `docs/OPERATIONS.md` section 3).
- Firewall: open 80 and 443 only; PostgreSQL stays on localhost.
## 4. Pathik worker (optional, Gujarat hotels)

The Pathik worker is a second process: in a copy of the repository run `npm ci` in `pathik/worker`, give it its own environment file (`HMS_BASE_URL`, `PATHIK_WORKER_TOKEN` equal to the web app's, the other names in `pathik/worker/.env.example`; readable only by the service user), install Chrome (or `npx playwright install --with-deps chromium`) and run `npm start` as a systemd service with `Restart=on-failure`. It can share the server with the web app or run on a second small server that reaches the web app's address. Details and the go-live gate: `docs/pathik/PATHIK-WORKER.md`.

## Behind Cloudflare (security plan 2026-11-01, sections 4 and 5)

- The ready-made files are in `security/deploy/` (host hardening, Cloudflare-only firewall, nginx origin lock, fail2ban, container, checks). With that nginx file the visitor reaches the app as ONE `X-Forwarded-For` entry (nginx replaces the header with the address Cloudflare reported), so `HMS_PROXY_HOPS=1`. If you use your own nginx that APPENDS (`$proxy_add_x_forwarded_for`) behind Cloudflare, set `HMS_PROXY_HOPS=2` instead: Cloudflare adds the visitor, nginx adds Cloudflare, and the app reads the entry two from the right (review round 3, R3-6). A wrong number makes every visitor look like Cloudflare, and every per-IP limit then hits all of them together.
- During the Vercel testing period this does not work: Vercel overwrites the header with the address it saw, which is Cloudflare's. Do not rely on per-IP limits or Fail2ban there; the Cloudflare rate limits (security plan section 4) are the control until the VPS is live.
- The origin must accept traffic from Cloudflare only (UFW with Cloudflare's published ranges, then mTLS), otherwise a caller can reach the app directly and write `X-Forwarded-For` himself.
- Set the alert and reset variables of `ENVIRONMENT.md` (`HMS_SECURITY_*`, `CLOUDFLARE_*`) and run the plan's end-to-end test (section 10, step 7) once the site is live.

