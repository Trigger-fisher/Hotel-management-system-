# Full-scope check: results (plan: docs/plans/FULL-CHECK-PLAN.md). Each owner writes their own section.

## Backend

### Phase 1: machine checks (12 Oct 2026, on the test database `hms_test`; the dev database `hms` part waits for approval A)

| Command | Result | Failures |
|---|---|---|
| `npm run test:server` | 1,625 tests, 1,604 pass, 21 skipped (the MySQL-only placeholders), 0 fail | none |
| `npm run test:db` (alone, one run) | 270 tests, 270 pass | none |
| `npx tsc --noEmit` (whole project, 3 GB heap) | exit 0 | none |
| `npm run lint` (eslint + db scripts) | 0 errors, 6 warnings, all in files of other owners or test-only | none to fix in backend code |
| `npm run lint:sql` | no violations | none |
| `npm run seeds:check` | seeds, hotel seeds and permission catalogue up to date | none |
| Migrations on a FRESH database (`reset-test`, `migrate --test`, `seed --test`) | platform 0000-0112 and hotel 0000-0020 apply cleanly | none |
| Second `migrate --test` | "0 pending, 21 applied": a no-op | none |
| Migrations on the existing dev database `hms` | NOT RUN: `hms` still has the empty old `platform.hotel_setup` and a recorded 0110 with the old checksum, so `migrate` stops (by design) until approval A | waits for MJ |

### Phase 2: review (route families), what is done so far

Automated scans over `src/app/api/v1` and `src/server` (read-only):

| Scan | Finding |
|---|---|
| Write routes (`POST/PUT/PATCH/DELETE`) without a body schema | 95 routes, all of them actions with no input (delete, restore, purge, toggle, unlock, approve, exit, unlink, cancel, resend). Nothing to fix. |
| Every route declares a permission (`part`, `session` + service check, or public) | Read from source by `tests/server/security.hotel.test.ts` for all hotel routes and by the platform and group inventories: complete. |
| Anonymous 401, no grant / too-low level 403, guest and company never reach staff routes, foreign hotel never 5xx | Covered for every non-platform route file by `security.hotel.test.ts`; platform by `platform.superadmin.test.ts`; group by `group.console.test.ts`. One gap found and fixed earlier (`GET /search` answered a guest). |
| SQL built by string in `repos/postgres` | Every `${...}` is an identifier or fragment from a code constant (column lists, whitelisted sort column and direction, state fragments); all values are `$n` parameters. No injection path found. |
| `console.*` in server code | One place: the development log mail driver (prints a sign-in code; never used in production, `mailSenderFor` returns nothing without SMTP). |
| Empty `catch {}`, `@ts-ignore`, TODO/FIXME | none (one intended eslint-disable in `compose/mail.ts`). |
| Secrets in log calls | none. |

Still to do in Phase 2 (read each family once and write file:line findings): validation depth per body, audit rows for every change in hotel modules, idempotency on creates, rate limits, migration safety on live data, error sentences. These are read after the dev database is migrated, so that the live behaviour can be checked too.

### Findings and fixes so far (already fixed and pushed)

| # | Finding | Fix |
|---|---|---|
| 1 | `GET /search` answered a guest or company account with an empty 200 | 403 (`searchService`) |
| 2 | A catalogue repo test assertion was commented out by a stray character and never ran | repaired, runs |
| 3 | Sign-in would break on a database without the `hotel_setup` columns or on the old sessions shape | reads and inserts tolerate both shapes |
| 4 | My Profile 500 for a person without a hotel | profile read, edit, audit work without a hotel |
| 5 | Lint warnings in backend files | fixed |

### Later (needs MJ): keys and decisions

SMTP keys for one real test mail, Razorpay keys (payment link, webhook), Google keys (reviews, Drive backup), the public website, ID and bank masking inside visits, backups source, hosting.

### Percent so far

Phase 1: 90% (the dev-database migration check waits for approval A). Phase 2: 40%. Phase 3: 0%. Phase 4: 0%.

## Frontend 2

### Phase 1: machine checks
| Command | Result | Failures |
|---|---|---|
| `npx eslint src/dashboards src/components src/lib src/app` (web-app) | exit 0 | none (ui-shared is outside ESLint's base path by project config; it is type-checked by tsc below) |
| `npx tsc --noEmit -p . --incremental false` (whole project: web-app, ui-shared, adapters, tests) | exit 0 | none |
| root tests `node --test tests/*.test.ts` | 83 of 83 pass | none |
| docs dead-reference check of `docs/UI.md`, `docs/BACKEND.md`, `docs/PROJECT-STATE.md`, `README.md` (backticked file names resolved against the repo) | 0 real dead links | the unresolved names are the deleted documents the docs name on purpose (COMPONENTS.md, PALLAV-MARKUP.md, DATABASE.md, API.md, SECURITY.md, ENVIRONMENT.md, ERROR_HANDLING.md, TESTING.md, MODULE-PATTERN.md), Pallav's own `pms-money.js`, `proxy.ts` (a Next 16 name, "not used by HMS"), `db/schema-part-1..3.sql` (untracked, listed in housekeeping) and a migration filename pattern |

### Phase 2: review of payroll, companies pieces, reports, website, guest and corporate portals, public onboarding pages
Method: mock-mode headless Chrome sweeps (390 px and 1280 px, day and night) over every menu entry of the hotel admin, Super Admin, guest, corporate, Platform Admin and Group admin logins; the four public onboarding states (open, group, expired, invalid); a Tab-key walk; static scans of every screen file. Real-mode live testing belongs to Frontend 1 (HOTEL-REAL-WIRING.md).

| # | Finding | Where | Severity | Status |
|---|---|---|---|---|
| 1 | Website form labels not linked to their controls | website Content, Settings, Rates, Calendar, Lists, Enquiries, Gallery, InviteForm | a11y | fixed (e141563, 38dc6f9, 736891f) |
| 2 | White text on night's light violet (2.7:1): open tab, filter pill, count bubble, website tab, CRM dot, guest period pill | `public/pallav/hms-overrides.css` | contrast | fixed (db93574, f42d422) |
| 3 | Daily Report amounts 3:1 at night | `.dr-table .c-amt`, `.dr-glance` | contrast | fixed |
| 4 | Clickable table rows reachable by mouse only | guest Bills, corporate Bills and Ledger, platform Groups, payroll Companies | keyboard | fixed (3cdc4ae) |
| 5 | "Sunrise Foods" hard-coded in the Daily Report food-plan line, the attendance-marks hint and the meals-company fallback | overview/DailyReportScreen.tsx, payrollCore/Statuses.tsx, payrollPay/shared.tsx | wrong names in real mode | fixed (8acdcbe) |
| 6 | Lead activity "Log it" could be double-submitted | companies/LeadScreen.tsx | bug | fixed (8acdcbe) |
| 7 | Guest order did not show the server's `payWith` refusal sentence | guest/Order.tsx | bug | fixed (7a8c80c) |
| 8 | Enquiry confirm/decline gave no sign when the guest was not mailed | website/Enquiries.tsx | missing state | fixed (7a8c80c) |
| 9 | No page-wide sideways scroll at 390 px on any entry; the four public onboarding states are clean at 390/1280, day/night | all | - | pass |
| 10 | Not mine, sent to Frontend 1: System Health 3 px sideways scroll at 390 px; Razorpay search boxes and System/Force Log From/To date boxes have no accessible name; role pills and System Health buttons low contrast at night | admin | minor | reported |
| 11 | Night link colour and Front Desk "Due out" below 4.5:1 | Pallav sheets | minor | fixed by Frontend 1 (00396f1), re-measured: pass. Left: `.text-danger` small text ("due 10 Oct") 4.1:1 at night, Front Desk |

### Phase 3: fix round
All items above marked fixed are pushed. Items 10 and 11 are the only open ones (other owner / theme-wide).

### Phase 4: audit re-run
`docs/sessions/audits/AUDIT-2026-10-11.md` (new section at the top) and `pm-dashboard/data/modules.json`: Database 96, Server 96, Screens 98, Wiring 79, mean 92 (first run: 79).

