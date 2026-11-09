# Operations runbook

For whoever runs HMS in production. Commands run from `web-app` unless a path says otherwise. Hosting is not chosen yet: the same steps hold on a VPS (`docs/deploy/DEPLOY-VPS.md`) and on a hosted platform (`docs/deploy/DEPLOY-HOSTED.md`). Variables: `docs/ENVIRONMENT.md`.

## 1. Is it healthy?

- Liveness: `GET /api/v1/health` answers 200 `{status:"ok"}` while the process runs (no database). Use it for "restart if dead".
- Readiness: `GET /api/v1/health/ready` answers 200 `{status:"ready", db:"ok"}` when the environment is valid and the database answers `SELECT 1` within 2 seconds; 503 `{status:"unhealthy"}` otherwise. Use it for the load balancer and the uptime monitor. Limited to 120 a minute per address.
- Smoke test after every deploy: `node scripts/smoke.mjs https://your-address` (exit 1 and the failing checks if anything is wrong; add `--dev` for a local http server).
- Logs: one JSON line per event on stdout with `level`, `message`, `traceId`. An error shown to a user carries the same `traceId`; search the log for it. Nothing secret is logged (codes, passwords, tokens, ID numbers are redacted). Collect stdout with the host's log service (systemd journal, container logs); set `LOG_LEVEL`.

## 2. Start, stop, update

- Start: `npm run build` once per release, then `NODE_ENV=production npm run start` (set the variables first). If the environment is wrong the process prints the NAMES of the problems and exits with code 1 (see ENVIRONMENT.md).
- Stop: send SIGTERM (a deploy, `systemctl stop`, a container stop). The mail worker stops and the database pool closes, then the process exits 0; allow 10 to 30 seconds.
- One instance runs the mail worker per process; with several instances each polls the outbox and a row is claimed by only one (`FOR UPDATE SKIP LOCKED`), so more than one is safe.

## 3. Migrations (every release)

Migrations are files in `db/migrations/platform` (once) and `db/migrations/hotel` (once per hotel schema). They are append-only: a file that has been applied is never edited (its checksum is checked; a changed file stops the run before anything is applied).

1. **Back up first** (section 4). A migration on live data is moved forward, not rolled back.
2. Preview: `npm run db:cli -- migrate --dry-run` lists what is pending per schema.
3. Apply: `npm run db:cli -- migrate` (platform first, then every hotel; one transaction per file per schema; the grants of every hotel are synced at the end). It prints schema and file names only.
4. Run it again: it must say `0 pending` everywhere.
5. Seeds after a release that changes them: `npm run db:cli -- seed`. `npm run seeds:check` (in CI) proves the generated seed files are current.
6. Rollback: each file's first line says how its change would be undone (`-- rollback: ...`), but on real data the safe way back is the backup taken in step 1. Migrations that add columns are written to be safe on live data (add nullable, backfill, then constrain).

The app version must be deployed AFTER the migration when it needs the new columns, and the migration must keep the previous app version working (the previous app keeps running until the new one is up). The releases so far are written that way.

## 4. Backup and restore

What to back up: the database and the media folder (`HMS_MEDIA_DIR`), plus the two secrets that cannot be recreated: `HMS_HASH_KEY` and the database passwords (keep them in the host's secret store, not only on the server).

- Backup: `npm run db:cli -- backup` writes `db/dumps/backups/hms-<UTC time>.dump` (PostgreSQL custom format, all schemas) and a `.sha256` beside it. Add `--out <folder>` to choose the folder. Schedule it daily (cron / systemd timer / the host's scheduler) and copy the file OFF the machine the same day. Keep at least 7 daily and 4 weekly copies. A backup that has never been restored is not a backup:
- Restore check (run it monthly and after changing the database server): `npm run db:cli -- restore-check` takes a fresh dump (or `--file <dump>`), restores it into a scratch database `hms_restore_check` on the same server, compares counts of users, hotels, hotel schemas and key tables with the source, drops the scratch database and prints `OK` or `DIFFERENT`. It needs `PGSUPERUSER_URL`. Tested on the development database on 12 Oct 2026: 24 users, 9 hotels, 5 hotel schemas, 34 sample rows: identical, 0 restore errors.
- Real restore (disaster), on a new or emptied server: (1) `npm run db:cli -- setup --external` (needs `PGSUPERUSER_URL` in `db/.env.local`; makes the two main roles and the empty database), (2) run `<dump>.roles.sql` (written beside every dump) as a PostgreSQL superuser: the hotel roles belong to the server, not to the database, so they are not in the dump, (3) `pg_restore --no-owner --dbname hms --host ... --username hms_owner <dump>`, (4) restore the media folder and put `HMS_HASH_KEY` and the passwords back, (5) `migrate` (it must say `0 pending`, or apply newer files), (6) start the app and run the smoke test. `restore-check` runs steps 2 and 3 into a scratch database, so it proves the dump AND the roles script.

### 4a. The nightly copy per hotel (hosted, 13 Oct 2026; MJ's plan T6)
On Vercel there is no disk and no `pg_dump`, so the website makes the copy outside the database itself: `GET /api/v1/cron/backup` (Vercel Cron `30 20 * * *` UTC = 02:00 IST in `web-app/vercel.json`, `Authorization: Bearer CRON_SECRET`, up to 300 s) reads every live hotel's records the way the Super Admin's "Export data" does (one JSON line per row of every table of the hotel's schema, plus the platform rows about the hotel; the hotel's own role, read only) and writes them gzipped to the **private bucket** under `backups/<hotel id>/backup-<IST day>-<sha8>.ndjson.gz` (`MEDIA_DRIVER=s3`; on a server with a disk the folder `backups` beside the media folder). One row per run and hotel goes to `platform.hotel_backups` (migration 0122: file, size, SHA-256, tables, rows; or the step that failed: `read`, `write`, `record`). Retention, applied by the same run: the daily copies of the last 14 days and the Sunday copy for 8 weeks; older files and rows are deleted. Platform health shows the newest copy as "Last backup" and flags a hotel with none, or with one older than 2 days. Hotels not reached inside the time budget are counted as `skipped` and taken the next night; the answer is `{configured, hotels, done, failed, skipped, pruned}` (`configured: false` = Vercel without a bucket: nothing is kept).

Decoys and the backup: the security decoys (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 8) are NEVER database rows: the decoy addresses are answered from code, the canary links are signed addresses made from `HMS_HASH_KEY`, and the decoy file is a loose file made by `npm run security:decoy`. Nothing of them is in any hotel schema or in the platform tables, so neither this nightly copy nor a dump or a restore ever holds or receives decoy data. Keep the decoy file outside the project and outside every backup folder.

What this copy is and is not: The hosted database's own point-in-time history (Supabase console) is the FIRST line of restore, and the dump of this section the second on a server with `pg_dump`; the nightly copy is the per-hotel copy OFF Neon, in a format that needs no PostgreSQL tool to read. **Drill (monthly):** download one hotel's newest file from the bucket, read its `file_sha256` from `platform.hotel_backups`, then `npm run db:cli -- backup-check --file <backup-....ndjson.gz> --sha256 <hex>`: it proves the checksum, parses every line and prints the hotel, people, memberships, status changes and rows per table (never a row's content). **Loading one hotel back** from the file (a hotel deleted by mistake after its grace period, a bucket-only disaster): make the hotel again (`create-hotel`, so its schema and role exist at the current migrations, with no seeds applied twice: delete the seeded default rows first or accept the duplicates the unique keys refuse), then as `hms_owner` with `search_path` on that schema, `ALTER TABLE ... DISABLE TRIGGER ALL` on the tables, insert each `"kind":"table"` line with `INSERT INTO <table> SELECT * FROM jsonb_populate_record(NULL::<table>, $1::jsonb)` in the order the foreign keys need (parents first: masters, rooms, customers, companies, reservations, stays, bills, logs last), `ENABLE TRIGGER ALL`, and run `migrate` to confirm `0 pending`. This load is a documented manual procedure, not a command yet; the dump path above stays the restore of record on a server with `pg_dump`.

## 5. Everyday tasks

| Task | How |
|---|---|
| Add a hotel | The product flow: Platform Admin invites, the hotel fills the onboarding form, Platform Admin approves (a schema is built). From a shell: `npm run db:cli -- create-hotel --name "X" --slug x`. |
| Add a platform person | `npm run db:cli -- create-user --username u --name "N" --email e --account-role platform_admin --role admin --write-file` (the temporary password goes to a git-ignored file, not the terminal; the person must change it at first sign-in). |
| A person is locked out | Hotel Admin: Users, Unlock. Platform: Hotel admins, Unlock. Throttle counters: `npm run db:cli -- clear-rate-limits` (development tool). |
| Remove a hotel for good | Archive, wait out the grace period, Export, then Delete permanently (Super Admin). A failed cleanup is finished with `npm run db:cli -- drop-hotel-schema <schema>`. |
| Rotate the database passwords | Change the role password in PostgreSQL, update `PG_OWNER_URL` / `DATABASE_URL`, restart the app. |
| Live test of a production build on this PC (development only) | Build and start it as in `deploy/DEPLOY-VPS.md` with `MAIL_DRIVER=smtp` and `SMTP_HOST=127.0.0.1` (no mail server listens, so codes wait in the outbox). `npm run db:cli -- dev-password <username>...` gives each test account a new password (no first change, locks cleared) in the git-ignored `db/.dev-login.txt`, never printed. `npm run db:cli -- smoke-codes` copies the sign-in codes still waiting in the outbox into the git-ignored `db/.dev-mail.log`, where the test harness reads them (a running dev server's log driver may already have put them there). Both refuse unless the database is on this machine; neither exists in the app, so a real server cannot use them. |
| Mail is not arriving | Check `GET /api/v1/health` is up, the outbox (`platform.outbox` rows stuck as `pending`/`failed`), the SMTP settings and the log for `mail` lines. The worker retries 5 times, then marks the mail failed and wipes its content. |

## 6. Known limits (honest list)

- Uploaded photos live on the app's disk (`HMS_MEDIA_DIR`). A host with no persistent disk (pure serverless) needs an object-store adapter first (`src/server/media/store.ts` is the port; only the local-disk adapter exists).
- The mail worker runs inside the app process (an interval). A host that sleeps idle processes needs one request per minute (the uptime monitor does it) or a scheduler hitting the app; there is no separate worker process yet.
- Online payments (Razorpay), Google reviews and Google Drive backup are not connected: they wait for MJ's keys. The backup above is the supported backup.

## 7. Pathik (Gujarat Police guest register)

- **What it is:** every stay that must be registered with Pathik gets a row (Front Office, Pathik page); the separate worker process (`pathik/worker/`, Pathik Backend's runbook) sends them through the hotel's own Pathik account. Only hotels whose state is Gujarat see it, and the Hotel Admin switches it on (Settings, Pathik).
- **Settings:** `HMS_SECRET_KEY` must be set (production refuses to start without it); `PATHIK_WORKER_TOKEN` (and `_NEXT` during a rotation) is the worker's key to `/api/v1/pathik-worker`, the same value in the worker's environment. Unset: the worker routes answer 404.
- **Backups:** the main guests' ID photos are files in the folder `id-photos` next to the media folder (`web-app/.data/id-photos`, or beside `HMS_MEDIA_DIR`). Back it up with the media folder and the database dump; it is never served on a public address.
- **Rotating `HMS_SECRET_KEY`:** set the new key and restart; each Hotel Admin then saves the Pathik password again (or deletes it). Without the old key the saved passwords cannot be opened. Keep the key apart from the database dumps.
- **Retention (open, needed before real hotels use Pathik):** ID photos are kept for ever once uploaded (decision 37) and the guest details a hotel typed are kept with the stay. A retention rule (how long, who deletes, what is logged) must be decided and built before the first real hotel uses Pathik.
- **Rotating the worker token:** put the new value in `PATHIK_WORKER_TOKEN_NEXT` and restart the app; switch the worker to it; move it to `PATHIK_WORKER_TOKEN`, clear `_NEXT`, restart again.
- **Stopping Pathik for a hotel at once:** the Hotel Admin deletes the credentials (Settings, Pathik); the worker's next claim for that hotel is refused (409).
- **What staff do with a row:** Pending: nothing (the worker sends it). Needs staff: read the reason (a missing field: fix it on the stay, then Retry; an ID type Pathik does not accept: correct it or let the Hotel Admin set the fallback, then Retry; a captcha, OTP or Aadhaar step: do it on the Pathik site, then Mark as submitted). Failed: the worker tries again (15, then 30 minutes; the third failure needs staff). Sent / Marked as submitted: done; a room change after this changes nothing in Pathik (one entry at check-in, one check-out).

### 7a. Pathik worker (the browser program)

- **What runs:** `pathik/worker/` is a separate process (`npm start` in that folder; full runbook `docs/pathik/PATHIK-WORKER.md`). It needs Chrome or Edge on the machine (or `npx playwright install chromium`, about 150 MB) and must reach the web app at `HMS_BASE_URL`. It never opens the database.
- **Start, stop, restart:** start with `npm start` (Windows: a scheduled task "at start-up"; Linux: a systemd service with `Restart=on-failure`). Stop with Ctrl+C or SIGTERM: the row in hand finishes, then the browser closes. A restart is safe: a row it was holding is released by the server after 5 minutes. `npm start -- --once` runs a single cycle for a check.
- **Health:** the Pathik page shows "Pathik worker last ran at" and whether the last run went well (its heartbeat). If that time is older than about 30 minutes, the worker is off or cannot reach the web app: look at its log (it prints one line per event, with ids and counts only, never a guest value, a password or the token).
- **Visible or hidden:** `PATHIK_VISIBLE=true` shows the browser window (for MJ's watched runs); otherwise hidden. The real Pathik site is contacted only when `PATHIK_ALLOW_REAL=yes` is set; without it the worker refuses to start unless `PATHIK_PORTAL_URL` is local.
- **Limits to the portal:** one hotel at a time, one row at a time, a pause between steps (`PATHIK_PAUSE_MS`) and between hotels (`PATHIK_HOTEL_GAP_MS`), at most `PATHIK_JOBS_PER_HOTEL` rows per hotel per cycle, cycles every 10 to 15 minutes. It stops at a captcha, OTP or Aadhaar step (the row shows Needs staff) and never works around them.
- **If Pathik changes its website:** rows start to fail or stop with "Pathik shows a page the worker does not know" / "has changed". Staff use Copy details and Mark as submitted meanwhile. The fix is one file, `pathik/worker/src/portal/selectors.ts` (and the adapter beside it); `pathik/PATHIK-WORKER.md` lists every value that is still a guess.

## Sealing the ID numbers (decision 74, Release A)
Order, on each database (local first, then hosted): 1. `HMS_DATA_KEY` set in `web-app/.env.local` / Vercel, and a copy of it kept apart from the dumps. 2. `npm run db:cli -- migrate` (direct connection) applies hotel 0063 (customers, stays) and 0064 (staff, payroll company, salary rows). 3. `npm run db:cli -- backup`, copy the dump off the machine. 4. `npm run db:cli -- seal-numbers --dry-run` (counts). 5. `npm run db:cli -- seal-numbers --backup-done --hotel <schema>` for one hotel, then `--verify`, then without `--hotel` for the rest. 6. `npm run db:cli -- seal-numbers --verify` must say "0 wrong, 0 still plain only". `seal-numbers` seals every listed column (guests, the other guests of a stay, staff, company and salary numbers); its lines name `table.column`. Rerunning is safe. Deploy the app that has the sealing code AFTER step 2 (before it, the new columns do not exist and a save would fail). Never remove or change `HMS_DATA_KEY` afterwards: sealed numbers cannot be opened without it.
