# Behaviour spec: Payroll core (companies, staff, attendance, attendance marks, deduction types, staff emails, dashboard)

Source: Pallav `app/Http/Controllers/Payroll/{PayrollCompanyController,PayrollDashboardController,EmployeeController,AttendanceController,
AttendanceStatusController,DeductionController,StaffEmailController}.php`, `app/Support/{PayrollContext,PayrollScope,PayrollRules,PayrollMasters,
PayrollLogger,PhoneCountries}.php`, `app/Services/Payroll/{StaffShareMailer,OfferLetterMailer}.php`, `SalaryProcessor::employeesWithIncompleteAttendance`,
`app/Models/{PayrollCompany,Employee,AttendanceMonth,AttendanceStatus,StaffEmail}.php`, `tests/Feature/Payroll/{PhoneNumberTest,StaffFormTest,
StaffEmailsTest,PayrollRulesTest,CompanyIsolationTest,FixedCompaniesTest,PayrollPagesTest}.php`.
**HMS:** marks a deliberate difference. Golden fixtures: `db/scripts/php/generate-payroll-core-fixtures.php` → `fixtures/payroll-core.json` (REAL PHP:
PhoneCountries required verbatim from `db/scripts/php/pallav/PhoneCountries.php`, the attendance save's cell rule, progress, month completeness).
Tests `tests/server/payrollCore*.test.ts`. Tables: hotel migration `0007_payroll_core`. Repositories: `src/server/repos/payrollCore.ts` (approved).
Contract: `ui-shared/dashboards/payrollCore.ts` and the requests in `docs/API.md` (Payroll core).

## 1. The company context (`PayrollContext`, `PayrollScope`)

- Pallav keeps the open company in the session. **HMS:** it is in the URL (`/payroll/companies/{companyId}/...`); every call checks it belongs to this
  hotel's database and is active, else 404 "Select a company first." (`currentOrFail`). Every row is read through its company: another company's
  employee, status, deduction or month reads as absent (404), as `PayrollScope::ensure` aborts 404 (CompanyIsolationTest).
- A posted list of ids (employees to email, deductions to assign) must all be the company's (`belongsToCompany`): "The selected {field} is invalid."
- Companies are FIXED (`PayrollCompany::FIXED`, FixedCompaniesTest): **HMS:** seeded at provisioning (Worker A; codes HP01 and PF01, names from the
  hotel), never created on a read; no add, delete or deactivate. Update (`PayrollCompanyController::update`) writes the details only (name and code
  are dropped): mobile, address, city, state, authorised person name (max 150) and designation (max 100) required; owner, authorised person
  name max 150; mobile and authorised mobile max 15; email and authorised email `email` max 254; pincode max 20; PAN and TAN max 20; PF, ESIC and
  PT registration max 50; bank name and branch max 150; account number max 50 (**HMS:** plain data, MJ: stored and returned as typed, absent = keep); IFSC max
  20. Logo and signature: uploads (later task, with the media store). "Company updated."
- Listing (`PayrollController`): the fixed order, with staff and active staff counts from ONE grouped count.

## 2. Permissions (`Support/Permissions.php:250-335`, ruled 2026-10-05)

Module `payroll`; parts used here: `payroll.dashboard` (view), `payroll.staff` (full; staff and staff emails), `payroll.attendance` (edit;
the sheet, save, generate, re-generate, unlock), `payroll.attendance-status` (full), `payroll.deduction` (full). HMS levels: create, edit, delete =
full. The company list needs ANY payroll part's view; editing a company needs the module's edit. Options and lookups need `payroll.staff` view.

## 3. Staff (`EmployeeController`)

- Fields (`rules()` :28-104): employee ID required max 50, unique per company among live staff ("This Employee ID is already used within the selected
  company."); name required max 150; designation required max 100; department max 100; shift max 20 and one of Master Data `shift` when that list
  has values; responsibilities; joining date required; salary required numeric ≥ 0 (paise); daily working hours required 0.5-24; mobile required
  ("A mobile number is needed."), judged by its country (§4); address max 255; emergency contact name max 150, relation max 60, number optional
  (§4); payment mode required, one of Payroll Master `salary_payment_mode` (defaults Cash, Bank); with the mode "Bank": bank name, account holder,
  account number, IFSC required ("Bank name is required when the payment mode is Bank." and the same for "Account holder name", "Account number",
  "IFSC code"); bank name and holder max 150, account number max 50, IFSC max 20, branch max 150; ID proof type max 100, number max 50; email
  required ("An email address is needed - the appointment letter is sent to it."), `email` max 254, lower-cased and trimmed, unique per company
  ("Another employee in this company already uses this email address."); date of birth; gender one of Payroll Master `gender` (Male, Female,
  Other); nationality, country and pincode max 100; qualification and institution max 150; skills max 2000; deductions: each row's deduction the
  company's, type One Time or Monthly (default Monthly), amount ≥ 0 (default 0); a row with no deduction is skipped.
- **HMS sealed**: account number, IFSC, ID proof number and emergency number are AES-256-GCM in their own column contexts; the list never carries
  them; a read gives `accountNumberLast4` and `idProofLast4`; `getEmployee` gives IFSC and the emergency number in full. Write-only inputs: absent
  = keep, "" = remove.
- Create: `created_by` = the session user. The deductions are synced in the same unit. With `sendOfferLetter` the appointment letter is queued
  AFTER the save, and its outcome comes beside the record, never instead of it (`store` :175-189): "Employee added. {message}" or "Employee added,
  but {message, first letter lower-cased}".
- Edit (`update` :206-243): `PayrollRules::canEdit`: someone who can write, and the SuperAdmin, an Admin, or whoever added the person: "Only an Admin
  or whoever added this person can edit their record." (ForceMode steps past it). Editing never sends the letter. syncDeductions (:245-263):
  assignments of the person not kept are hard-deleted, kept ones (by id, the person's own) updated, new ones inserted.
- Delete (`destroy` :265-279): `PayrollRules::canDelete`: Admin or SuperAdmin: "Only an Admin can delete a staff record." Then
  `blockingDependency` (Attendance Management, Advance Management, Bonus & Incentive Management, Salary Processing, Staff Advance Salaries): "This
  employee is already used in {X} and cannot be deleted. Remove the dependent records first, or mark the employee Inactive." Both locks step
  aside under ForceMode. To the recycle bin; restore and purge for recycle-bin users (`canUseRecycleBin`); purge refused while a dependency names
  the person. Toggle active: "Employee status updated."
- List: most recent joiner first (joining date desc, id desc); **HMS:** paged, every word in name, code, designation, department, email or mobile;
  `canEdit` / `canDelete` per row. Lookup: code or name prefix, at most 50.
- Offer letter (`sendOfferLetter`) and share (`share`): only for the company's staff (404 otherwise).

## 4. Phone numbers (`PhoneCountries`; golden: every case in `fixtures/payroll-core.json`)

41 countries, India first and the default ("91"); each has min and max national digits and an optional leading-digit rule. `normalise(raw,
selected)`: a "+" or "00" names the country itself (longest dial code wins) and overrides the selector; else the digits, with a trunk 0 dropped
when one too many, and the dial code typed without "+" dropped when what remains fits the country and the whole does not. `check`: "Choose a
country code from the list."; India: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9."; others "Enter a valid {Country} number of {n}
digits." (n = "min to max" when they differ) or "That does not look like a {Country} mobile number.". Display: "+91 98765 43210" (India split five
and five), else "+{dial} {national}". With nothing typed the country stays (or becomes) "91". The country field must be in the list ("The selected
contact country is invalid." is Laravel's `in`; the check's own sentence is what the person sees on the number).

## 5. Attendance (`AttendanceController`, `AttendanceMonth`)

- The sheet (`index` :19-55): a month after the current one is the current one; the month row is made on first open (one per company and month).
  Active employees by name (**HMS:** paged, ONE query for the page's entries); active statuses by name; progress: filled (days with a status),
  expected = people × (days so far in the current month, else the whole month), required = people × days; who is incomplete.
- Save (`save` :58-128): the month must be editable ("This attendance month is locked. An Admin must unlock it before changes can be made.");
  keys are upper-cased and trimmed; any key not an ACTIVE status of the company fails the whole save ("Unknown attendance status shortcut key(s):
  {keys}. Only keys configured in Attendance Status Master are allowed.", each key once in the order met); days outside the month are skipped; a
  day with no key and no overtime is removed; otherwise the status is COPIED onto the day (key, percentage, skips food) with its overtime. Logged
  "Attendance saved for {m}/{yyyy}". **HMS:** the rows sent must be the company's live staff (else 404); a month never opened, or still to come, is
  404 (Pallav's route binding); the month is locked for update while saving; the write is batched; overtime left out of a row keeps what is
  stored. The accounting-year guard (Pallav `InAccountingYear` on AttendanceMonth, year and month: the 1st of the month is the date) applies
  where the MONTH row is saved (generate, re-generate, unlock), as in Pallav; the days themselves are not guarded (AttendanceEntry has no trait).
- Generate (`generateSalary`): the month must be over (its last day counts: `isComplete`) ("Salary can only be generated once the attendance month
  is over."); not already locked ("Salary has already been generated for this month. An Admin must unlock attendance to re-generate."); every
  active person complete ("Salary Generation cannot be completed. Please complete attendance entries for all active employees before generating
  salary: {names}."); then `SalaryProcessor::generate` (**HMS:** the SalaryRun port, filled by task B6a (`docs/specs/payroll-pay.md` §3); without it (a test wiring) 422 `VALIDATION_FAILED` with `details.fields.reason` = "Salary generation arrives with Payroll Pay.", the shape of the other
  generate refusals) locks the month. Re-generate: Admin only ("Only Admin users can re-generate salary."), completeness again. Unlock: Admin only
  ("Only Admin users can unlock attendance."), only a locked month ("This attendance month is not locked."); the unlock belongs to the session
  that made it (**HMS:** the session id): when any other session next opens or saves the month, it returns to locked (`revertStaleUnlock`).
  Every lock steps aside under ForceMode.

## 6. Attendance marks (`AttendanceStatusController`) and deduction types (`DeductionController`)

- Status: name required max 100; shortcut key required max 10, upper-cased, unique per company ("This shortcut key is already used by another
  attendance status."); colour required max 20, unique per company ("This colour is already used by another attendance status."); percentage 0, 25,
  50, 75 or 100 ("Attendance percentage can only be 0, 25, 50, 75 or 100."); type Paid or Unpaid; skips food. Newest first; used count (days).
  Changing skips food carries to days in UNLOCKED months only. Delete (hard) refused when a day uses it ("This attendance status is already used
  in Attendance Management and cannot be deleted."). Toggle: "Status updated."
- Deduction: name required max 100, unique per company ("A deduction with this name already exists for this company."); amount required ≥ 0
  (paise). Newest first with the assignment count. Delete (hard) refused when assigned ("This deduction is already assigned to an employee and
  cannot be deleted."). Toggle: "Status updated."

## 7. Staff emails (`StaffEmailController`, `StaffShareMailer`)

- Recipients: Payroll Master `share_emails` (shared + this company's, active). Send: recipient required ("Choose who to send it to."), 1-100 people
  ("Choose at least one member of staff."), all the company's. Each person: a record written FIRST (employee name, code, designation, recipient,
  subject "Staff details: {name} ({company})", attachment "employee-{code}.pdf", sent by the session's name), then the mail. A recipient not on the
  list: recorded failed, "That recipient is not on the list for this company. Ask the SuperAdmin to add it under Payroll Master." **HMS (ruled):**
  the mail goes through the outbox (port `PayrollMail`) inside the same unit and the worker finishes the record; the PDF comes from the
  `DocumentRenderer` port (stub: "attachment pending"). Until the mail port exists the record is finished failed with Pallav's "The details could
  not be emailed. Check the mail settings and try again." "Sent" in an answer means handed to the outbox (Pallav's sentence is kept); the card
  shows "sending" until the worker reports. Logged as an email in `payroll_logs`.
- List: newest first, 10/25/50/100 a page (default 25), words over employee name and code, recipient name and email, sender; status sent /
  sending (still open, under 5 minutes) / failed (failed, or open over 5 minutes = "stalled"); from/to on the IST day it was made (`whereDate`
  in the app's time zone); its age is measured on the service clock, which also writes `created_at`. Numbers: total, sent,
  failed (incl. stalled), today. Feed: records made after the newest card (at most 50) plus the watched ones (at most 200).

## 8. Dashboard (`PayrollDashboardController`)

Staff (active) and former staff; attendance progress of the CURRENT month (filled / (active staff × today's day), `min(100, round(...))` PHP
rounding, locked); the pay half (net and paid of the latest processed month, outstanding, unpaid count, advances outstanding and open, the recent
feed, people on notice) from the `PayrollPayFigures` port (filled by B6a; people on notice with B6b). Attention, in Pallav's order: no active status (danger), no active
staff (danger), no deduction (warn), no joining letter (warn), no experience letter (warn), then the pay items (B6).

## 9. Deviations (HMS), each with a named test

1. The company is in the URL, not the session (`payrollCore: another company's id is 404`).
2. Fixed companies are seeded, not made on a read (`payrollCore: company list never creates`).
3. Bank and ID numbers are plain data (MJ): returned as stored; never written to a log.
4. Paged staff list and paged attendance sheet (`payrollCore: the grid reads one page in one query`).
5. Mail through the outbox, record finished by the worker (`payrollCore: a send is recorded before the mail`).
6. Identity only from the session: isAdmin, sentBy, the unlock session (`payrollCore: identity never from input`).
