# Behaviour spec: Billing, Bills and Debit Settlement (Bill Master bills)

Hotel Pallav's Bills screen as the backend must keep it. Source: `app/Http/Controllers/BillMasterController.php` (lines below are that file
unless named), `app/Models/BillMasterBill.php`, `app/Models/MealPlanRate.php`, `resources/views/bill_master/bills.blade.php`. **HMS:** marks a
deliberate difference. Golden fixtures by real PHP: `db/scripts/php/generate-billing-fixtures.php <pallav> bills` →
`db/scripts/php/fixtures/billing-bills.json`; tests `tests/server/billing.bills*.test.ts`. Advances: `billing-advances.md`.

Table: `bill_master_bills`. Contract: `ui-shared/dashboards/billing.ts` (`Bill`, `BillInput`, `SettleInput`, `Installment`, `Settlement`,
`AppliedAdvance`, `BillQuery`, `BillList`).

## 1. Permissions (`Support/Permissions.php:114-121`, routes `routes/web.php:433-441`)

| Action | Pallav | HMS |
|---|---|---|
| list, read, preview | `bills.bills.view` | `bills.bills` view |
| create | `bill-master.bills.store` POST → create | `bills.bills` create |
| edit | PUT → edit | `bills.bills` edit |
| delete | DELETE → delete | `bills.bills` full |
| settle a debit | `bill-master.debit-bills.store` POST → `bills.debit-bills.create` | `bills.debit-bills` create |
| reverse a settlement | DELETE → `bills.debit-bills.delete` | `bills.debit-bills` full |
| restore / remove for good | SuperAdmin | hotel role `super_admin` |

`bills.debit-bills` offers view, create, delete only (`:118-120`); the settlement is shown on Bills, so reading goes through `bills.bills`.
The lookups a form needs (`GET /billing/options`, the advance and bill previews) use the PART key (`bills.bills` / `bills.advances` view), not the
module key: a person given only the Bills part must still be able to fill the bill form (ruled 2026-10-05).

## 2. Fields and validation (`billRules`, `:324-368`; Laravel 11 wording)

| HMS input | Pallav field / rule | Message |
|---|---|---|
| `billNo` (create only) | `bill_number` required, string, max:50 | "The bill number field is required." / "The bill number field must not be greater than 50 characters." |
| `companyId` | nullable, exists:company_profiles | "The selected company id is invalid." |
| `billDate` | required, date | "The bill date field is required." / "The bill date field must be a valid date." |
| `guestName` | required, max:255 | "The guest name field is required." / "... must not be greater than 255 characters." |
| `mobile` | max:15 | "The mobile number field must not be greater than 15 characters." |
| `roomNo` | max:20 | "The room number field must not be greater than 20 characters." |
| `advanceId` (create only) | nullable, exists:bill_master_advances | "The selected advance id is invalid." (**HMS:** a soft-deleted advance too, §11.2) |
| `hotel.plan` | max:100 | "The hotel plan field must not be greater than 100 characters." |
| hotel lines `roomPaise` (hotel_amount), `planPaise`, `extraBedPaise`, `laundryPaise`, `vpoPaise` (hotel_other_amount), `gstPaise` (hotel_gst) | nullable, numeric (NO min: a line may be a negative adjustment) | (only the type rule) |
| `hotel.mode` | hotel_mode_of_payment max:100 | "The hotel mode of payment field must not be greater than 100 characters." |
| food lines `foodPaise`, `planPaise`, `laundryPaise`, `gstPaise` | nullable, numeric | |
| `food.mode` | food_mode_of_payment max:100 | |
| `referenceName` | max:100 | "The reference name field must not be greater than 100 characters." |
| `referenceMobile` | max:15 | |
| `instruction` | nullable string (no max; **HMS:** bounded at 5,000 by the input shape) | |
| `grNo` | gr_number max:50 | "The gr number field must not be greater than 50 characters." |
| `address` | guest_address max:255 | |
| `gstin` | guest_gstin max:20 (no format check in Pallav; **HMS:** the same, §11.7) | |
| `persons` | integer, min:1, max:99 | "The persons field must be at least 1." / "... must not be greater than 99." |
| `arrivalAt` / `departureAt` | date; departure after_or_equal arrival | "The departure at field must be a date after or equal to arrival at." |
| `stay` | array max:30; each `from` required date, `to` required date after from, `plan` max:100, `persons` required integer 1-99 | "The stay field must not have more than 30 items." / "The stay.N.to field must be a date after stay.N.from." ... |

- Invoice uploads (`invoice_pdf`, `food_invoice_pdf`): **HMS:** not in this slice (files come with the media task); the paths stay null.
- **GST is a typed AMOUNT** (`hotel_gst`, `food_gst`): stored as typed; no rate (MJ #19).

## 3. Totals (`prepareBill`, `:377-403`)

- Hotel total = room + plan + extra bed + laundry + other (V.P.O.) + GST; food total = food + plan + laundry + GST, each `round(sum, 2)`
  (paise: exact). The server ALWAYS works the totals out from the lines; the input has no totals (a `totalPaise` key is refused as unknown).
- The stay is priced night by night by `MealPlanRate::price` (`MealPlanRate.php:57-87`): a part `[from, to, plan, persons]` covers the nights
  from `from` up to the morning of `to`; each night uses the latest rate whose `effective_from` ≤ that night, plan matched case-insensitively,
  0 when none has started; a part's amount = Σ rate × persons, `round(…, 2)`; its `rate` is the one rate when all nights share it, else null
  ("changing rate"); parts missing `from` or `to` are dropped. `plan_food_amount` = the total; `stay_segments` = the parts, null when none.
  This is what the hotel owes its food side, kept apart from the guest's bill.

## 4. Bill number

`date('Y').' / '.$number` (`:408`), the current IST year; unique among live bills: field `billNo` "This bill number already exists." (`:410-412`).
Never changed by an edit (`:463`).

## 5. Taking an advance off a new bill (`:416-441`, create only)

1. The advance must have hotel + food balance > 0: else field `advanceId` "Advance {receipt} has nothing left to take off." (`:420-422`).
2. Snapshots written by the SERVER (never input): receipt, guest name, hotel and food amount as text, payment date, company name.
3. Taken: hotel = min(advance hotel balance, hotel total), food likewise; the advance's balances = max(0, balance − total). The "delete
   amounts" (what a delete gives back) = what was taken. The advance row is read `FOR UPDATE` and its version rises (two clerks cannot
   spend the same money). **HMS:** a side whose total is ≤ 0 takes nothing (§11.1).
4. A closed year's advance may be used (only its pending columns change, `BillMasterAdvance.php:17-20`).

## 6. Balances

Debit (mode text equals "debit", any case) → that side's balance = the side total; otherwise 0 (`:443-444`, edit `:467-468`). See quirk (a).
Status (`bills.blade.php:23`): `paid` when neither side is on debit; else `settled` when the first instalment's date is set; else `due`.

## 7. Edit (`:456-476`) and delete (`:478-496`)

- Refused when a settlement is recorded: `CONFLICT` "A debit bill has already been generated for this bill; it cannot be edited." / "... deleted."
- Edit recomputes totals, stay and balances; the advance taken is NOT re-applied (**HMS:** `advanceId` ignored on edit, §11.6).
- Delete gives the advance back (balances += the delete amounts; a soft-deleted advance is skipped) and puts the bill in the recycle bin.
- Version check on edit, delete, settle, reverse, restore.

## 8. Settling a debit (`storeDebitBill`, `:502-572`)

- Refused when already recorded AND nothing is owed any more: `CONFLICT` "Debit bill already recorded for this bill." **HMS (H6, 13 Oct 2026):** a settlement that left a balance takes further payments: the new instalments are kept after the earlier ones (five in all, else the field error `installments` "Up to five installments in all; N already recorded."), the reference stays unless retyped, the balances come down each time, the log line reads "Debit bill payment"; the screen shows such a bill as "Part paid" with its balance and a Pay / Record payment button until it is cleared, and it stays under the **Debit waiting** tab and count (`BILL_STATE_SQL`: settled = a settlement recorded AND nothing owed; due = owed, recorded or not; the carried-forward rule of the date window follows) (Pallav recorded the settlement once, whatever was paid).
- Up to five instalments (slot 1 has no suffix, then `_1`…`_4`): date, hotel/food mode (max 20), hotel/food amount (numeric); reference name
  max 100, mobile max 15, instruction. **HMS:** `installments.0.date` is required (§11.3); field keys `installments.N.date|hotelPaise|...`.
- Paid = Σ amounts per side; remaining = balance − paid; balance = max(0, remaining); `debit_{side}_advance` = PHP text of max(0, −remaining)
  ("1000", "50.25", "0").
- Any excess (paid above the balance) becomes a NEW advance numbered `Excessive / {bill number}`, dated today (IST), same guest, mobile and
  company, logged as Added Advance; the bill keeps its receipt in `formatted_advance_receipt_number`. See quirks (b) and (d).
- Accounting year: a closed year's bill may still be settled (pending columns, `BillMasterBill.php:24-25`), with every instalment date in the
  current year.

## 9. Reversing a settlement (`destroyDebitBill`, `:574-610`)

- The excess advance(s) with that receipt are deleted, one log line each. **HMS:** refused if one was already used (§11.5); refused when
  nothing is recorded (§11.4).
- Every settlement column back to null; balances = the totals (quirk (c)).
- A settlement whose instalment dates lie in a closed year cannot be reversed ("changed").

## 10. The list, one bill, the preview

- List as advances (`:303-322`): the years on screen plus older DEBIT bills still owed (no settlement), carried forward; tabs paid/due/settled;
  filters mode, company/walk-in, month; search words over bill number, GR, guest, mobile, room, company or "walk-in", modes, total `1234.50`;
  KPIs: bills this month (count), billed this month, debit waiting (owed), debit settled (received). Order `bill_date desc, id desc`.
- `GET /bills/{id}/preview` (**HMS**, MJ's no-PDF rule): the paper's fields as data: header (hotel name, food name, address, phone from
  hotel settings; GSTIN null: Pallav has none, contract request), bill number, date, GR, guest block, every line, the totals with amounts in
  words (`NumberToWords`), GST amounts, the advance snapshot and what was taken, balances, instalments, plan meals owed. Never file paths.

## 11. HMS deviations (ruled by the Backend master, 2026-10-05)

1. A side whose total is ≤ 0 takes nothing from the advance (Pallav would RAISE the advance's balance).
2. A soft-deleted advance is refused "The selected advance id is invalid." (Pallav stores the id and takes nothing).
3. The first instalment's date is required: "The debit bill date field is required." (otherwise a bill could be settled twice).
4. Reversing with no settlement: `CONFLICT` "This bill has no settlement to reverse."
5. Reversing when the overpayment's advance was already used: `CONFLICT` "The advance made from the overpayment has already been used."; nothing changes.
6. `advanceId` is ignored on edit.
7. GSTIN: max 20 only, as Pallav (the UI's format check is the UI's).
8. Restoring a recycle-binned bill RE-TAKES the advance money its delete gave back, in the same unit with the advance read FOR UPDATE;
   if the advance is gone or can no longer cover it (either side), `CONFLICT` "The advance no longer has enough left to restore this bill."
   (Pallav restores the row only, so the same money counted twice). Restoring a recycle-binned ADVANCE is refused when what live bills took
   off it + its balance + its refund would exceed what was paid: `CONFLICT` "The bills that used this advance now claim more than it holds."

## 12. Quirks MJ should confirm (built exactly as Pallav, each behind one switch in `services/billing/quirks.ts`)

Default today: **every switch = Pallav's behaviour** until MJ answers. Each line below is ready to send to MJ.

**(a) `debitBalanceIgnoresAdvance`: FIXED by MJ (#21 A, 2026-10-05); `billingQuirks` now runs the corrected rule (a debit side owes its total less what was taken off the advance, never below zero). The text below is the old behaviour.** A guest's hotel bill is ₹8,000, paid "Debit" (to be settled later). At billing, ₹5,000 is taken off
their advance. Pallav shows the bill as still owing **₹8,000**; the advance's ₹5,000 is used up but not counted against what is owed. The
corrected rule would show **₹3,000** owed (₹8,000 − ₹5,000, never below zero). The Lead recommends fixing it.

**(b) `settleNonDebitMakesExcess`.** A bill was paid in Cash (nothing owed). Someone records a "settlement" of ₹700 on it. Pallav accepts it
and turns the whole ₹700 into a new advance "Excessive / 2026 / 1188" for the guest. The corrected rule would refuse: "This bill is not on debit."

**(c) `reverseResetsNonDebit`.** Continuing (b): reversing that settlement sets the bill's balance to its full total, ₹4,500, so a bill paid in
Cash now shows ₹4,500 owed. The corrected rule would set the balance as a new bill does: the side total only for a side on Debit, else ₹0.

**(d) `excessAdvanceDatedToday`.** A guest overpays by ₹500 in an instalment dated 28 Mar 2027; the clerk records it on 2 Apr 2027. Pallav dates
the new excess advance **2 Apr 2027** (the day it was recorded), so it lands in the new accounting year. The corrected rule would date it
**28 Mar 2027** (the last instalment's date).

## 13. Not in this slice

Invoice file uploads, the bill PDF (MJ: no PDF library; the preview is data), the Front Office check-out that writes a bill (B3,
`Support/Pms/Billing.php`), company editing.
