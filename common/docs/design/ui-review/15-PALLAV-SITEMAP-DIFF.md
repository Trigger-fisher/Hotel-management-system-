# 15 - Exact sitemap of Pallav (Hotel user, Guest portal, Company portal) and the diff against ours

MJ 2026-10-06: "I want the exact UI and PAGES in the Hotel user." Source: Pallav GitHub clone running locally (HEAD ae0dd7c): `resources/views/layouts/app.blade.php` (sidebar), `app/Support/PayrollContext.php` (payroll rail), `resources/views/portal/_layout.blade.php` (portals); ours: `ui-shared/dashboards/nav.ts`. Status: HELD until the Lead releases the UI sessions. This file covers **menu names, sections, order and which pages exist**. Per-page columns/filters/actions/KPIs are compared screen by screen in the parity pass (13) with paired shots.

Pallav's menu is **permission-gated** (`@can`): a Hotel User sees only the entries their role is granted; the SuperAdmin/Hotel Admin sees all. Our `adminOnly` flag maps to that; the entries below are the full set.

## 1. HOTEL: Pallav sidebar, top to bottom (exact names, icons Bootstrap Icons)
| Section | Entry (route) | Icon |
|---|---|---|
| OVERVIEW | Dashboard (`dashboard`) | bi-speedometer2 |
| GUEST BILLING | Guest Advances (`bill-master.advances`) | bi-wallet2 |
| | Bills (`bill-master.bills`) | bi-receipt |
| DAILY CASH | Revenue (`revenue.index`) | bi-cash-coin |
| | Expenses (`expense.index`) | bi-cash-stack |
| | Shift Handover (`shift-handover.index`) | bi-arrow-left-right |
| COMPANIES | Company Profiles (`company.index`) | bi-building |
| | Customers (`customer.index`) | bi-people |
| | CRM (`customer.crm.index`) | bi-kanban |
| | Company Ledger (`company.ledger`) | bi-journal-text |
| STAFF | Payroll (`payroll.index`, opens Company Listing) | bi-people-fill |
| REPORTS | Daily Report (`reports.index?type=daily-report`) | bi-calendar-day |
| | Food Plan Report (`reports.index?type=food-plan`) | bi-egg-fried |
| FRONT OFFICE (shown if any of the 4 is permitted) | Front Desk (`pms.board`) | bi-grid-3x3-gap |
| | Reservations (`pms.reservations.index`) | bi-calendar-plus |
| | In House (`pms.stays.index`) | bi-person-check |
| | Rooms (`pms.rooms.index`) | bi-door-open |
| WEBSITE (if any website permission) | Website (`website.index`) | bi-globe2 |
| | Guest Enquiries (`website.enquiries.index`) | bi-inbox |
| ADMINISTRATION | Master Data (`masters.index`) | bi-sliders |
| | User Accounts (`users.index`) | bi-people |
| | Roles & Permissions (`access.index`) | bi-shield-lock |
| (SuperAdmin only, same section) | Settings, Razorpay, Guest Portal (preview), Company Portal (preview), System Health, System Log, Force Log | bi-gear, bi-credit-card-2-front, bi-phone, bi-building-check, bi-heart-pulse, bi-clock-history, bi-lightning-charge |
| Bottom of the sidebar | user card (name + role, online dot) = **My Profile** (`profile.show`), "Collapse menu" button | |
| Top bar (not menu) | Accounting year selector (FY), Force mode, day/night button, user menu (My Profile, Change password, Sign out) | |

**Payroll** opens the **Company Listing** (home of the module). Choosing a company opens the second panel ("Payroll", company switcher card, then the rail below; Payroll Master/Log under ADMINISTRATION in the panel):
| Rail section | Pages (exact labels) |
|---|---|
| Company | Dashboard |
| Staff & Attendance | Staff; Attendance; Resignations; Staff Emails |
| Pay Adjustments | Salary Revisions; Advances; Bonus & Incentives; Staff Meals |
| Salary | Salary Payments; Salary Slips |
| Reports | Monthly Report; Period Report |
| Letters | Joining Letter; Experience Letter |
| Setup | Attendance Marks; Deduction Types; Meal Price |
| Administration | Payroll Master; Payroll Log |

**Website** (second panel/tabs inside the Website page): Overview, Enquiries, Rooms (+ create/edit), Rates, Calendar, Gallery, Content, Services, Policies, Nearby, Settings (+ Google connect).

## 2. HOTEL: diff against ours (`nav.ts`)
| # | Ours today | Pallav | Action |
|---|---|---|---|
| 1 | Section order: Overview, **Front Office**, Guest Billing, Daily Cash, Companies, Staff, Website, Administration | Overview, Guest Billing, Daily Cash, Companies, Staff, **Reports**, **Front Office**, Website, Administration | REORDER: Front Office moves after Reports |
| 2 | Overview has Dashboard, **Reports**, **Books (years)** | Overview = Dashboard only | MOVE Reports to its own section; REMOVE "Books (years)" from the menu: Pallav has no such page entry, the books/years live in the **Accounting year selector** in the top bar (route `/books` is that switch) |
| 3 | one "Reports" item | section REPORTS with 2 entries: **Daily Report**, **Food Plan Report** | SPLIT into two pages with exact names |
| 4 | Front Office: Front Desk, Reservations, In House, **Check-in**, Rooms | Front Desk, Reservations, In House, Rooms | REMOVE "Check-in" from the menu (Pallav reaches it by the "Walk-in check-in" button on Front Desk/Reservations and the check-in form `front-office/check-in`); keep the page |
| 5 | Companies order: Profiles, **Ledger, Customers, CRM** | Company Profiles, **Customers, CRM, Company Ledger** | REORDER |
| 6 | Staff: Payroll | Payroll | same (opens Company Listing) |
| 7 | Payroll sub-menu: 3 sections Payroll/Pay/Letters & exits with Companies, Payroll Dashboard, Staff, Attendance, Attendance Statuses, Deductions, Staff Emails, Salary Update, Salary Payments, Salary Slips, Advances, Bonus / Incentives, Staff Meals, Payroll Reports, Joining Letter, Experience Letter, Resignations, Payroll Master, Payroll Log | company switcher + 8 rail sections (table above) | REGROUP into Pallav's sections and order; RENAME: Payroll Dashboard to **Dashboard**; Attendance Statuses to **Attendance Marks**; Deductions to **Deduction Types**; Salary Update to **Salary Revisions**; Bonus / Incentives to **Bonus & Incentives**; SPLIT Payroll Reports into **Monthly Report** and **Period Report**; ADD **Meal Price** (setup page `payroll/food-price`; ours has only Staff Meals); REMOVE "Companies" from the rail (it is the company switcher card + the Company Listing home); Payroll Master/Log under an ADMINISTRATION group in the panel |
| 8 | Website entries: Website, Guest Enquiries (admin only) + sub-menu Overview, Enquiries, Rooms, Rates, Calendar, Gallery, Content, **Services, Policies, Nearby (one page)**, Website Settings | same two sidebar entries; sub pages Overview, Enquiries, Rooms, Rates, Calendar, Gallery, Content, Services, Policies, Nearby, Settings | SPLIT "Services, Policies, Nearby" into **three pages**; RENAME "Website Settings" to **Settings** |
| 9 | Administration: User Accounts, Roles & Permissions, Master Data, Settings, **Online Payments**, System Health, **My Profile** | Master Data, User Accounts, Roles & Permissions, then (SuperAdmin) Settings, **Razorpay**, **Guest Portal**, **Company Portal**, System Health, **System Log**, **Force Log** | REORDER (Master Data first); RENAME Online Payments to **Razorpay**; ADD System Log, Force Log, and the two portal preview entries (SuperAdmin/Hotel Admin; they open the Guest and Company dashboards in preview); REMOVE "My Profile" from the list (it is the user card at the bottom of the sidebar) |
| 10 | no user card, collapse in header | bottom user card + "Collapse menu" | per 13 §1 |
| 11 | top bar: breadcrumb + hotel pill | Accounting year, Force mode, day/night, user menu with Change password | per 13 and 14 |
| 12 | Quick-action diamond sheet on mobile | none | MJ keeps it; Pallav has no equivalent (list as "not Pallav") |

## 3. GUEST: Pallav guest portal (`portal.*`)
Public: Sign in / Register with a **Guest | Company** segmented switch (`portal.sign-in`, `portal.register`). Sidebar: **Overview** Dashboard (`portal.home`) | **Billing** Bills, History | **Stay** Order to room, Book a room | **Account** My account.
| Ours (`nav.ts` guest, one section "My stay") | Pallav | Action |
|---|---|---|
| Home | Dashboard | RENAME, first |
| Rooms | Book a room | RENAME, move to Stay |
| Order | Order to room | RENAME, move to Stay |
| Bills | Bills | same, section Billing |
| History | History | same, section Billing |
| Profile | My account | RENAME, section Account |
Order becomes: Dashboard; Bills, History; Order to room, Book a room; My account. Sections Overview/Billing/Stay/Account. (Pallav's portal is a "preview" with a fixed demo guest, so real page content comes from our backend; layouts come from `resources/views/portal/*.blade.php`.)

## 4. CORPORATE: Pallav company portal (`portal.company*`)
Sidebar: **Overview** Dashboard | **Accounts** Ledger, Bills, Payments | **Stay** Book rooms | **Company** Company profile, Team & users.
| Ours (one section "Company") | Pallav | Action |
|---|---|---|
| Dashboard, Rooms, Bills, Payments, Ledger, Team, Profile | Dashboard; Ledger, Bills, Payments; Book rooms; Company profile, Team & users | REORDER into 4 sections; RENAME Rooms to **Book rooms**, Team to **Team & users**, Profile to **Company profile** |

## 5. Pages to ADD / MERGE / REMOVE (summary for the Lead)
- ADD (menu entries, pages mostly exist as screens): Food Plan Report and Daily Report as two entries; Meal Price; Monthly Report and Period Report as two pages; Services, Policies and Nearby as three pages; System Log; Force Log; Guest Portal and Company Portal preview entries; Masters first in Administration; the company-switcher card and Company Listing as the payroll home; the accounting-year selector in the top bar.
- REMOVE from menus: Books (years) (becomes the accounting-year selector), Check-in (button only), My Profile in the list (sidebar user card instead), Payroll "Companies" rail item.
- RENAME: see tables. MERGE: none needed (Pallav splits more than we do).
- Section order and entry order must match tables 1, 3, 4 exactly; names are case-exact ("Expenses", "In House", "Roles & Permissions").
- Permission gating stays the same as Pallav (an entry hidden without its `view` permission; the Front Office, Website and Administration headings disappear when empty).
- Check at build time: because we have a 4-level permission system and Pallav has per-route `@can` keys, the Lead's `nav.ts` mapping must keep one permission key per entry (`pms.board.view`, `masters.view`, ...). Reports have no permission key in Pallav's sidebar (shown to all): confirm with MJ whether Hotel User sees Reports.
