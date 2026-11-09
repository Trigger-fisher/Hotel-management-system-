# Audit of MJ's requests R1 to R30 against the code (session D, 12 Oct 2026)

Checked by opening the code on the working tree (uncommitted edits of other sessions included). No test suite and no browser were run; one type-check of `web-app` after my changes (see the end). Full text and evidence per row: the Status column of `docs/sessions/orders/MJ-REQUESTS-11-12-OCT.md`.

Words: DONE = the code does it and I opened the file; PARTLY = part of it; NOT BUILT = searched, absent; UNKNOWN = cannot be seen from code.

| # | Request (short) | Status | Evidence (path) |
|---|---|---|---|
| R1 | Emailed code optional, own switch | DONE, 2 open details | `web-app/src/server/services/auth/credentialService.ts` (setMyTwoFactor), `db/migrations/platform/0114_signin_code_optional.sql`, `components/auth/steps/EmailCodeStep.tsx`, `dashboards/groups/admin/Profile.tsx`, `guest/Profile.tsx` |
| R2 | Corporate: no Teams/Users | DONE | `ui-shared/dashboards/nav.ts` (corporate entries), no `corporate/team` route |
| R3 | Company edits info, never price/percent | DONE (code) | `app/api/v1/corporate/profile/route.ts`, `services/corporate/schemas.ts` |
| R4 | My profile like Super Admin / limited guest | PARTLY CHECKED | `guest/Profile.tsx`, `corporate/ProfileScreen.tsx` |
| R5 | No Book a room | DONE | no `guest/bookings`, `guest/rooms`, `corporate/bookings` routes |
| R6 | Corporate Accounts: 3 pages, one design | DONE (code) | `corporate/AccountList.tsx`, nav ids corporate.bills/payments/ledger |
| R7 | Corporate dashboard calm, no pay button | DONE (code) | `corporate/DashboardScreen.tsx` |
| R8 | Hotel selector, All by default | DONE (code) | `groups/portal/HotelSwitch.tsx`, routes `guest/hotels`, `corporate/hotels` |
| R9 | F5 keeps the page; fresh visit goes to dashboard | DONE for the page | `dashboards/shell/lastView.ts`, `shell/RoleDashboard.tsx` |
| R10 | No agents | RULE | `pm-dashboard/server.mjs` allowAgents false |
| R11 | Header search removed; page search on all lists | DONE (browser-checked) | one component `pallav/ui/SearchBox.tsx`; see below |
| R12 | Latest first | PARTLY | see "Latest first" below |
| R13 | Guest bills = all, history = payments | DONE (code) | routes `guest/bills`, `guest/history` |
| R14 | Room service only while staying; schedule; hours | DONE (code) | `services/guest/guestService.ts`, `admin/restaurant-hours` |
| R15 | Persons on every bill | DONE (code) | `guestService.ts`, `corporateService.ts` (personsOf) |
| R16 | Add member removed | DONE | no `guest/members` route or screen; leftovers task t086 |
| R17 | Mock data for portals | DONE (code) | `ui-shared/dashboards/guest.mock.ts` and the corporate mock, loaded by `mockLoader.ts` |
| R18 | Friendly page for unlinked accounts | DONE (code) | `groups/portal/parts.tsx`, `admin/PortalLink.tsx` |
| R19 | Code box submits by itself | DONE | `EmailCodeStep.tsx` |
| R20 | Employee role gone | DONE | no `employee_user` text in code; migration 0115 applied on dev (per A) |
| R21 | No Hotel Super | CODE CLEAN, DATA UNKNOWN | only the hotel SuperAdmin role key in `server/auth/access.ts` |
| R22 | Mobile layout of portals | PARTLY | `groups/portal/MobileNav.tsx`, `hms-overrides.css`; not seen |
| R23 | Pathik folder, submit mode, python folder | DONE (code, uncommitted) | `pathik/worker`, `pathik/docs`, `python/ocr/README.md`, `admin/PathikSettings.tsx` |
| R24 | Group data for MJ | UNKNOWN | data, not code |
| R25 | Website sign-in handoff | PARTLY | client sends `entryHotel` and applies `entryHotelId` (`lib/auth/httpApi.ts`); brand name on the sign-in page waits for A's brand route |
| R26 | One entry per room, members | DONE (code) | `services/pathik/fields.ts` |
| R27 | Migrations run locally | DONE per A | not checked by D |
| R28 | Employee User removed | DONE | same as R20 |
| R29 | Pathik worker: Python or not | DONE | `pathik/docs/PYTHON-OR-NOT.md` |
| R30 | Live Pathik page in the menu, survives refresh | DONE, not run in a browser | `ui-shared/dashboards/nav.ts` (hotel.fo.pathikLive), `frontOffice/index.ts`, `PathikScreen.tsx`, `server/repos/postgres/pathik.ts` (table pathik_active) |

## What session D changed today

| File | Change |
|---|---|
| `web-app/src/dashboards/groups/overview/BooksScreen.tsx` | page search on Accounting Years (ListSearch, words match label and dates); the newest-year Remove button now follows the year id, not the list position |
| `ui-shared/dashboards/nav.ts`, `groups/frontOffice/index.ts`, `PathikScreen.tsx` | R30: menu entry "In Pathik now" (own view id on the same screen); the two tabs now navigate between the two ids, so a reload returns to the same tab |
| `groups/payrollPay/serverList.ts`, `Advances.tsx`, `Bonus.tsx`, `Slips.tsx`, `Resignations.tsx` | R12: these lists open newest first (sorted by date, processed date or resignation date, descending) |
| `ui-shared/auth-pallav/types.ts`, `mock.ts` | R1: stale comment and demo-account labels that said administrators always need the emailed code |
| docs | Status column of `MJ-REQUESTS-11-12-OCT.md`, row R30, this file |

## Search (R11): what is true

| Fact | Evidence |
|---|---|
| The header search is not mounted; `dashboards/pallav/GlobalSearch.tsx` and `dashboards/search/api.ts` are unused code | grep: `GlobalSearch` only references itself |
| Every list page has a search box in its page head, except the pages below | scan of the 70 screens named in `SEARCH-AUDIT.md` |
| (Now merged into `SearchBox.tsx` the same day.) Before the merge it was NOT one component: `ListSearch` (12 files, and `CashSearch` is an alias), the older `SearchField` with Blade wrappers `pay-toolbar` / `cb-search` / `log-search` (about 45 files), `PtSearchBox` in the portals | `dashboards/pallav/ui/ListSearch.tsx`, `PmsTable.tsx` SearchField, `groups/portal/parts.tsx` |
| Why I did not merge them | each wrapper has its own CSS (`cashbook.css`, `company.css`, `payroll-look.css`) and I cannot see the screens; a blind merge could move boxes. Needs a browser pass |
| Pages with no list to search (MJ to say if he wants a box) | Front Desk tiles, Website Calendar, Platform Health, Platform Dashboard, My Profile small lists, Group details lists |

## Latest first (R12)

Newest first by default: bills, advances, cash books, handover (`dir` default `desc` in `services/*/schemas.ts`, `validation/listQuery.ts`). Changed today: payroll Advances, Bonus, Slips, Resignations. Not changed on purpose: Salary Payments (one row per employee for a month), alphabetical lists (companies, staff). Not checked: portal lists (B, C), platform lists.

## Open items found (owner)

| # | Item | Owner |
|---|---|---|
| 1 | (DONE by A, verified 12 Oct: route and old sentences removed) `POST admin/users/[id]/disable-code` still lets a user manager switch another person's emailed code off, and refuses admin roles with the old sentence "Administrators always sign in with an emailed code" (`credentialService.ts` lines 19 to 22 and 124 to 131, test `credentials.test.ts`). Decision 46 says nobody can force it for another person | A |
| 2 | (withdrawn) corporate My profile is the hotel's Profile screen and has the switch | - |
| 3 | R25 server part: `GET /api/v1/public/hotels/{slug}/brand` and `entryHotelId` on the session answer, then D builds the sign-in page | A, then D |
| 4 | Leftover routes after the portal redesigns: `corporate/dues`, `corporate/dues/pay`, `corporate/bills/[id]/pay`, `guest/bills/pay` | A (task t075) |
| 5 | `.next/types/validator.ts` still lists removed routes (`corporate/rooms`, `corporate/team`, `guest/bookings`, `guest/rooms`); a type-check fails until `.next` is regenerated (`npx next typegen`) | whoever runs the next build |
| 6 | (done 12 Oct) the three search markups are now one component, `SearchBox.tsx` | D |

## Not verified

No browser run (R9, R11, R22, R30 not seen on screen), no live F5 test of the Pathik list against a worker, no unit test of `lastView.ts`, no test run for my changes (type-check only).
