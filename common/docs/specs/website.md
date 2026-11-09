# Website, part 1 (W1): enquiries, rooms, tariff plans, calendar

Port of Pallav Website controllers (Enquiry, Room, Rate, Calendar). Code: `web-app/src/server/services/website/`, tests `tests/server/website.test.ts` (end to end) and `website.golden.test.ts` (availability, phone, reference, labels; fixtures made by real PHP in `db/scripts/php/generate-website-fixtures.php`).

## Rules
1. **Availability**: rolling open window of 3 months from today, stay cap 60 nights, free = capacity - sold; a date with no calendar row is open inside the window, closed beyond it; sold = confirmed enquiries + front-office reservations + walk-ins.
2. **Confirm** (enquiry edit): under the room lock, availability is re-checked (the open window is not applied to a request already sent; per-date closings and full rooms still stop it); the front-office reservation is made in the same unit; mail goes through the SiteMail port. Message: "Enquiry X confirmed. Reservation Y made at the front desk." Already confirmed -> 409.
3. **Decline / cancel** needs a reason (422); frees the reservation; already cancelled -> 409. A declined enquiry may be confirmed again (as Pallav).
4. **Update**: phone normalised, 7-15 digits; stored `guests` = adults + children.
5. **List**: "new" from an earlier day reads pending; tiles count every enquiry whatever the search.
6. **Rooms**: unique slug, last in order; never deleted with enquiries on record (409); delete removes plans, rates, inventory.
7. **Plans**: tiers give single (1 guest) and double (2 guests, else the first tier) prices; pause/move/delete.
8. **Calendar**: week starts at the date given (not Monday-aligned); save checks each cell alone (inventory below sold / above total refused) and returns `{saved, error}`; toggling a date past the window opens it (it shows as closed with no row); block range <= 366 days, dates with bookings skipped; bulk prices write only dates whose price changes.
9. Permissions: website.enquiries / rooms / rates / calendar; delete = full.
