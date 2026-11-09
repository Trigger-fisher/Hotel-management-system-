# Moving the database and the images to Supabase: plan and checklist

**Status (1 Nov 2026):** MJ decided to use Supabase (decision 72). The uuidv7() shim is now made by `db:cli setup --hosted` itself (section 1) and has a test; the .env.example has a Supabase block. Neon (database) and Vercel (app) stay live until MJ says "switch". Nothing in this document has been run against a real Supabase project yet: that needs MJ's _local/secrets/supabase.env and `supabase-check.ts`.
**Owner:** claude-d3 (hosting / deploy). **Date:** 18 Oct 2026.

Supabase project settings MJ chose: region Mumbai (ap-south-1), Data API off, automatic exposure off, automatic RLS off. HMS talks to PostgreSQL directly and never uses Supabase's REST/GraphQL API, Auth or Realtime.

---

## 1. Compatibility: what HMS needs from the database, and what to check on Supabase

| HMS needs | Where in the code | Supabase | Action |
|---|---|---|---|
| **PostgreSQL 18** (`uuidv7()` is a built-in function from 18; 36 tables use `DEFAULT uuidv7()`) | every migration since the first | New projects run PostgreSQL 17 (18 may be offered later; the check script reports the version) | If the version is below 18: create a **`public.uuidv7()` shim** (a plain SQL function returning a time-ordered UUID, same layout as the built-in) **before** the first migration. The tables then use the shim; when Supabase moves to 18, the shim can be dropped once nothing depends on it. The shim goes in a small extra setup step, not in a migration, so Neon/local (already 18) are unchanged. |
| `LOCALE_PROVIDER builtin` when making the database | `db/scripts/pg-setup.ts` (CREATE DATABASE) | PostgreSQL 17 has it | Check that the setup role may run CREATE DATABASE (below). |
| Roles **`hms_owner`** (CREATEROLE, owns everything, runs migrations) and **`hms_app`** (NOINHERIT, the web app), plus one NOLOGIN role per hotel (`hotel_<hex>_rw`) made by `hms_owner` | `pg-setup.ts` runHostedSetup; `db/scripts/create-hotel.ts` | The `postgres` role Supabase gives us has CREATEROLE and CREATEDB but is not a superuser, the same shape as Neon's console role, which `setup --hosted` was written for | `setup --hosted` should work as is with `PG_CONSOLE_URL` = the **direct** connection as `postgres`. The check script confirms the role's attributes. |
| A separate database `hms` (and `hms_test` only on the local machine) | `pg-setup.ts` | Supabase projects come with one database, `postgres`. Others can be created, but the pooler may only route to `postgres`. | The check script tests whether the pooler reaches a database other than `postgres` (read-only: it tries to connect, with no CREATE). If not, run HMS inside `postgres` in its own schemas (`platform`, `hotel_*`); `setup --hosted` then needs a `--database postgres` option (a small change, made only if the check says so). |
| Extensions `citext`, `pg_trgm` | `pg-setup.ts` | Both available on Supabase | The check script reports them as available. They are created during setup, not by the check. |
| `SET LOCAL ROLE "hotel_<hex>_rw"` and `set_config('search_path' / 'hms.scope_*', …, true)` inside each transaction; `BEGIN READ ONLY` for visits | `web-app/src/db/withHotel.ts` | All transaction-local, so they suit Supavisor's **transaction mode** (port 6543): the settings end with the transaction, so nothing leaks to the next client | The check script runs one transaction with `SET LOCAL ROLE` (to its own role) and `set_config(…, true)`, then a second transaction on the same pool, and confirms the setting did not leak. |
| No named prepared statements | the app uses node-postgres with unnamed statements (no `name:` anywhere in `src`) | Transaction mode does not keep prepared statements between transactions | OK. The check script runs one parameterised query through the transaction pooler to confirm. |
| Advisory locks (the tests' `lockTestDatabase`, the migration runner) | `db/scripts/migrate.ts`, tests | Session-level advisory locks need a **session**, so not the transaction pooler | Migrations and setup use the **direct** connection (or the session pooler, port 5432). Only the web app uses the transaction pooler. |
| Row-level security (company and guest portals, hotel 0035) | hotel migrations | Normal PostgreSQL RLS; Supabase's "auto RLS" is off, so it adds nothing of its own | No action. |

**Connections after the move:**
- Web app on Vercel: `DATABASE_URL` = `hms_app` through the **transaction pooler** (port 6543, `?sslmode=require`), `DB_POOL_MAX` small (3 to 5 per function).
- Scripts, migrations and Neon-SQL-style steps: **direct** connection (or the session pooler) as `hms_owner`.

### 1a. The new data structure on Supabase (decision 72, steps 1 to 10)

Checked against Supabase (PostgreSQL 17, no superuser, transaction pooler):

- **Nothing needs PostgreSQL 18 except `uuidv7()`**, and `db:cli setup --hosted` makes that shim in `public`. The migration files hold no other 18-only syntax and no extension beyond `citext` and `pg_trgm`, which Supabase allows.
- **Writes go through two SECURITY DEFINER functions** (`platform.create_person`, `platform.change_person`) whose `search_path` is `platform, public, pg_temp`, so they find the shim on Supabase and the built-in on 18.
- **Pooler:** every setting is transaction-local (`set_config(..., true)`), so `DB_POOLED=1` on port 6543 is safe. Migrations and `setup` use the DIRECT connection.
- **Shards:** one project is the `main` shard (about 300 hotels). A second project becomes a second shard by setting `DATABASE_URL_SHARD_<KEY>` and adding it to `platform.shards`; the central tables (logins, Guest ID, Company GST, the hotel to shard map) stay on `main`.
- **Which database (done on the real project, 1 Nov 2026):** HMS lives in the project's own `postgres` database, not a separate `hms`: the Supabase dashboard (Table Editor, SQL Editor) and the pooler reach only `postgres`. `db:cli setup --hosted --database postgres` does it: it skips the lock on the host's database and makes the extensions and the `uuidv7()` shim as the console role. Look at the tables in the dashboard under the `platform` and `hotel_...` schemas.
- **Through the pooler:** a Supabase pooler login carries the project (`postgres.<project>`); `urlWithLogin` keeps that part for every role. Direct needs IPv6, so on an IPv4-only network the setup runs through the Session pooler (port 5432). A server before PostgreSQL 18 needs `public` on the migration search path for the `uuidv7()` shim (`legacyUuidSearchPath`).
- **Sample hotels:** `db:cli demo-hotels` makes 2 groups (each with a Group Hotel Admin), 5 group hotels and 2 individual hotels, each with a Hotel Admin and a small set of sample data; it refuses a database that already holds a real hotel. The logins go to `common/db/.dev-login.txt` (git-ignored).
- **Hotel map:** `platform.hotel_map` (migration 0158) lists every hotel with its group and its hotel database, read from `platform.hotel_shards`. Until a second database exists, every line says `main`.
- **Data API:** the tables live in the `platform` and `hotel_*` schemas, which Supabase does not expose through its Data API unless they are added to "Exposed schemas". Leave them out (or switch the Data API off): the app talks to the database directly as `hms_app`, and `anon` and `authenticated` hold nothing.
- **Still to run on the real project** (needs `_local/secrets/supabase.env`): `db:cli setup --hosted`, `migrate`, `seed`, and `supabase-check.ts`.

## 2. How `db:cli setup --hosted` applies to Supabase

`setup --hosted` (db/scripts/pg-setup.ts runHostedSetup) was written for Neon:
1. As the console role (Supabase: `postgres`, direct connection), it creates `hms_owner` and `hms_app` with generated passwords, and grants `hms_owner` to the console role WITH SET, so it can create the database for it.
2. It creates the database owned by `hms_owner` (or, if the check says so, uses `postgres`; see section 1).
3. As `hms_owner`, inside the database: closes `public`, creates `citext` and `pg_trgm`, sets default privileges.
4. It writes the URLs and passwords **only** into git-ignored files (db/.env.local, web-app/.env.local); nothing is printed.

Then `db:cli migrate` (as `hms_owner`, direct) applies every platform and hotel migration, and `create-hotel` makes each hotel schema and role.

For Supabase, two small additions, made in a separate commit only after the check: the `uuidv7()` shim (if the version is below 18), and a `--database` choice (if the pooler only reaches `postgres`).

## 3. Images: Supabase Storage through its S3-compatible endpoint

HMS already stores images (menu photos, website media, profile photos) through `MEDIA_DRIVER=s3` (`web-app/src/server/media/s3.ts`, settings in `web-app/src/server/config/env.ts`). Supabase Storage speaks the S3 protocol, so **no code change** is expected:

| Setting | Value on Supabase |
|---|---|
| `MEDIA_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://<project-ref>.supabase.co/storage/v1/s3` (Supabase shows it under Storage > S3 Connection). Note: env.ts accepts an endpoint *without a path* today, so this endpoint (which has `/storage/v1/s3`) needs env.ts to accept a path, or a small adapter; the check script tells us which. |
| `S3_REGION` | the project's region as Supabase shows it (`ap-south-1`) |
| `S3_BUCKET` | `hms-media`: a **private** bucket (never public; the app serves images through its own routes with the hotel check) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | an S3 access key made under Storage > S3 Connection > Access keys. These keys can reach every bucket of the project, so they are kept like a database password. |
| path style | Supabase needs path-style addressing (`forcePathStyle: true` in s3.ts) |

Moving the existing images: copy every object from the current store to `hms-media` with the same keys (an S3-to-S3 copy script, run once, read-only on the old store). Compare the object count and total size before the switch.

## 4. Moving the data from Neon

Done in a short **write freeze** (MJ chooses a quiet time; about 15 to 30 minutes for the current size):

1. **Before the freeze** (no rush): Supabase is set up empty (`setup --hosted`, migrations) and checked; a full trial copy runs into it; the app runs against it on a Vercel *preview* deployment and is smoke-tested. Then that trial data is dropped and the schemas are made again.
2. **Freeze:** MJ turns on a maintenance note for staff. The cron jobs (mail, Pathik, daily summary, backup) are paused by removing `CRON_SECRET` on Vercel for the freeze; no new sign-ins.
3. **Dump from Neon** (direct connection, as the owner): `pg_dump --format=custom --no-owner --no-privileges --schema=platform --schema='hotel_*'` (data and schema; or data-only into the migrated Supabase schema, the safer choice, since roles and grants are then Supabase's own).
4. **Restore into Supabase:** `pg_restore --data-only --disable-triggers` as `hms_owner` (direct), schema by schema; then `syncHotelGrants` for every hotel schema (as `migrate` does).
5. **Verify** (a script prints only numbers): for every table in `platform` and every hotel schema, the row counts match Neon; the newest `schema_migrations` version per schema matches; the sequence-free uuidv7 keys need no sequence reset. Check a few money totals (bills, advances) per hotel.
6. **Switch:** MJ enters the new values on Vercel (section 5) and redeploys. Smoke test: sign-in, one hotel's dashboard and bills, one guest-portal page, an image, a test mail.
7. **Unfreeze:** put `CRON_SECRET` back and remove the maintenance note.

**Rollback** (any time within the first days): put the Neon values back on Vercel and redeploy. Neon is not touched during the move and stays as it was at the freeze. Data written on Supabase after the switch would need copying back (the same dump/restore, the other way), so a rollback is simplest in the first hours. Neon is kept, not deleted, for at least two weeks.

## 5. Vercel environment changes (MJ enters them himself, never in chat)

| Name | New value (where to find it) |
|---|---|
| `DATABASE_URL` | `hms_app` on the Supabase **transaction pooler** (Settings > Database > Connection pooling, port 6543); the password comes from the setup's git-ignored file |
| `DB_POOL_MAX` | 3 |
| `MEDIA_DRIVER` | `s3` (unchanged if already s3) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | as in section 3 |
| everything else (`HMS_HASH_KEY`, `HMS_SECRET_KEY`, `SMTP_*`, `CRON_SECRET`, …) | **unchanged**. `HMS_HASH_KEY` and `HMS_SECRET_KEY` must stay the same, or every saved password vault and keyed hash stops working. |

## 6. Switch-over checklist

- [ ] Check script run against the EMPTY Supabase project: version, roles, extensions, pooler, storage all OK (section 7).
- [ ] Shim / `--database` additions committed if the check needs them; tests green.
- [ ] `setup --hosted` + `migrate` on Supabase (direct connection); `create-hotel` not needed (the hotels come with the data).
- [ ] Trial copy + preview deployment smoke-tested; trial data dropped.
- [ ] Images copied to `hms-media`; counts match.
- [ ] Freeze → dump → restore → verify counts → Vercel env → redeploy → smoke test → unfreeze.
- [ ] First day: watch Vercel errors and Supabase's database load; keep Neon untouched.
- [ ] After two quiet weeks: MJ decides whether to stop the Neon project.

## 7. The read-only check script

`db/scripts/supabase-check.ts` reads `_local/secrets/supabase.env` (git-ignored; MJ fills it himself) and **prints no value**, only yes/no and numbers:

- server version (and whether `uuidv7()` exists);
- the connecting role's attributes (super, createrole, createdb, replication, bypassrls);
- whether `citext` and `pg_trgm` are available, and which extensions are already installed;
- direct, session pooler, transaction pooler: each connects; a parameterised query works on the transaction pooler; `SET LOCAL ROLE` (its own role) and `set_config(…, true)` inside a transaction do not leak into the next one;
- whether the pooler reaches a database other than `postgres` (only by connecting, no CREATE);
- storage (only with `--storage`): one tiny object is written to the private bucket, read back, compared and deleted, and an anonymous read of it is refused.

It changes nothing on the database (it rolls back its test transaction) and touches nothing on Neon or Vercel.
