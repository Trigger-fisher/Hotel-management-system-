# 17 - Parity scoreboard (PARTIAL, saved when the usage limit was reached, 2026-10-06)

Method: same viewport, same day, same S08 fixture data (where mapped), headless Chrome; ours = dev preview `?role=...&data=s08`, reference = live Pallav copy (127.0.0.1:8000, scratch DB). Pixel difference = share of pixels whose colour differs by more than 16/255. Gate = under 1.5%. "Data-only" means our mock differs from Pallav's rows (fixtures not mapped for that screen). Tools: scratchpad `board/` (screens.mjs = all 70 screens with Pallav URL and our click path, ours.mjs, pal.mjs, lib.mjs, compare.py, run.sh). Not finished: the full automated run was started and stopped; the numbers below are from the manual gates already done.

## Measured so far (same data, same day, vs live Pallav)
| Screen | Day 1440 | Night 1440 | Day 390 | Pass (<1.5%) | Top difference (layout/style unless marked data) |
|---|---|---|---|---|---|
| Revenue | 1.3% | 0.9% | 1.4% | day, night, phone | none |
| Shift Handover | 1.4% | 1.1% | 2.2% | day, night | phone: layout of cards |
| Front Desk | 1.7% | 1.3% | 2.0% | night | day: legend/KPI pills spacing |
| Expenses | 1.6% | - | - | none yet | small spacing |
| Rooms | 1.7% | - | - | none yet | small spacing |
| In House | 1.8% | - | - | none yet | small spacing |
| Bills | 3.8% (earlier 1.18%) | 3.5% (earlier 0.94%) | 3.2% | fixes sent: "All N bills" text, sidebar scroll | text + scroll |
| Guest Advances | 3.8% (earlier 1.2%) | 1.01% | 0.54% | same fixes | text + scroll |
| Reservations | 6.7% | - | - | order and "walk_in" label fixed since | list order/label |
| Shell (sidebar region) | 1.34% | 0.97% | - | day, night | brand/user text (identity) |
| Payroll pages with S08 (17 pages, day only) | 0.8-8.4% | - | - | resignations 0.8, period 1.1 | staff order, titles, log filter bar (fixes sent, Web UI 2 says done) |
| Company Profiles/Customers/CRM/Ledger/Daily Report (old shots, no fixtures) | 5-9% | 5-9% | - | none | data-only |
| Food Plan report | 19% / 18% | | | none | check (not looked at) |
Pop-ups reviewed: New Bill (4 vs 5 steps, invoice step left out), New Advance (native date/select, now flatpickr/tom-select), New Handover (modal too wide, missing "Save Handover" on step 1), New Entry (modal too narrow). NOT reviewed: Settle, Refund, Rooms, Stay, Deposit (Pallav capture failed).

## Totals so far
Measured screens: about 12 of 70. Pass in day: Revenue, Handover (2 of the measured set strictly under 1.5%; several others within 0.3% of it). Pass in night: Revenue, Handover, Front Desk, shell. Pass on phone: Revenue. These counts are NOT the final scoreboard.

## 10 worst measured screens (day)
1. Food Plan report 19% (not looked at)  2. Reservations 6.7% (fixed since, re-gate)  3. Payroll log 7.6% (filter bar fixed since)  4. Company Profiles/CRM/Customers/Ledger/Daily Report 5-9% (data-only until fixtures exist)  5. Payroll staff 5.9% (order fixed since)  6. Bills 3.8%  7. Guest Advances 3.8%  8. In House 1.8%  9. Rooms 1.7%  10. Front Desk 1.7%.

## Still ungated (never captured against Pallav)
Administration (Master Data, User Accounts, Roles, Settings, Razorpay, System Health/Log/Force Log, Profile + sign-ins, Books/Accounting years), Website (12 pages), Guest portal (6), Company portal (7), login/register screens, Settings tabs, Staff Emails/Staff Meals/Meal Price (Pallav timed out on capture), Settle/Refund/Rooms/Stay/Deposit pop-ups, the whole phone (390) and night passes for most screens.

## STOP NOTE: what to do next, in order
1. Make sure the dev server (localhost:3000) and Pallav (`php artisan serve --host=127.0.0.1 --port=8000` with `PHP_CLI_SERVER_WORKERS=4` in `%LOCALAPPDATA%\HMS\pallav-ref`, superadmin / default seed password) are running; check C: disk space (it hit 0 once; capture scripts now clean their Chrome profiles).
2. From scratchpad `board/` (copy it into the repo if you want to keep it: screens.mjs, lib.mjs, ours.mjs, pal.mjs, compare.py, run.sh): run `./run.sh day1440`, then `night1440`, then `day390`, then `python compare.py` (writes results.json: pct, worst band, per screen).
3. Build this file from results.json: sort worst first, totals (N of M pass per mode), mark "data-only" for screens whose `data` flag is `none` in screens.mjs.
4. Send each UI session its screens' list (region = band_y/band_x, what differs, %), they fix, re-run only those ids (`ours.mjs <dir> <w> <h> <scheme> <role> id1,id2`).
5. Map the missing S08 fixtures (customers, CRM, ledger, staff emails, reports, Administration, Website, portals) so those screens can pass; the fixtures are in docs/sessions/S08-fixtures (re-export with `php export-fixtures.php` from the Pallav scratch copy).
6. Review the pop-ups with clicks on both sides (list in the Web UI 1 message: modal widths from the Pallav Blade).
7. Backend still open: B6b review and the 3 failing tests I never diagnosed (GST settings work); PG1/PG2 are green (125 tests) and reviewed.
8. Decisions waiting for MJ: money grouping (western vs Indian), weather widget, keep mobile dock/diamond (kept), reports visible to Hotel User.
9. Pallav login/"Settle"/"New Deposit" captures failed in my tooling (click chain): use selectors, not text, for those two.
10. Do not delete the scratch Pallav copy or the S08 fixtures; delete `board/out` after each diff to save disk.
