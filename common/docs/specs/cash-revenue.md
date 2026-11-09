# Behaviour spec: Daily Cash, Revenue (cash deposits)

The rules of Hotel Pallav's Revenue screen, as the backend must keep them. Source for every rule: the Pallav code at
`app/...` (paths are relative to the Pallav repo; line numbers are from the clone used for this port). Where HMS deliberately
differs, the line says **HMS:** and why. This file is written BEFORE the code; the golden tests (`tests/server/cash.golden.test.ts`,
fixtures made by real PHP: `db/scripts/php/generate-cash-fixtures.php`) and the service tests are written from it.

Tables: `hotel_cash_deposits`, `food_cash_deposits` (hotel migration 0003). Contract: `ui-shared/dashboards/cash.ts`
(`CashDeposit`, `DepositInput`, `CashList`, `CashStats`, `DepositQuery`).

## 1. The two books

- Two cash books, `hotel` and `food`, one set of handlers (`Http/Controllers/RevenueController.php:28-31`, routes `routes/web.php:400-407`).
- Names on screen and in the system log: Pallav `Hotel Pallav` / `Pallav Food` (`Support/CashLedger.php:23`). **HMS:** `Hotel` / `Food`
  (`cashBookShort`; the name of the hotel is not baked into the code).
- Each book has its own depositor list in Master Data: set keys `revenue_depositor_hotel`, `revenue_depositor_food` (`CashLedger.php:26`).
- A saved deposit never changes book (**HMS:** `VALIDATION_FAILED` `book`: "The cash book of a saved deposit cannot change.", from `ui-shared/dashboards/cash.ts`; Pallav has no such input because the book is in the URL).

## 2. Permissions (what each action needs)

Pallav maps a route name and method to a permission (`Support/Permissions.php:527-650`; the Revenue module is `Permissions.php:66-79`):

| Action | Pallav route | Pallav permission | HMS check |
|---|---|---|---|
| open the screen, list, read one | `revenue.index` GET | `revenue.view` (module) | key `revenue`, level `view` |
| record a deposit | `revenue.hotel.store` POST | `revenue.hotel.create` | key `revenue.hotel` (or `.food`), level `create` |
| correct a deposit | `revenue.hotel.update` PUT | `revenue.hotel.edit` | level `edit` |
| delete a deposit | `revenue.hotel.destroy` DELETE | `revenue.hotel.delete` | level `full` |
| receipt PDF | `revenue.hotel.view` GET | `revenue.hotel.export` | **HMS:** later, with PDFs |
| restore / remove for good | `recycle-bin.*` (middleware `superadmin`, `routes/web.php:148`) | SuperAdmin only | the hotel's built-in permission role `roleKey = super_admin` (never the account role) |

- The parts `revenue.hotel` and `revenue.food` offer only create, edit, delete and export (`Permissions.php:39`, `WRITES`): **reading goes through the module** `revenue`. Writes need the PART permission, not the module's.
- Levels: create = `create`, edit = `edit`, delete = `full` (MJ's four levels over Pallav's actions, `db/scripts/generate-platform-seeds.ts`).
- Beyond the permission, three people-rules apply (section 5): who may edit, who may delete, who may choose the date and time.

## 3. Fields and validation (`RevenueController.php:132-157`)

| Field (HMS input) | Pallav rule | Pallav message (word for word) | HMS |
|---|---|---|---|
| `date` | `required, date, before_or_equal:today` | "The date field is required." / "The date field must be a valid date." / "The date field must be a date before or equal to today." | only validated when a date is chosen by hand (section 4); format `YYYY-MM-DD` |
| `time` | `required` | "The time field is required." | `HH:MM` or `HH:MM:SS`, 24-hour (Pallav stores whatever the picker sent; a bad string would be a database error) |
| `depositor` | `required, string, max:100, in:<book's Master Data list + the name the entry already has>` | "Choose who is depositing." (required) / "Choose a depositor from the {book} list. The SuperAdmin adds names in Master Data." (in) / "The depositor field must not be greater than 100 characters." (max) | `{book}` is `Hotel` / `Food`; only ACTIVE list items count (`Support/Masters.php:39-42`); an edit may keep the name it already has even if hidden since |
| `instruction` (column `reason`) | `nullable, string, max:500` | "The instruction field must not be greater than 500 characters." | trimmed; empty becomes null (`RevenueController.php:165`) |
| `amountPaise` (Pallav `amount`, rupees) | `required, numeric, min:0.01, max:9999999999.99` | "The amount field is required." / "The amount field must be a number." / "The amount field must be at least 0.01." / "The amount field must not be greater than 9999999999.99." | integer paise, 1 to 999,999,999,999 |

Laravel's wording is the framework default for 11.x (`lang/en/validation.php`, not in the clone). The apps show their own client-side text first
(`validateDeposit` in `ui-shared/dashboards/cash.ts`); the server's text is the fallback and the authority.

- Money crosses the API as integer paise. Pallav stores `decimal(12,2)` rupees; the table here is `amount_paise bigint CHECK (> 0)`.
- No identity in the input: the person recording is the signed-in person (`RevenueController.php:179-180`, `user_id` and `full_name` = their name at that moment, column limit 20 characters). Unknown input keys are refused (`z.strictObject`).
- **Amount in words** is worked out on every save and stored (`RevenueController.php:166`, `Support/NumberToWords.php:21-43`): Indian numbering, "Rupees"/"Rupee", "and Fifty Paise", "Only"; `Zero Rupees Only`; outside 0 to 100,000,000,000 paise the plain number comes back. Golden-tested against real PHP.

## 4. Date and time stamp (`CashLedger.php:179-206`, `Models/Concerns/LocksEntryStamp.php`, `Support/EntryStamp.php`)

- The form's own picker is only to the minute, so unless the date/time was chosen BY HAND (`_stamp_set`, **HMS:** `stamp` is not null) the entry is stamped with the moment of saving: on create, date = today and time = now to the second; on edit, date and time are left as they were (`CashLedger::stamp`).
- A time chosen by hand `HH:MM` becomes `HH:MM:00`.
- Only a person with the ability `system.backdate` may choose the date and time. For everyone else the model forces the stamp: a new entry gets the moment of saving, and an edit keeps the original, whatever the form sent (`LocksEntryStamp.php:16-34`). **HMS:** the same, silently (no error), by ability `system.backdate`.
- "Today" and "now" are in IST (Asia/Kolkata). Golden-tested: the boundaries around IST midnight.

## 5. Who may do what to an entry

`CashLedger.php:45-102`, `Models/User.php:137-238`. Definitions: **admin** = may see the `users` module (Pallav `can('users.view')`); **super admin** = the hotel's built-in permission role `super_admin` (`roles.key`, level 4; Pallav's SuperAdmin). The ACCOUNT role `super_admin` is the platform owner and is not this; the account role only picks the dashboard and the guest/corporate record scope. "Below my level" compares `roles.level`; **can write** = holds any create or edit level anywhere (`Support/Access.php:161-170`); **manage(owner)**: super admin always; admin unless the owner is a super admin; anyone else only their own entry; an owner of null = admin only (`User.php:224-238`).

- **Newest entry of a book** = ordered by `date desc, time desc, id desc`, the first one (`CashLedger.php:34-37`): "the entry at the top of the book on screen, even when an Admin has backdated a newer one below it". (The ui-shared mock uses the highest entry number; the server follows Pallav. **Contract note**, see docs/API.md.)
- **Edit** (`CashLedger.php:45-60`, `RevenueController.php:194-219`): allowed when `canWrite AND manage(owner) AND entry is the newest`, or when the super admin has force mode armed (any entry). Refusals are `FORBIDDEN`: "Only the latest deposit in a book can be edited." (not the newest) or "You are not allowed to edit this deposit." (the newest but not allowed). Editing a closed entry under force mode writes a force-log row "Forced past a lock: Edited a closed revenue entry" (`RevenueController.php:208-210`, `ForceMode.php:169-179`).
- **Delete** (`CashLedger.php:85-102`): only an admin; never over a super admin's entry unless the person is a super admin; any entry, old or new. Refusals: "Only an Admin or the SuperAdmin can delete an entry." / "You are not allowed to delete this entry."
- A deleted entry goes to the recycle bin (soft delete: `deleted_at`, `deleted_by`, `Models/Concerns/Recyclable.php`). **Restore** and **remove for good** are SuperAdmin only (`RecycleBinController.php`, route group `routes/web.php:148`); restoring clears `deleted_by` and writes a system-log line "Added {label}" in module `recycle-bin` with `Restored by`; removing for good writes nothing. After 30 days the nightly purge removes it (`Support/RecycleBin.php:111-124`); **HMS:** the purge job `recycle-bin-purge` (not built yet).
- **Accounting year lock** (`Support/Books.php:224-277`, `Models/Concerns/InAccountingYear.php`): a save or a delete is refused when the entry's date lies in a CLOSED year; only the newest accounting year takes entries; with force mode the lock is skipped and written to the force log ("Accounting year lock"). Dates before the first year are history and not locked. Messages (`Books.php:297-317`): "{day} is in {next year}, which has not been started yet. An Admin can start it from the year menu in the header. Until then, entries up to {current end} can still be made." / "{year} is closed, so nothing can be dated {day}. Only {current year} ({span}) takes entries." / "{year} is closed, so an entry dated {day} cannot be {changed|deleted}. Only {current year} ({span}) takes entries." The error field is `date`.

## 6. Entry numbers (`Models/Concerns/HasEntryNumber.php`)

- Per book, one past the highest `entry_no` on the table counting soft-deleted rows; a gap in the middle stays; deleting the last entry for good (purge) frees its number; a soft delete does not (`HasEntryNumber.php:11-14,34-46`).
- Shown as four digits, zero padded: `0001` (`HasEntryNumber.php:84-87`). Search and receipts use both `#0001` and `0001`.
- Race: Pallav takes the number in a transaction and retries a clash (5 tries). **HMS:** `pg_advisory_xact_lock` + `MAX+1` + the UNIQUE index (`src/server/data/entryNo.ts`); the in-memory double runs one unit at a time per hotel.

## 7. The list (`RevenueController.php:33-89`, `CashLedger.php:104-229`)

- Filters: `book` = all, hotel or food (`CashLedger::book`); the accounting years on screen (`Books::scope`; **HMS:** `from`/`to` dates; the year menu is a UI concern that sends the dates of the years it shows); search `q`.
- Order: newest first, `date desc, time desc, id desc` (`CashLedger::page`). **HMS:** `sort` is a whitelist (`at`, `entryNo`, `amountPaise`, `depositor`), default `at` descending with the same tie-breakers.
- Paging: `per` in 10, 25, 50, 100, default 25 (`CashLedger.php:17-20,219-222`); `page` 1 or more. **HMS:** any other `pageSize` is `VALIDATION_FAILED` instead of silently 25 (clients are ours).
- **Search** (`CashLedger::search`, golden-tested against the real function): split into words, `"quoted phrases"`, `-word` to leave out; every word must match somewhere on the row, in any order; text is lower-cased, a comma inside a number is dropped (`24,000` = `24000`), other punctuation becomes a space; amount filters `>5000`, `<500`, `500-2000` compare the amount. The text searched: `#0001`, `0001`, the date as `d-m-Y d M Y l Y-m-d`, the time `HH:MM`, depositor, reason, the name of the person who recorded it (name at the time and current display name), amount in words, the amount as `1234.50` and `1,234.50`, the book name and the word `deposit`. Search is plain text: `%` and `_` are ordinary punctuation (turned into a space like any other), never wildcards; a query that is only punctuation matches every row.
- Page data also carries the numbers on top of the screen (`RevenueController.php:65-76`): `today`, `month`, `hotelMonth`, `foodMonth` (sums by date in IST, live rows only, books shown for today/month) and the count; **HMS:** `CashList.stats` (`todayPaise`, `monthPaise`, `hotelMonthPaise`, `foodMonthPaise`), `counts` per tab (after search, before paging) and `shownTotalPaise` (sum of every row matching the filters, all pages).
- Each row says whether the signed-in person may edit or delete it (`RevenueController.php:57-61`); **HMS:** `CashDeposit.isLatest`; the client combines it with `canEditCashEntry`/`canDeleteCashEntry`, the server re-checks on every write.

## 8. The system log (`Support/SystemLogger.php`, `RevenueController.php:186-189,215-216,229-233`)

- Module `revenue`; entity `{Hotel|Food} deposit`; label = the four-digit entry number; subject = the deposit's id.
- Created: action `created`, summary `Added {entity}: {label}`, details Depositor, Amount, Instruction, Date (`d-m-Y`).
- Updated: action `updated`, summary `Changed {entity}: {label} ({fields})` or `Saved {entity}: {label} with no change`, details only the fields that moved as `was X, became Y` (`SystemLogger::diff`, empty shows as `empty`).
- Deleted: action `deleted`, summary `Removed {entity}: {label}`, details what it held.
- **HMS:** the row is written in the SAME unit (transaction) as the change, so there is never a change without its log; money in the details is in paise; the trace id of the request is stored (`system_logs.trace_id`); Pallav swallows a logging failure, HMS lets it roll the change back.

## 9. Not in this slice

The receipt PDF (`RevenueController::view`), the recycle-bin listing screen and the 30-day purge job, Master Data editing, the accounting-year menu, the nightly `deleted_by` bookkeeping outside these routes.

## 10. Throttling

Pallav puts no `throttle` middleware on the Revenue routes (`routes/web.php:95-123,400-407`: only the signed-in group middleware). None is declared here; the wrapper's `limits` support is built and tested for the routes that do have one (sign-in, reset codes).
