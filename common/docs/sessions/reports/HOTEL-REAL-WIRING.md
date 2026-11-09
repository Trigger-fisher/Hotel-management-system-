# Hotel dashboard: real-server wiring checklist (11 Oct 2026)

Adapters: `web-app/src/lib/api/adapters/{billing,frontOffice}.ts` (fac40f6). Live test: `?api=real` on a second dev server (:3001), account `ui.super` (hotel Super Admin of Hotel Demo), throwaway data prefixed `LT` (category "LT-Deluxe", rooms LT/9/8 + number, guests "LT ...", bills/advances "LT ..."). Status words: **tested** = called live and the answer matches the contract; **failing**; **notYet** = not run.

"API" = the route called with real data; "Screen" = the dashboard page opened in a headless browser against the real server (loads, shows the data, no error panel). Form submits driven through the UI are not done yet (the same adapter calls were made directly).

## Billing: Guest Advances

| Feature | Route | API | Screen |
|---|---|---|---|
| list, filters (tab used/refunded, mode, month, search, sort, company walk-in, paging) | GET /billing/advances | tested | tested (Bill Master - Advances) |
| open advances (for a bill) | GET /billing/advances/open | tested | - |
| create (422 field errors, duplicate receipt 422) | POST /billing/advances | tested | form opens; submit notYet |
| get | GET /billing/advances/{id} | tested | - |
| edit (stale version 409 with currentVersion) | PATCH /billing/advances/{id} | tested | notYet |
| refund / undo refund | POST, DELETE /billing/advances/{id}/refund | tested | notYet |
| delete, recycle bin list, restore, purge | DELETE /{id}, GET ?deleted=only, POST /{id}/restore, DELETE /{id}/purge | tested | notYet |
| receipt preview / PDF | GET /{id}/preview, /{id}/pdf | tested (PDF 200, %PDF) | notYet |
| advance made from a front-office reservation shows in the list | POST /front-office/reservations/{id}/advances | tested | tested (list shows it) |

## Billing: Bills (and debit bills)

| Feature | Route | API | Screen |
|---|---|---|---|
| list, filters (tab paid/settled, mode, month, search, sort, company, paging), KPIs | GET /billing/bills | tested | tested (Bill Master - Bills) |
| get, preview, PDF | GET /{id}, /{id}/preview, /{id}/pdf | tested | notYet |
| create (422 field errors, duplicate number 422, with an advance taken off, debit bill) | POST /billing/bills | tested | form submit notYet |
| edit (stale 409) | PATCH /billing/bills/{id} | tested | notYet |
| delete | DELETE /billing/bills/{id} | tested | notYet |
| settle a debit bill, reverse settlement, settle again | POST, DELETE /{id}/settlement | tested (a second settle while one exists = 409 'Debit bill already recorded for this bill.') | notYet |
| options | GET /billing/options | tested | - |
| bill made by front-office check-out appears here (bill 2026 / 1) | POST /front-office/stays/{id}/checkout | tested | tested |

## Front Office

| Feature | Route | API | Screen |
|---|---|---|---|
| board | GET /front-office/board | tested | tested (Front Desk) |
| options | GET /front-office/options | tested | - |
| rooms list + filters (vacant, occupied, dirty, outOfOrder) | GET /front-office/rooms | tested | tested (Rooms) |
| add room (duplicate 422), bulk add, edit, housekeeping, out of order and back | POST /rooms, /rooms/bulk, PATCH /rooms/{id}, PUT /housekeeping, PUT /service | tested | notYet |
| room category (for reservations) | POST /website/rooms | tested | - |
| reservations: list (6 views, search), create (422 dates), get, edit (stale 409), cancel, advance | /front-office/reservations... | tested | tested (Reservations) |
| check-in list, prefill, check-in | GET /reservations/check-in, GET /stays/prefill, POST /stays | tested | notYet |
| stays: in-house / past list, get | GET /stays, /stays/{id} | tested | tested (In House) |
| charges: add (quantity 3 decimals 422), remove | POST, DELETE /stays/{id}/charges | tested | notYet |
| move room (rooms to move), extend | GET /stays/{id}/rooms, POST /move, /extend | tested | notYet |
| check-out defaults, check-out (422, repeat 409 'This guest has already checked out.') | GET /stays/checkout-defaults, POST /stays/{id}/checkout | tested | notYet |
| plans of a category (rate plans) | POST /website/rooms/{id}/plans | my test body was wrong (needs `tiers`, `extraPersonPaise`); reservations then price at 0 | notYet |

## Payroll: Master and Log (Frontend 2, adapter `adapters/payrollPay.ts`, e499dde)

Super Admin only (checked by the service): test as the hotel Super Admin account. Scope = `all` or a payroll company id. Status words here: **written** = the adapter calls the route with its exact keys and maps the answer, compiles, checked with a fake network (10 cases, `scratchpad/padapter/paymaster.ts`), NOT run against the live server. Frontend 2 could not run them live (no permission to read the dev logins): Frontend 1, please run the rows below and set **tested** / **failing**.

| Feature | Route | API | Screen |
|---|---|---|---|
| list of one master list in a scope (own + inherited + counts) | GET /payroll/master?scope=&list= | **tested** (11 Oct, live, ui.super) | notYet (Payroll Master) |
| add an item (email list needs a valid `value`; 422 field `label`/`value`; duplicate 422) | POST /payroll/master/{list}?scope= `{label, value}` | **FAILING** 11 Oct: valid add answers 500 (server SQL: inconsistent types deduced for parameter $1); 422 for empty label / bad email is right | notYet |
| change an item (scope of the list it lives in) | PATCH /payroll/master/items/{id}?scope= | notYet (blocked: no item can be created) | notYet |
| switch an item on/off (body `{}` = Pallav's flip) | POST /payroll/master/items/{id}/toggle?scope= | notYet (blocked: no item can be created) | notYet |
| remove an item | DELETE /payroll/master/items/{id}?scope= | notYet (blocked: no item can be created) | notYet |
| payroll log: newest first, views (today, week, emails, money, deletions, problems), action/entity/status/user/from/to/search; the adapter fetches EVERY page at 100 (max 50 pages) because the screen filters and sorts the whole list itself | GET /payroll/log?scope=&... | **tested** (11 Oct, live: all six views and filters answer 200 {page,stats,entities,people}; pageSize must be 10/25/50/100) | notYet (Payroll Log) |

Contract note: `updateMasterItem(id, input, scope?)`, `toggleMasterItem(id, scope?)` and `deleteMasterItem(id, scope?)` got an optional trailing `scope` (the real routes find the item only in its own scope; the mock ignores it). `Master.tsx` passes the scope it is showing.

## Form submits driven through the browser (11 Oct 2026, ui.super, :3001)

| Screen and action | Result |
|---|---|
| Guest Advances > New Advance (receipt, guest, mobile, amount, paid by) > Save Advance | **tested**: saved, list refreshed (taken this month +1,500) |
| Reservations > Reservation (new): guest, mobile, room category > Make reservation | **tested**: RES-26-00003..6 created, detail page shows it |
| Reservation > Check in (room, rate, address) > Check in | **tested**: stay opens (In house), account shows the room night |
| In house stay > Add charge (food, qty 2, 450) | **tested**: charge row added, totals updated |
| In house stay > Check out > Check out and bill > confirm dialog 'Check out' | **tested**: POST /stays/{id}/checkout 200 |
| Bills > New Bill (4 steps: Bill and guest, Charges, Stay and plan, Reference) > Create Bill, paid bill and debit bill (Paid by Debit) | **tested** 11 Oct: both created (list: debit waiting +4,480); labels now linked to their controls (27 of 30; the three date labels Bill date, Arrived, Left are not, flatpickr builds its input later) |
| In house stay > Move room (new room + new rate) > Move | **tested**: stay shows the new room and rate |
| Reservation > Cancel reservation (reason required: 'Please give a reason for cancelling.') > confirm | **tested**: reservation shows Cancelled |
| Change check-out (date picker), edit reservation, refund/delete advance, rooms add/edit | notYet through the UI (API tested) |

Real mode prints the hotel's own names now (session user.hotel.name and foodName): the advance form shows 'Hotel Demo' / 'Hotel Demo Food'.
## Admin: expense catalogue and backup (11 Oct 2026, ui.super)

| Feature | Route | API | Screen |
|---|---|---|---|
| expense catalogue of a business (hotel / food, scope both) | GET /admin/masters/{key}/catalog?scope= | **tested** (8 seeded categories: Kitchen ... Other) | notYet |
| add category (duplicate 422 'That category is already on this list.', empty 422), rename, delete | POST /{key}/catalog/categories, PATCH, DELETE /catalog/categories/{id} | **tested** | notYet |
| add / edit / delete priced item (no price 422 key `price`, duplicate 422) | POST /catalog/categories/{id}/items, PATCH, DELETE /catalog/items/{id} | **tested** | notYet |
| backup status | GET /admin/backup | **tested** ({connected, redirectUri, lastAt, lastResult}) | notYet |
| connect / test / run (honest 409 sentences: 'Google Drive is not connected yet.' ...), disconnect | POST /admin/backup/connect|test|run|disconnect | **tested** | notYet |
## Payroll core and pay, Reports, Companies, CRM (API run live 11 Oct 2026 by Frontend 1, ui.super; screens notYet)

| Area | Routes run live | Result |
|---|---|---|
| Payroll core: companies, company, dashboard, options, employees list/lookup/get | GET /payroll/companies..., /employees... | **tested** |
| employees: create (422 field keys; contactCountry is the dial code '91', shift from options), update, toggle, delete (409 'already used in Attendance Management...'), bin/restore/purge, offer letter | /employees... | **tested** (employee bin list uses a `deleted` flag value the server accepts only as the adapter sends it) |
| attendance statuses: create, duplicate shortcut 422, update, toggle | /attendance-statuses | **tested** |
| deductions: create, delete | /deductions | **tested** |
| attendance sheet: get, save (all active employees), generate salary (409 until every active employee is filled), regenerate, unlock (409 not locked) | /attendance/{month}... | **tested** |
| staff e-mails: list, feed, recipients | /staff-emails... | **tested (reads)**; send notYet |
| Payroll pay: staff, masters, salary profiles list/get, revision (dailyWorkingHours is a string) | /staff, /salary-profiles... | **tested** |
| payments: periods, list, mark paid, stale 409, bulk (ids + versions as a record) | /salary-periods, /payments... | **tested** (bulk success notYet: no pending row was left) |
| slips: list, get | /slips... | **tested** |
| advances: create 422/201, edit, delete, restore, delete, purge | /advances... | **tested** (bin list needs the adapter's deleted flag) |
| bonuses: create, edit, delete, restore, purge | /bonuses... | **tested** |
| separations: create (status Pending/Accepted/Relieved), edit, list tab, delete, restore, purge | /separations... | **tested**; experience letter 404 'No experience letter template configured...' (template needed) |
| staff meals (Food company only): view, add price 200 | /meals, /meals/prices | **tested**; start/stop period notYet; price on a non-food company = 404 (by design) |
| letter templates: get (null when none), save/toggle/delete | /letters/{kind} | get tested; save notYet (section ids must be the template's own) |
| reports: daily, food plan, payroll period, payroll monthly | /reports/daily, /reports/food-plan, /payroll/.../reports/... | **tested** (reads, empty-hotel data) |
| payroll master list + log | /payroll/master, /payroll/log | list/log tested; add/edit/toggle/delete: Backend fixed the 500 in c803e72, retest below |
| Companies: options, list, lookup, ledger, customers, lookup | /companies... | **tested** (reads) |
| CRM: staff, board, create, activity, stage, delete | /companies/crm... | **tested** |
## Website (API run live 11 Oct 2026 by Frontend 1, ui.super; screens notYet)

| Feature | Route | Result |
|---|---|---|
| overview (fy param; bad fy = 422) | GET /website/overview?fy= | **tested** ({siteUrl, fy, currentFy, years, stats, arrivingToday, arrivingWeek, recent, blocked, changes, facts}); wired (4793317) |
| photos: list, upload 1 and 3 (base64), disguised text-as-png 422 'Pick a JPG, PNG, WEBP, GIF image.', over 12 MB 422 'That file is too big: the limit is 12 MB.', none 422, caption/alt edit, move up/down, delete | /website/photos... | **tested** (a real PNG with a .exe name is accepted: the server goes by content) |
| image display | GET /api/v1/website/media/{file} | **tested** (200 image/png) |
| page wording | GET, PUT /website/content | get **tested**; PUT answers 422 'Required.' for heroLead, enquireLead, footerTagline of a NEW hotel (the form must be filled in before the first save: by design) |
| services: create with SVG icon, script SVG 422 'That SVG contains scripts or links and was not uploaded.', edit, remove icon, move (409 'This item cannot move any further.' at an end), delete | /website/services... | **tested** |
| house rules: create, edit, delete | /website/policies... | **tested** |
| nearby: list (hotelPinned), create with map link, non-https link 422 'Enter a full link starting with https://', edit with map query, delete | /website/nearby... | **tested** |
| settings: get (secrets are Set flags only), save the whole form, logo + favicon upload and removal, validation 422 sentences | GET, PUT /website/settings | **tested** (the PUT body is the GET object without the read-only keys: hasLogo, hasFavicon, logoUrl, faviconUrl, mapLat, mapLng, *Set flags, googleStatus, googleLastFetchedAt, googleReviewCount, secretsVisible, gbpRedirectUrl, plus `hotelMapUrl`) |
| settings as a person without the website ability | GET /website/settings | 403 for ui.test; the 'secretsVisible: false' answer is not testable with the dev accounts |
| Google connect / refresh / disconnect | POST /website/google/* | **tested**: 409 'Save the Google client ID and secret first, then click Connect with Google.' / 'Google is not connected yet.', disconnect 200 |
## Website screens in the browser (11 Oct 2026, ui.super, :3001)

| Screen | Result |
|---|---|
| Overview (FY picker shown, real data), Enquiries, Rooms, Tariff plans, Calendar, Gallery, Content, Services, House rules, Nearby, Settings | **tested**: every tab loads real data with the right empty states |
| Gallery upload (2 files) + disguised file | **tested**: images listed, URLs load (/api/v1/website/media/lt1.png), the text file shows 'Pick a JPG, PNG, WEBP, GIF image.' |
| Content > Save all changes on a NEW hotel | **tested**: three 'Required.' messages come back (heroLead, enquireLead, footerTagline); Frontend 2 added the jump to the first section with an error and the focus (e141563) |
| Content > Save all changes on a new hotel | **tested** (after e141563): 'Required.' x3 and focus on c_heroLead |
| Services > Add service with an SVG icon | **tested**: card with the icon shown (/api/v1/website/media/...svg) |
| Nearby > Add place with a pasted map link | **tested**: card 'Uses the pasted link' |
| Website Settings > phones, e-mail, logo upload > Save settings | **tested**: logo saved and shown; Frontend 2 gave every Settings control an id and linked its label (38dc6f9). The Google buttons are hidden until the client id and secret are saved (googleStatus not 'notSetUp'): to re-check after saving them |
| House rules with icon, caption edit, reorder, delete in the browser | notYet (API tested) |
| Razorpay screen | **tested**: 'Not set up yet: <hotel> and <hotel Food>. Add the Razorpay keys under Settings ...' note, empty payments list |
| A part with no server route | shows 'This part is not set up yet.' |
## More form submits in the browser (11 Oct 2026, ui.super, :3001)

| Screen and action | Result |
|---|---|
| Company Profiles > Add Company (3 steps: Company, People, Billing) > Create Company | **tested**: company created and listed (LT UI Company) |
| Customers > Add Customer > Add customer | **tested**: customer created ('Added by staff', portal Active) |
| CRM > Add Lead > Add lead | **tested**: lead page with history 'Lead added from Phone call.' |
| Revenue > New Deposit > Save Deposit (depositor from Master Data > Depositor Names) | **tested**: ₹2,500 listed, REG. NO. 0001; with no depositor set up the form says 'No depositors are set up for <hotel> yet. Add them in Master Data.' |
| Expenses > New Entry (withdrawal, 'Received by' from Receiver Names) > Save Entry | **tested**: ₹700 listed |
| Shift Handover > New Handover (shift, handover to a payroll employee, notes ₹500 x2 + ₹100) > Save Handover | **tested**: ₹1,100 counted, listed |
| Master Data (payroll master) add / edit / toggle / delete + e-mail list | **tested** via API after Backend c803e72 (201/200/409 'This one applies to every company...' on a wrong scope) |

Accessibility: labels of the shared forms (Field, payroll Fld) now link to their control automatically, date labels point at the flatpickr display box, Instruction textareas of Revenue/Expenses/Advance have ids; TomSelect fields are labelled through aria-labelledby (their label.control is empty by design).
## Payroll screens in the browser (11 Oct 2026, ui.super, :3001)

| Screen and action | Result |
|---|---|
| Payroll > company list > Open (Hotel Demo) > company dashboard | **tested**: loads real figures (active staff, attendance filled, salary due, advances out) and the 'No joining letter template' / 'salary payments still open' notes |
| Attendance Management, Staff Management, Salary Payment, Advance Management | **tested**: each loads real data (empty state 'No advances recorded') |
| Staff > Add Employee (4 steps: Personal, Job, Pay, Documents) > Add Employee | **tested**: employee created, list shows 7 active staff, monthly salary total updated |
| All 20 Payroll pages from the Payroll menu (Dashboard, Staff, Attendance, Resignations, Staff Emails, Salary Revisions, Advances, Bonus & Incentives, Staff Meals, Salary Payments, Salary Slips, Monthly Report, Period Report, Joining Letter, Experience Letter, Attendance Marks, Deduction Types, Meal Price, Payroll Master, Payroll Log) | **tested**: each loads real data with its right empty state |
| Advances > Add Advance (employee, amount 3,000, recovery) | **tested**: advance listed, totals updated |
| Bonus & Incentives > Add Entry (employee, Bonus 1,500) | **tested**: entry listed, totals updated |
| Resignations > Record Exit (3 steps) > Save Exit | **tested**: 'In notice 1' |
| Deduction Types > Add Deduction | **tested**: 10 deductions |
| Attendance Marks > Add Attendance Status (50% of a working day, Paid) | **tested**: 3 statuses |
| Payroll Master add / edit / toggle / delete | **tested** via API (closed: Backend c803e72) |
| Attendance sheet fill + Generate salary, mark a payment paid, slip view, meals, letter templates, edit/delete/restore of payroll items in the browser | notYet (API tested) |
## Group Hotel Admin console (11 Oct 2026, by Frontend 1; routes /api/v1/group/*, contract ui-shared/dashboards/groupConsole.ts)

Test group: 'Live Test Hotel GRP579455' (admin live.grpadm579455, made through the real invitation + onboarding + approval), hotels Live Test Hotel 1 and 2 linked by the Platform Admin.

| Feature | Route | API | Screen |
|---|---|---|---|
| overview (tiles, newest hotels, recent activity) | GET /group/overview | **tested** | **tested** (Dashboard) |
| my hotels: list, status filter, search; detail; 404 for a hotel outside the group | GET /group/hotels, /group/hotels/{id} | **tested** | **tested** (My hotels, Hotel details) |
| invite a hotel into my group (422 field errors; `groupId` in the body is refused) | POST /group/invitations | **tested** | form driven in mock; real notYet through the UI |
| my invitations, resend, cancel (409 when repeated) | GET /group/invitations, POST .../resend, .../cancel | **tested** | **tested** (list); resend/cancel notYet in the browser |
| hotel admins of my hotels; reset password, unlock (409 not locked), disable, enable; 404 outside the group | /group/hotel-admins... | **tested** | **tested** (list) |
| look inside a member hotel (reason 5+ chars, read-only, 60 min), exit | POST /group/hotels/{id}/enter, /exit | **tested**: write inside = 403 'You are viewing <hotel> as the Group Hotel Admin. This is read-only.' | **tested** in mock (banner 'as the Group Hotel Admin'); real notYet in the browser |
| archive a member hotel | POST /group/hotels/{id}/archive | **tested** | **tested** (Hotel details > Archive hotel, reason) |
| remove from group | POST /group/hotels/{id}/unlink | notYet | notYet |
| my profile | GET /profile | **FAILING**: 500 for a group admin (uuid '' in the member lookup), sent to Backend | 'This did not load' |

'Set up your hotel' (real): GET/PUT /profile/hotel-setup wired (SetupChecklist.tsx); a newly approved hotel answered applies:false because dev DB `hms` still has the old empty hotel_setup table; waiting for Backend's migration (needs MJ's OK).
## Edit, delete and restore in the browser (11 Oct 2026, ui.super, :3001)

| Record | Edit | Delete | Restore |
|---|---|---|---|
| Revenue deposit | **tested** (amount 3,000) | **tested** | **tested** (Settings > Recycle Bin > Restore) |
| Expense entry | **tested** (amount 800) | **tested** | via the Recycle Bin (same screen) |
| Shift handover | **tested** (+₹100 note) | **tested** | **tested** (Recycle Bin) |
| Customer | **tested** (city) | **tested** | notYet |
| Company profile | form opens, steps pass; Save button of step 3 not driven | **tested** | notYet |
| CRM lead | notYet | **tested** (Delete lead + confirm) | - |
| Stay | Change check-out **tested** (date set through the picker); Move room **tested** earlier | - | - |
| Payroll payment | **tested** (Update payment: Paid) | - | - |

Mobile traces removed from the UI files (comments, mock device names).
## Room-service menu and guest orders (Frontend 2; server 93c74c2; screens 7a8c80c)

Status: **written**, waiting for the dev database migration (the menu table is missing on hms, so the menu is empty and admin edits answer 500 there). Driven in mock mode in the browser; the real calls are checked only by type.

| Feature | Route | API | Screen |
|---|---|---|---|
| Master Data > Room service menu: the three lists with their items | GET /admin/menu | written | written (Master Data rail 'Guest services') |
| add an item (422 name/note/pricePaise, duplicate name in a list) | POST /admin/menu/items | written | written |
| edit an item, switch on/off | PATCH /admin/menu/items/{id} | written | written |
| remove an item (placed orders keep their own text and price) | DELETE /admin/menu/items/{id} | written | written |
| move up / down inside a list | POST /admin/menu/items/{id}/move | written | written |
| Guest Order to room: menu (switched-off items greyed), empty-menu state | GET /guest/menu | written | written |
| place an order on the room bill (becomes stay charges; no stay 403; empty cart / bad item 422 cart; over 20 of one item 422) | POST /guest/orders | written | written (shows the cart / payWith sentence) |
| pay now | POST /guest/orders payWith pay_now | written: refused 422 payWith until Razorpay keys exist | written (shows the sentence) |
| Website enquiry confirm / decline carry mail (queued, no_email, failed, off) | POST /website/enquiries/{id}/confirm, /decline | written | written (note when the guest was not mailed) |

## Findings

1. **Business names are mock text.** Advances/Bills forms and many labels say "Hotel Sunrise" / "Sunrise Foods" (`ui-shared/dashboards/billing.ts:59-60`, `cash.ts`, `admin.ts`, `corporate.ts`, `frontOffice.ts` mock data) also in real mode. Needs the hotel's own name (and food business name) from the server (session `user.hotel.name`, a hotel profile) instead of the constants. Not changed yet: waiting for the source of the second business name.
2. Rate plans were not created in the test, so reservation prices were 0; plan creation by the web admin is covered by the Website module's adapter (not part of this checklist).
3. A debit bill allows ONE settlement at a time (reverse first to change it).
4. List tabs: advances = all/unused/partial/used/refunded, bills = all/paid/due/settled (the server answers 422 'Not valid' for any other tab, e.g. `open`, `debit`).

## Portals and Group admin, real mode (12 Oct 2026)

Tour of every sidebar page with console and network errors listed: dev.guest (Dashboard, Bills, History, Order to room, Book a room, My account) clean; dev.corporate (Dashboard, Ledger, Bills, Payments, Book rooms, Company profile, Team and users) clean once the company LT UI Company was restored from the recycle bin (a deleted company answers 403 on every /corporate call, by design); dev.group (Dashboard, My hotels, Invitations, Hotel admins, My Profile) clean. Found and fixed in the same round: Daily Report duplicate row keys; Group admin My Profile asked for /admin/roles (403).

