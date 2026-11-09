# Guest portal walk, real mode and mock (Session B, 12 Oct 2026, R44 for the guest area)

Method: headless Chrome (playwright-core, scripts `pm-dashboard/tools/guest-shots.mjs` and the scratchpad scripts of Session B) against the dev server on :3000 and the LOCAL database, signed in as `demo.guest` (Hotel Demo) with a real in-house stay. Desktop 1280 px, phone 390 and 360 px, light and dark. Nothing on Neon. Every number below was read from the page or the server answer.

## What was walked (real mode)
Sign-in; Dashboard; Bills (tabs, pay cards, list, bill detail with persons and hotel, invoice preview); History; Order to room (menu groups, a sold-out item, cart, order now to the room bill, order for a later time inside the stay, Pay now dialog and its answer); My profile (details, wrong current password, weak new password, sign-in code on then off); the "not set up yet" page (account unlinked, then linked again). Hotel selector: a single-hotel login shows the hotel name without a dropdown (the two-hotel dropdown was checked in mock).

## Defects found
| # | Screen | Steps | What happened | What should happen | Owner | State |
|---|---|---|---|---|---|---|
| 1 | Bills, Bill, pay cards | open a stay's running bill | the bill number was blank ("Bill ·", "BILL NO." empty) | say "Running bill" until it is numbered | B | FIXED (`billNumberText` in `ui-shared/dashboards/guest.ts`, used in Bills.tsx, Bill.tsx, parts.tsx) |
| 2 | Bills / Bill / Order | press Pay now and confirm while online payment is off | the guest saw "Some details need fixing. Check the highlighted fields." although the server sent "Online payment is not switched on yet. Please pay at reception." | show the server's sentence | B | FIXED (`errorText` in Bill.tsx, parts.tsx, Order.tsx); re-tested: the sentence shows |
| 3 | History (empty) | open History with no payments | text said "Room charges, orders and payments show here as they happen" (History is payments only) | "The payments you make show here." | B | FIXED (guest.ts) |
| 4 | Order to room | hotel with no menu items | three empty cards without a word | "Nothing on this list yet. Please call reception to order." | B | FIXED (Order.tsx) |
| 5 | My profile | real server | "Username" shows the mobile number (9000099001) instead of the login name | show the login name (`demo.guest`) | A (guest profile DTO has no username) | OPEN, sent to A |
| 6 | Bill lines | order food | the line reads "Order: B-test Dal Tadka · 2.00 × ₹190.00" and "Order for 13-10 13:00" | "2 × ₹190" and "Order for 13 Oct, 1:00 pm" | A (server line text) | OPEN, sent to A |
| 7 | Order to room | check the "outside hours" message in real mode | not testable: Hotel Demo's hours are 12:00 am to 11:59 pm every day | covered in mock (insideHours) | - | NOT TESTED in real mode |
| 8 | Bills at 360 px, real server | open Bills | the first screenshot at 1.8 s still showed grey skeleton blocks (data came later) | no sideways scroll (none found); skeleton only on the first load | D (R48 data layer) | check again after R48 |
| 9 | Bills | two open bills | the pay cards on top and the list below show the same two bills twice, so the page is long on a phone | compact pay cards | B | FIXED (R46 step 1; page 2080 px to 1593 px at 360 px) |

No sideways scroll on any guest page at 1280, 390 or 360 px, light or dark. No console error and no failed request except the expected ones (the wrong-password test, the Pay now refusal).

## Real-mode data created on the LOCAL dev database (for clean-up later)
| What | Id / name |
|---|---|
| Login account | username `demo.guest` (Hotel Demo), id 01a12d0d-dd9e-78d0-b136-3eef266e99d8; its dev password is in `db/.dev-login.txt` (git-ignored) |
| Customer record | "Demo Guest", mobile 9000099001, id 01a12d0f-4bc5-798b-91e3-3dc0bf25c4d3 (linked to demo.guest) |
| In-house stay | id 01a12d0e-f2b5-7d84-8c54-fb1f81f3ad82, room PE7881 (room id 01a1292d-9e51-7834-909b-6c9ff0d15ca4, it was "dirty"), checked in 12 Oct 2026, check-out 15 Oct; it carries room-service orders (3 orders O-... on the food bill) and the running room bill |
| Room-service menu items (Hotel Demo) | B-test Dal Tadka 01a12d11-4d7c-7925-a3f7-7978df56d4e6; B-test Masala Dosa (switched off) 01a12d11-4da8-7d8f-9000-f12feec1cd24; B-test Shirt 01a12d11-4dcc-75b5-8771-da8ff2809819; B-test Tea (2 cups) 01a12d11-4def-7bb9-86df-febe51f8f9a0 |
No existing dev row was changed or deleted. (The portal link of demo.guest was removed and set again during the not-linked test; the sign-in code was switched on and off again.)

## R47 (WhatsApp) in the guest files
Done: no WhatsApp text, field or label is left in `ui-shared/dashboards/guest.ts`, `guest.mock.ts`, `lib/api/adapters/guest.ts`, `web-app/src/dashboards/groups/guest/`, or `web-app/src/server/services/guest/` (A removed the server side and the contract fields in one pass; B removed the pay/receipt texts and the channel labels). Type-check clean.

## R46: the guest journey improvements (all built on 12 Oct, see UI.md change log)
1. Bills: keep the pay cards, but make them compact (number, hotel, amount due, tick, "View bill") and let the list below carry the details; today every bill is shown in full twice.
2. After "Add to my room bill": a confirmation card with the order number, the arrival time and a "See it on my bill" button instead of only a toast; keep the cart emptied.
3. "Pay now" refused: show "Pay at reception" with the reception phone as a call button (tel:), not only the sentence.
4. Order to room when not staying: say what happens next ("Ask at check-in") and show the hotel's reception number.
5. Home: the "What you can do here" box can be closed ("Got it") and stay closed for that guest; the first phone screen then shows the amount to pay and the quick actions.
6. Profile: next to "To change a detail, ask the front desk" add the reception call button.
7. Home "Coming up": scheduled room-service orders listed with their time (needs a server list, A).
