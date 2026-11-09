# 13 - Pallav parity (MJ: "100% same", except unreadable text and unavoidable phone arrangement)

Reviewer: UI reviewer, 2026-10-06. **Reference = Pallav actually running** (GitHub clone, HEAD ae0dd7c, Oct 4 2026) at http://127.0.0.1:8000 from `%LOCALAPPDATA%\HMS\pallav-ref`, fresh scratch SQLite DB (migrations + MockDataSeeder + PayrollDemoSeeder, 2FA off for the scratch superadmin). Demo data, not MJ's real data. Encrypted fields of the real dump cannot be read (no APP_KEY), so they are not used. Shots in `docs/design/ui-review/pallav-ref/` (pallav-*.png, ours-*.png, diff-*.png).
Tools (scratchpad): `cap.mjs` (any URL), `pcap.mjs` (log in to Pallav, capture paths), `meas.mjs` (computed styles), `diff.py` (pixel diff + heat map).

## Verdict (honest)
Our web dashboard is the **same family, not the same design**. First measured pair (Dashboard, 1440x900 light): 13.5% of pixels differ, but pixel % under-reports because both pages are mostly pale background; the visible structure differs everywhere. Web is about **55-60%** of the way to Pallav, mobile about **40%** (Pallav's phone layout is a narrow icon-rail sidebar + top icon bar; ours is bottom dock).
**Gate** for "accepted": pixel diff < 1.5% on the same data AND zero computed-style mismatches on the key elements AND every remaining difference listed. A screen with a structural difference below is automatically "different".

## 1. App shell (all screens) - DIFFERENT
| Part | Pallav (measured from screenshots + CSS) | Ours |
|---|---|---|
| Brand | **Playfair Display** serif "Hotel Pallav" + tagline MANAGEMENT SUITE, "HP" mark tile with sheen; HMS name text to come from MJ's copy, same treatment | Inter "HMS" + hotel name |
| Sidebar | 244 wide, violet glass panel, blurred blobs, **flat section lists** with tiny uppercase headings (OVERVIEW, GUEST BILLING, DAILY CASH, COMPANIES, STAFF, REPORTS), no accordion/chevrons, icon tiles 32px, active item = bright glass pill with white icon tile + left marker, user card at the bottom with online dot + double-chevron collapse button | accordion sections with chevrons and rules, no glass pills, no user card styling, collapse chevron in header |
| Second panel (sub-nav 276) | Opens for modules with sub pages (Payroll shows a violet "Payroll - Choose a company" card, an info note, then ADMINISTRATION list: Payroll Master, Payroll Log) | none |
| Top bar | one white rounded bar: page icon tile + small eyebrow (OVERVIEW/STAFF) over the page title (Dashboard, Company Listing), then **greeting ("Good night, Super"), live date/time, weather (Rajkot 26°C Clear), Accounting year selector (FY 2026-27), dark-mode button, Force mode, user chip with role** | breadcrumb "Overview" + hotel pill + user chip |
| Page intro | purple (#6D28D9-ish) sentence under the bar, actions on the same row: ghost text buttons (Record deposit, Record expense) + one gradient primary (Handover) | H1 title + grey subtitle + outline buttons |
| Phone (390) | **no bottom bar**: a 68px violet icon-rail sidebar fixed on the left with the user + collapse at the bottom, a compact top bar of icon buttons, content to the right | bottom dock + diamond (not Pallav; MJ decided it stays, in Pallav colours/icons) |
| Icons | Bootstrap Icons everywhere | custom set |
| Night | pms-dark.css: sidebar #151024 family, own surfaces | derived by me (unverified until compared with dashboard-dark-1440) |

## 2. KPI tiles - DIFFERENT
Pallav `.kpi`: white card radius ~18, soft layered purple shadow, a **gradient icon tile** (purple, green #34D399->#059669, red/pink, amber #FBBF24->#B45309), uppercase label 11.5px/700/.04em, **centred big value (~26px/800)**, a **pill** underneath (tinted: purple "Recorded", green "17% vs yesterday", purple "Across today's Handovers"), a blurred blob in the bottom-right corner, hover lift -3px. 4 across at 1440 (Shift Handover row and Cash row). Ours: flat pastel icon tile, left-aligned value, plain grey sub text, 3-4 across without the pills/blobs.

## 3. Dashboard content - DIFFERENT
Pallav order: intro + actions, SHIFT HANDOVER (4 KPI, link "All Handovers ->"), CASH (4 KPI, "Revenue ->"), then 2 columns: **Cash flow bar chart** (In/Out legend, 7/14/30 days segmented control, y axis 0-40k, purple bars) beside **Needs attention (count badge)**. Ours: Needs attention first as a full-width list card, KPI rows, chart below. Titles/labels differ too ("Handover" capitalised "All Handovers", "Hotel book · Food book" split in the KPI pill).

## 4. Auth - CLOSE (login measured)
Measured Pallav login: input 42px/14px/#D9CEF6/radius 11, button 44px, label **14.5px/600**, radius 12 (Web UI 1 used 16px: fix). Kept on purpose (text readability): muted #5E5775, copyright 72%, button fill p600->p800. Phone: input text 16px (allowed adaptation). Everything else per spec 09 + a side-by-side still to do.

## 5. Page-level gaps (CORRECTED 2026-10-06)
**Correction:** my first version said HMS "lacks" many pages. The UI sources show screens already exist for most of them (admin: Masters, Payments=Razorpay, Profile, Roles, Settings, System, Users; website: enquiries, calendar, gallery, nearby, policies; recycle bin, reports, books, debit bills; guest and corporate portals). So the page gaps are mainly **BACKEND not built** and **look not matching Pallav**, not missing screens. "UI" below = a screen exists in `dashboards/groups/*` (look unverified against Pallav); "BE" = backend built by B1-B6b.
Source: Pallav `routes` (113 named GET routes) + controller `use` lines, from the running clone. Full machine list: `%LOCALAPPDATA%\HMS\pallav-refoutes.md`.

| Pallav route(s) | Controller | Main data (Pallav models) | HMS UI | HMS BE |
|---|---|---|---|---|
| /dashboard | DashboardController@index | Employee, Food/HotelCashDeposit+Withdrawal, FoodMiscExpense | yes | partial (cash, payroll figures built; summary endpoint not) |
| /revenue, /expense, /shift-handover (+view) | RevenueController, ExpenseController, ShiftHandoverController | HotelCashDeposit, FoodCashDeposit, withdrawals, misc expenses, ExpenseCategory/Item/Line, ShiftHandover | yes | yes (cash) |
| /bill-master/bills, /advances | BillMasterController | BillMasterBill, BillMasterAdvance, CompanyProfile, MealPlanRate | yes | yes (billing) |
| /bill-master/debit-bills | closure in routes | BillMasterBill (debit mode, `debit_bill_date` null) | yes | check (derived from bills; confirm done in B1/B2) |
| /books | BooksController | none (year switch, "inBooks" filter) | yes | no |
| /company, /company/{id}/view, /company/ledger (+pdf, summary-pdf) | CompanyProfileController, CompanyLedgerController | CompanyProfile, bills, advances | yes | yes (companies) + PDF B7 |
| /customers, /crm (+create/edit/show) | CustomerController, CrmController | Customer, CrmLead, CrmActivity | yes | yes (companies/CRM) |
| /front-office (board), /reservations, /check-in, /in-house, /stays/{id}, /rooms | Pms\BoardController, ReservationController, StayController, RoomController | Pms\Room, Reservation, Stay, Charge, IdProofType | yes | yes (front office) |
| /masters, /masters/plan-rates | MasterDataController, MealPlanRateController | OptionSet/OptionItem, MealPlanRate | yes (Masters) | no (option sets seeded only) |
| /payroll* (companies, staff, attendance, statuses, advances, bonus, deductions, food charges/price, salary payments/slips/update, resignations, letters, emails, reports monthly/period) | Payroll\* | Employee, PayrollCompany, SalaryProcessing, Attendance*, PayrollAdvance, BonusIncentive, Deduction, EmployeeSeparation, JoiningLetter, ExperienceLetter, StaffEmail | yes | yes (B5, B6a, B6b built; reports/letters/emails PDF = B7) |
| /payroll/master, /payroll/log (+pdf), /payroll/dashboard | PayrollMasterController, PayrollLogController, PayrollDashboardController | PayrollMasterItem, PayrollLog | partly | log rows written by B6; viewer + master editing not built (Admin task) |
| /reports (+download) | ReportController | none (aggregates over cash/bills/payroll) | yes | no |
| /access, /users, /users/{id}/detail | AccessController, UserController | Role, RolePermission, UserPermission, User, UserAuditLog | yes (Roles, Users) | partly (4 levels + permission tables in M1; admin endpoints not built) |
| /settings, /settings/backup/google/* | SettingsController, BackupController | Settings (GSTIN etc.), Google Drive OAuth | yes | no |
| /profile, /profile/sign-ins, /profile/two-factor/confirm, /change-password | ProfileController, AuthController | User, ActivityLog, UserAuditLog | yes | auth built; profile/2FA/sign-ins endpoints not built |
| /recycle-bin | RecycleBinController | soft-deleted rows across modules | yes | derived ability only; no endpoint |
| /razorpay | RazorpayPaymentController | RazorpayPayment, RazorpayEvent | yes (Payments) | no (needs MJ's keys later) |
| /system-health (+errors, map, features), /system-log (+pdf), /force-log (+pdf) | SystemHealthController, SystemLogController, ForceLogController | health_checks, feature_errors, SystemLog, ForceLog | yes (System) | no |
| /website (+calendar, content, enquiries, gallery, nearby, policies, rates, rooms(+create/edit), services, settings, google/*) | Website\* | Site\Room, DateRate, DateInventory, RatePlan, PageContent, Enquiry, GalleryPhoto, NearbyPlace, PolicyCard, Service, Settings | yes | no (public site + admin) |
| /portal/company/* (dashboard, bills, ledger, payments, profile, rooms, team), /portal/sign-in, /portal/register | PortalCompanyController, PortalSignupController | CompanyProfile, BillMasterBill, Customer | yes (corporate) | no |
| /portal, /portal/bills, /history, /order, /profile, /rooms | PortalPreviewController (static preview in Pallav) | none (preview) | yes (guest) | no |
| Top bar features: Accounting year (FY), Force mode, weather | layouts/app.blade.php + Settings/ForceLog | accounting-year lock, ForceLog | no (add) | accounting-year lock + force ability exist |

## 6. What the teams change first (screen by screen) - see the message to Web UI 1 / Mobile UI 1
1. Icons: Bootstrap Icons, same names as Pallav's views (grep `bi-`).
2. Shell: sidebar structure (flat sections, glass pill active, user card, collapse), Playfair brand, top bar content, second panel, phone icon-rail.
3. KPI tile + page intro pattern + Cash flow chart + Needs attention placement.
4. Then module by module against its CSS file: pms-payroll.css (Payroll), cashbook.css (Revenue/Expense), shift-handover.css, company-ledger.css, bill-master.css, front-office.css, access.css, website-admin.css, settings.css, system-health.css.

## 7. Not Pallav (MJ decided keep, but recolour/re-icon to Pallav): mobile dock + diamond + quick actions sheet; SPA single page auth.
Not Pallav and NOT decided: collapsing large title, shimmer skeletons, empty-state halo, slide transitions, Press scale. Mark for MJ.
