# Billing: mock-mode result and the list for the live check (Web UI 1, 11 Oct 2026)

Billing is already wired to the real server: `web-app/src/lib/api/adapters/billing.ts` (all 19 `BillingApi` calls), switched in `groups/billing/api.ts`. No Billing file was changed by me. The someone-else edits in those files (Textarea instead of a hand-written textarea, check:shared) were not touched.

## Done in mock mode (dev server, own port, quick login `anita`, headless Chrome)
| Check | Result |
|---|---|
| Bills: create a paid bill (4-step form), count 29 to 30, toast, row shows number, guest, company, cash | pass |
| Bills: View opens the print view (in demo data it says the PDF is made by the live server) | pass |
| Debit bill: create, Settle (full), tabs move Debit waiting 10 to 9 and Debit settled 6 to 7 | pass |
| Reverse Settlement (confirm "Reverse") puts it back to Debit waiting | pass |
| Bills: Edit (change guest name), saved, "Bill updated." | pass |
| Bills: Delete (confirm "Delete"), count back | pass |
| Advances: create (receipt, guest, amount), count 19 to 20 | pass |
| Advances: Refund (Process Refund) moves one to Refunded 3 to 4; Undo Refund (confirm "Reverse") restores it | pass |
| Advances: Delete, count back | pass |
| Day and night, desktop 1440 and phone 390: Bills and Guest Advances screens and both forms, no sideways scroll | pass |
Seen, not fixed (cosmetic, mock): on New Bill the two "Advance from / Advance to take off" selects show blank when nothing is chosen (their list does start with "No advance"). The bill number box shows the next number only as grey placeholder text, it is not filled in.
Not done in mock: the recycle bin (it lives in Admin, not on the Billing screens), bill and advance print views beyond opening them, extra installments (up to 5) in Settle, a bill with an advance taken off, the company and month filters.

## For the live check (real server, a throw-away hotel or test records; remove what is created)
| Call (adapter to route) | What to look for |
|---|---|
| `listBills` GET `/billing/bills` | filter by tab (paid, debit waiting, debit settled), search, payment mode, company, month, sort (only billDate, billNumber, guestName, totalPaise, balancePaise are accepted: any other is a 422), page size snaps to the server's sizes; KPI numbers and tab counts match the list |
| `listAdvances` GET `/billing/advances` | the same, tabs unused / partly used / used / refunded; `options.companies` filled |
| `listCompanies` GET `/companies/lookup?limit=50` | picker works; for a user WITHOUT Companies access the fallback (names from the advances list, no GSTIN) shows |
| `getBillingOptions` GET `/billing/options` | plans with today's meal rates, payment modes; the form totals match the server's total after saving |
| `createBill` POST `/billing/bills` | the bill number the clerk typed is kept; a duplicate number gives the field error; GST and total equal the server's; with `advanceId` the advance balance falls |
| `updateBill` PATCH `/billing/bills/{id}` | send `version`; open the same bill in two tabs, save in both: the second gets CONFLICT and the screen shows the conflict note |
| `deleteBill` DELETE `/billing/bills/{id}` | needs `version`; the bill goes to the bin (Admin recycle bin) |
| `settleBill` POST `/billing/bills/{id}/settlement` | 1 to 5 installments, overpaying keeps the rest as an advance, version conflict |
| `reverseSettlement` DELETE `/billing/bills/{id}/settlement` | back to Debit waiting, any advance made from overpay is handled as the server says |
| `getBillPreview` GET `/billing/bills/{id}/preview` and the PDF `/billing/bills/{id}/pdf` | header, GSTIN, amount in words, plan lines; the PDF opens |
| `createAdvance` / `updateAdvance` / `deleteAdvance` | receipt number kept, hotel and food sides, version on update and delete |
| `refundAdvance` POST `/billing/advances/{id}/refund` and `undoRefund` DELETE the same | limits (cannot refund more than is left), undo restores |
| `listOpenAdvances` GET `/billing/advances/open` | the "advance to take off" picker on a new bill shows only advances with money left |
| `getAdvancePreview` GET `/billing/advances/{id}/preview` and the PDF | receipt fields, amount in words |
| `restoreAdvance` (no version: scans the bin, 100 per page up to 50 pages) and `purgeAdvance` | through Admin's recycle bin; check the restored advance returns with its old receipt number |
| Permissions | a user with no Billing grant gets the no-access state, not an endless skeleton; a read-only user sees no Edit/Delete/Settle |
| Errors | stop the server mid-save: the form keeps the typed values and shows the error |

## Speed script (for Frontend 1 to run with its real session)
`web-app/scripts/measure-ui-speed.mjs` (new): page change (first and second open of Bills, Revenue, Customers) and one search, in a real headless Chrome, reads only, takes the session cookie from `--cookie`, prints two small tables. Run it before and after a change, on `npm run build` + `npm start`. Usage is at the top of the file.
