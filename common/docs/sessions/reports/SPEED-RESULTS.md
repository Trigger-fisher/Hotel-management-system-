# Speed results

## Frontend 1 (UI): S1 static measurements, production build (12 Oct 2026, commit 2eb7a5b, Turbopack, no demo flag)

| Measure | Value | Budget |
|---|---|---|
| All client JS chunks together | 3862 KB raw, 1173 KB gzip (63 files) | none |
| Sign-in page JS (framework/main 127 KB gz + page chunks 74 KB gz) | about 201 KB gzip | under 250 KB gz: met |
| Largest chunks | 244 KB raw (54 gz), 229 raw (72 gz, framework), 216 raw (62 gz), 213 raw (62 gz), 200 raw (60 gz) | none |
| Console shell (signed in) | NOT measured yet | under 450 KB gz |
| Page change time per console, LCP, first sign-in load | NOT measured yet | 150 ms cached / 400 ms with a server call; sign-in under 1.5 s |

Why the runtime numbers are missing: a production server (`next start`) refuses to start with the dev settings (HMS_PUBLIC_URL required, MAIL_DRIVER must be smtp, no HMS_DEV_RELAX_LIMITS), and without a readable mail sink the two-step sign-in code cannot be read. Needed from Backend: how :3020 is started (env) and where its sign-in codes can be read. Until then the S1 runtime table, S2 fixes and S4 before/after are open.

### Frontend 1: S1 runtime, production server :3020 (Backend's HEAD build, real DB, small data), 12 Oct 2026

Probe: headless Chrome, hotel admin ui.super, 26 sidebar entries, 3 clicks each, "ready" = no skeleton/spinner on screen and no fetch/script/XHR in flight for 120 ms (the PM's 300 ms and a main-region-has-content test are still to add).

| Measure | Run 1 (looser probe) | Run 2 (network-idle probe) | Budget |
|---|---|---|---|
| Sign-in page, cold load to form | 954 / 343 / 386 ms | 1005 / 3151 / 3826 ms (server busy with other work during runs 2 and 3) | under 1.5 s |
| Sign-in JS transferred | 240 KB (encoded) | 240 KB | 250 KB gz |
| Code accepted to dashboard ready | 453 ms | 668 ms | none |
| Page change, median of the 26 medians | 39 ms | 38 ms | 150 ms cached / 400 ms with a server call |
| Slowest page change | Daily Report 51 ms | Guest Advances 222 ms (single clicks up to 368 ms: Rooms) | same |
| Pages over 400 ms (median) | none | none | |

Reading: with the small demo data nothing is near the budget. System Health and System Log read 0 ms (their content did not start a request in the window; to recheck). LCP is not reported by this probe yet (PerformanceObserver to add). The sign-in cold-load spread (343 ms to 3.8 s) is the server, not the bundle: the same 240 KB each run. The real test is volume ("Perf Test Hotel" from Backend); S2 fixes follow from that.

## Backend: B1 to B3, server time per route (11 Oct 2026)

**How:** a production build (`next build` + `next start`, NODE_ENV=production) against the real dev database, on the volume hotel `PERF-Test Hotel` (`npm run db:cli -- perf-hotel create`: 2,000 bills, 1,500 advances, about 3,150 company ledger lines, 3,000 cash entries, 600 enquiries, 800 customers, 20 companies, 400 staff with 12 months of attendance (146,000 day rows) and 4,800 salary months). Load: `node web-app/scripts/load.mjs <url> --cookies <file> --users N --seconds S`, reads only, a hotel admin on 43 list, detail, dashboard and report routes. Server time is the new `Server-Timing: app;dur=..., auth;dur=...` header on every answer (an answer over 500 ms is also logged as `slow request`). Times in ms, p50 / p95. Two loads: 1 user (pure server time) and 20 users firing with no pause (worst case, far above a hotel's real traffic). The PC was shared with about 60 other Node processes from the other sessions, so the 20-user numbers are pessimistic.

**What was slow and why (profile + EXPLAIN):**
1. The shared row reader turned every field name into a column name with a regex on every row (50 fields x 400 staff = 20,000 replaces per request). It now works the names out once per field list.
2. Finding the session took 6 database reads on every request. Now 3 (user plus membership in one read; the role ladder and its grants in one read).
3. The cash lists (expenses, deposits) read the lines of every expense on every call and added up the four numbers on top in 12 to 16 small queries. They now read lines only for the 25 rows shown (when there is no search text; the search still sees every line) and the totals in one query per book.
4. Attendance month: counting each status's use joined all 146,000 entries (47 ms). It now counts from the index (17 ms).
5. Database connections closed after 30 s idle; the first request after a quiet spell paid about 80 ms to open one. Now 4 stay warm for 10 minutes.

| Route (`/api/v1`) | 1 user before | 1 user after | 20 users before | 20 users after | KB |
|---|---|---|---|---|---|
| /payroll/companies/{id}/attendance/{month} | 70 / 149 | 13 / 21 | 468 / 1323 | 117 / 156 | 35 |
| /expense/entries | 37 / 73 | 15 / 28 | 583 / 865 | 171 / 260 | 21 |
| /payroll/companies/{id}/dashboard | 13 / 24 | 9 / 16 | 374 / 661 | 142 / 217 | 2 |
| /reports/daily | 39 / 81 | 32 / 49 | 334 / 642 | 125 / 167 | 0 |
| /revenue/deposits | 27 / 53 | 20 / 27 | 353 / 612 | 123 / 184 | 9 |
| /billing/advances | 12 / 22 | 10 / 16 | 278 / 535 | 108 / 167 | 15 |
| /billing/bills | 18 / 38 | 14 / 18 | 283 / 526 | 107 / 156 | 22 |
| /overview/dashboard | 24 / 39 | 17 / 32 | 279 / 513 | 107 / 171 | 5 |
| /auth/session | 6 / 14 | 5 / 10 | 250 / 470 | 92 / 139 | 0 |
| /payroll/companies/{id}/payments | 36 / 56 | 14 / 26 | 245 / 456 | 86 / 129 | 351 |
| /companies/ledger | 16 / 28 | 12 / 21 | 195 / 453 | 73 / 108 | 12 |
| /payroll/companies/{id}/staff | 18 / 48 | 8 / 14 | 196 / 382 | 71 / 106 | 160 |
| /search?q=ra | 33 / 64 | 5 / 35 | 118 / 389 | 37 / 141 | 2 |
| every other route measured (21) | 3 to 8 / 4 to 17 | 3 to 5 / 4 to 9 | 123 to 202 / 343 to 476 | 50 to 85 / 77 to 128 | |

Throughput at 20 users: 91 requests/s before, 284 after (3.1x).

**Against the budget (reads p95 under 150 ms):** with 1 user every route is inside it (slowest p95: the daily report, 49 ms). Under 20 users with no pause, 7 routes are still a little over (156 to 260 ms). That load is about 280 requests a second, many times what a hotel's staff produce, and the time is the single Node thread queueing on a shared PC. Writes were not loaded here (the load script reads only); single writes in the console checks answered well under 300 ms.

**Left, with the reason:**
- Answer sizes: `/payroll/companies/{id}/payments` (351 KB, every person of the month, as Pallav's screen) and the pay-screen staff picker `/staff` (160 KB, full staff rows) are big. A lean picker shape and a paged payments list are contract changes, to agree with Frontend.
- Compression: not done in Node on purpose (it would use the one thread that answers requests). The reverse proxy compresses: `docs/deploy/DEPLOY-VPS.md` now says how (Caddy `encode zstd gzip`, nginx `gzip_types application/json`); hosted platforms compress by themselves. 351 KB becomes about 30 KB.
- Caching of GET answers: kept `no-store`. They are a signed-in person's hotel data, and a shared front-desk PC must not keep them on disk. ETag and revalidation would save transfer but not server time.
- The cash lists still read every row of the window into memory, because Pallav's search runs over text built in code (the recorder's name, amount in words); moving it into SQL is a parity risk. At 1,000 entries a book it costs about 15 ms.

## Frontend 2: payroll and website screens (12 Oct 2026, commit cc05ec7)

What changed (my screens; numbers marked "est." are sizes Backend measured on the PERF hotel of 400 staff, not yet re-measured in the browser):
| Screen | Before | After | Status |
|---|---|---|---|
| Salary Payments (/payroll/companies/{id}/payments) | the whole month in one answer, filtered, sorted and paged in the browser (351 KB est.) | the server returns one page (25 rows by default) with status, search and order applied before paging; the KPIs and tab counts still come from the whole-month summary; search is debounced 250 ms; ticked rows survive page changes (about 20 KB est.) | pushed; tested in mock mode in the browser (search, sort both ways, status tab, rows per page) |
| Joining Letter picker (/payroll/companies/{id}/staff/lookup) | every pay row of every active person (160 KB est.) | a type-ahead on name or code, 50 at most (a few KB est.); the chosen person stays in the list while the search changes | pushed; mock mode tested |
| "All pages" lists (staff, slips, advances, bonus, resignations, platform lists) | one page after the other | the first answer says the total, the other pages are asked together, 6 at a time (already in getEveryPage) | in place |
| Website gallery and icon images | lazy loading already on the gallery pictures | decoding="async" added to gallery pictures and icons | pushed |
| Group chunks | one chunk per group (payroll has 20 screens in one) | unchanged; split per screen only if the production build shows the payroll chunk is the slowest to open | to measure on the production build |

Not done on my side: photo resizing (the server serves the original upload, up to 12 MB: Backend or an image step must make thumbnails), server-side paging for Slips, Advances, Bonus and Resignations (their screens still ask 1000 to 5000 rows and filter in the browser; they need the same status/search/sort/page parameters as Salary Payments), a production-build measurement of screen open time (waits for the mock split build).

### Backend: writes (B2/B3, 11 Oct 2026)

`node web-app/scripts/load-writes.mjs <url> --cookie <file> --users N --seconds S` on the PERF hotel (it CHANGES data: throwaway hotel only). Each user picks at random: bill create (every 5th with an Idempotency-Key, sent twice), advance create, a salary payment marked Paid or Processing with its version, attendance saved for 5 staff of the current month. Server time, ms, p50 / p95.

| Write | 1 user | 10 users, before | 10 users, after |
|---|---|---|---|
| Bill create | 8 / 12 | 13 / 26 | 30 / 53 |
| Bill create with Idempotency-Key (same key again = replay) | 8 / 12 (4 / 6) | 14 / 27 (5 / 10) | 30 / 52 (10 / 19) |
| Advance create | 7 / 11 | 12 / 26 | 29 / 55 |
| Salary payment marked | 8 / 12 | 13 / 25 | 29 / 50 |
| Attendance save, 5 staff | 25 / 37 | 205 / **340** | 69 / 122 |

The fix: the attendance save locked the month row and rebuilt the whole sheet for its answer while still holding the lock, so 10 clerks on one month queued behind each other. The lock now covers only the write; the sheet is read after the commit. The other writes rose a little "after" because the server finished about 45% more writes in the same minute (12,800 against 8,800).

Correctness under load: 0 deadlocks and 0 server errors in the log; every Idempotency-Key replay returned the first answer (646 of 646); payment conflicts (two clerks on one row) were refused with 409 and the current version, as designed; after about 4,600 bills and 4,200 advances, no duplicate entry number, bill number or receipt number. Every write is inside the 300 ms budget at 10 users.

**Check-in and check-out (11 Oct 2026, production build, perf.backend as Hotel SuperAdmin in the PERF hotel).** Server time, ms, p50 / p95 / max.

| Write | 1 user, 30 s | 10 users, 45 s |
|---|---|---|
| check-in | 13 / 20 / 84 (219 done) | 47 / 82 / 302 (923 done) |
| check-out with bill | 18 / 28 / 35 (219 done) | 99 / 192 / 461 (922 done) |

Both are inside the 300 ms write budget at p95 (0 of 8 write kinds over it in both runs); idempotent replays right 182 of 182, wrong 0. One check-in in 4,000 answered 500 at 10 users: the local PostgreSQL ran out of connection slots (several dev servers, test runs and this load share one small local instance), not a code fault; with the pooled-connection settings (DB_POOL_MAX) a real server stays under its limit. The build measured is the one from before the Pathik privacy commit; Pathik is off in the PERF hotel (not a Gujarat hotel), so check-in does no Pathik work there.

### Frontend 1: volume hotel (PERF-Test Hotel: 2,000 bills, 1,500 advances, 800 customers, 3,000 cash entries, 600 enquiries, 400 staff), production build of main on :3079 (12 Oct 2026)

Probe ui90 (headless Chrome, perf.admin, click to network idle + no skeleton, 3 clicks each, median of medians). Before = Backend's :3020 build earlier the same day (getEveryPage fetched the 100-row pages one after the other); after = my build with parallel pages (commit 5f8b967).

| Page change | Before | After | Budget (150 cached / 400 with a server call) |
|---|---|---|---|
| Customers (800 rows) | 831 ms (first 831, up to 1053) | 148 ms median (first 272) | met |
| Bills (2,000) | 233 ms | 130 ms | met |
| Revenue / Expenses | 267 / 383 ms | 156 / 96 ms | met |
| Dashboard | 330 ms | 85 ms | met |
| Payroll (400 staff) | 348 ms | 78 ms (first 221) | met |
| Company Profiles / Ledger | 271 / 140 ms | 36 / 64 ms | met |
| Food Plan Report | 156 ms | 162 ms | met |
| Daily Report | 211 ms (small hotel) | 876 to 1213 ms (first 876) | NOT MET: the server answers /reports/daily in 270 to 540 ms (first call 1143 ms) for this data, 7 KB; the rest is the page: for Backend (B-side) and then the screen |
| Median of all 26 pages | 195 ms | 77 ms | met |

Sign-in page: JS 239 KB transferred (budget 250), cold load to the form 366 ms median (first run 1.3 s with a cold server), LCP not measured. Code accepted to dashboard ready: 995 ms. Not measured yet: search and filter timing on the volume lists (d7's measure-ui-speed.mjs run), PDFs.

## Daily Report (GET /api/v1/reports/daily): query and service tuning (Web UI 1, 11 Oct 2026)

**How:** the real service and the real PostgreSQL repository, called in a script (no HTTP, no sign-in) on a THROWAWAY Postgres (own data folder, own port), on the PERF-Test Hotel, then the same hotel with its bills and advances copied to 10x (20,000 bills, 15,000 advances; the PERF bills given a stay and a plan so the food-plan part runs). 21 calls per date, same process; "warm" = calls 2 to 21, median and p95; "first" = call 1 (new connection and a cold plan). Two rounds, old and new code alternating. The dev database was not touched.

**Cause (measured):** the opening of the day is worked out from the whole history on every call: the cash lines of every day before it (a UNION of 22 selects that built every text column of every line only to add up four numbers), the stay bills of every bill since 2000 (read twice, once for the opening and once for the night) and each night of each stay priced by looping the rate table. The cost grows with the hotel's history: about 40 ms at 2,000 bills, 135 to 270 ms (p95 up to 490) at 20,000.

| Date (20,000 bills) | Before: first / warm median / p95 | After: first / warm median / p95 |
|---|---|---|
| 11 Oct 2026 | 397 / 254 / 301 and 315 / 269 / 490 | 126 / 42 / 53 and 123 / 45 / 54 |
| 15 Jun 2026 | 257 / 226 / 244 and 361 / 262 / 367 | 63 / 49 / 59 and 54 / 47 / 58 |
| 1 Mar 2026 | 128 / 135 / 184 and 152 / 161 / 211 | 37 / 41 / 43 and 36 / 38 / 44 |
At 2,000 bills it was already about 40 ms and stays so. The answers are identical: the JSON of 49 different dates (with and without bills, 1999 and 2000 edge days, a leap day) has the same hash before and after, and the real-database repo test (opening equals the sum of the lines) and the server tests pass.

**What changed** (nothing a person sees): (1) `repos/postgres/reports.ts` `cashNetBefore` is one statement that reads each table once and adds in place (no company join, no notes), the same lines and conditions as the day sheet; (2) the day sheet reads the plan rates and the stay bills once for both the opening and the night, each part given exactly the bills its own window would have found; (3) `stayBills` takes `mealPlans`, so a bill with no stay parts whose own plan has no price is not read at all (it is worth no meals on any night); (4) `foodPlanMath` remembers the price of a (plan, night) and the next day of a date (thousands of nights share a few hundred pairs); (5) hotel migration `0024_daily_report_debit_slot_indexes.sql`: partial indexes on the four other debit-recovery dates (only the first had one, so the day sheet read the whole bills table eight times per call; day lines 6.4 to 1.4 ms in EXPLAIN). The migration is NOT applied to the dev database: Backend runs `npm run db:cli -- migrate` and `migrate --test` when MJ allows.
**Left, with the reason:** the opening is still worked out from the history on each call (now far cheaper per bill); a hotel with ten times more bills than this would again approach 150 ms. The real fix for that is a stored running opening per day (changes every write path of cash, billing and the stay), a Backend decision. The first call after an idle connection still pays about 36 to 126 ms (connection and plan).

### Frontend 1: global search on the volume hotel, production build :3079 (DB_POOL_MAX=3), perf.admin, 8 s after sign-in, 3 runs each (12 Oct 2026)

Script ui94 (headless Chrome): open the search, type the word, time to the first result row and until the "N results" live region appears (server groups settled).

| Word | First row (median) | Settled (median) | Rows | Budget 400 ms with a server call |
|---|---|---|---|---|
| Bill (matches screens by name) | 13 ms (from the menu, no request) | 439 ms | 2 | just over |
| Co | 7 ms | 320 ms | 37 | met |
| PERF (no screen matches; hotel data only) | 440 ms | 441 ms | 40 | just over |

Reading: the screen names answer at once from the menu; the server groups take 320 to 440 ms on 10,000 bills / 8,400 advances: two of three words are slightly over the 400 ms budget. For Backend: the search route time on this data (the page adds about 30 to 60 ms). Daily Report re-measure after migration 0024: pending Backend.

### Frontend 1: Daily Report after migration 0024 and d7's query tuning (12 Oct 2026)

Production build, perf hotel: page change 1198 / 1168 / 1072 ms (before: 876 to 1213): not improved on the page. API for other days: 160 to 360 ms. Cause found with the network list: GET /reports/daily?date=<today> answers 4,573 KB in about 3.4 s on this data (the dev server asks twice because of React StrictMode); other dates answer about 7 KB. Needs a smaller answer for a busy day (cap or paging): with Backend. Food Plan Report 127 ms.

## Global search

### Backend: GET /api/v1/search server time on the volume hotel (12 Oct 2026, uncommitted, for the lead's review)

**How:** the real search service (`services/admin/searchService.ts`) over the real PostgreSQL repositories and the real `withHotel` transaction, called in a script on the LOCAL dev database (hms_app login, 2 connections), on `PERF-Test Hotel` as it is now (10,182 bills, 8,420 advances, 20 companies, 800 customers, 400 staff in 2 payroll companies, 1,141 stays, 600 enquiries, 0 reservations), a session holding view on every module. Per word: 3 warm-up calls, then 20 timed calls; p50 / p95 in ms. Each SQL statement was timed too. No HTTP and no Next.js in the number: the page and the route add their own time (Frontend 1 measured about 30 to 60 ms for the page); Frontend 1 should re-run ui94 on a production build for the end-to-end figure. The same PC was shared with the dev servers and other sessions.

**Cause (measured, then EXPLAIN ANALYZE):**
1. Every source ran its screen's list query, which is TWO queries: `COUNT(*)` of every match, then the page. The search never shows a total. On bills and advances each of the two read every row of the table and built the search text per row (about 14 ms raw per pass on bills): 4 full passes per search, 70 to 80% of the time. 21 statements per search in all.
2. The bill and advance search text was ONE expression per row: `concat_ws(' ', own columns..., COALESCE(c.name, 'walk-in'), modes, to_char(amount))`, so every row paid for the company join and the money formatting (`to_char` alone was about 40% of the per-row cost: count 13.9 ms, without it 8.9 ms), whatever the word.
3. The newest-first order (`bill_date DESC, entry_no DESC`) had only a `bill_date` index: every row of the newest day was read and sorted before the first 8 came out. On this hotel the load test made about 8,000 bills on one day, so a common word ("PERF") read 8,175 rows to return 8.

**What changed (results identical):**
1. `repos/types.ts` `Page.countTotal?: boolean`: `false` = the page only, the list skips its COUNT and reports `total: -1` (`repos/postgres/shared.ts` `countTotal`, used by the bill, advance, company, customer, staff, reservation, stay and enquiry lists). The search asks every source with `countTotal: false`. Screens are unchanged (they leave it out and still get their total). 21 statements per search became 10 or 11.
2. `repos/postgres/shared.ts` `companyWordsCondition`, used by `billWhere` / `advanceWhere` (so both list screens and their state counts too): per word, the row's own columns OR `company_id = ANY(ARRAY(SELECT id FROM company_profiles WHERE name holds the word))` (looked up once, no per-row join; the binned companies count, as the old join did) OR `company_id IS NULL` only when "walk-in" holds the word OR the amount only when the word could be part of a figure (digits, `.`, `-`, `#`). A word has no space, so it can only match inside one part, never across the ' ' between them: the rows found are exactly the old ones. A word that is empty or holds a space falls back to the old expression.
3. Hotel migration `0025_search_date_order_indexes.sql`: `(bill_date DESC, entry_no DESC)` and `(payment_date DESC, entry_no DESC)` WHERE `deleted_at IS NULL`. A common word now stops after 8 rows (bills 12 ms raw to 0.1 ms). Applied to the local dev database (dry run listed exactly 0025 for the 7 hotels) and to hms_test.

| Word | Before p50 / p95 | After p50 / p95 (run 1, run 2) | Statements before / after | Hits (same before and after) |
|---|---|---|---|---|
| Bill | 119 / 148 | 26 / 48, 20 / 22 | 21 / 11 | 0 |
| Co | 128 / 252 | 20 / 21, 18 / 19 | 19 / 10 | 32 (8 bills, 8 advances, 8 companies, 8 staff) |
| PERF | 148 / 202 | 7 / 7, 7 / 7 | 19 / 10 | 50 (8 of each source, 2 enquiries) |
| ra | 172 / 273 | 22 / 23, 20 / 21 | 21 / 11 | 16 |
| zzqx (no match anywhere) | 161 / 197 | 21 / 24, 20 / 24 | 21 / 11 | 0 |

Per statement (p50, before, through the app): bills count 22 to 32 + page 34 to 51 ms, advances count 16 to 27 + page 22 to 36 ms; after: bills page 0.7 ms for a common word, 8 to 10 ms for a rare one (every row is still read once), advances 0.5 / 6 to 8 ms. Every other source is 0.2 to 1.7 ms a statement.

**Tried and left out, with the reason:** a pg_trgm GIN index on the bills' own text (`lower(coalesce(..) || ' ' || ..)`, the expression must be immutable, so `concat_ws` and `to_char` cannot be in it). EXPLAIN ANALYZE on this data (in a rolled-back transaction): the planner walked the date index for rare words (where the trigram index would win) and took the bitmap for common ones, which made "guest" slower (12 ms to 22 to 43 ms), even with the company ids resolved beforehand. It is also no help for two-letter words. Not worth its write cost on every bill here. A prefix search for 1 or 2 letters would change the results, so it was not done. One UNION query for every source would bypass the screens' own repository searches (the spec says the search uses the same ones). Left: a rare word still reads every bill and advance once (about 10 ms at 10,000 bills); at ten times that, a trigram index with a planner hint or a stored search column is the next step.

**Checks:** parity script on the PERF hotel, about 55 word lists from fixed and sampled words (names, walk-in pieces, `-`, `%`, `_`, `\`, amounts, bill numbers, two words), live and binned, bills and advances: the new list returned exactly the rows and order of the old condition, totals and state counts equal (ALL SAME). Tests: `tests/db/billing.repo.test.ts` new block "the word search of bills and advances ... on a fixed data set" (parity with the old condition for 26 word lists live and binned, pinned results, `countTotal: false`, the 0025 indexes); `tests/server/admin.profile.test.ts` (every source asked with `countTotal: false`). tsc clean; `npm test` 132 + 1753 tests, 0 failed; `npm run test:db` 289 passed, 0 failed.
