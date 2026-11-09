# Behaviour spec: Payroll pay (part a: salary run, revisions, payments, slips, advances, bonuses, reports; part b: staff meals, letters, resignations)

Source: Pallav `app/Services/Payroll/{SalaryProcessor,OvertimeCalculator}.php`, `app/Http/Controllers/Payroll/{SalaryUpdateController,
SalaryPaymentController,SalarySlipController,PayrollAdvanceController,BonusIncentiveController,SalaryReportController}.php`,
`app/Models/{SalaryProcessing,SalaryProcessingLine,PayrollAdvance,BonusIncentive,SalaryUpdateHistory}.php`.
**HMS:** marks a deliberate difference. Golden: `db/scripts/php/generate-payroll-pay-fixtures.php` → `fixtures/payroll-pay.json` (REAL PHP running
verbatim copies of the run's arithmetic over 128 months, with PHP 8.3's round, Pallav's live server). Tests `tests/server/payrollPay*.test.ts`.
Tables: hotel migration `0008_payroll_pay`. Repositories: `src/server/repos/payrollPay.ts`. Contract: `ui-shared/dashboards/payrollPay.ts` and
the requests in `docs/API.md` (Payroll pay, part a). Every route is under the payroll company (`docs/specs/payroll-core.md` §1).

## 1. Permissions

Parts `payroll.salary-update` (edit), `payroll.salary-payment` (edit), `payroll.salary-slip` (view), `payroll.advance` (full),
`payroll.bonus-incentive` (full), `payroll.monthly-report` and `payroll.period-report` (view). The pickers (companies, staff, master choices,
processed months) need any payroll part's view. Changing or deleting an advance or a bonus is for Admins (`Auth::user()->isAdmin()`: an Admin or
the SuperAdmin), from the session.

## 2. Salary revisions (`SalaryUpdateController`, `SalaryUpdateHistory`)

- List: active staff, most recently changed first (`updated_at` desc), each with its revision count and latest effective date (one grouped read).
- A revision: effective date required, a date; salary required ≥ 0; designation and department max 100; working hours required 0.5-24; payment
  mode one of Payroll Master `salary_payment_mode`; bank name and holder max 150; account number max 50 (write-only: absent = not part of this
  save); IFSC max 20; branch max 150. Pallav does not require the bank details here.
- The tracked fields, in order: Salary, Designation, Department, Working Hours, Salary Payment Type, Bank Name, Account Holder Name, Account
  Number, IFSC Code, Branch Name. Numbers compare loosely (8 and 8.00 are the same). None changed: "No tracked fields were changed." (409; ForceMode
  steps past). Otherwise the person is updated and each change kept with one batch id: "{n} field(s) updated and recorded in the update history."
- **HMS:** Account Number and IFSC Code are sealed in the history (context `salary_update_histories.value`), as Pallav encrypts them; shown as
  "****9012" and in full. A batch's changes are listed in the tracked order (Pallav's ids order them; UUIDs do not).

## 3. The salary run (`SalaryProcessor`, filling payroll core's SalaryRun port)

- Generate (from attendance, `payroll-core.md` §5): the month's previous run is reversed, every ACTIVE person (by name) is processed, payments
  already recorded are put back (a "Paid" salary that grew past what was paid becomes "Partially Paid"), and the caller locks the month.
- One person (golden): the daily rate per day (a "Salary" revision dated in the month pays its new rate from its effective date; before it, the
  revision's previous value); each day pays rate × percentage / 100; days counted in 0/25/50/75/100 buckets (another percentage is skipped, its
  overtime still counts); payable days; daily salary and hourly rate (salary / days / hours) shown rounded; overtime = round(rate × hours, 2);
  bonuses and incentives dated in the month; gross; deductions (every assignment; a settled One Time one skipped; 0 skipped; One Time ones become
  settled); after deductions never below 0; advances (unsettled, by date): a Monthly one takes at most its instalment, a One Time one all of it,
  never more than what is left; whatever is not taken is booked on the advance as recovered, the advance closes, and the balance becomes a
  carry-forward advance dated the 1st of next month ("Carry Forward from Previous Month[ - remarks]"); net never below 0.
- Lines on the slip: each bonus / incentive, each deduction, each advance instalment (with what is still pending).
- Reverse: each carry-forward's amount goes back off its parent's recovered, then the carry-forward goes; each advance line's amount goes back;
  One Time deductions become unsettled; touched advances are settled only when nothing is outstanding; the month's processings and lines go.
- **HMS:** floats exactly as PHP, rounded with PHP 8.3's round (`money/phpFloat.ts`), stored as paise; reads are ONE per table for the month
  (entries, revisions, bonuses, assignments, advances), writes batched; the bank details copied onto the salary are re-sealed in its own columns.

## 4. Payments (`SalaryPaymentController`)

- The month (`resolveMonth`): the one asked for, else the latest processed, else this month; never past this month. Rows: unpaid first, then
  latest paid, then by name. Figures: net, paid, outstanding (each person's balance added up), fully paid, total, per status.
- Update: status one of Pending, Processing, On Hold, Partially Paid, Paid, Failed; paid amount ≥ 0; paid date not in the future ("The payment
  date cannot be in the future."); reference max 100; remarks max 500. Paid = the net; Partially Paid = the amount, which must be more than 0 and
  less than the net ("A partial payment must be more than ₹0 and less than the net salary of ₹28,000.00."); otherwise 0. Paid and Partially
  Paid carry a date (today when none) and keep the old reference when none is given; other statuses clear both.
- Bulk: "Select at least one employee."; Pending, Processing, On Hold, Paid or Failed only; the chosen salaries of this company in one unit:
  "{n} payment(s) marked {status}.".
- A closed year's salary can still be paid, dated this year (`$booksPending`, `$booksActionDates` paid_at).

## 5. Slips (`SalarySlipController`)

Newest period first, then the latest processed; one slip with its lines. **HMS:** paged, searchable by name or code, filterable by month.

## 6. Reports (`SalaryReportController`)

- Period: a range inside one month and not past today ("From Date must be on or before To Date.", "The selected date range must belong to the
  same month and year.", "The selected date range must not exceed the current date."); that month's salaries (one person or all), by name.
- Monthly: the month (`resolveMonth`), every person by name, with totals. The meals bill is in §11 (once the month's salary is generated).

## 7. Advances (`PayrollAdvanceController`, `PayrollAdvance`)

- Fields: employee (this company's), date not in the future ("Advance date cannot be in the future."), amount > 0 ("Advance amount must be
  greater than zero."), recovery One Time or Monthly; Monthly needs an instalment > 0 ("A monthly recovery needs an instalment greater than
  zero."); One Time recovers the whole amount. A date left at today is the moment of the save; an edit that keeps the day keeps its seconds.
- Numbered (entry_no). Update and delete: Admins only ("Only Admin users can update advance records." / "delete"), never a carry-forward
  ("Carry-forward advances are generated by Salary Processing and cannot be edited." / "deleted."), never once the person's salary for the
  advance's OWN month is processed ("Salary Processing is already completed for this period, so this advance cannot be changed." / "deleted.").
  Each lock steps aside under ForceMode. Delete = the recycle bin; restore and purge for recycle-bin users.
- Figures over the list: issued (not carry-forwards), recovered (less what moved on to carry-forwards), outstanding, open.

## 8. Bonuses and incentives (`BonusIncentiveController`)

- Fields: employee, date not in the future ("Date cannot be in the future."), a NEW one only in the current month ("Bonus and incentive entries
  can only be dated in the current month (October 2026)."), type Bonus or Incentive, amount > 0 ("Amount must be greater than zero.").
- Not once the month's salary is generated ("Salary has already been generated for this month, so no more bonus or incentive entries can be
  added to it."). Update and delete: Admins only ("Only Admin users can update these records." / "delete"), not once processed ("Salary
  Processing is already completed for this period, so this entry cannot be changed." / "deleted."). Recycle bin as advances.

## 9. The dashboard's pay half (`PayrollDashboardController`, filling payroll core's PayrollPayFigures port)

The latest processed month's net, paid and unpaid count; outstanding advances and the open count; open and failed payments; the latest advances
and bonuses ("Advance of ₹5,000.00", "Bonus of ₹1,500.00"). People on notice are the resignations not Relieved and not rejoined; the latest three leavers are in the recent feed ("Resignation - Pending").

## 10. Deviations (HMS), each with a named test

1. Floats as PHP with PHP 8.3's round, stored as paise (`salary run golden: all 128 months`).
2. The run reads per month, not per person (`the salary run: each person's month`).
3. Sealed bank numbers on the salary and in the revision history (`a revision records each changed field; bank numbers stay sealed`).
4. Paged lists (slips, advances, bonuses, salary profiles) with their figures over the whole list.
5. A batch's revision changes in the tracked order (`salary revisions: a revision records each changed field; bank numbers stay sealed`, which asserts the order).

---

# Part b (task B6b): staff meals, letters, resignations

Source: Pallav `Support/FoodCharges.php`, `Http/Controllers/Payroll/{FoodPriceController,FoodChargeController,JoiningLetterController,
ExperienceLetterController,SeparationController}.php`, `Models/{EmployeeMealPeriod,FoodChargeRate,JoiningLetter,ExperienceLetter,EmployeeSeparation}.php`.
Golden: `generate-payroll-meals-fixtures.php` (92 people-months, real PHP running the bill's arithmetic verbatim) and
`generate-payroll-letters-fixtures.php` (274 date pairs through PHP's `DateTime::diff`, the placeholders through `strtr`). Tests
`payrollMeals.golden`, `payrollLetters.golden`, `payrollMeals.test.ts`. Tables: `food_charge_rates`, `employee_meal_periods`, `joining_letters` /
`experience_letters` (HMS keeps both kinds behind one `letters` repository), `employee_separations`.

## 11. Staff meals

- Permissions: parts `payroll.food-price` (edit) and `payroll.food-charge` (edit); the page needs the view of either. Only companies HP01 and PF01
  serve meals (any other: 404). **Pallav Food (PF01) alone sets the price** (404 for HP01's price actions); both companies keep who takes meals.
- Price: amount 0 to 1,000,000 (paise here); the start date today or earlier ("A price cannot start after today. Choose today or an earlier day in an
  open month."); in an open month: the price is closed once ANY company's salary is generated for that month or a later one ("Salary has already
  been generated for September 2026, so its meal price is closed. A new price can start from October 2026 onwards."). A second price for the same
  day replaces the first. "The price is now Rs 3,000.00 per employee from 1 September 2026. The earlier price stays on record." Delete: only in an
  open month; "That price was removed. Days it covered fall back to the price before it."
- A person's record: from a day not after today and not before they joined ("{name} joined on 1 January 2026, so meals cannot start before that."),
  optionally to a day after the start and not after today; two live records of one person may not overlap ("{name} already has meals recorded for
  01 Sep 2026 - ongoing. Stop that first, or start after it."). Closed by the company's OWN latest generated month ("Salary has already been
  generated for September 2026, so its meals bill is closed. Changes can start from October 2026 onwards."). Stop: sets the end (not before the start,
  not after today, no overlap); the days that change are those after the earlier of the old and new end. Remove: from its first day, so it is
  refused in a closed month with "... To stop meals from a later day instead, end the record rather than removing it." Records go to the recycle bin.
  A closed year's record may still be ended, the end dated this year (`$booksActionDates ends_on`).
- The bill (golden): everyone whose records cover part of the month (the record decides, not the payroll: someone who has left is still billed
  for meals eaten); each day in a record that is not marked with a status that leaves meals out ("skips food" copied onto the day), each at the
  price in force that day divided by the days in the month; an open record stops at the person's last working day if they are Relieved and have not
  rejoined, a dated one is honoured as written; a running month counts to today. Rows with no days are dropped; no price, or nobody charged = no bill.
  The note on a row ("joined 8 Sep", "left 12 Sep", "meals from 10 Sep", "meals until 20 Sep", "3 days not counted") is Pallav's.
- Live (the Staff Meals page: any month up to this one, with whether it is final) or final (the monthly report: only once the month's salary is
  generated). Hotel Pallav owes it; Pallav Food's own staff are a cost.
- **HMS:** the page's `closedThrough` / `firstOpenMonth` are the company's own (its records); the price's are `priceClosedThrough` /
  `firstOpenPriceMonth` (any company's run closes a price): the apps' mock showed one pair for both. The staff list is every person of the company,
  active first (`FoodChargeController::index`), with their live records read in ONE query.

## 12. Letters

- ONE template per company and kind (joining, experience); saving again updates it. Every field is optional (Pallav): subject max 255, signatory
  name max 150 and designation max 100. A template whose signatory is empty (or equals the company's authorised person) uses the company's
  authorised person (`use_company_signatory`); reads give the effective signatory. Switch on or off ("Status updated."); delete (a hard delete).
- Placeholders (golden, `strtr`): joining `{EMPLOYEE_NAME} {DESIGNATION} {DEPARTMENT} {RESPONSIBILITIES} {JOINING_DATE}` (d-m-Y) `{CURRENT_DATE}`
  (d-m-Y); experience `... {JOINING_DATE} {LAST_WORKING_DATE} {DURATION} {CURRENT_DATE}` (d M Y). `{DURATION}` is Carbon's
  `diffForHumans` (absolute, two parts) over PHP's date interval: "1 year 3 months", "8 months 4 weeks", "2 weeks 3 days", "0 seconds"; no joining date: "-".
- Joining letter: 404 "No joining letter template configured for this company." without a template; a template switched off still prints
  (Pallav checks only that it exists; only the appointment EMAIL needs it active). Experience letter: 404 "No experience letter template configured
  for this company."; "An experience letter can only be issued once the employee is marked Relieved." (409) unless Relieved and not rejoined.
- **HMS:** the letter is returned as the structured document the apps print (`PayrollDoc`); the PDF itself is the `DocumentRenderer` port (MJ's
  open decision). The acceptance heading / closing text and the signatory's closing text are not in the contract: they keep what is stored.
  Signature images come with the media store.

## 13. Resignations

- Fields: employee (this company's), type one of Payroll Master `separation_type` (defaults Resignation, Termination, Retirement, End of
  Contract), resignation date and last working day required ("The last working day cannot be before the resignation date."), reason required,
  remarks, status Pending, Accepted or Relieved. Numbered (entry_no). One open record per person: "This employee already has an open separation
  record." (409; ForceMode steps past). A Relieved record makes the person inactive (out of attendance and payroll).
- Edit: `PayrollRules::canEdit` (can write, and an Admin, the SuperAdmin or whoever recorded it): "Only an Admin or whoever recorded this separation
  can edit it."; a person who has not rejoined follows the status (inactive only while Relieved). **HMS:** an edit never moves a record to another
  person (Pallav lets the employee field change).
- Delete: Admins only ("Only Admin users can delete a separation record."); to the recycle bin; the person goes back into active payroll
  ("Separation record removed and the employee reactivated."). Restore and purge for recycle-bin users; a restored record re-applies the status.
- Rejoin: joining date and designation (max 100) required, salary ≥ 0, hours 0.5-24, department; a phone typed any way (country and national digits,
  judged by the country's rule); address; payment mode one of the master's; with "Bank" the bank name, holder, account number and IFSC are
  required; the person is updated, made active, and the record notes the rejoin date. Pallav does not require the new joining date to follow the last
  working day, and does not stop a second rejoin; the apps' mock added the first rule, the server follows Pallav. The account number is
  write-only (absent = keep).
- Lists: most recent leaver first (last working day, then number); the tab (in notice, relieved, rejoined) narrows the page, the figures cover every
  record. **HMS:** the acceptance document upload comes with the media store (a document name sent now is not kept).

## 14. Deviations of part b (HMS), each with a named test

1. Separate price lock and records lock in the meals page (`the meal price: ... closed once any salary is generated`, `meals records and the bill`).
2. Letters as structured documents (`the letters: one template per company`).
3. An edit never moves a resignation to another person (`resignations: ... who may edit and delete`).
4. Rejoin takes the account number write-only (`rejoin: the person is back on`).

## 15. Concurrency, idempotency and audit (Backend review follow-ups; tests in `payrollPay.concurrency.test.ts`)

- **The guard for generate is the month row lock**: `attendance.month(company, year, month, { forUpdate: true })` = `INSERT IGNORE` then `SELECT ... FOR UPDATE`
  on `attendance_months`. Generate, re-generate, unlock and the attendance save of ONE month take it first, so two admins generating the same month run
  one after the other: the second sees "Salary has already been generated for this month..." (409), never two runs or two carry-forwards. Re-generate
  (Admin) twice runs twice in turn, each reversing the last: nothing is double-counted (`two admins generate the SAME month at once`, `two admins
  re-generate the same month at once`, `generate against a save of the same month`).
- Payments lock the salary row (`FOR UPDATE`); a run locks the open advances (`FOR UPDATE`) and an advance edit or delete locks its row, so they
  interleave whole: the edit lands first (the run uses it) or is refused as processed (`an advance edited while the month is generated`, `an advance
  deleted while ...`, `an employee deleted while ...`, `generate against a bulk payment`).
- **A salary payment carries a version (MJ #23, answered B: warn the second clerk)**: `salary_processings.version`, +1 on every payment change and
  set to the old row's number + 1 on a re-generate. A `PaymentUpdateInput.version` that is stale answers CONFLICT with `details.currentVersion`; a
  bulk update with any stale entry of `versions` is refused whole before anything is written. Pallav itself has no version (last write wins): this is
  an approved HMS change (`the same salary paid twice at once by two clerks (MJ #23)`, `a bulk payment with one stale version is refused whole`).
- Money creates (advances, bonuses, single and bulk payments) accept `Idempotency-Key` through the wrapper ("optional" by default for a body that
  changes data): the same key and body replays the first answer and writes nothing twice; the same key with another body is `IDEMPOTENCY_KEY_REUSED`
  (`idempotent money creates`).
- Every generate / reverse, payment, revision, advance, bonus, meal, letter and resignation writes its `payroll_logs` row inside the same unit; a log that
  cannot be written rolls the action back (`a log line that cannot be written rolls the action back`).
- The real-MySQL twins of these tests (skipped without a database) follow with the MySQL repositories (Worker A).

## 16. Server-derived fields (never inputs) in `ui-shared/dashboards/payrollPay.ts`

Identity: `changedBy`, `createdBy`, `paymentUpdatedBy`, `sentBy` and every `actor`. Locks and permissions: `locked`, `canEdit`, `canDelete`.
Run output: `SalaryRecord` in full (days, lines, rates, net, `generationCount`), `Advance.recoveredPaise`, `outstandingPaise`, `isSettled`, `isCarryForward`,
`entryNo`; `Separation.entryNo`, `rejoinedOn` (set by rejoin only), `documentName`; `MealPeriod.createdBy`; `LetterTemplate.updatedAt`; every `*Last4`,
`ProfileSummary` count and `usedCount` / `assignedCount`. Inputs the server ignores: `isActive` on statuses and deductions, `employeeId` on a resignation
edit, `documentName`, `name` / `code` / `isActive` of a payroll company.
