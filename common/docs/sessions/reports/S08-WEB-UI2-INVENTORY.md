# Web UI 2: Pallav source inventory for payrollCore, payrollPay, companies, reports

Pallav source: `%LOCALAPPDATA%\HMS\pallav-ref\resources\views`. Reference shots (Pallav running, 1440 wide, day and night, same demo data): scratchpad `qa3/shots/ref-{day,night}-*.png`. Written 2026-10-06.

**CSS common to every payroll page:** pms.css, pms-ui.css, pms-dash.css, pms-nav.css, pms-sidebar.css, pms-header.css, pms-filterbar.css, pms-payroll.css, payroll-look.css, pms-dark.css (night). The payroll layout is `payroll/layout.blade.php`; the company switcher card is `payroll/partials/_company-switch.blade.php`; shared partials: `_kpi`, `_pager`, `_month-nav`, `_phone-field`, `_report-table`, `_food-table`.

## payrollCore
| Our screen | Pallav view | Extra CSS / JS | Data from our mock | Gaps in our mock |
|---|---|---|---|---|
| Companies (Company Listing) | payroll/companies/index + partials/_company-fields | - | PayrollCompanyRow list, 3 KPIs (companies, staff on payroll, salaries outstanding) | KPI counts; company logo and signature uploads (`logo`, `signature_image`); PDF view of a company |
| Dashboard | payroll/pages/dashboard + _kpi | - | getDashboard | check KPI set against Pallav (4 tiles + attention list) |
| Staff | payroll/pages/staff + _employee-fields, _rejoin-fields, _phone-field | pms-forms.js, pms-filterbar.js | Employee list, Employee, options | `photo`, `resume`, `id_proof_image`, `id_proof_back_image` uploads (we only have resumeFileName); 4 KPIs (active, monthly salary, joined this year, paid by bank); row actions (PDF, letter, email, send, edit, delete) |
| Attendance | payroll/pages/attendance + _month-nav | pms-forms.js | AttendanceSheet | keyboard-entry grid like Pallav; overtime per day |
| Attendance Marks (our "Statuses") | payroll/pages/attendance-status + _attendance-status-fields | - | AttendanceStatus | fields match (name, shortcut_key, color, attendance_percentage, status_type, skips_food) |
| Deduction Types | payroll/pages/deduction + _deduction-fields | - | Deduction | match (name, amount) |
| Staff Emails | payroll/pages/staff-emails + _staff-email-card | staff-emails.css, staff-emails.js, profile.css, system-log.css | listStaffEmails, feed | live feed UI; cards layout |
| Resignations | payroll/pages/separation + _separation-fields, _rejoin-fields | - | Separation list | `document` upload; employee view / PDF |

## payrollPay
| Our screen | Pallav view | Data / gaps |
|---|---|---|
| Salary Revisions (Salary Update) | salary-update, salary-update-show, _salary-revise, salary-update-history | matches (effective_date, salary, designation, department, hours, mode, bank fields); history page |
| Advances | advance + _advance-fields | `deduction_type` / `deduction_amount` map to recovery type and instalment; datetime-local with the "stamp set by hand" flag (data-sets-stamp) |
| Bonus & Incentives | bonus-incentive + _bonus-fields | matches (employee, entry_date, type, amount, remarks) |
| Staff Meals | food-charges + _food-table | Pallav has TWO pages: food-charges (staff meals) and food-price (Meal Price): ours has Meals only, so Meal Price needs its own screen |
| Salary Payments | salary-payment (22 KB, the largest page) + payment register PDF | status and amount edit, bulk update, month nav |
| Salary Slips | salary-slip + salary-slip PDF | |
| Monthly / Period Report | monthly-report, period-report, _report-table | two pages (ours has one Reports screen); PDF and download |
| Joining / Experience Letter | joining-letter, experience-letter | template editor + generate |
| Payroll Master | master + _master-fields + master-search.js | list of option lists; fields `label`, `value` |
| Payroll Log | log | profile.css, shift-handover.css, system-log.css; filters; PDF |

## companies
| Our screen | Pallav view | Extra CSS / JS | Gaps |
|---|---|---|---|
| Company Profiles | company/index, company/_fields, company/pdf | company.css, company.js, cashbook.css, shift-handover.css | fields match (name, address, pincode, email, mobile_number, phone_number, gst_number, country, nationality, instruction); PDF |
| Customers | customer/index, customer/form | company.css, cashbook.css | fields match (name, mobile, email, address, city, id_proof_type, id_proof_number, notes, is_active); reset login; PDF |
| CRM | crm/index, crm/form, crm/show | crm.css, crm.js, company.css | fields: assigned_to, check_in, check_out, email, guests, interest, mobile, name, next_follow_up, notes, source, value; stage drag and activity log |
| Company Ledger | company_ledger/index, show, pdf, summary-pdf | company-ledger.css, cashbook.css | statement + summary PDF |

## reports
Pallav `reports/index` (+ partials daily-report, food-plan, and cash-book, bill-register, advance-ledger, receivables, revenue-sources, expense-heads, monthly-summary) with payroll-look.css and shift-handover.css. Our scope is Daily Report and Food Plan Report (two entries in the new sitemap).

## Whole-job notes
- Pallav pages use Bootstrap markup (cards, tables, modals, dropdowns, forms) plus its own classes; with the vendored CSS most of the work is writing the same markup in TSX.
- File uploads (photos, logo, signature, ID images, resume, separation document) have no mock fields. Needed from the Lead: a mock-level `*FileName` / data URL field per upload, or leave them as non-functional pickers.
- Behaviour that is JS-driven in Pallav (pms-forms.js, pms-filterbar.js, pms-live.js, master-search.js, staff-emails.js) must be re-done as React hooks.
