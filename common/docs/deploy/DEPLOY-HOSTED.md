# Deploy on a hosted platform (Vercel + Neon for testing, then the VPS)

> **1 Nov 2026: the host is now Supabase, not Neon.** Read docs/deploy/SUPABASE-MOVE-2026-10-18.md first. This page keeps the Vercel set-up (section B, D, E); its Neon sections (C) are the older notes and are kept only for comparison.

For a host where you push code and it builds and runs it, with a hosted PostgreSQL database. Read `docs/ENVIRONMENT.md` and `docs/OPERATIONS.md` first. MJ's plan (11 Oct 2026): **Vercel (serverless functions) + Neon (managed PostgreSQL) for testing, later everything on a VPS.** Every Vercel-specific piece is switched on by an environment variable; with none of them set the app behaves exactly as on the VPS or this PC.

Nothing in this file has been run on a real Vercel or Neon project yet. What was tested is named as tested; everything marked **(to verify)** must be checked in the Vercel or Neon console, because it depends on their current plans and settings.

## What HMS needs from a host

| Need | Why | Status on Vercel + Neon |
|---|---|---|
| Node runtime functions | every API route is a Node.js Route Handler (`pg`, `argon2`, `pdfkit`) | Works: Vercel runs Next.js route handlers as Node functions. |
| PostgreSQL **18** with the HMS roles | `uuidv7()` (PG 18 only), one NOLOGIN role per hotel, `SET LOCAL ROLE` | Works only if Neon offers PostgreSQL 18 for the project **(to verify when creating the project; if not, STOP, see section C)**. |
| A lasting place for photos | website photos and guest ID photos | `MEDIA_DRIVER=s3`: an S3-compatible private bucket (built and tested against a fake S3 server, `tests/server/media.s3.test.ts`). The local disk of a function is not kept. |
| Something that sends the mail queue | sign-in codes, reset links, invitations wait in `platform.outbox` | `HMS_MAIL_WORKER=cron`: no timer; a scheduler calls `GET /api/v1/cron/mail` with `CRON_SECRET` (built and tested, `tests/server/cron.test.ts`). See the plan limit in section A.4. |
| Outbound SMTP | real mail | Works (any mail service with SMTP). |
| An owner-side worker for building and removing hotel schemas | approve a hotel, export, permanent delete | **Does not work on Vercel** (section A.6). Done from MJ's computer meanwhile. |
| The Pathik worker (a real browser) | Gujarat Police register | Not on Vercel: it runs on MJ's PC and calls the app's https address (section F). |

## A. Vercel project

### A.1 Project settings

| Setting | Value |
|---|---|
| Root Directory | `web-app` |
| Include source files outside of the Root Directory in the Build Step | **On** (Project Settings > General > Root Directory). The app imports `../ui-shared` (`@shared/*` in `tsconfig.json`; `next.config.ts` sets Turbopack's root to the repository root) and the Platform console's provisioner imports `../db/scripts`. Without it the build cannot find them. |
| Framework | Next.js (also in `web-app/vercel.json`) |
| Install command | `npm ci` (there is a `web-app/package-lock.json`; also in `vercel.json`) |
| Build command | `npm run build` (= `next build`; also in `vercel.json`). Do NOT set `NEXT_DIST_DIR` on Vercel: it is only for a second local build beside the dev server. |
| Output | the Next.js default (leave empty) |
| Node.js version | Next.js 16.3.8 needs Node >= 20.9 (`node_modules/next/package.json`). MJ's PC runs Node 24. Pick 24.x if Vercel offers it, else 22.x **(to verify in Project Settings > General)**. |
| Function region | the Vercel region nearest to the Neon region you choose (both in or near India for the hotels). `vercel.json` deliberately names no region (it would be wrong for any other choice): set it in Project Settings > Functions > Function Region, or add `"regions": ["<id>"]` to `vercel.json` once chosen **(to verify the region ids for both providers)**. A function far from its database pays the distance on every query. |
| Function duration | the PDF routes, the mail cron route and the Platform hotel export and permanent-delete routes declare `export const maxDuration = 60` (seconds). Other routes use the plan's default. Whether 60 s is allowed on the plan **(to verify)**. |
| Environments | set the variables below for **Production** only. A Preview deployment with the same `DATABASE_URL` would write to the same database; previews also run with `NODE_ENV=production`, so without the variables they refuse to start, which is the safe state. (A Neon branch per preview is possible later.) |

### A.2 Environment variables on Vercel (Production)

Names only; generate every secret on your computer (for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), paste it straight into Vercel's settings, never into a file in the repository or a chat.

| Name | Value |
|---|---|
| `NODE_ENV` | set by Vercel (`production`); do not add it |
| `DATABASE_URL` | Neon's **pooled** connection string (the host with `-pooler`) for the role **`hms_app`**, database `hms`, with `sslmode=require` |
| `DB_POOLED` | `1` (a transaction pooler refuses connection start-up options; `hms_app` carries `timezone=UTC` itself) |
| `DB_POOL_MAX` | `3` (connections per function instance) |
| `DB_POOL_MIN` | `0` (no connection is kept for ever: one at or below this number gets no idle timer and could come back dead after the function instance was suspended) |
| `DB_POOL_IDLE_SECONDS` | `300` (an idle connection to the pooler is kept 5 minutes, so the requests of one person reuse it instead of paying the 1 to 1.3 s of a new connection each time). These three are also the app's defaults on Vercel (`VERCEL` set, the variables unset); `10` from an earlier deploy should be changed |
| `HMS_HASH_KEY` | base64 of 32 random bytes; **the same value for the whole life of the data** (back it up) |
| `HMS_SECRET_KEY` | base64 of exactly 32 random bytes (the Pathik password vault); back it up apart from the database |
| `HMS_PUBLIC_URL` | `https://www.easyhotelsolutions.in` (MJ's domain; no path) |
| `MAIL_DRIVER` | `smtp` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | the mail service |
| `HMS_MAIL_WORKER` | `cron` |
| `CRON_SECRET` | 32+ random characters. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when this variable is set on the project **(to verify in Vercel's Cron documentation)** |
| `MEDIA_DRIVER` | `s3` |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | the bucket (section B). `S3_FORCE_PATH_STYLE=1` only if the provider needs path-style addresses |
| `PATHIK_WORKER_TOKEN` | 32+ random characters, the same in the worker's environment on MJ's PC |

**Never on Vercel:** the owner connection string (`PG_OWNER_URL`), Neon's direct (unpooled) string, `PGSUPERUSER_URL`, `PG_TEST_OWNER_URL` (the app refuses to start if one of the three `PG*` names is present), `HMS_MEDIA_DIR`, `HMS_DEV_RELAX_LIMITS`, `NEXT_PUBLIC_API=mock`, `NEXT_PUBLIC_HMS_LOCAL_DEMO`.

The boot check enforces the rules: in production `MEDIA_DRIVER=s3` without all five `S3_*` settings, an `S3_ENDPOINT` that is not https (plain http is allowed only to this machine), or `HMS_MAIL_WORKER=cron` without `CRON_SECRET` stops the server with the variable's name (`tests/server/env.production.test.ts`). On Vercel (`VERCEL` is set by the host) `HMS_MAIL_WORKER` other than `cron` also stops it; `MEDIA_DRIVER` unset/`local` (photo uploads answer 503 "Photo storage is not set up on this server yet") and a database login other than `hms_app` only warn, in the boot log and under System Health; mail on port 587 needs `SMTP_SECURE` unset or `false` (STARTTLS), `true` is for 465 (`docs/ENVIRONMENT.md`).

### A.3 Limits of Vercel functions that HMS meets

- **Request body 4.5 MB** (Vercel's limit). On Vercel (`VERCEL` is set by the platform) the wrapper caps every route at 4,400,000 bytes; a route that allows more (photos) still works up to that, and above it answers **413** with the sentence "This upload is too big for the web host: at most about 3 MB per photo." (tested, `tests/server/wrapper.vercel.test.ts`). Base64 makes a file a third bigger, so about 3.3 MB of photo fits. A body above 4.5 MB is refused by Vercel itself before HMS runs (its own error, not HMS's sentence). **The cap is on the request body (JSON with the image as base64), not on the file: the browsers resize every image to under 3 MB before sending (about 4 MB as base64), decision 38.** The screens should check the size before sending, and the website "add photos" screen should send one photo per request (it allows 40 MB per request elsewhere).
- **Response body**: Vercel also limits what a function may send back **(to verify the number; the request limit is 4.5 MB)**. A photo uploaded on Vercel is at most ~3.3 MB, so it can be served back; a 12 MB gallery photo uploaded on the VPS could not be served through Vercel. A very large PDF would hit the same limit.
- **Duration**: see A.1.
- **No lasting local disk, no lasting memory.** What was checked in `web-app/src/server`:
  - photos: behind the media store, `MEDIA_DRIVER=s3` (website media under `media/`, ID photos under `id-photos/` in the same bucket);
  - rate limits and Idempotency-Keys: in PostgreSQL already;
  - the mail queue: in PostgreSQL; the timer replaced by the cron route;
  - `compose/mail.ts` `logMailSender` appends to `db/.dev-mail.log`: development only (production refuses `MAIL_DRIVER=log`);
  - `provisioner/local.ts` writes exports under `db/dumps/exports`: refused in production anyway (A.6);
  - **Google Business Profile OAuth state** is kept in process memory (`compose/website.ts` `memoryOAuthStates`): the integration is not configured yet (`noGoogle`), but when it is, the "connect" callback can land on another function instance and fail. It needs a database-backed state store before it is switched on;
  - caches that only save work (the mail sender setting, read once a minute; the PDF fonts) are fine;
  - System Health's "Disk space" check reads the function's own read-only disk on Vercel: its number means nothing there.

### A.4 The mail queue (cron) and the plan limit

`HMS_MAIL_WORKER=cron` stops the in-process timer. `GET /api/v1/cron/mail` (no session; `Authorization: Bearer <CRON_SECRET>`; no secret set = 404, wrong = 401; at most 60 calls a minute per address) sends ONE pass of the queue (at most 20 mails, the same pass the timer runs) and answers `{sent, failed, remaining}`. Two calls at the same time never send a mail twice.

`web-app/vercel.json` has **no per-minute `crons` entry** (a per-minute schedule makes a Hobby deployment fail, so it is not in the committed file); its `crons` entries are all once a day, which the Hobby plan allows (100 cron jobs per project, once a day each, up to an hour late; checked on vercel.com/docs 13 Oct 2026): the daily summary (`/api/v1/cron/daily-summary`, `30 15 * * *` UTC = 21:00 IST), the Pathik safety net (`/api/v1/cron/pathik`, 01:30 UTC), the mail safety net (`/api/v1/cron/mail`, 02:00 UTC) and the nightly backup copy (`/api/v1/cron/backup`, `30 20 * * *` UTC = 02:00 IST; `docs/OPERATIONS.md` 4a). **Hobby:** an outside scheduler calls `https://<address>/api/v1/cron/mail` every minute with `Authorization: Bearer <CRON_SECRET>`. **Pro:** add `"crons": [{ "path": "/api/v1/cron/mail", "schedule": "* * * * *" }]` to `web-app/vercel.json` (Vercel then sends the bearer header itself when `CRON_SECRET` is set).

> **Vercel Hobby (free) plan: cron jobs run at most once a day**, and a deployment whose `vercel.json` asks for more may be refused **(to verify the exact behaviour)**. Once a day is useless for sign-in codes (valid 10 minutes). On Hobby: remove the `crons` block from `vercel.json` and let an outside scheduler (an uptime monitor or a cron service that can send a header) call `https://<address>/api/v1/cron/mail` every minute with the `Authorization: Bearer <CRON_SECRET>` header. On a paid plan (Pro) keep `"schedule": "* * * * *"` (per-minute cron is allowed there **(to verify)**).

Since 13 Oct the cron is only the safety net: the request that queues a mail (a sign-in, a website enquiry, a confirmation) runs one pass of the queue right after its answer went out (`next/server after`), so the mail leaves within seconds; the scheduler catches retries of a mail server that was down. Every few minutes (cron-job.org, like the Pathik runner) is enough. Vercel Cron also runs only on the production deployment.

### A.5 What `DB_POOL_MAX=3` means

Each function instance holds its own pool of at most `DB_POOL_MAX` connections to Neon's pooler. Client connections at the pooler = (function instances alive at that moment) x 3; Neon's pooler accepts up to 10,000 client connections and runs the work over a much smaller number of real PostgreSQL connections (transaction pooling). The real limit is the compute's `max_connections`, which Neon sets from the compute size, and the pooler's own pool size per role and database **(both to verify in the Neon console: Settings and the compute's configuration)**. MJ's direct connection for migrations counts against `max_connections` separately.

### A.6 Platform-console actions that cannot work on Vercel

The hotel provisioner (`web-app/src/server/provisioner/local.ts`) reads `PG_OWNER_URL` from `db/.env.local` and **refuses whenever `NODE_ENV` is production** (every Vercel deployment). It is not changed. So on Vercel:

| Console action | Route | What happens on Vercel |
|---|---|---|
| **Approve** a hotel that finished onboarding | `POST /api/v1/platform/hotels/{id}/approve` | Building its schema fails: the Super Admin gets a 500 with the plain "create failed" sentence (`invitationService.ts` `approveHotel`, the provisioner answers NOT_CONFIGURED). The hotel stays `pending_approval`. |
| **Create a hotel** | there is no direct "create" in the console: a hotel is invited, filled in by its admin, then approved, so it stops at the same approval step | Same as approve. `npm run db:cli -- create-hotel --name X --slug x` from MJ's computer creates a NEW hotel directly (platform row, schema, role, seeds). |
| **Export** a hotel's data | `POST /api/v1/platform/hotels/{id}/export` | Refused: "Exporting hotel data is not set up on this server yet." (and the file would have been written to the function's disk) |
| **Delete permanently** | `POST /api/v1/platform/hotels/{id}/delete-permanently` | Refused up front, nothing recorded: "Deleting a hotel is not set up on this server yet." (it also needs an export first) |
| Platform health, per-hotel migration count | `GET /api/v1/platform/health` | Still answers, but without the per-hotel migration count and schema timing (it uses the same provisioner; each hotel shows the platform ping instead, `services/platform/healthService.ts`). |

Options: (1) during the test period, do these from MJ's computer with the direct owner string in `db/.env.local` (`create-hotel` exists; there is **no CLI command today that approves an existing pending hotel, exports one or deletes one**: those would be small additions to `db/scripts/cli.ts`, reusing `provisionHotel`, `exportHotelData` and `dropHotelSchema`); (2) run the console's owner-side actions on the VPS later, where the provisioner can be given an owner connection by a production provisioner (BACKEND.md 14.8; not built).

## B. The bucket (MEDIA_DRIVER=s3)

Any S3-compatible store: AWS S3, Cloudflare R2, Backblaze B2, MinIO on the VPS later. HMS uses plain HTTPS requests signed with AWS Signature Version 4 (no SDK): PUT, GET, HEAD, DELETE of one object.

- Create ONE **private** bucket (no public access, no public URL, no website hosting). Website media are stored under `media/<hotel id>/<file>`, guests' ID photos under `id-photos/<hotel id>/<file>`. HMS serves every file itself after checking the person's permission; the website media route can only name keys under `media/`, so an ID photo is never served publicly.
- Create an access key limited to that bucket with read, write and delete of objects (no bucket administration).
- `S3_ENDPOINT` is the provider's endpoint without a path (`https://s3.<region>.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com`); `S3_REGION` the region (`auto` for R2 **(to verify)**); `S3_FORCE_PATH_STYLE=1` if the provider wants `endpoint/bucket/key` instead of `bucket.endpoint/key`.
- Back up the bucket (provider versioning or a periodic copy) together with the database. The same bucket holds the nightly copy of every hotel's records under `backups/<hotel id>/` (written by `/api/v1/cron/backup`, `docs/OPERATIONS.md` 4a; needs Neon SQL 0122); it is the copy OFF Neon, so keep the bucket in another provider or region than the database when you can.

## C. Neon

### C.1 PostgreSQL version

The migrations use `uuidv7()` (column defaults), which exists only in PostgreSQL 18. When creating the Neon project pick **PostgreSQL 18**. **If Neon offers only an older major version, STOP and tell MJ**: there is no silent fallback (the migrations would fail on the first table).

### C.2 Roles and what a non-superuser owner can do

Neon gives no superuser. The role the console makes when the project is created is a member of `neon_superuser`, which can create roles and databases and trusted extensions, but is not a superuser **(to verify the exact attributes in Neon's "Manage roles" documentation)**. HMS needs:

| Role | How to make it on Neon |
|---|---|
| `hms_owner` | `LOGIN CREATEROLE`, not superuser, no CREATEDB/REPLICATION/BYPASSRLS. Owns the database `hms`, runs migrations, seeds, create-hotel, backups. Never given to the app. |
| `hms_app` | `LOGIN NOINHERIT`, nothing else; role settings `statement_timeout 15s`, `idle_in_transaction_session_timeout 10s`, `lock_timeout 5s`, `timezone UTC` |
| `hotel_<32 hex>_rw` | NOLOGIN, one per hotel, made by `create-hotel` as `hms_owner` (`db/scripts/create-hotel.ts:123`), and `GRANT ... TO hms_app WITH INHERIT FALSE, SET TRUE` (`:130`) |

**Pooled connections and `SET LOCAL ROLE`:** Neon's pooler is PgBouncer in transaction mode. The app only changes role and search path inside a transaction (`withHotel`: `BEGIN`, `SET LOCAL ROLE`, `set_config('search_path', ..., true)`, work, `COMMIT`; `src/db/withHotel.ts`, `src/db/schemaName.ts`), and its locks are transaction-level (`pg_advisory_xact_lock`, `src/server/data/entryNo.ts`, `repos/postgres/frontOffice.ts`). All of that ends with the transaction, so it is compatible with transaction pooling. No named prepared statements, `LISTEN` or session `SET` are used by the app. The migration runner takes a SESSION advisory lock (`db/scripts/migrate.ts:185`): migrations must use the **direct** string.

**What `db:cli setup` would do, and what a non-superuser can do (checked file by file):**

- `db:cli setup` connects with `PGSUPERUSER_URL` (`db/scripts/pg-setup.ts:61-62`). There is no superuser on Neon; the console role is the closest.
- `pg-setup.ts:85-92` `CREATE ROLE hms_owner ... CREATEROLE` / `CREATE ROLE hms_app ... NOINHERIT`: a role with CREATEROLE can create them; whether it may give `CREATEROLE` to a new role **(to verify)**.
- `pg-setup.ts:95-99` `ALTER ROLE ... SET statement_timeout` etc.: allowed to a CREATEROLE role on roles it has ADMIN on (PostgreSQL 16+ gives the creator ADMIN) **(to verify)**.
- `pg-setup.ts:103` `CREATE DATABASE ... OWNER hms_owner ... LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`: needs CREATEDB, and (PostgreSQL 16+) the creator must be able to `SET ROLE hms_owner`; the creator gets ADMIN on roles it creates but not necessarily SET, so `GRANT hms_owner TO <console role> WITH SET TRUE` may be needed first **(to verify)**. Whether Neon accepts the `builtin` locale provider **(to verify)**; otherwise create the database in the Neon console and transfer it (`ALTER DATABASE hms OWNER TO hms_owner`, `:104`, same SET rule). HMS does not depend on the collation for correctness (case-insensitive rules use `citext` / `lower()`), only for sort order of text.
- `pg-setup.ts:105-107` `REVOKE ALL ON DATABASE ... FROM PUBLIC`, `GRANT CONNECT`: the database owner can.
- `pg-setup.ts:112-116` `REVOKE ALL ON SCHEMA public FROM PUBLIC`, `CREATE EXTENSION citext`, `CREATE EXTENSION pg_trgm` (in `public`), `GRANT USAGE ON SCHEMA public`: in PostgreSQL 15+ the `public` schema belongs to the database owner, and `citext` and `pg_trgm` are trusted extensions that the database owner may create. Neon lists both as supported **(to verify for PostgreSQL 18)**. The migrations themselves create no extension.
- `pg-setup.ts:118-120` `ALTER DEFAULT PRIVILEGES FOR ROLE hms_owner ...`: run as `hms_owner` itself it is always allowed.
- `pg-setup.ts:83, 110` and `pg-db.ts` `pgUrl` build `127.0.0.1:5433` URLs and the setup writes `DATABASE_URL` for that address into `web-app/.env.local`: `setup` is made for HMS's own instance. **Do not run `setup` against Neon**; do the steps below by hand.
- Migrations (`db/migrations/platform`, 22 files 0000-0113, and `db/migrations/hotel`, 24 files 0000-0023; every file searched for the statements below, the matches read): `CREATE SCHEMA IF NOT EXISTS platform` (`platform/0000_foundation.sql:6`, also `migrate.ts:241`), tables, indexes, plpgsql trigger functions (no `SECURITY DEFINER`, no other language), `GRANT ... TO hms_app` on platform tables and functions (`0099_grants.sql`, `0101`-`0110`), `REVOKE ... FROM PUBLIC` (`0099_grants.sql:8-9`, `0102:191`, `0105:89`, `0106:82`). All of it is ordinary owner work. **Not found anywhere:** `ALTER SYSTEM`, `SUPERUSER`/`CREATEDB`/`REPLICATION`/`BYPASSRLS` grants, `OWNER TO` in a migration, `CREATE EXTENSION`, `COPY ... FROM` a file, `pg_read_server_files`/`pg_read_file`, event triggers, untrusted languages, tablespaces.
- `create-hotel.ts:122-130`: `CREATE SCHEMA`, `CREATE ROLE hotel_..._rw NOLOGIN ...` (needs `hms_owner`'s CREATEROLE), `ALTER DEFAULT PRIVILEGES FOR ROLE hms_owner IN SCHEMA ...`, `GRANT "hotel_..._rw" TO hms_app WITH INHERIT FALSE, SET TRUE` (PostgreSQL 16+ syntax; `hms_owner` has ADMIN on roles it created). `:88-93` per-table `REVOKE`/`GRANT DELETE`. All as `hms_owner`, no superuser needed.
- `hotel-data.ts:64-76` (permanent delete): `DROP SCHEMA ... CASCADE`, `DROP ROLE hotel_..._rw`: as `hms_owner`.
- Neon limits the number of roles per branch (BACKEND.md section 10 notes 500, so roughly 490 hotels) **(to verify)**.

**Fixed (11 Oct):** the database scripts now honour `sslmode=require` (and `verify-ca` / `verify-full`) in a connection string (`db/scripts/pg-db.ts`, tested). If Neon's string carries `channel_binding=require` and the driver refuses it, remove that part.

**The current order for MJ is `docs/deploy/SUPABASE-MOVE-2026-10-18.md`; `db:cli setup --hosted` replaces the manual role and database steps of C.4 (it was run against a simulated Neon: a PostgreSQL 18 server whose console role is not a superuser).**

### C.3 Cold start and connections

- Neon's free plan suspends the compute after about 5 minutes without queries; the first query after that waits while it starts (roughly half a second to two seconds) **(to verify on the plan)**. `GET /api/v1/health/ready` waits at most 2 seconds for the database, so the very first readiness check after a quiet spell can answer 503: try again. A function that has been idle also starts cold.
- Connections: section A.5.

### C.4 Making the database (from MJ's computer, with the DIRECT string)

Use `psql` from PostgreSQL 18 (`C:\Program Files\PostgreSQL\18\bin\psql.exe`) with the console role's **direct** connection string. Generate the two passwords locally; never paste them anywhere but the command and the env files.

1. As the console role: `CREATE ROLE hms_owner LOGIN CREATEROLE PASSWORD '...';` `CREATE ROLE hms_app LOGIN NOINHERIT PASSWORD '...';` `ALTER ROLE hms_app SET statement_timeout = '15s';` (and `idle_in_transaction_session_timeout = '10s'`, `lock_timeout = '5s'`, `timezone = 'UTC'`), `ALTER ROLE hms_owner SET timezone = 'UTC';`
2. `GRANT hms_owner TO <console role> WITH SET TRUE;` (if needed, see C.2), `CREATE DATABASE hms OWNER hms_owner;`
3. Connected to `hms` as `hms_owner`: `REVOKE ALL ON DATABASE hms FROM PUBLIC; GRANT CONNECT ON DATABASE hms TO hms_app; REVOKE ALL ON SCHEMA public FROM PUBLIC; CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public; GRANT USAGE ON SCHEMA public TO hms_app; ALTER DEFAULT PRIVILEGES FOR ROLE hms_owner REVOKE ALL ON TABLES FROM hms_app;` (and the same for `SEQUENCES` and `FUNCTIONS`) — the same statements as `pg-setup.ts:105-120`.
4. In `db/.env.local` on MJ's computer only: `PG_OWNER_URL` = the **direct** (unpooled) string for `hms_owner` on `hms`, with `sslmode=require`. (Needs the `pg-db.ts` fix above.)

## D. First deploy, step by step

From MJ's computer unless it says Vercel:

1. Create the Neon project: PostgreSQL 18 (C.1), region near the hotels.
2. Make the roles and the database (C.4).
3. `npm run db:cli -- migrate --dry-run`, then `npm run db:cli -- migrate` (against the direct string in `PG_OWNER_URL`). Expect every platform file applied.
4. `npm run db:cli -- seed`.
5. The first Super Admin: `npm run db:cli -- create-user --username <u> --name "<Full name>" --email <e> --account-role super_admin --role super_admin --write-file` (the temporary password goes to the git-ignored `db/.dev-login.txt`; it must be changed at the first sign-in).
6. Hotels for the test: `npm run db:cli -- create-hotel --name "<Hotel>" --slug <slug>` (approval in the console does not work on Vercel, A.6).
7. Create the bucket and its key (B).
8. Vercel: import the repository, apply A.1, set the variables of A.2 for Production, deploy. On the Hobby plan first apply A.4.
9. `node web-app/scripts/first-deploy-check.mjs https://www.easyhotelsolutions.in` (with `CRON_SECRET` in the shell's environment to also call the cron route once; the script never prints it). It checks health, readiness with the database, the security headers, `no-store` on API answers and that the cron route refuses a caller without the secret.
10. `node web-app/scripts/smoke.mjs https://www.easyhotelsolutions.in`.
11. Sign in as the Super Admin: the sign-in code arrives by mail within about a minute (the cron route sends it); this is the mail test.
12. Upload a website photo under 3 MB and a guest ID photo; open both again (the bucket test). Try a 4 MB photo: the 413 sentence must appear.
13. Look at Vercel's Cron page (or the outside scheduler): `/api/v1/cron/mail` answers 200 every minute.

## E. Move from Vercel and Neon to the VPS

1. **Freeze writes** (tell the users; or switch the Vercel deployment off) so nothing changes during the copy.
2. **Dump** from MJ's computer with the direct Neon string as `PG_OWNER_URL`: `npm run db:cli -- backup` (custom-format `pg_dump` of every schema, a `.sha256`, and `<dump>.roles.sql`, the script that recreates each hotel's NOLOGIN role; `db/scripts/backup.ts`). Equivalent by hand: `pg_dump --format=custom --dbname "<direct string>" --file hms.dump`. Use `pg_dump` 18.
3. **On the VPS (PostgreSQL 18):** `npm run db:cli -- setup --external` with the VPS superuser as `PGSUPERUSER_URL` (roles, database `hms`, extensions `citext` and `pg_trgm`), then run `<dump>.roles.sql` as the superuser (hotel roles are server-level, not in the dump), then `pg_restore --no-owner --dbname hms --username hms_owner <dump>`, then `npm run db:cli -- migrate` (must say 0 pending). This is `docs/OPERATIONS.md` section 4 "Real restore"; `npm run db:cli -- restore-check` proves the dump and the roles script first. The per-hotel schemas `hotel_<hex>` and their grants come with the dump; the extensions are made by `setup` before the restore.
4. **Photos:** either keep the bucket (`MEDIA_DRIVER=s3` works on a VPS too; nothing to move) or copy every object to the VPS disk with any S3 tool: `media/<hotel>/<file>` to `<HMS_MEDIA_DIR>/<hotel>/<file>` and `id-photos/<hotel>/<file>` to `<folder beside HMS_MEDIA_DIR>/id-photos/<hotel>/<file>` (the local layout of `compose/website.ts` and `compose/frontOffice.ts`), then set `MEDIA_DRIVER=local` (or remove it) and `HMS_MEDIA_DIR`.
5. **Environment on the VPS:** `DATABASE_URL` = the VPS `hms_app` string; remove `DB_POOLED`, `DB_POOL_MIN`, `DB_POOL_IDLE_SECONDS` (or set them for a long-running server; defaults 4 and 600) and size `DB_POOL_MAX` (`docs/ENVIRONMENT.md` section 4); `HMS_MAIL_WORKER=in-process` (or remove it; the timer starts again) and `CRON_SECRET` may be removed (the route then answers 404); keep `HMS_HASH_KEY`, `HMS_SECRET_KEY`, the SMTP settings and `PATHIK_WORKER_TOKEN` **unchanged** (a new hash key cancels live codes; a new secret key makes the saved Pathik passwords unreadable). The provisioner works on the VPS only once a production owner-side worker exists (A.6).
6. **DNS:** point the domain at the VPS (lower the record's TTL a day before); `HMS_PUBLIC_URL` stays the same if the domain stays the same. Point the Pathik worker's `HMS_BASE_URL` at it.
7. **Final check:** `node web-app/scripts/first-deploy-check.mjs https://www.easyhotelsolutions.in` (the cron checks then report 404 if `CRON_SECRET` was removed, which is expected on the VPS) and `node web-app/scripts/smoke.mjs https://www.easyhotelsolutions.in`; sign in, open a photo, send a test mail. Then remove the Vercel project's variables and delete the Neon project only after a VPS backup has been taken and restore-checked.

## F. The Pathik worker through Vercel

**Update 13 Oct (MJ: "host everything from one place"):** the online runner no longer needs cron-job.org or any outside timer. A check-in, a check-out, the Run now button
and an open Pathik or Front Desk page kick a run for that hotel through the site's own `/api/v1/cron/pathik` (one POST with the CRON_SECRET, after the request has answered),
and `web-app/vercel.json` carries the once-a-day Vercel timers (Hobby allows daily crons) as the safety net. Only that one route carries the serverless Chromium. The Pathik
page's **runner card** and the System Log say what every run did, and why a run never reached Pathik (hotel migration 0033). The whole set-up, the variables and how to read
the card: **`docs/pathik/PATHIK-ONLINE.md`**.

**Update 12 Oct (MJ: "move the worker to the site"):** the worker can now run INSIDE the Vercel app as a function (HMS_PATHIK_RUNNER=online): see pathik/docs/ONLINE-WORKER.md for what it does, the two decisions (manual submit cannot work online; pathik.guru may refuse Vercel's addresses), the setup (cron-job.org calls GET /api/v1/cron/pathik every 5 minutes with the CRON_SECRET) and the risks. The PC worker below stays the fallback.

The worker (`pathik/worker/`) stays on MJ's PC. Set `HMS_BASE_URL=https://<the Vercel address>` and the same `PATHIK_WORKER_TOKEN` as on Vercel (`docs/pathik/PATHIK-WORKER.md`). Its routes (`/api/v1/pathik-worker/...`) use only the `Authorization: Bearer` header (no cookie, no session) and small JSON bodies, so they pass through Vercel like any other request. The claim answer carries the hotel's Pathik password, so it must never be cached: every HMS answer is sent with `Cache-Control: no-store`. If Vercel Deployment Protection is switched on for the production address, the worker (and the cron scheduler) are refused before HMS sees them **(to verify the project's protection setting)**.

## G. Other hosts

A container or PaaS host with a long-running `next start` and a persistent disk works without any of the switches above (in-process mail timer, local media folder): steps as in E.3-E.7. Several instances are safe (the outbox claims rows without double-sending; each instance has its own pool: `DB_POOL_MAX x instances` under the database's cap; throttle counters and Idempotency-Keys are in the database).
