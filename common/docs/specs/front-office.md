# Behaviour spec: Front Office (Pallav "Pms": board, rooms, reservations, stays, charges, check-in, check-out)

Source: Pallav `app/Http/Controllers/Pms/{BoardController,RoomController,ReservationController,StayController}.php`, `app/Models/Pms/*.php`,
`app/Support/Pms/{FrontDesk,Billing}.php` (lines below are those files). **HMS:** marks a deliberate difference. Golden fixtures by real PHP:
`db/scripts/php/generate-front-office-fixtures.php` → `db/scripts/php/fixtures/front-office.json`; tests `tests/server/frontOffice*.test.ts`.
Tables: `pms_rooms`, `pms_reservations`, `pms_stays`, `pms_charges` (hotel migration 0006); read-only: `site_rooms`, `site_rate_plans`,
`site_enquiries`, `id_proof_types`, `app_settings`. Contract: `ui-shared/dashboards/frontOffice.ts`.

## 1. Permissions (`Support/Permissions.php:150-176`)

Module `pms`, parts `pms.board`, `pms.reservations` (`pms.reservations.cancel` is an edit), `pms.stays`, `pms.rooms` (`pms.rooms.bulk` is a
create). View → list/read; POST → create; PUT/PATCH and toggle*/move/extend/cancel → edit; DELETE → full (HMS's four levels). The board is
`pms.board` view; a reservation's advance (POST `advance`) is a `pms.reservations` create. Check-out writes a Bill Master bill and needs
`pms.stays` edit (Pallav maps `pms.stays.checkout` and `pms.stays.extend` to edit, `Permissions.php:167`);
the bill and advance it writes are logged in module `bills` exactly as Pallav (`Billing.php:55`, `:153`). Lookups a form needs use the part key.

## 2. Rooms (`RoomController.php`)

- Fields: `number` required max 20, unique ("There is already a room with that number."); `floor` max 20; `room_type_id` exists site_rooms;
  `notes` max 255. New room: `sort_order` = highest + 1. Log module `frontdesk`, entity `Room`, label `Room {number}`.
- Bulk (`:22-59`): "101-110" ranges (at most 200 per range, end ≥ start) or a list split on commas/spaces, each part cut to 20 characters;
  numbers already there are skipped; one log line "Added {n} rooms" with the typed numbers. Result: added count and skipped numbers; with none
  added the message is "Those rooms are all already there."
- Delete (`:72-82`): refused when any stay names the room: "Room {number} has guests on record and stays. Mark it out of order instead."
  Hard delete (no recycle bin in Pallav).
- Housekeeping (`:85-91`): toggles clean/dirty, logs "Room {n} marked {status}". **HMS:** the apps send the status they want (set, not
  toggle: two clerks toggling at once would cancel out; contract request).
- Out of order (`:94-109`): refused while a guest is in it: "Room {number} has a guest in it. Check them out or move them first."; taking it
  out keeps the reason (≤255, trimmed, empty = none); bringing it back clears the reason; logs "Room {n} taken out of order" / "back in service".
- State (`Room.php:39-47`): occupied (an in-house stay) > out of order > dirty > vacant.

## 3. The board (`BoardController.php`)

Rooms by sort order then number, grouped by floor ("Rooms" when none); stats rooms, occupied, vacant, dirty, out of order, occupancy =
round(occupied × 100 / rooms in service) (0 when none in service); arrivals = confirmed reservations with check-in ≤ today (IST), by check-in
then guest; departures = in-house stays with expected check-out ≤ today; in-house count.

## 4. Availability (`FrontDesk.php`)

- Nights of a stay: check-in up to, not including, check-out, at most 366 (`:39-51`, golden-tested).
- Capacity of a category: its real rooms not out of order, or, before any real rooms of it exist, `site_rooms.total_count` (`:57-66`).
- Held per night: confirmed or checked-in reservations of the category (each holds its `rooms`, at least 1), plus walk-in in-house stays
  in its rooms from check-in through max(expected check-out, tomorrow) (`:77-123`).
- Free for a stay = capacity − the busiest night's held, never below 0; no nights → 0 (`:126-137`).
- Refusal (`ReservationController.php:185-198`): "No {name} room is free for every night of those dates." / "Only {n} {name} room is|rooms are free for every night of those dates." (`that category` when the category has no name).

## 5. Reservations (`ReservationController.php`, `Reservation.php`)

- Fields (`:159-182`): guest name required max 150; mobile max 20; email (Laravel `email`) max 150; company exists; category required
  ("Choose a room category."); rooms 1-50; plan max 60; rate numeric min 0 (empty = 0); adults 1-99; children 0-99 (empty = 0); check-in
  required date; check-out required date after check-in ("Check-out must be after check-in."); source one of walk-in, phone, website,
  company, agent, other; notes max 2000.
- Reference "RES-{yy}-{n:5}" (`Reservation.php:42-48`, the year the reservation is made, IST). **HMS:** n = one past the highest number of any
  reference (Pallav: the auto-increment id); taken inside the unit (ruled).
- Create: status confirmed; refused when not enough rooms are free (§4). Edit: only confirmed or checked-in ("A reservation that is
  finished or cancelled cannot be changed."); availability ignores the reservation itself. Version check on edit, cancel, advance.
- Cancel (`:100-121`): only confirmed ("Only a reservation not yet checked in can be cancelled."); a reason is required unless it is a
  no-show ("Please give a reason for cancelling."); no-show reason "Did not arrive"; reason cut to 255. If an advance still holds money,
  the answer says "It still has an advance: refund it from Guest Advances if it is to be returned." (**HMS:** a `notice` in the response).
- Views (`:3-24`): upcoming (confirmed, by check-in), today (confirmed, check-in ≤ today), in house (checked in, by check-out), past
  (checked out, newest check-out first), cancelled (cancelled or no-show, newest change first), all (newest check-in first); then newest first.
  Search words in guest name, mobile, reference.
- Advance against a reservation (`:124-147`, `Billing::advance`): receipt required max 50, payment date required, amounts min 0, modes max
  20, instruction max 255; nothing paid → "Enter how much the guest paid."; receipt taken → "That receipt number is already used."; written
  as a Guest Advance (year / number, guest, mobile cleaned to digits and + and cut to 15, company, `reservation_id`, reference name = the
  reservation reference, instruction default "Advance for reservation {ref}"), logged in module `bills` "Added Advance: Advance {receipt} - {guest}".
- Website enquiry → reservation (`FrontDesk.php:144-191`): done once per enquiry (a cancelled/no-show one is confirmed again); category =
  the enquiry's room; plan = the room's first active plan by sort order; rate = single price when adults ≤ 1 and a single price exists,
  else double (golden); adults = max(1, guests − children); source website; notes "Website enquiry {ref}\n{message}". Cancelling the
  enquiry cancels its confirmed reservation with the reason (≤255). Called by the Website module.

## 6. Check-in (`StayController.php:46-128`)

- The form (`:46-67`): a reservation must be confirmed or checked in ("This reservation cannot be checked in."); rooms to give = free
  rooms (not occupied, not out of order), the reserved category first, clean before dirty; none → "No room is free to give: every room is occupied or out of order."
- Fields (`:71-92`): room required; GR max 50; guest name required max 150; mobile REQUIRED max 20; email; address max 255; city max 100;
  nationality max 60 (default "Indian" in the table); ID proof type max 60, number max 60 (**HMS:** encrypted at rest, blind-indexed,
  only the last 4 shown, MASTER 4.3); company exists; GSTIN max 20; adults 1-20; children 0-20; plan max 60; rate required min 0; expected
  check-out required, after today ("The check-out date must be after today."); notes max 2000. ID proof upload: **HMS:** later (media task).
- The room must be free: "Room {number} is not free. Choose another." The SAME message when two check-ins race for one room (the one-in-house
  index refuses the second; tested).
- Check-in time = now; status in house; the reservation becomes checked in once its in-house stays reach its rooms count. Log `frontdesk`
  `Check-in` "{guest} in room {n}" with Reservation (reference or Walk-in), Rate, Until.

## 7. The guest's account (charges, move, extend)

- Charge (`:143-166`): only in house ("This guest has checked out; their bill is in Bill Master."); category food, room service (food side),
  laundry, extra bed, other (hotel side); description required max 255; date required; quantity 0.01-9999; unit price min 0; amount =
  round(quantity × unit price, 2) (golden). Log "Guest charge" "{description} - room {n}".
- Remove a charge (`:168-180`): the charge must belong to the stay (404); only in house; hard delete, logged with its amount. **HMS (ruled):**
  add and remove read the stay FOR UPDATE, so a charge can never land after check-out (tested against a racing check-out).
- Move (`:183-199`): the target room must be free: "Room {number} is not free."; an optional new rate; the room left becomes dirty.
- Extend (`:202-213`): expected check-out after the check-in date; the reservation's check-out follows.
- Nights so far (`Stay.php:59-64`): check-in date to check-out date (or today in house), at least one; room charge = nights × rate (golden).

## 8. Check-out (`:219-259`, `Billing.php:74-161`)

- Only in house ("This guest has already checked out."). Fields: bill number required max 50, bill date required, modes max 100, GST
  percents 0-28 (**HMS:** the form's default comes from the hotel settings `checkout.hotel_gst_percent` / `checkout.food_gst_percent`, seeded
  5; the percents used are stored on the stay and the bill, MJ #19), instruction max 1000. Bill number taken → "That bill number is already used."
- The bill (one unit, through the billing service's own function, ruled (f)): hotel = room (nights × rate) + extra bed + laundry + other;
  food = food + room service; GST = round(base × percent / 100, 2) per side (golden); totals; plan amounts 0; modes kept only for a side whose
  total > 0; mobile cleaned; address "address, city"; persons adults + children; arrival = check-in, departure = now; reference = the
  reservation reference. The reservation's advance with the most money left that is not refunded is taken off as Bill Master does (one
  shared function, golden). Debit balances as Bill Master (quirk (a) applies). Bill log "Added Bill: Bill {n} - {guest}".
- The stay is checked out (bill linked), its room dirty; the reservation finishes when none of its rooms has a guest left (check-out date
  = today if after check-in). Log `frontdesk` `Check-out` "{guest} checked out of room {n}" with Bill, Hotel total, Food total.

## 9. HMS decisions (for the master)

1. ID proof numbers encrypted with a blind index; the DTO shows `idProofLast4` only.
2. Housekeeping sets a status instead of toggling (contract request).
3. Rooms and charges have no version column (ruled); charges are protected by the stay's row lock.
4. The cancel notice about a remaining advance is a field in the response.
