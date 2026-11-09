# Behaviour spec: Daily Cash, Expenses, miscellaneous expenses and their lines

Read `docs/specs/cash-revenue.md` and `docs/specs/cash-withdrawals.md` first: this file lists only what is specific to a miscellaneous expense. Pallav source: `Http/Controllers/ExpenseController.php` unless stated. Tables: `hotel_misc_expenses`, `food_misc_expenses`, `expense_lines` (one table for both books, told apart by `business`), and the catalogue `expense_categories`, `expense_items`. Contract: `ui-shared/dashboards/cash.ts` (`CashExpense` with `kind: 'misc'`, `ExpenseLine`, `ExpenseLineInput`, `ExpenseInput`).

## 1. What it is

Day-to-day spending recorded as a LIST OF LINES, item by item (`:288-299`). The amount is never typed: it is the sum of the lines (`:431-438`). The entry also keeps two short names built from the lines (`expense_name`, `expense_head`) so lists and reports still read well (`:388-397`).

## 2. Permissions

Part `expense.misc` (create / edit / delete = levels `create` / `edit` / `full`); reading through the module `expense` (`Support/Permissions.php:88-92`). Same people rules as every cash entry.

## 3. Validation (`rules():288-299`)

| Field | Rule | Message (Laravel 11 wording, attribute names as the apps read them) |
|---|---|---|
| `lines` | required array, min 1, max 40 | "The lines field must have at least 1 items." / "The lines field must not have more than 40 items." |
| `lines.N.categoryId` | required | "The lines.N.category_id field is required." (field `lines.N.category`) |
| `lines.N.itemId` | required | "The lines.N.item_id field is required." (field `lines.N.item`) |
| `lines.N.quantity` | required, numeric, min 0.001, max 1000000 | "...is required." / "must be a number." / "must be at least 0.001." / "must not be greater than 1000000." |
| `lines.N.pricing` | `listed` or `custom` | the contract's union type |
| `lines.N.amountPaise` | required when custom, numeric, min 0.01, max 9999999999.99 | "The lines.N.amount field is required when lines.N.pricing is custom." / "must be at least 0.01." / "must not be greater than 9999999999.99." |
| `instruction` | nullable, max 500 | "The instruction field must not be greater than 500 characters." |

Then the lines are resolved against the catalogue (`resolveLines`, `:329-385`):
- an item that is not in the book's catalogue (and is not "keep"): "Choose an item from the list." (`lines.N.item`, `:355`);
- "keep" (an old item no longer in the catalogue) is allowed only for a line that is already on the entry: otherwise "Choose an item for this line." (`:343`);
- **total <= 0** after pricing: "The total must be more than zero." on `lines` (`:433-435`, skipped under force mode, which also skips the field validation: `ForceMode::relax`).

## 4. The arithmetic (golden-tested against real PHP: 1,675 cases)

- `quantity = round(q, 3)` (`:338`).
- **Listed line:** the price is the CATALOGUE's, EXCEPT for a line already on the entry whose item is unchanged: it keeps the price it was saved with, so editing an old entry never quietly reprices it (`:361`). `total = round(quantity x price, 2)` (`:369`).
- **Custom line:** `total = round(amount, 2)`, `price = quantity > 0 ? round(total / quantity, 2) : 0` (`:366-367`).
- **Amount** of the entry = sum of the line totals (`:431`); words on every save.
- `expense_name` = the first two distinct item names joined by ", " plus " +N more" for the rest, cut to 100 characters; `expense_head` = the first distinct category plus " +N" for the other categories, cut to 60 (`summary`, `:388-397`, multibyte-safe).
- Money is exact (paise, a three-decimal quantity, one rounding half away from zero). PHP 8.3 rounds an exact decimal tie UP; PHP 8.4 rounds some of them down. HMS follows 8.3 (what production ran); the golden test tolerates a difference only on an exact tie where HMS rounded up.

## 5. Saving and editing

- On create the entry and its lines are written in ONE transaction with the entry number (`:465-469`); lines are copied (names, price) so later catalogue changes never touch old entries (`Models/ExpenseLine.php`).
- On edit EVERY line is deleted and recreated (`:514-518`): the line ids change. `lineId` in the input says which saved line a row came from (for "keep" and for the unchanged-price rule).
- **Pallav defect, fixed:** deleting an entry deletes its lines (`Models/Concerns/HasExpenseLines.php:17`), and a soft delete fires that too, so a restored entry comes back with its amount but NO lines. HMS keeps the lines on a soft delete (they leave with a purge). Test: "a restored miscellaneous expense still has its lines".
- Search extras: the lines' category and item names (`:77-81`).
- System log: created details `Date`, `Amount`, `Paid to` (empty), `What` = the expense name; updated: was/became for `date, time, amount, instruction, expense_name, expense_head`; deleted: what it held.

## 6. The catalogue

`expense_categories` (name, 1 to 80 characters, unique per business) and `expense_items` (name unique per category, price 0 to 9999999.99), per business, ordered by sort order then name (`Support/ExpenseCatalog.php`). The catalogue is READ here (the lookups and the pricing). Maintaining it (create, rename, delete, the "both businesses" mirroring) is Master Data (`ExpenseCatalogController`, SuperAdmin only) and belongs with the Master Data module: **not in this slice**. Those tables are marked `hard-delete` (Pallav deletes them: `ExpenseCatalogController.php:92,155`).

## 7. Not in this slice

Staff advances (the third kind: Payroll staff list, `year_month`), the receipt PDF, Master Data editing (receiver lists, the catalogue), the accounting-year menu.
