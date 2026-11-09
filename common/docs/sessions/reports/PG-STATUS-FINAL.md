# PostgreSQL: final status (Worker A)

Every backend module the web app uses has a real PostgreSQL repository. With `DATABASE_URL` set, compose switches to them; without it the in-memory doubles still run (tests, no-database development).

## The database (127.0.0.1:5433, HMS's own PostgreSQL 18 instance)
- Roles `hms_owner` (CREATEROLE only) and `hms_app` (NOINHERIT; SET member of each hotel role). Databases `hms` (dev, one demo hotel "Hotel Demo", slug `hotel-demo`) and `hms_test`.
- One `platform` schema (users, roles, sessions, auth events, audit, outbox, rate limits, hotels) and one `hotel_<32hex>` schema plus one NOLOGIN role `hotel_<32hex>_rw` per hotel. Role timeouts: statement 15 s, idle-in-transaction 10 s, lock 5 s.
- Migrations: platform 0000–0006, 0099 (grants), 0100 (ui theme), 0101 (users.created_by, sign_in_removals). Hotel 0000–0019 (generated template, then billing/rooms/company unique numbers, payroll case-insensitive uniques, salary version rule, plan rates, website fetch columns, Books removal deletes). Applied files are immutable (checksums).
- DELETE on a hotel table needs a marker in a migration: `-- hard-delete:` (source in Pallav) or `-- hard-delete-grant: <table> (<why>)`; create-hotel and migrate give the hotel role exactly those rights.
- No encryption of data: passwords are Argon2id hashes, codes and identifiers use HMAC with `HMS_HASH_KEY`. `setup` generates every secret (`DATABASE_URL`, `HMS_HASH_KEY` in `web-app/.env.local`; `PGSUPERUSER_URL`, `PG_OWNER_URL`, `PG_TEST_OWNER_URL` in `db/.env.local`). Names only here; values are never printed.

## Repositories on PostgreSQL (`web-app/src/server/repos/postgres/`)
| Module | File | Test file |
|---|---|---|
| Sign-in (users, codes, sessions, outbox, events, audit, rate limits) | `auth.ts`, `platformUnit.ts`, `people.ts` | `auth.repo`, `auth.flow` |
| Cash (revenue, expenses, lookups) | `cash.ts`, `entries.ts`, `support.ts` | `cash.repo`, `cash.flow` |
| Billing (bills, advances) | `billing.ts` | `billing.repo` |
| Front office | `frontOffice.ts` (incl. `arrivalsToday`) | `frontOffice.repo` |
| Companies and ledger | `companies.ts` | `companies.repo` |
| Payroll core / pay | `payrollCore.ts`, `payrollPay.ts` | `payrollCore.repo`, `payrollPay.repo` |
| Admin core (settings, plan rates, master lists), platform preferences | `admin.ts`, `adminPlatform.ts` | `admin.repo` |
| Admin users, roles, grants, overrides, sign-in history, audit | `adminUsers.ts` | `adminUsers.repo` |
| Books (accounting years, counts, start-next, remove-newest) | `adminBooks.ts` | `adminBooks.repo` |
| Website | `website.ts` | `website.repo` |
| Reports (day sheet, opening, food plan, dashboard figures) | `reports.ts` | `reports.repo` |
| Combined hotel unit (one transaction over all hotel repos) | `hotel.ts` | used by all |

Compose: `compose/billing.ts` (`billingDefaults()` builds the combined unit for billing, front office, companies, payroll, website, admin core, recycle and reports), `compose/cash.ts`, `compose/auth.ts`, `compose/admin.ts` (users and books), `compose/mail.ts` (the mail worker).

## Behaviour worth knowing
- `withHotel` = BEGIN + `SET LOCAL ROLE` + `search_path`, one statement per query (stacked statements are refused). Case-insensitive uniqueness is `lower()` indexes. Entry numbers: advisory transaction lock, MAX+1.
- Mail worker: sends only rows it claimed (`FOR UPDATE SKIP LOCKED`), so nothing is sent twice. A row left `sending` by a stopped server is closed as failed after ten minutes with its code removed (at-most-once). Development uses the log driver only; there is no production sender yet, so the worker does not start in production.
- Books removal (`removeLatest`): one transaction; gives back what the year did to older records, then deletes everything dated in it; any failure rolls all of it back.
- Test lock: `lockTestDatabase` (`pg_advisory_lock(7777)`) waits at most 8 minutes and a file that hangs is ended after 12, so a failed file cannot hold it.

## Known gaps
- Handover (shift handover) has no service, so it has no repo beyond the Reports reads.
- A recorder's name in Reports is the row's `full_name` snapshot (the hotel schema cannot read `platform.users`); Worker B is adding `userId` so the service can resolve display names.
- `carried.cashPaise` (Books) is null in SQL; the books service computes it from the reports.
- No production mail sender; no SMTP configured.
- Design limit: `hms_app` is a SET member of every hotel role (needed for `SET LOCAL ROLE`); isolation against a stacked-statement injection relies on `withHotel` refusing stacked statements and on parameterised queries.
- Dev data: `demo.admin` (temp password not kept) and `dev.admin` (password in `db/.dev-login.txt`, git-ignored); MJ rotates every secret before production.

## Commands (from `web-app`)
- Start / check / stop: `npm run db:pg -- ensure`, `npm run db:pg -- status`, `npm run db:pg -- stop`
- First run: `npm run db:cli -- setup`, then `npm run db:cli -- migrate` and `npm run db:cli -- seed`
- New hotel: `npm run db:cli -- create-hotel --name "X" --slug x`; new user: `npm run db:cli -- create-user --username u --name "N" --email e --write-file`
- Test database: add `--test` to migrate / seed / create-hotel; `npm run db:cli -- reset-test` empties `hms_test`
- Tests: `npm run test:db` (serial, real instance). One file: `npx tsx --import ./src/server/lib/node-hooks/register.ts --test --test-concurrency=1 tests/db/<file>.test.ts`. Run suites one at a time: they share one test database.
