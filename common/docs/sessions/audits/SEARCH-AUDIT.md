# Search audit: every list page, and how Handover's search works (decision 51, 12 Oct 2026)

Read-only audit by d7 from the working folder (no code changed, nothing run), for `ORDER-PAGE-SEARCH.md`. UI and Backend use it as their checklist. Facts below are read from the files named; where a fact could not be read from code it says "to confirm".

## 1. How Handover's search works (the reference)

| Item | What it is |
|---|---|
| Screen | `web-app/src/dashboards/groups/cash/HandoverScreen.tsx` (view `hotel.cash.handover`), search line 146 |
| Component | `CashSearch` in `web-app/src/dashboards/groups/cash/cashKit.tsx:26` (not in the shared kit: it lives in the cash group; In House and the two Pathik lists import it from there). Markup: `<form class="pay-toolbar" role="search"> <div class="search-field"> <i class="bi bi-search"/> <input type="search" class="form-control"/> [clear button when text] </div></form>`; the clear button is the kit's `TextAction kind="clear"`. No Escape-to-clear (the kit's `SearchField` in `pallav/ui/PmsTable.tsx:207` has it). |
| Props | `value`, `onChange(v)`, `placeholder` (the component adds "…"; Handover: "Search handovers"), `onClear()`. Fixed: `aria-label="Search the list"`, `title` = the tips sentence below. |
| Position | top of the page, inside `div.page-head.page-tools > div.sh-head-actions`, as the FIRST item, to the left of the primary button ("New Handover"). Revenue and Expenses put it in the same head beside their New button. |
| Screen state | `typed` (what the person types) and `search = useDebounced(typed, 250)` (`components/ui/useDebounced.ts`, default 300 ms; Handover passes 250); changing the text sets `page = 1`; `useAsync(() => cashApi.listHandovers({ search, page, pageSize }), [search, page, pageSize])`; the previous answer stays on screen while the new one loads (`useLastReady`), no skeleton flash. |
| Empty result | `EmptyState` with title "No Handover matches that search", the hint "Try a different word, a date like 19-09-2026, a registration number like 5, or an amount." and a button **Clear search**. With no text and no rows: "No Handovers yet" and New Handover. |
| Query parameter | `search` (adapter `lib/api/adapters/handover.ts:32`: trimmed, empty left out) on `GET /api/v1/handover?search=&page=&pageSize=&sort=&dir=&from=&to=&deleted=`. |
| Server route | `app/api/v1/handover/route.ts` with `handoverListQuery` (`services/handover/schemas.ts:30`, strict): `search` string, max 200 characters, no control characters. |
| What it searches | `matchesHandover` (`services/handover/rules.ts:136`, Pallav's ShiftHandoverController::search): the text is trimmed and split on spaces; **every word** must match (case-insensitive substring) the name saved, the shift, the notes, the instructions, the total in words, or the recorder's current name; or be the entry number ("12", "#12"), the total in rupees ("1,500", "₹1500") or the date (19-09-2026, 19/09/2026, 2026-09-19). |
| How the route runs it | `handoverService.list` loads ALL rows of the window (deleted flag, `from`/`to`) from the repository, then filters in memory with `matchesHandover`, sorts and pages (10, 25, 50 or 100). It is not a SQL search. Fine for handovers (a few per day); not "fast: no full scans on big tables" for a large list. |
| The tips tooltip | `CashSearch`'s `title` says: several words must all match, "exact phrase", -leave out, >5000, <500, 500-2000. Those operators exist only in the cash books' own search (`services/cash/search.ts`, Revenue and Expenses). Handover's server does not implement quotes, minus or amount ranges, and In House / Pathik / Pathik-active use the same component with the same tooltip: **the tooltip over-promises on 4 of its 6 screens** (UI: make the tip a prop). |

### Search implementations that exist today (what "same capability" must reconcile)
| Kind | Used by | Behaviour |
|---|---|---|
| A. Handover-style (words + entry number + amount + date), in memory over the window | Handover | as above |
| B. Cash search with operators (words, "phrase", -not, >, <, a-b ranges), in memory over the window's rows | Revenue, Expenses (`services/cash/search.ts`, `search` max 500) | superset of A for amounts |
| C. SQL words: `position($word in lower(concat_ws(' ', columns))) > 0`, every word (`wordsCondition` in `repos/postgres/shared.ts:54`, `wordsOver` in `frontOffice.ts:43`, `words` in `companies.ts:40` and `payrollCore.ts:69`) | Front Office, Companies, Payroll, Platform, System Log | substring on the visible columns; **no trigram index exists anywhere** (`gin_trgm_ops` is in no migration), so each is a scan of the table (cheap while small) |
| D. Billing ILIKE (`repos/postgres/billing.ts`, "the text a list's search runs over") | Bills, Guest Advances | substring on columns, company name, amount in rupees |
| E. Client-side filter over rows already loaded (the route takes no `search`) | Daily/Food Plan reports, Payroll Master, Masters, payroll companies list, Razorpay, Groups, Rooms (website), ... | fine for small sets |

### Search boxes in the screens today (what UI must unify)
Five different boxes: (1) `CashSearch` (cash group: Revenue, Expenses, Handover, In House, Pathik, Pathik active); (2) the kit's `SearchField` with `wrapClass="pay-toolbar"` or `"cb-search"` or `"log-search"` (Billing, Companies, Platform, Group, Payroll lists, Enquiries, Rooms, Reservations, Users, sign-ins, logs), sometimes `bare` inside a `PayLayout` search slot (payroll); (3) plain `<input type="search">` with their own markup (Masters, Daily Report, Food Plan Report, Salary Payments, the recipient and employee pickers); (4) `PtSearchBox` (`groups/portal/parts.tsx:396`, Guest and Company portals); (5) the header search (`pallav/GlobalSearch.tsx`, mounted by `shell/RoleDashboard.tsx:615` for every role: hotel via `hotelSearchApi`, the others via `screensOnlyApi`) which decision 51 removes.

## 2. Every list page, role by role

Legend. **Box today**: C = CashSearch, S = kit SearchField, P = plain input, T = portal PtSearchBox, "-" = none. **Server `search`**: yes = the route's query schema accepts it; no = it does not; n/a = no list route (rows come with a bigger answer). "Tabs" = each tab's list needs the box (one box per page is enough when the tabs switch one list; a tab that shows a different list needs its own).

### Hotel (Hotel Admin, Hotel User, Super Admin)
| # | Page (view id) | Screen file (`groups/`) | List route | Box today | Server `search` | What it searches / would search | Note |
|---|---|---|---|---|---|---|---|
| 1 | Daily Report (`hotel.reports.daily`) | overview/DailyReportScreen.tsx | GET /reports/daily?date | P (client) | no | guest, room, bill of the day's lines | the whole day is loaded; client filter is right |
| 2 | Food Plan Report (`hotel.reports.foodPlan`) | overview/FoodPlanScreen.tsx | GET /reports/food-plan?month&plan | P (client) | no | guest, room, bill | same |
| 3 | Books (years) (`hotel.books`) | overview/BooksScreen.tsx | GET /admin/books | - | n/a | year label, note | a short list of accounting years; decide with MJ |
| 4 | Guest Advances (`hotel.billing.advances`), tabs All / Unused / Partly used / Used / Refunded | billing/AdvancesScreen.tsx | GET /billing/advances | S | yes (100) | receipt, guest, room, company, amount | one list, tabs filter it |
| 5 | Bills (`hotel.billing.bills`), tabs All / Paid / Debit waiting / Debit settled | billing/BillsScreen.tsx | GET /billing/bills | S | yes (100) | bill, guest, room, company, amount | |
| 6 | Revenue (`hotel.cash.revenue`), books All / Hotel / Food, plus deleted view | cash/RevenueScreen.tsx | GET /revenue/deposits | C | yes (500, operators) | depositor, reason, entry no, amount, date | |
| 7 | Expenses (`hotel.cash.expenses`), books and kinds, deleted view | cash/ExpensesScreen.tsx | GET /expense/entries | C | yes (500, operators) | name, head, instruction, lines, entry no, amount | |
| 8 | Shift Handover (`hotel.cash.handover`) | cash/HandoverScreen.tsx | GET /handover | C (reference) | yes (200) | see section 1 | the model |
| 9 | Company Profiles (`hotel.co.profiles`) | companies/ProfilesScreen.tsx | GET /companies | S | yes (100) | name, GST, email, mobile, people | deleted view uses the same list |
| 10 | Customers (`hotel.co.customers`), tabs All / Active / Off | companies/CustomersScreen.tsx | GET /companies/customers | S | yes (100) | name, mobile, city, ... | |
| 11 | CRM (`hotel.co.crm`) board of lead cards | companies/CrmScreen.tsx | GET /companies/crm/leads | S | yes (100) | lead text columns | cards by stage; one search over all stages |
| 12 | Company Ledger (`hotel.co.ledger`), show All / Owing / Credit / Settled | companies/LedgerScreen.tsx | GET /companies/ledger | S | yes (100) | company, GST, phone | |
| 13 | Company statement (`hotel.co.statement`, one company's lines) | companies/StatementScreen.tsx | GET /companies/{id}/ledger (search in the query) | S | yes (100) | guest, room, bill, amount | a list inside a record page |
| 14 | Payroll: Companies (`hotel.payroll.home`, `.companies`) | payrollCore/Companies.tsx | GET /payroll/companies | S (client) | no (the repo supports words, the route's adapter sends none) | name, code, owner | Backend: pass `search` through |
| 15 | Staff (`hotel.payroll.staff`), tabs incl. deleted | payrollCore/Staff.tsx | GET /payroll/companies/{id}/employees | S (two boxes: live and deleted) | yes (100) | name, ID, designation, department, email, mobile | |
| 16 | Attendance (`hotel.payroll.attendance`), month grid of employees | payrollCore/Attendance.tsx | GET /payroll/companies/{id}/attendance/{month} | - | no | employee name, code | a long grid for a large company: needs search |
| 17 | Attendance Marks (`hotel.payroll.attendanceStatuses`) | payrollCore/Statuses.tsx | GET /payroll/companies/{id}/attendance-statuses | - | no | mark name | short master list |
| 18 | Deduction Types (`hotel.payroll.deductions`) | payrollCore/Deductions.tsx | GET /payroll/companies/{id}/deductions | - | no | name | short master list |
| 19 | Staff Emails (`hotel.payroll.staffEmails`) | payrollCore/StaffEmails.tsx | GET /payroll/companies/{id}/staff-emails | S | yes (100) | staff, recipient, sender | the recipient picker inside has its own plain find box |
| 20 | Resignations (`hotel.payroll.resignations`), incl. deleted | payrollPay/Resignations.tsx | GET /payroll/companies/{id}/separations | S (two boxes) | yes (100) | name, reason, type | |
| 21 | Salary Revisions (`hotel.payroll.salaryUpdate`) | payrollPay/SalaryUpdate.tsx | GET /payroll/companies/{id}/salary-profiles | S | yes (100) | name, ID, designation | |
| 22 | Advances (`hotel.payroll.advances`), incl. deleted | payrollPay/Advances.tsx, PayBin.tsx | GET /payroll/companies/{id}/advances | S (two boxes) | yes (100) | employee, instruction | |
| 23 | Bonus & Incentives (`hotel.payroll.bonus`) | payrollPay/Bonus.tsx | GET /payroll/companies/{id}/bonuses | S | yes (100) | employee, type, instruction | |
| 24 | Staff Meals (`hotel.payroll.meals`) | payrollPay/Meals.tsx | GET /payroll/companies/{id}/meals | - | no | employee name, date | a list of meal charges per period |
| 25 | Salary Payments (`hotel.payroll.salaryPayments`) | payrollPay/Payments.tsx | GET /payroll/companies/{id}/payments | P (own markup) | yes (100) | employee, reference | make it the shared box |
| 26 | Salary Slips (`hotel.payroll.salarySlips`) | payrollPay/Slips.tsx | GET /payroll/companies/{id}/slips | S | yes (100) | employee | |
| 27 | Monthly Report (`hotel.payroll.reports`) | payrollPay/Reports.tsx, ReportTable.tsx | GET /payroll/companies/{id}/reports/monthly | - | no | employee name, code | one row per employee; decide with MJ |
| 28 | Period Report (`hotel.payroll.periodReport`) | payrollPay/Reports.tsx | GET /payroll/companies/{id}/reports/period | - | no | employee name, code | same |
| 29 | Meal Price (`hotel.payroll.mealPrice`) | payrollPay/MealPrice.tsx | GET /payroll/companies/{id}/meals/prices | - | no | date, price | very short history list |
| 30 | Payroll Master (`hotel.payroll.master`), several master lists | payrollPay/Master.tsx | GET /payroll/master/{list} | S (client) | no | label | |
| 31 | Payroll Log (`hotel.payroll.log`) | payrollPay/Log.tsx | GET /payroll/log | S | yes (100) | the log text | |
| 32 | Joining Letter, Experience Letter (`hotel.payroll.joiningLetter`, `.experienceLetter`) | payrollPay/Letters.tsx | GET /payroll/companies/{id}/staff/lookup | P (employee picker) | yes (`q`) | name or code | a picker inside a form: see "no list" |
| 33 | Front Desk (`hotel.fo.board`): room tiles by floor, arrivals, departures | frontOffice/Board.tsx | GET /front-office/rooms (+ stays, reservations) | - | yes for rooms (100) | room number, guest | tiles, not rows: ask MJ |
| 34 | Reservations (`hotel.fo.reservations`), views Upcoming / Today / In house / Past / Cancelled / All | frontOffice/ReservationsScreen.tsx | GET /front-office/reservations | S | yes (100) | name, mobile, reference | |
| 35 | In House (`hotel.fo.inHouse`), views In house / Past | frontOffice/InHouseScreen.tsx | GET /front-office/stays | C | yes (100) | name, mobile, G.R., room | |
| 36 | Rooms (`hotel.fo.rooms`), filters All / Vacant / Occupied / Dirty / Out of order | frontOffice/Rooms.tsx | GET /front-office/rooms | S | yes (100) | room number, floor, type | |
| 37 | Pathik (`hotel.fo.pathik`), tab "Rows" (the queue by status) | frontOffice/PathikScreen.tsx | GET /pathik/queue | C | yes (100) | guest, room, bill | |
| 38 | Pathik, tab "In Pathik now" | frontOffice/PathikActive.tsx | GET /pathik/active | C (client over at most 200 decrypted rows) | no (by design: text is encrypted, never searched in SQL) | name, contact, room, serial | keep client-side |
| 39 | Guest Enquiries / Website Enquiries (`hotel.web.enquiries`), tabs All / Pending / Confirmed / Declined | website/Enquiries.tsx | GET /website/enquiries | S | yes (100) | name, phone, email, reference | |
| 40 | Website Rooms (`hotel.web.rooms`) | website/Rooms.tsx | GET /website/rooms | - | no | room category name | cards, usually under 10 |
| 41 | Website Rates (`hotel.web.rates`) | website/Rates.tsx | GET /website/rates | - | no | room name, plan | tables per room |
| 42 | Website Gallery (`hotel.web.gallery`) | website/Gallery.tsx | GET /website/photos | - | no | caption | photo grid |
| 43 | Website Services (`hotel.web.services`) | website/Lists.tsx | GET /website/services | - | no | name | short list |
| 44 | Website Policies (`hotel.web.policies`) | website/Lists.tsx | GET /website/policies | - | no | title | short cards |
| 45 | Website Nearby (`hotel.web.nearby`) | website/Lists.tsx | GET /website/nearby | - | no | name, kind | short list |
| 46 | Website Calendar (`hotel.web.calendar`) | website/Calendar.tsx | GET /website/calendar | - | no | room | a week grid: probably "no list" |
| 47 | Master Data (`hotel.admin.masters`), several panels (options, catalogue, plan rates, room-service menu) | admin/Masters.tsx, MastersCatalog.tsx, MastersMenu.tsx, MastersPlanRates.tsx | GET /admin/masters/{key}, /admin/menu, /admin/plan-rates | P (inline in Masters.tsx, client) | no | item label | one box per panel today; make it the shared one |
| 48 | User Accounts (`hotel.admin.users`) | admin/Users.tsx | GET /admin/users | S | yes (100) | name, username, email | |
| 49 | Roles & Permissions (`hotel.admin.roles`) | admin/Roles.tsx | GET /admin/roles | - | no | role name | few cards |
| 50 | Settings, tab Recycle bin (`hotel.admin.settings`) | admin/Settings.tsx (RecycleExtra), PayrollBins.tsx | GET /admin/recycle (+ payroll bins) | - (PayrollBins use S per list) | yes for /admin/recycle (100) | what was deleted: kind, label | the route is ready, the page has no box |
| 51 | Razorpay (`hotel.admin.payments`) payments list | admin/Payments.tsx | GET /admin/razorpay | S | **no** (the adapter notes the server takes only the page) | payer, reference, amount | box shown but the server ignores it: Backend add `search` |
| 52 | System Health (`hotel.admin.system`) error list | admin/SystemHealth.tsx | GET /system/errors | - | no (`show`, `feature`) | message, feature | paged fault list |
| 53 | System Log (`hotel.admin.log`) | admin/SystemLog.tsx | GET /system/log | S | yes (100) | event text | |
| 54 | Force Log (`hotel.admin.forceLog`) | admin/SystemLog.tsx | GET /system/force-log | S | yes (100) | event text | |
| 55 | My Profile (`hotel.admin.profile`): devices, account changes, link to sign-ins | admin/Profile.tsx | GET /profile/devices, /profile/changes | - | no | device, date | small lists inside a profile: "no list" candidates |
| 56 | Sign-in history (opened from My Profile) | admin/SignIns.tsx | GET /profile/sign-ins | S | yes (100) | address, place, browser, date | |
| 57 | Guest Portal / Company Portal preview (`hotel.admin.guestPortal`, `.companyPortal`) | admin/PortalPreview.tsx | (the portal screens, rows 78 onward) | (per portal screen) | | | tabs that open the portal pages; each portal page is a row below |

### Platform (Platform Admin, Super Admin console)
| # | Page | Screen file (`groups/platform/`) | List route | Box today | Server `search` | What it searches | Note |
|---|---|---|---|---|---|---|---|
| 58 | Hotels (`platform.hotels`) | Hotels.tsx | GET /platform/hotels | S | yes (100) | name, slug, city, state, GSTIN, group | status filters |
| 59 | Invitations (`platform.invitations`) | Invitations.tsx | GET /platform/invitations | S | yes (100) | hotel, contact, email | |
| 60 | Groups (`platform.groups`) | Groups.tsx | GET /platform/groups | S (client) | **no** (status only) | group name | Backend: add `search` or keep client-side |
| 61 | Hotel admins (`platform.admins`) | Admins.tsx | GET /platform/hotel-admins | S | yes (100) | name, username, email, hotel, group | |
| 62 | All users (`platform.users`) | Users.tsx | GET /platform/users | S | yes (100) | name, username, email, mobile, hotel, group | |
| 63 | Audit log (`platform.audit`) | Audit.tsx | GET /platform/audit | S | yes (in the audit filters) | action, actor, target | |
| 64 | Sign-in history (`platform.signins`) | SignIns.tsx | GET /platform/sign-ins | S | yes (100) | person, address | |
| 65 | Platform admins (`platform.staff`) | PlatformStaff.tsx | GET /platform/staff | S | yes (100) | name, username, email | |
| 66 | Archived hotels (`platform.archived`) | Archived.tsx | GET /platform/archived-hotels | S | yes (100) | name, slug | unpaged |
| 67 | Hotel details, tab Admins (`platform.hotel`) | HotelDetails.tsx (AdminsTab) | inside GET /platform/hotels/{id} | - | n/a | name, username | a short list inside a record |
| 68 | Hotel details, tab Activity | HotelDetails.tsx (ActivityTab) | GET /platform/activity?hotelId | - | no | event | paged list of events |
| 69 | Group details (`platform.group`): hotels, invitations in the group | GroupDetails.tsx | GET /platform/groups/{id}, invitations | - | partly (invitations list yes) | hotel name | lists inside a record |
| 70 | Platform health (`platform.health`) | Health.tsx | GET /platform/health | - | n/a | check name | a status table of about ten checks: "no list" candidate |

### Group Hotel Admin
| # | Page | Screen file (`groups/group/`) | List route | Box today | Server `search` | What it searches | Note |
|---|---|---|---|---|---|---|---|
| 71 | My hotels (`group.hotels`) | GroupHotels.tsx | GET /group/hotels | S | yes (100) | hotel name, city, status | |
| 72 | Invitations (`group.invitations`) | GroupInvitations.tsx | GET /group/invitations | S | yes (100) | hotel, contact | |
| 73 | Hotel admins (`group.admins`) | GroupAdmins.tsx | GET /group/hotel-admins | S | yes (100) | name, username, email, hotel | |
| 74 | Group Dashboard activity card (`group.overview`) | GroupDashboard.tsx | GET /group/activity | - | no | event | a short "recent activity" card: "no list" candidate |
| 75 | Hotel details (`group.hotel`) | GroupHotelDetails.tsx | GET /group/hotels/{id} | - | n/a | | record page |

### Company portal (corporate user)
| # | Page | Screen file (`groups/corporate/`) | List route | Box today | Server `search` | What it searches | Note |
|---|---|---|---|---|---|---|---|
| 76 | Ledger (`corporate.ledger`) | LedgerScreen.tsx | GET /corporate/ledger?period | - | no | bill, payment, date, amount | lines of the account; more than 5,000 lines are flagged |
| 77 | Bills (`corporate.bills`), tabs | BillsScreen.tsx | GET /corporate/bills | T | yes (100) | bill, guest, room | |
| 78 | Payments (`corporate.payments`), tabs | PaymentsScreen.tsx | GET /corporate/payments | T | yes (100) | reference, mode, amount | |
| 79 | Book rooms (`corporate.rooms`): availability cards and "your bookings" | RoomsScreen.tsx | GET /corporate/rooms (availability), /corporate/bookings | - | no | room type; booking reference | the availability form is not a list search; the bookings list is a list |
| 80 | Team & users (`corporate.team`) | TeamScreen.tsx | GET /corporate/team | - | no | name, email | decision 48 removes this page |

### Guest portal (guest user)
| # | Page | Screen file (`groups/guest/`) | List route | Box today | Server `search` | What it searches | Note |
|---|---|---|---|---|---|---|---|
| 81 | Bills (`guest.bills`), tabs | Bills.tsx | GET /guest/bills | T | yes (100) | bill, room, date | |
| 82 | History (`guest.history`), tabs, load more | History.tsx | GET /guest/history | T | yes (100) | stay, room, date | |
| 83 | Order to room (`guest.order`): menu items by category | Order.tsx | GET /guest/menu | - | no | item name, category | a long menu needs it; ask MJ |
| 84 | Book a room (`guest.rooms`): availability cards | Rooms.tsx | GET /guest/rooms (availability) | - | no | room type | availability form, not a list search |

### Employee portal
Decision 47 names it, but there is no Employee dashboard, nav or screen in the code (`ui-shared/dashboards/nav.ts` has guest, corporate, hotel, platform and group only). Nothing to audit yet; when the portal is built, each list page gets the box.

## 3. "No list": pages that are only a form, a single record or a dashboard of numbers
So MJ can say if he wants a search there too.

| Role | Pages |
|---|---|
| Hotel | Dashboard (`hotel.dashboard`, number tiles; its "Recent movements" card is a short list of the latest cash entries, GET /overview/dashboard), Check-in (`hotel.fo.checkIn`, a form with a reservation picker), Reservation (one record), Reservation form, Stay (one record with its charges and members), Lead (one record), Payroll Dashboard (`hotel.payroll.dashboard`, numbers), Website Overview (`hotel.web.overview`), Website Content (`hotel.web.content`, forms), Website Settings (forms), Website Room form, Settings (every tab except Recycle bin, forms), My Profile (a form; its two small lists: devices, account changes), Company, customer, lead, staff, advance, bonus, salary-revision, separation forms and modals, Master Data panels that hold a single value |
| Platform | Dashboard (`platform.overview`), New hotel (a form), Platform settings (a form), My Profile, Hotel details (a record page; its Activity and Admins tabs are rows 67 and 68), Group details (row 69), Platform health (row 70 candidate) |
| Group | Dashboard (`group.overview`), Invite hotel (a form), Hotel details, My Profile |
| Company portal | Dashboard (`corporate.dashboard`, numbers), Company profile (`corporate.profile`, a form), a single bill (`corporate.bill`) |
| Guest portal | Dashboard (`guest.home`, numbers and the current stay), a single bill (`guest.bill`), My account (`guest.profile`, a form) |

## 4. Summary for the two orders
- **List pages in this audit: 84 rows** (a row can hold two screens or the tabs of one list; row 57 is the portal preview, which opens the portal rows below). **Rows with a search box today: 52** = the kit's `SearchField` 37 (some client-side), Handover-style `CashSearch` 6, plain inputs with their own markup 5 (Daily Report, Food Plan, Salary Payments, Masters, the letter picker), portal `PtSearchBox` 4. **Rows without a box: 31.** Every box must become the one shared component in the Handover position (UI order 2).
- **Rows with a list and NO box today (UI adds one): 3, 16, 17, 18, 24, 27, 28, 29, 33, 40, 41, 42, 43, 44, 45, 46, 49, 50, 52, 55, 67, 68, 69, 70, 74, 75, 76, 79, 80, 83, 84.** Several are short lists, tiles or grids (Books, Marks, Deduction Types, Meal Price, Front Desk tiles, website rooms, rates, gallery, services, policies, nearby, calendar, Roles, the small lists inside record pages, Platform health, the portal availability cards): MJ's call whether a box is wanted there (section 3 lists the pages that are not lists at all). Row 80 (Team & users) goes away with decision 48.
- **Server routes that already accept `search`:** handover, revenue, expenses, billing bills and advances, companies, customers, leads, ledger overview and account, employees, staff emails, salary profiles, payments, the four pay lists (slips, advances, bonuses, separations), payroll log, reservations, stays, rooms, Pathik queue, enquiries, admin users, admin recycle, profile sign-ins, system log, force log, platform hotels, invitations, hotel admins, users, audit, sign-ins, staff, archived, group hotels, invitations and admins, corporate bills and payments, guest bills and history.
- **Backend: routes that need `search` added (or an explicit "client side by design"):** Razorpay payments (the page has the box, the server ignores it), Groups list, platform Activity and group Activity, Attendance sheet, Staff Meals, Meal Price, Monthly and Period reports, Attendance Marks, Deduction Types, Roles, Master lists and payroll master, System Health errors, Website rooms, rates, photos, services, policies and nearby, corporate Ledger, Team and Bookings, guest Menu, payroll Companies (the repository supports words, the route does not pass it), Books.
- **Semantics to settle before Backend adds routes:** (1) the Handover route filters in memory over the window; the SQL routes use `position(word in lower(concat_ws(...)))`, which cannot use an index and scans the table (no trigram index exists in any migration, so "use pg_trgm" needs a new hotel migration with `gin_trgm_ops` on the searched text); (2) the length limit differs (100 on most, 200 Handover, 500 cash books): one rule is needed; (3) the cash books' operators ("phrase", -not, >, <, ranges) exist only in Revenue and Expenses, while the shared box's tooltip promises them everywhere.
- **Search box position:** the Handover position is the first item of the page head's tools, before the primary button. Pages with a filter bar (Billing, Reservations, Companies) and the payroll `PayLayout` slot place it in other spots today: UI decides the one place (the Handover head) and moves them.
- **The header search** (`pallav/GlobalSearch.tsx`, `search/api.ts`, `shell/RoleDashboard.tsx:615`, nav `searchableScreens`) can be unreferenced as the order says; its server route `GET /api/v1/search` stays.

