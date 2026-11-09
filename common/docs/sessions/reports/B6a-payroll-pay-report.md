# B6a Payroll Pay, part a: report to Backend review (from hms-5e, Worker B)

**Status:** built. The Lead (Planning 1) approved the plan while the review session was away. B6a waits for the master's review together with B5.

## Scope

- **Built here:**
  - the salary run (Pallav's SalaryProcessor and OvertimeCalculator), filling payroll core's `SalaryRun` port;
  - salary revisions;
  - payments, single and bulk;
  - slips;
  - advances and bonuses, with the recycle bin;
  - the monthly and period reports;
  - the pickers (company list, staff list, master-list choices);
  - the dashboard's pay figures, filling the `PayrollPayFigures` port.
- **B6b, next:** staff meals (including the monthly report's meals bill), joining and experience letters, separations and rejoin.
- **Admin task:** Payroll Master editing and the payroll log viewer.

## Files

- **Repository interface:** `web-app/src/server/repos/payrollPay.ts`. The advances repo is named `payrollAdvances`, because `advances` is Bill Master's.
- **In-memory test version:** `repos/memory/payrollPay.ts`, in the shared hotel store. In that store, the core's `blockingDependency` now also checks advances, bonuses and salaries.
- **PHP 8.3 rounding:** `money/phpFloat.ts` ports PHP 8.3's `round()` line by line. Payroll core's progress percentage uses it too.
- **Services** (`services/payrollPay/`):
  - `salaryMath` (the pure arithmetic)
  - `salaryRun` (generate and reverse, inside the caller's unit)
  - `revisionService`
  - `paymentService` (payments, slips, reports, pickers, `createPayFigures`)
  - `adjustmentService` (advances and bonuses)
  - `dto`, `schemas`
- **Wiring:** `compose/payrollCore.ts` now plugs the real salary run and pay figures into the B5 ports.
- **Routes:** 21 files: `app/api/v1/payroll/company-refs` and `app/api/v1/payroll/companies/[companyId]/{staff,masters,salary-periods,salary-profiles,payments,slips,reports,advances,bonuses}`.
- **Docs:** `docs/specs/payroll-pay.md`, `docs/api/payroll-pay.md`, and "Payroll pay, part a" in `docs/API.md` (applied by Planning).
- **Golden fixtures:** generator `db/scripts/php/generate-payroll-pay-fixtures.php`, output `fixtures/payroll-pay.json`. It runs verbatim copies of Pallav's arithmetic over 128 months, with PHP 8.3 and PHP 8.4 rounding.
- **Tests:** `tests/server/payrollPay.golden.test.ts` (3) and `tests/server/payrollPay.test.ts` (6). All 33 payroll tests pass; lint is clean; tsc is clean on the server.

## Golden results

- All 128 months match PHP 8.3 to the paisa. Each month checks:
  - attendance buckets and payable days;
  - daily and hourly rates;
  - overtime;
  - bonuses and incentives;
  - deductions, including One Time ones settling;
  - advances, including instalments, Monthly and One Time recovery, and carry-forwards with their dates, amounts, instalments and remarks;
  - net salary.
- PHP 8.4's own rounding differs only on exact ties, such as 1640.625 (overtime of 30000/28 per day at 8 hours, times 12.25 hours).

## Scale

- **One read per table per run:** a month's run reads entries, salary revisions, bonuses, deduction assignments and open advances once each, for every active person, and groups them in code.
- **Batched writes.**
- **Payments:** a month is one query, plus one for its lines.
- **Advance and bonus pages** show their locks from one `processedKeys` read.

## Security

- **Sealed bank details:** the bank details copied onto a salary are re-sealed under that salary's own column contexts. Account Number and IFSC Code in the revision history are sealed with `salary_update_histories.value`; tests prove no plain value is stored.
- **Identity:** whoever made a change and whoever recorded a payment come from the session, and Admin checks use the session too.

## Deviations (each in the spec)

1. Floats are computed as in PHP, rounded with PHP 8.3's `round()`, and stored as paise.
2. The run reads per month, not per person.
3. Bank numbers are sealed on the salary and in the revision history.
4. Lists are paged.
5. A batch's revision changes are shown in the tracked-field order.

## For Worker A

The index requests have been forwarded by the Lead. `hotel-template.test.ts` and `hotel-additions.test.ts` are failing because they check for those indexes before Worker A's migration exists.
