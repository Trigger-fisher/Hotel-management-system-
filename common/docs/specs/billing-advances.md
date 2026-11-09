# Behaviour spec: Billing, Guest Advances (Bill Master advances)

The rules of Hotel Pallav's Guest Advances screen as the backend must keep them. Source for every rule: the Pallav code
(`app/...`, paths relative to the Pallav repo; line numbers from the clone used for this port). Where HMS deliberately differs, the
line says **HMS:** and why. Written BEFORE the code; the golden tests (`tests/server/billing.golden.test.ts`, fixtures made by real PHP:
`db/scripts/php/generate-billing-fixtures.php`) and the service/route tests are written from it.

Table: `bill_master_advances` (hotel template; Postgres reference `db/_pg-hotel/migrations/hotel/0004_billing_books.sql`, MySQL port by
Worker A). Contract: `ui-shared/dashboards/billing.ts` (`Advance`, `AdvanceInput`, `RefundInput`, `AdvanceQuery`, `AdvanceList`).
Bills that take money off an advance are in `billing-bills.md` (B2); the rules here that bills touch are marked **(B2)**.

## 1. What an advance is

- Money a guest (or a company) paid before the bill: a hotel side and a food side, each with its own amount, mode and balance
  (`BillMasterController.php:132-186`). One record may hold both sides ("Bills and advances legitimately hold both businesses on one
  record", `BillMasterController.php:19-22`).
- `total` = hotel amount + food amount on create and edit (`:183`); after a refund `total` = the refunded amounts (`:265`); after the
  refund is reversed `total` = the restored balances (`:283`). **HMS:** kept exactly (column `total_paise`); the DTO does not show it.
- Balances (`hotel_balance`, `food_balance`) start equal to the amounts (`:178`) and go down when a bill takes money off **(B2)** or a refund is recorded.

## 2. Permissions (`Support/Permissions.php:105-121`, route-to-action `Permissions.php:632-652`, routes `routes/web.php:426-431`)

| Action | Pallav route (method) | Pallav permission | HMS check |
|---|---|---|---|
| list, read one, open advances picker | `bill-master.advances` GET | `bills.advances.view` | key `bills.advances`, level `view` |
| record | `bill-master.advances.store` POST | `bills.advances.create` | `bills.advances`, `create` |
| correct | `bill-master.advances.update` PUT | `bills.advances.edit` | `bills.advances`, `edit` |
| delete | `bill-master.advances.destroy` DELETE | `bills.advances.delete` | `bills.advances`, `full` |
| refund | `bill-master.advances.refund` POST (tail `refund` = edit, `Permissions.php:649`) | `bills.advances.edit` | `bills.advances`, `edit` |
| reverse a refund | `bill-master.advances.refund.destroy` DELETE | `bills.advances.delete` | `bills.advances`, `full` |
| receipt PDF | (view) | `bills.advances.export` | **HMS:** later, with PDFs |
| restore / remove for good | `recycle-bin.*` (SuperAdmin) | SuperAdmin | hotel role `super_admin` (as cash) |

- The part `bills.advances` offers view, create, edit, delete (`CRUD`, `Permissions.php:34,111`). Reading needs the PART's view
  (a part holder reaches the module page through it, `Permissions.php:535-540`). Levels: create = `create`, edit = `edit`, delete = `full`.
- No identity in the input: `created_by` is the signed-in person (`:159`); unknown input keys are refused.

## 3. Fields and validation (create `BillMasterController.php:134-148`, edit `:194-207`)

Laravel 11 default wording (`lang/en/validation.php`), field names as Laravel prints them (underscores become spaces).

| HMS input | Pallav field / rule | Pallav message (word for word) |
|---|---|---|
| `receiptNo` (create only; ignored on edit) | `receipt_number` required, string, max:50 | "The receipt number field is required." / "The receipt number field must not be greater than 50 characters." |
| `guestName` | `guest_name` required, string, max:255 | "The guest name field is required." / "The guest name field must not be greater than 255 characters." |
| `mobile` | `mobile_number` nullable, string, max:15 | "The mobile number field must not be greater than 15 characters." |
| `roomNo` | `room_number` nullable, string, max:20 | "The room number field must not be greater than 20 characters." |
| `companyId` | `company_id` nullable, exists:company_profiles,id | "The selected company id is invalid." (a soft-deleted company does not exist for this rule? **No:** Laravel `exists` ignores `deleted_at`; **HMS:** a company in the recycle bin still counts, same as Pallav) |
| `paymentDate` | `payment_date` required, date | "The payment date field is required." / "The payment date field must be a valid date." |
| `hotelPaise` / `foodPaise` | `hotel_amount` / `food_amount` nullable, numeric, min:0 | "The hotel amount field must be a number." / "The hotel amount field must be at least 0." (same for food) |
| `hotelMode` / `foodMode` | `hotel_mode` / `food_mode` nullable, string, max:20 | "The hotel mode field must not be greater than 20 characters." |
| `referenceName` | `reference_name` nullable, string, max:255 | "The reference name field must not be greater than 255 characters." |
| `referenceMobile` | `reference_mobile_number` nullable, string, max:15 | "The reference mobile number field must not be greater than 15 characters." |
| `instruction` | `instruction` nullable, string, max:255 | "The instruction field must not be greater than 255 characters." |

- Lengths count characters (Laravel `max` on a string uses `mb_strlen`). Text is trimmed; an empty string is stored as null
  (Laravel `ConvertEmptyStringsToNull` + `TrimStrings` middleware).
- **The sides** (`advanceAmounts`, `:174-186`): the form sends only the side(s) the advance is for; a side left out is written as 0,
  never kept from before. Each amount is `round(x, 2)` (paise: already whole); balance = amount; a side whose amount is 0 or less gets
  mode null. **HMS:** `covers` (`hotel`/`food`/`both`) says which sides were sent; the amount of a side not covered is 0.
- **Nothing paid**: total ≤ 0 → field `hotelPaise` "Enter how much the guest paid." (`:156-158`, `:209-211`; Pallav puts it on `hotel_amount`).
- Money: integer paise, 0 to 999,999,999,999 (Pallav `decimal(12,2)`). **HMS:** a value that is not a whole number of paise is refused by the input schema.
- Modes: Pallav accepts any string up to 20 characters (the screen offers its list). **HMS:** the same; the DTO passes the stored text
  through (contract `PaymentMode` is a narrower union: **Contract request**, see docs/API.md).

## 4. Receipt number

- Create: the typed number gets the YEAR in front: `date('Y').' / '.$number` (`:150`), e.g. `2026 / 814`. The year is the CURRENT
  year at saving, not the payment date's year. **HMS:** the current year in IST (Pallav's `config/app.php:71` default is UTC unless the
  server sets `APP_TIMEZONE`; HMS fixes IST for every "today", as the cash slice). Golden-tested around 31 Dec / 1 Jan IST.
- Unique: if a live advance already has that full receipt number → field `receiptNo` "This receipt number already exists." (`:152-154`).
  A soft-deleted advance does not count (**HMS:** functional unique index on live rows, Worker A's MySQL rule; Pallav's check is
  `where(...)->exists()` which skips soft-deleted rows through `SoftDeletes`).
- Edit never changes the receipt number (it is not in the edit rules, `:194-207`).
- An advance made by an overpaid debit settlement is numbered `Excessive / {bill number}` **(B2)** (`:549`). **HMS:** the contract comment
  says "Excess / ..."; Pallav's text wins (**Contract request**). `fromBillNo` in the DTO = the bill number after `Excessive / `.

## 5. Entry numbers (`Models/Concerns/HasEntryNumber.php`)

- `bill_master_advances.entry_no`: one past the highest on the table, soft-deleted rows included; a gap stays; deleting the top row FOR
  GOOD frees its number; a soft delete does not (`:11-14,34-46`). Shown as four digits `0001` (`:84-87`).
- Taken inside the unit (MySQL: `GET_LOCK` + `MAX+1` + UNIQUE, `Backend Review/05-MYSQL-DECISION.md` §3; in memory: one unit at a time per hotel).

## 6. States and the locks

- **Unused** = hotel amount = hotel balance AND food amount = food balance (`Models/BillMasterAdvance.php:46-50`).
- **Refunded** = a refund date is set (`:52-55`). Status for the screen (`ui-shared advanceStatus`): refunded; else unused; else partly
  (something left) or used (nothing left).
- **Edit** (`:188-219`): refused when the advance is NOT unused OR is refunded: `CONFLICT` "This advance has already been used or refunded and cannot be edited." (`:190-192`).
  No people-rule: anyone with `bills.advances` edit may correct any unused advance.
- **Delete** (`:221-237`): first the people-rule `canManage(creator)` → `FORBIDDEN` "Not allowed to delete this record." (`:223-225`);
  then not unused → `CONFLICT` "This advance has already been partly used and cannot be deleted." (`:227-229`). A refunded advance whose
  balance was refunded is no longer unused → refused. canManage: SuperAdmin always; Admin unless the owner is a SuperAdmin; anyone
  else only their own; owner unknown → Admin only (`Models/User.php:224-239`). **HMS:** the shared `canManage` of `services/cash/rules.ts`
  (an Admin also may not reach over an owner of a higher role level: the HMS rule already ruled for cash).
- **Refund** (`:239-272`): already refunded → `CONFLICT` "This advance has already been refunded." (`:241-243`). Rules: hotel/food refund
  nullable, numeric, min:0; modes nullable string max:20; `refund_payment_date` required, date; refund guest name max:255, mobile max:15,
  instruction max:255 (`:245-254`). Refund above a side's balance → `VALIDATION_FAILED` (Pallav flashes `error`; **HMS:** field
  `hotelPaise`/`foodPaise`) "Refund amount cannot exceed the available advance balance." (`:259-261`). Then hotel balance -= hotel refund,
  food balance -= food refund, total = hotel refund + food refund (`:263-265`).
  - A refund of 0 on both sides IS accepted by Pallav (it marks the advance refunded and closes it for edit). **HMS:** kept (the apps
    stop it client-side, `validateRefund`).
  - HMS input → columns: `date` → refund_payment_date, `hotelPaise`/`foodPaise` → hotel/food_refund_amount, `hotelMode`/`foodMode` →
    refund modes, `toName` → refund_guest_name, `toMobile` → refund_mobile_number, `note` → refund_instruction. Messages name Pallav's
    fields: "The refund payment date field is required.", "The refund payment date field must be a valid date.", "The hotel refund amount
    field must be a number.", "The hotel refund amount field must be at least 0.", "The hotel refund mode field must not be greater than
    20 characters.", "The refund guest name field must not be greater than 255 characters.", "The refund mobile number field must not
    be greater than 15 characters.", "The refund instruction field must not be greater than 255 characters." (food the same).
- **Reverse a refund** (`:274-297`): balances += the refund amounts; total = the two restored balances; every refund column back to null.
  Pallav has NO check that a refund exists. **HMS:** reversing an advance with no refund changes nothing in Pallav (adds 0, nulls stay
  null) but still writes a log line; HMS answers `CONFLICT` "This advance has no refund to reverse." (no-op guard, no money effect; the
  only HMS wording in this slice: see section 11).
- **Force mode** (`Support/ForceMode.php:154-179`): each lock above (`ForceMode::locked`) steps aside for the SuperAdmin with force armed,
  and writes the force log "Forced past a lock: {what}" plus the platform audit `force.override`. The `{what}` texts are Pallav's:
  "This advance has already been used or refunded", "Not allowed to delete this record", "This advance has already been partly used and",
  "This advance has already been refunded", "Refund amount cannot exceed the available advance balance".
  With force armed the FIELD rules relax too (`ForceMode::relax`, `:55-90`): required, max, min and exists are dropped, types stay
  (numeric, date, string); a field left empty is filled with a harmless blank (`ForceMode::fill`, `:98-137`): a date → today (IST),
  a number → 0, text → '' (stored null), never an id. **HMS:** a forced refund larger than the balance would drive the balance below zero;
  the table refuses a negative balance (CHECK, money rule), so **HMS refuses it even under force** with the same message (`VALIDATION_FAILED`).
  Ruling requested (section 11).
- **Version check** (MJ #14): every edit, refund, refund reversal, delete, restore carries `version`; a different version → `CONFLICT`
  with `currentVersion` ("someone else changed this"). Bills changing an advance's balance **(B2)** raise its version too.

## 7. Accounting-year lock (`Support/Books.php:224-277`, `Models/BillMasterAdvance.php:17-20`)

The advance is dated by `payment_date`. Its "pending" columns (what may still change once its year is closed) are the balances, `total`
and every refund column; its action date is `refund_payment_date`.
- **Create** dated in a closed year or a year not started → refused "dated" (field `date` in Pallav; **HMS:** field `paymentDate`).
- **Edit** of an advance whose payment date lies in a closed year: refused "changed" (an edit always changes non-pending columns).
  An edit that moves the payment date INTO a closed year → refused "dated".
- **Refund / reverse refund** of a closed year's advance: allowed (only pending columns change), but the refund date must be in the
  current year ("dated"), and reversing a refund that was dated in a closed year is refused "changed" (`Books.php:66-79`).
- **Delete** of a closed year's advance → refused "deleted".
- **(B2)** a bill taking money off a closed year's advance only changes balances: allowed.
- Dates before the first accounting year are history and not locked; with no accounting year at all nothing is locked (`Books.php:35-49`).
- Messages are Pallav's, built by the shared guard (as `docs/specs/cash-revenue.md` §5). **HMS:** needs the guard to know "pending"
  columns and action dates (the cash guard has none): a shared extension requested from the master (section 11).
- Force mode steps past the lock and writes "Accounting year lock" to the force log.

## 8. The list (`BillMasterController.php:101-130`)

- Rows: advances dated in the years on screen, PLUS older ones still holding money (no refund date and hotel + food balance > 0), carried
  forward (`inBooks`, `:105-115`, `:122-123`). **HMS:** the year menu sends `from`/`to`; when `from` is given, older open advances are
  carried in. `month` (`YYYY-MM`), `mode`, `companyId` (`walkin` = no company) and `tab` (status) are the screen's filters (the Pallav
  screen filters client-side in the browser; **HMS:** the server applies them, same meaning).
- Unit switcher (`scopeToUnit`, `:23-38`): when a unit (hotel or food) is chosen, only rows with an amount on that side. **HMS:** not in the
  contract yet (no unit switcher in the HMS screens); the repo filter exists for later.
- Order: `payment_date desc, id desc` (`:124`). **HMS:** default `paymentDate` desc, tie-break entry number desc; sort whitelist
  `paymentDate`, `receiptNo`, `guestName`, `totalPaise`, `balancePaise`.
- Search (the screen's search box): every word must appear in the receipt number, guest, mobile, room, company (or "walk-in"), modes,
  or the amount `1234.50`. **HMS:** server-side, plain text, `%`/`_` are not wildcards, bounded length.
- Counts per tab (after filters and search, before the tab), KPIs and filter options as `AdvanceList` (contract): month taken, money
  held (not refunded), unused count, refunded total. Paging `page`/`pageSize` in 10, 25, 50, 100.
- **Open advances picker** (for a new bill) = advances with hotel + food balance > 0, by guest name (`:316-318`). Pallav does not exclude a
  refunded one with money left (a partial refund leaves a balance); **HMS:** the same.

## 9. The DTO (`Advance`)

`receiptNo`, `paymentDate`, `guestName`, `mobile` ('' when null), `companyId`, `companyName` (the company's current name; null for
walk-in), `roomNo`, amounts and balances in paise, modes, reference fields, `refund` (null when no refund date; else date, amounts,
modes, to-name, to-mobile, note), `usedOn` (bill numbers of live bills with `advance_id` = this advance, **(B2)**), `fromBillNo`,
`createdAt` (ISO). **HMS adds** (contract request): `entryNo`, `version`, `canDelete`/`canEdit` hints are NOT sent (the client uses
`canChangeAdvance`; the server re-checks).

## 10. The system log (`Support/SystemLogger.php`, `BillMasterController.php:44-95`)

- Module `bills`; entity `Advance` (refund: `Advance refund`); label `{receipt number} ({guest name})` (`:45-48`); subject = the advance.
- Created (`:164`): `Added Advance: {label}`, details = every field holding a value except id, created_at, updated_at, created_by
  (`whole`, `:82-87`), keys made readable (`hotel_balance` → `Hotel balance`, `:90-95`), dates `d-m-Y`.
- Updated (`:213-216`): before/after of the edited fields only, `Changed Advance: {label} (Field, ...)` or `Saved Advance: {label} with
  no change`; field names readable (`SystemLogger::fieldName`).
- Deleted (`:231-234`): `Removed Advance: {label}`, details = whole.
- Refund (`:269`): `Added Advance refund: {label}`, details = the refund fields that hold a value, readable.
- Reverse refund (`:276-294`): `Removed Advance refund: {label}`, details = the refund fields it held.
- **HMS:** written in the SAME unit as the change; money in the details in paise (keys keep Pallav's readable names, e.g.
  `Hotel amount`); the trace id is stored.

## 11. HMS deviations (ruled by the Backend master, 2026-10-05)

1. **HMS deviation:** reversing a refund when there is none is `CONFLICT` "This advance has no refund to reverse." (Pallav silently adds 0
   and writes a misleading log line). Test: `billing.advances.test.ts` "HMS deviation: reversing when there is no refund ...".
2. **HMS deviation:** a refund above the balance is refused EVEN UNDER FORCE (money integrity: the balance CHECK forbids a negative
   balance). Likewise a negative amount (`min:0`) stays refused under force. Test: "... refused EVEN UNDER FORCE ...".
3. The accounting-year guard takes Pallav's "pending columns" and "action dates" (`guardBooks` `pending`, `services/cash/books.ts`,
   backward compatible; tests in `billing.rules.test.ts`).
4. Mode text is free (Pallav) while the contract's `PaymentMode` is a union: contract request in `docs/API.md`.
5. A forced (`force`) save with an empty payment date gets today (IST) (ForceMode::fill); a malformed date is still refused (a type rule).

## 11b. The receipt preview (HMS, MJ: no PDF library)

`GET /advances/{id}/preview` returns ui-shared `AdvancePreview`: the header from hotel settings (`general.site_name`, `general.address`,
`general.support_phone`, the food business unit's name; empty text when a setting is not set; `gstin: null`, Pallav has none, MJ #20), the
advance as `Advance`, and `amountWords` = hotel + food amount in Indian words (`NumberToWords::convert`, golden-tested against real PHP).
Permission `bills.advances` view; a recycle-binned advance only for recycle-bin users (`canUseRecycleBin`); never a stored file path.

## 12. Not in this slice

The receipt PDF file (the preview is data), the recycle-bin listing, the purge job, company editing (company names are read through a small read-only port),
reservations' advances from the front office (`pms.reservations.advance`, B3).
