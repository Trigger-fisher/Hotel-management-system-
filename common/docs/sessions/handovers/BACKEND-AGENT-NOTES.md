# Backend agent notes (11 Oct 2026): Vercel/Neon readiness and payroll paging

Written by the Backend session's extra agent for the Backend session to merge into `docs/BACKEND.md` and `docs/ENVIRONMENT.md` (the agent did not edit those two). Nothing committed.

## 1. New environment names

All in `web-app/src/server/config/env.ts` (zod schema; production rules in `productionRules`). Messages name the variable, never a value. Tested in `tests/server/env.production.test.ts`.

| Name | Type | Default | Required in production |
|---|---|---|---|
| `MEDIA_DRIVER` | `local` \| `s3` | `local` | no; with `s3` the five `S3_*` below are required |
| `S3_ENDPOINT` | http(s) address without a path | none | with `MEDIA_DRIVER=s3`; must be `https://` (plain `http://` only to `localhost`/`127.0.0.1`) |
| `S3_REGION` | `[a-z0-9-]{1,40}` | none | with `MEDIA_DRIVER=s3` |
| `S3_BUCKET` | bucket name (3-63 lower-case letters, digits, dots, dashes) | none | with `MEDIA_DRIVER=s3` |
| `S3_ACCESS_KEY_ID` | string 1-200 | none | with `MEDIA_DRIVER=s3` |
| `S3_SECRET_ACCESS_KEY` | string 1-500 (secret) | none | with `MEDIA_DRIVER=s3` |
| `S3_FORCE_PATH_STYLE` | `1` or unset | unset (virtual-host style) | no |
| `HMS_MAIL_WORKER` | `in-process` \| `cron` | `in-process` | no; with `cron`, `CRON_SECRET` is required |
| `CRON_SECRET` | string, at least 32 characters (secret) | none (the cron routes answer 404) | with `HMS_MAIL_WORKER=cron` |

Outside production nothing new is required (`MEDIA_DRIVER=s3` with a missing setting fails when the store is first used, naming the missing variables). `VERCEL` is read (not validated) by the wrapper: Vercel sets it itself.

**Rows to paste into `docs/ENVIRONMENT.md` section 1** (same columns: Name | Production | Default | Meaning):

```
| `MEDIA_DRIVER` | `s3` on Vercel | `local` | Where photos are kept: `local` = this server's disk (`HMS_MEDIA_DIR`), `s3` = a private S3-compatible bucket (website media under `media/`, guest ID photos under `id-photos/`). With `s3` in production the five `S3_*` settings are required. |
| `S3_ENDPOINT` | required with `s3`, `https://` | none | The bucket provider's endpoint, no path (`https://s3.ap-south-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com`). Plain http only to this machine. |
| `S3_REGION` | required with `s3` | none | The bucket's region (`ap-south-1`; `auto` for R2). |
| `S3_BUCKET` | required with `s3` | none | The bucket name. The bucket must be private: HMS serves every file itself after a permission check. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required with `s3` | none | An access key limited to that bucket's objects (read, write, delete). Read by the running app only; never logged, returned or put in an error. |
| `S3_FORCE_PATH_STYLE` | | unset | `1` = `endpoint/bucket/key` addresses (MinIO and most self-hosted stores); unset = `bucket.endpoint/key`. |
| `HMS_MAIL_WORKER` | `cron` on Vercel | `in-process` | How the mail queue is sent: `in-process` = a timer in the server (VPS, local); `cron` = no timer, a scheduler calls `GET /api/v1/cron/mail` with `CRON_SECRET` (serverless hosts). |
| `CRON_SECRET` | required with `cron` | none | At least 32 random characters: the bearer secret of `/api/v1/cron/*` (`Authorization: Bearer <CRON_SECRET>`; Vercel Cron sends it when the variable is set on the project). Unset: those routes answer 404. |
```

And under "Refused in production" add: "`MEDIA_DRIVER=s3` without all five `S3_*` settings or with a non-https `S3_ENDPOINT`, and `HMS_MAIL_WORKER=cron` without `CRON_SECRET`."

Note: `web-app/.env.example` was NOT changed (tests/server/repo.test.ts pins its exact list; `DB_POOL_MIN`/`DB_POOLED` are not in it either). Decide whether to add the new names there together with that test.

## 2. What was built (task 1)

- `src/server/media/s3.ts`: `createS3MediaStore({endpoint, region, bucket, accessKeyId, secretAccessKey, prefix, forcePathStyle, timeoutMs?, now?})`, fetch + AWS Signature V4 (node:crypto only); key `${prefix}${hotelId}/${name}`; same `assertSafe` as the local store (now exported from `store.ts`, with `contentTypeOf`); 404 -> `null`/`false`; delete treats 404 as gone; errors name the operation and HTTP status only (no key, address, secret; network causes dropped); `objectUrl` (path or virtual-host), `signV4` (checked against AWS's two published S3 example signatures), `s3MediaStoreFromConfig(config, prefix)`.
- `compose/website.ts` (`defaultMediaStore`, prefix `media/`) and `compose/frontOffice.ts` (`getIdPhotoStore`, prefix `id-photos/`): `MEDIA_DRIVER=s3` picks the bucket; no database = memory store as before; `local` unchanged.
- `compose/mail.ts`: `startMailWorker` does not start the timer when `HMS_MAIL_WORKER=cron`; new `drainMailOnce()` = ONE `runOutboxOnce` pass (unchanged function; the unit is wrapped only to count the claimed rows) returning `{sent, failed, remaining}` (`remaining` = `count(*)` of `platform.outbox` rows with status `pending`, same style as the existing `settingsFrom` query); `configureMailDrain()` for tests.
- `services/cron/cronService.ts` (bearer check: SHA-256 digests compared with `timingSafeEqual`; no secret = `NOT_FOUND`, missing/wrong = `SESSION_EXPIRED` 401), `compose/cron.ts`, route `GET /api/v1/cron/mail` (publicRoute, limit `cron` 60/min per address, `maxDuration = 60`).
- `http/wrapper.ts`: with `process.env.VERCEL` set, a route's body limit is capped at `VERCEL_MAX_BODY_BYTES = 4_400_000`; over the cap -> **413** with code `VALIDATION_FAILED`, message and `fields._` = "This upload is too big for the web host: at most about 3 MB per photo." (`HOST_BODY_TOO_BIG`). The 413 is made by re-wrapping the normal error response (no new error code: `ui-shared` owns the code unions). Without `VERCEL` nothing changes (422 "Request is too large" as before).
- `export const maxDuration = 60;` inserted after `export const dynamic = "force-dynamic";` in the 25 route files under a `/pdf/` path and in `platform/hotels/[id]/export` and `platform/hotels/[id]/delete-permanently` (27 files, one line each; a scripted insert, `git diff --stat` = 27 insertions).
- `web-app/vercel.json` (framework, install, build, cron every minute), `web-app/scripts/first-deploy-check.mjs`, `docs/deploy/DEPLOY-HOSTED.md` rewritten (Vercel + Neon, first deploy, move to the VPS, Pathik worker through Vercel).
- Tests: `tests/server/media.s3.test.ts` (8), `tests/server/cron.test.ts` (6), `tests/server/wrapper.vercel.test.ts` (4), two new cases in `env.production.test.ts`, `cron\/` allowed in `security.hotel.test.ts`'s public-route list.

## 3. Provisioner findings (not changed)

`src/server/provisioner/local.ts` reads `PG_OWNER_URL` from `db/.env.local` and throws NOT_CONFIGURED whenever `NODE_ENV` is production (every Vercel deployment, previews included); exports are written to `db/dumps/exports` on local disk. Effect on Vercel:

| Console action | Route | Result |
|---|---|---|
| Approve an onboarded hotel (this is also the only console path that creates a hotel: invite -> onboarding -> approve) | `POST /platform/hotels/{id}/approve` | 500 with the "create failed" sentence (`invitationService.approveHotel`); hotel stays `pending_approval` |
| Export data | `POST /platform/hotels/{id}/export` | 500 "Exporting hotel data is not set up on this server yet." |
| Delete permanently | `POST /platform/hotels/{id}/delete-permanently` | refused up front (inspect NOT_CONFIGURED), nothing recorded: "Deleting a hotel is not set up on this server yet." |
| Platform health | `GET /platform/health` | answers without per-hotel migration counts (falls back to the platform ping) |

Options: (1) from MJ's PC with the direct owner string: `db:cli create-hotel` exists (makes a NEW hotel); there is no CLI command to approve an existing pending hotel, export one or delete one (small additions to `db/scripts/cli.ts` reusing `provisionHotel`, `exportHotelData`, `dropHotelSchema`); if such a command builds a pending hotel's schema, the console's approve then "resumes" on Vercel (`approveHotel` skips the provisioner when the hotel is active, not yet approved, with pending accounts). (2) a production provisioner (owner-side worker) on the VPS later.

## 4. Other findings for the Backend session

1. **Blocker for Neon migrations: `db/scripts/pg-db.ts` `pgOptionsFromUrl` drops the query string**, so `sslmode=require` is ignored and every `db:cli` connection to Neon is plain TCP, which Neon refuses. Needs an `ssl` option (e.g. when `sslmode` is `require`/`verify-full`, or the host is not local). Not changed (outside the agent's files). The app's pool is fine (it passes the whole string to `pg`).
2. `db:cli setup` is for HMS's own instance (`pgUrl` defaults to `127.0.0.1:5433` and it writes `DATABASE_URL` for that); on Neon the roles/database are made by hand (`deploy/DEPLOY-HOSTED.md` C.4).
3. Google Business Profile OAuth state is in process memory (`compose/website.ts memoryOAuthStates`): breaks across serverless instances once the integration is switched on.
4. System Health "Disk space" (`compose/systemAdmin.ts statfs(process.cwd())`) is meaningless on Vercel.
5. Website photos route allows 40 MB per request and gallery photos up to 12 MB: on Vercel only ~3.3 MB per request gets through (413 sentence). The website screen should send one photo per request and check the size first (frontend message).
6. With `HMS_MAIL_WORKER=cron` a sign-in code waits up to a minute (cron granularity), and on the Vercel Hobby plan Vercel Cron runs at most once a day (an outside scheduler is needed). A possible improvement: after enqueueing a code, also run one drain right away (e.g. Next.js `after()`), keeping the cron as the safety net.

## Payroll paging (for BACKEND.md section 7 Pay)

**Not done by this agent: the work is already in progress elsewhere.** At 10:09 on 11 Oct, when task 1 was finished, the working tree already held another session's UNCOMMITTED changes for exactly this task (last written 10:00-10:07): `services/payrollPay/schemas.ts`, `paymentService.ts`, `adjustmentService.ts`, `separationService.ts`, a new `services/payrollPay/listView.ts`, `repos/payrollPay.ts`, `repos/memory/payrollPay.ts`, `repos/postgres/payrollPay.ts` and `tests/server/payrollPay.test.ts` (about 390 lines added). Writing the same files at the same time would have overwritten that work, so this agent did not touch them. The sort ids and status values must come from that session once it finishes.

What the four lists supported at the last commit (HEAD `1c1bf47`, `schemas.ts`), for reference:

| List | Route | Query at HEAD |
|---|---|---|
| Slips | `GET /payroll/companies/{cid}/slips` | `search`, `period` (YYYY-MM), `page` (default 1), `pageSize` 10/25/50/100 (default 25): always paged |
| Advances | `GET .../advances` | `search`, `deleted`, `page` (default 1), `pageSize`, `tab` all/open/settled |
| Bonus | `GET .../bonuses` | `search`, `deleted`, `page` (default 1), `pageSize`, `tab` all/Bonus/Incentive |
| Resignations | `GET .../separations` | `search`, `deleted`, `page` (default 1), `pageSize`, `tab` all/notice/relieved/rejoined |

Snapshot of what the uncommitted `schemas.ts` declared at 10:09 (NOT written or tested by this agent; may still change): Slips `status` = the six payment statuses, `sort` period|employee|net|processed|status; Advances `period`, `status` open|settled, `sort` date|entryNo|employee|amount|outstanding; Bonus `period`, `status` Bonus|Incentive, `sort` date|entryNo|employee|amount|type; Resignations `period`, `status` Pending|Accepted|Relieved, `sort` lastWorkingDate|resignationDate|employee|entryNo|status; all `dir` asc|desc (default asc).

## 5. Not verified (needs a real Vercel / Neon / S3 project)

- Any deploy to Vercel: `vercel.json` being accepted (and whether a per-minute cron is refused on Hobby at deploy time), the "include files outside the root directory" build with `../ui-shared` and `../db/scripts`, Node version choice, region ids, `maxDuration = 60` allowed on the plan, the response size limit, that `VERCEL` is set at run time, that Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`, Deployment Protection's effect on cron and the worker, `x-forwarded-for` on Vercel for the per-address limits.
- Neon: PostgreSQL 18 availability, the console role's exact attributes, CREATE ROLE ... CREATEROLE by that role, `CREATE DATABASE ... OWNER hms_owner` (SET membership), the `builtin` locale provider, `citext`/`pg_trgm` on PG 18, the pooler's real pool size and `max_connections`, cold-start time, role limit per branch, `channel_binding` in the connection string with node-postgres, and the `pg-db.ts` TLS blocker above (inferred from the code, not observed).
- S3: only an in-process fake server; signatures were also checked against AWS's published examples, but no request reached AWS, R2 or MinIO. `S3_REGION=auto` for R2 not checked.
- `first-deploy-check.mjs` was only run against an unreachable address (structure and exit code), never against a deployed server.
- The mail cron path with the real PostgreSQL outbox (`remaining` query): only the in-memory outbox was exercised; the SQL is a plain `count(*)` on a table `hms_app` already has SELECT on (`0099_grants.sql:32`).
