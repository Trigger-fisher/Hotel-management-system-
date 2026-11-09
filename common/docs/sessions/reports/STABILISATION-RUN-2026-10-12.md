# Final stabilisation run (R40, decision 56): the exact commands, prepared 12 Oct 2026 (nothing was run)

Run ONCE, after the Guest and Company sessions have finished. All commands from `D:\Hotel Management System\web-app` in PowerShell. Machine: 8 GB RAM, so never run two suites at the same time and close the dev server first. No agents (decision 50); do not commit while a suite runs.

## Before
1. `git status` : nothing half-edited by another session.
2. One type-check: `$env:NODE_OPTIONS="--max-old-space-size=3072"; npx tsc --noEmit -p . --incremental --tsBuildInfoFile "$env:TEMP\hms-web.tsbuildinfo"`. Expected: no error except stale `.next/types` or `.next/dev/types` lines for routes deleted this week; delete the `web-app\.next` folder first to get a clean answer.
3. Lint: `npm run lint` (ESLint + the db scripts) and `npm run lint:sql`. Expected: no errors; `lint:sql` says "SQL lint: no violations" (checked 12 Oct after the 0116 exemption in `db/scripts/lint-sql.ts`).
4. The test database is `hms_test` (PG_TEST_OWNER_URL in `db/.env.local`); it is migrated through platform 0117. `npm run db:cli -- migrate --test` must say nothing pending. NEVER point the DB suite at the dev database `hms`.

## Suite 1: client tests (light, about 1 minute)
`node --test tests/*.test.ts` : 12 files. Last run 12 Oct: 172 tests, 172 pass, 0 fail.

## Suite 2: server tests (no database, about 98 files, several minutes)
`npm run test:server`
Last full record: 11 Oct, 1,740 tests: 1,719 pass, 0 fail, 21 skipped (docs/sessions/audits/AUDIT-2026-10-11c.md). The count today is different (Add member, Employee portal, company team and booking, and old company routes tests were removed; website public, sign-in entry hotel and enquiry mail tests were added), so judge by "0 fail", not by the total. The 21 skips are the known skipped ones. Partial runs on 12 Oct (all green): platform/role 119, portal 46, corporate 9, website.public 12, auth 71, security.hotel and layers 422 in one run.

## Suite 3: database tests (real PostgreSQL, run ALONE, needs about 1 GB free, can take 10+ minutes)
`npm run test:db`
(`--test-concurrency=1 --test-timeout=600000`, `tests/db/*.test.ts`, 34 files). Last green run: 299/299 on a throwaway PostgreSQL 18 (commit d669bfe); 270 on 11 Oct. Today's removals (guest_id_scans repo tests) lower it a little. The helper takes a lock on the test database, so a second run waits.
If it fails with `users_admin_code_required` or a missing table, the test database is behind: `npm run db:cli -- migrate --test`.

## Suite 4: Pathik worker (separate)
`cd ..\pathik\worker; npm run typecheck; npm test` : last record 119/119 (commit d669bfe). Moved to `pathik/worker` on 12 Oct; the type-check was clean after the move.

## After
Report in a table: suite, tests, pass, fail, skipped, the first failing test name with its file, and who owns it (never fix another session's code during the run). Then one `git status` and tell the Project Manager.