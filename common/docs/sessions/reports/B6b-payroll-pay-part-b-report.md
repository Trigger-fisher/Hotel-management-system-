# B6b Payroll Pay, part b: report to Backend review (from hms-5e, Worker B)

**Status:** built; waits for the master's review together with B5 and B6a (the Lead approved the plan while the review session was away).

## Scope

Staff meals (price, records, the live bill, and the meals bill in the monthly report), the joining and experience letters, and resignations with
rejoin. With this, the payroll core and pay tables are covered except Payroll Master editing and the payroll log viewer (the Admin task).

## Files

- Repository interfaces: `repos/payrollPay.ts` (added `MealRepo`, `LetterRepo`, `SeparationRepo`); in-memory test version `repos/memory/payrollPay.ts`.
  The core's `employees.list` gained the "active first" sort.
- Services (`services/payrollPay/`): `mealsMath` (pure bill arithmetic), `mealsService` (also exports `mealStatement`, used by the monthly report),
  `letterText` (placeholders, `{DURATION}`), `letterService`, `separationService`, `dates` (Carbon formats).
  `paymentService` now fills the monthly report's meals bill and the dashboard's on-notice count and leaver feed.
- Wiring: `compose/payrollCore.ts`. Routes: 20 files under `app/api/v1/payroll/companies/[companyId]/{meals,letters,separations}` plus
  `employees/[id]/joining-letter`.
- Docs: spec §11-14 in `docs/specs/payroll-pay.md`; endpoints in `docs/api/payroll-pay.md`; contract requests in `docs/API.md`
  ("Contract requests for Payroll Pay, part b").
- Golden fixtures (real PHP): `generate-payroll-meals-fixtures.php` and `generate-payroll-letters-fixtures.php`.
- Tests: `payrollMeals.golden.test.ts` (1), `payrollLetters.golden.test.ts` (3), `payrollMeals.test.ts` (7).
  Whole server suite: 1,253 tests, 1,232 pass, 0 fail, 21 skipped (MySQL); lint and tsc clean.

## Golden results

- The meals bill: 92 people-months (days charged, each day at the price in force that day divided by the days in the month, skipped days left out,
  open versus dated records, relieved people, running month, the row's note, the month's prices) equal Pallav's `FoodCharges` run in real PHP.
- `{DURATION}`: 274 date pairs equal PHP's `DateTime::diff` with Carbon's wording rule (Carbon itself is not installed here, so its wording rule is
  written out in the generator; the interval is PHP's own).
- Placeholders replaced in one pass, as `strtr`.

## Scale

Meals page: the whole staff list's records in ONE read, the bill from one read per table (records of the month, employees, last days, skipped days).
Resignation lists: the figures from one aggregate; the tab narrows only the page.

## Deviations (each in the spec)

1. The meal price is closed by any company's salary run; a person's meals records only by their own company's (Pallav). The apps' mock closed both at
   once: new fields `priceClosedThrough` and `firstOpenPriceMonth` carry the price's.
2. A letter is returned as a structured document (the PDF is the open `DocumentRenderer` port).
3. An edit never moves a resignation to another person.
4. A switched-off letter template still prints (Pallav); the mock refused.

## Open for MJ (quirks noticed in Pallav, ported as they are)

- Rejoin does not check that the new joining date follows the last working day, nor that the record has not already been rejoined.
- A switched-off letter template still generates letters; only the appointment email needs it on.
