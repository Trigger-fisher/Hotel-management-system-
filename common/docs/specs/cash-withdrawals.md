# Behaviour spec: Daily Cash, Expenses, cash withdrawals

Same structure and almost all of the rules of `docs/specs/cash-revenue.md` (read that first: stamp, entry numbers, search, accounting-year lock, recycle bin, version check, system log, force mode, the SuperAdmin role). This file lists what is DIFFERENT for a withdrawal. Pallav source: `Http/Controllers/ExpenseController.php` unless stated. Tables: `hotel_cash_withdrawals`, `food_cash_withdrawals`. Contract: `ui-shared/dashboards/cash.ts` (`CashExpense` with `kind: 'withdrawal'`, `ExpenseInput`, `CashList`).

## 1. What a withdrawal is

Cash taken out of a book's till (`ExpenseController.php:43-44`). One handler for both books and for the other kinds of expense; the entry's type is `hotel-withdrawal` or `food-withdrawal`. Named `Hotel Cash Withdrawal` / `Food Cash Withdrawal` in messages and the system log (`:50,548-554`; **HMS:** `Hotel` / `Food`, not the hotel's own name).

## 2. Permissions (`Support/Permissions.php:80-95`)

| Action | Pallav | HMS |
|---|---|---|
| open the Expense screen, list, read one | `expense.view` (module) | key `expense`, level `view` |
| record, correct, delete a withdrawal | the part `expense.withdrawals` (create / edit / delete; the part has no view, `WRITES`) | key `expense.withdrawals`, levels `create` / `edit` / `full` |
| receipt PDF | `expense.withdrawals.export` | later, with PDFs |
| restore / remove for good | SuperAdmin | the hotel's `super_admin` role |

The parts `expense.withdrawals`, `expense.misc` and `expense.advances` are write-only: **reading goes through the module `expense`**. There is one part for both books (unlike Revenue, which has one per book).

## 3. Fields and validation (`rules():270-306`, `messages():309-317`)

| Field (HMS input) | Pallav rule | Message (word for word) | HMS |
|---|---|---|---|
| `withdrawer` | `required, string, max:100, in:<the book's receiver list + the name the entry already has>` | "Choose who is taking the cash." / "Choose a name from the {book} list. The SuperAdmin adds names in Master Data, under Expense." / "The withdrawer field must not be greater than 100 characters." | list = the ACTIVE items of the Master Data set `cash_person_hotel` / `cash_person_food` (`Support/CashPeople.php:20-28`); `{book}` is `Hotel` / `Food` |
| `amountPaise` (Pallav `amount`) | `required, numeric, min:0.01, max:9999999999.99` | "The amount field is required." / "must be a number." / "must be at least 0.01." / "must not be greater than 9999999999.99." | integer paise 1 to 999,999,999,999 |
| `instruction` | `nullable, string, max:1000` (a withdrawal; a misc. expense max 500) | "The instruction field must not be greater than 1000 characters." | trimmed; empty is null (`:441-444`) |
| date and time | `required, date, before_or_equal:today` / `required` | as in the revenue spec | only when chosen by hand, and only with the ability `system.backdate` (`LocksEntryStamp`) |

- No identity in input: the recorder is the signed-in person (`:460-461`).
- **Amount in words** stored on every save (`:446`).
- ui-shared `ExpenseInput` carries fields for every kind (`withdrawer`, `employeeId`, `yearMonth`, `lines`); for a withdrawal only `withdrawer`, `amountPaise`, `instruction` and `stamp` count and the others are ignored.

## 4. Differences from a deposit

- **An edit takes the entry over:** unless the person is the SuperAdmin, an edit sets `user_id` and `full_name` to the EDITOR (`:504-507`), so "recorded by" becomes whoever last corrected it. Deposits do not do this (`RevenueController::update`). HMS keeps it, per kind.
- Refusals read "entry" not "deposit": "Only the latest entry in a book can be edited." / "You are not allowed to edit this entry." (`:490`); delete: the same two refusals as revenue (`CashLedger::blocked`). Closed-entry force edit logs "Forced past a lock: Edited a closed expense entry" (`:496`).
- The newest entry is per TABLE: the newest withdrawal of the hotel book is not the newest miscellaneous expense (`CashLedger::newestId($entry::class)`, `:488`).
- System log module `expense`; entity `Hotel Cash Withdrawal`; label the four-digit number; created details `Date`, `Amount`, `Paid to` (the withdrawer), `What` (the instruction) (`:471-476`); updated: `date, time, amount, withdrawer, instruction, expense_name, expense_head` as was/became (`:509,522-523`); deleted: what it held (`:536-538`). HMS: money in paise, same unit as the change.
- Search words beyond the columns (`:77-81`): the book's name, `Cash Withdrawal`, and the staff name (advances only). Golden-tested (`expenseSearches`).
- The list shows withdrawals and miscellaneous expenses together (and advances, later): filters `book` (all/hotel/food) and `kind` (all/withdrawal/misc/advance) (`:55-61`).

## 5. Everything else is the revenue spec

Entry numbers per table (max + 1, soft-deleted rows count, a purge of the last frees it), the accounting-year lock and its messages, the recycle bin (restore and purge are SuperAdmin only), the version check, throttling (none: Pallav has no `throttle` on these routes), the numbers on top (`today`, `month`, `hotelMonth`, `foodMonth`: withdrawals and misc. only; advances are added when that slice is built, `:98-133`).
