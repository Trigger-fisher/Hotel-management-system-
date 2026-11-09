# Front-desk features: full requirements and data, written from scratch (PM, 17 Oct 2026)

Scope (MJ, 17 Oct): no outside service or API. Four features after the polish step: room board + housekeeping + maintenance, check-in / check-out, reservations calendar, night audit.
Also in scope: the URL shows the current page (MJ, 17 Oct; design by claude-d3 first).

## What already exists (migration `0006_front_office`)
- `pms_rooms`: number, floor, room type, `hk_status` clean|dirty, `out_of_order` + reason, notes, sort order.
- `pms_reservations`: guest, dates (check_out > check_in), rooms count, room type (not a room), rate, status confirmed|checked_in|checked_out|cancelled|no_show, version.
- `pms_stays`: one per room, status in_house|checked_out, bill_id, one in-house stay per room (database rule).
- `pms_charges`: per stay, per date, category (food, room_service, laundry, extra_bed, other), side hotel|food.
- Also: `bill_master_bills` / `bill_master_advances` (billing), `shift_handovers`, `guest_requests`, `menu_items`.

## 1. Room board, housekeeping, maintenance (H2 + N1 + N7)
Screens
- Board: every room as a tile, colour by status (vacant clean, vacant dirty, occupied, due out today, out of order, reserved arriving today). Filters: floor, type, status. Tap a room: guest, nights, balance, actions.
- Housekeeping list: dirty / clean / inspecting; mark clean; bulk mark; who cleaned and when.
- Maintenance tickets: raise on a room, priority, note, photo optional, status open / in progress / done; an open ticket marked "blocks room" makes the room out of order until closed.
Data gaps (new)
- `hk_status` needs `inspecting` (and optionally `cleaning`): widen the CHECK.
- `hk_status` history: who and when (`hk_updated_by`, `hk_updated_at`) or a small log table.
- `maintenance_tickets`: id, room_id, title, details, priority, blocks_room, status, raised_by, raised_at, closed_by, closed_at.
- Rule: a room is out of order while any open ticket with blocks_room exists (keep `out_of_order` in sync or derive it).
- Rule: check-out sets the room dirty automatically.
Queries the board needs: rooms with their current in-house stay and balance; rooms due out today; rooms with an arrival today; open blocking tickets per room.

## 2. Check-in and check-out (H3 + H4)
Check-in on one screen
- Start from a reservation (arrivals today) or walk-in; pick a room that is vacant, clean and not blocked; guest details, ID proof (existing `guest_id_scans`), adults/children, plan, rate, expected check-out, advance payment.
- Rules: room must be free for the whole stay (see calendar rule); one in-house stay per room (exists); reservation moves to checked_in.
Check-out to bill
- Open the bill with room charges for every night already posted plus extra charges; add/edit charges; settle by cash, UPI, card or company (recorded by staff, no online gateway); print / PDF; room becomes dirty; stay checked_out; reservation checked_out.
- Rules: balance must be zero or explicitly marked "bill to company"; edit locked after night audit closes the day unless force mode.
Data gaps
- Payments against a bill: confirm `bill_master_bills` / advances cover mode (cash/UPI/card/company), reference, who recorded. Add a payments table if not.
- Room-charge rows: tag `source_type = 'room_night'` + `source_id = stay_id` and a unique key on (stay, charge_date, 'room_night') so the night audit can never post the same night twice.
- Early check-out / extension: change expected_check_out and re-rate.

## 3. Reservations calendar (H5)
- Grid rooms × days (14/30 days), colour by status, today highlighted, "free tonight" count and filter, click an empty cell to create a reservation, click a bar to open it, drag to move (optional, later).
- No double booking: a room cannot hold two overlapping stays or room assignments.
Data gaps
- Today a reservation holds only a room TYPE and a count, not a room. For a calendar by room we need `reservation_rooms` (reservation_id, room_id, from_date, to_date) with an EXCLUDE constraint (room_id WITH =, daterange WITH &&) so overlaps are impossible in the database. This needs the `btree_gist` extension (check it is installed locally and on Neon; Neon allows it).
- Availability query: rooms free for [from, to) = not out of order, no overlapping reservation_rooms row, no in-house stay with expected_check_out > from.
- Availability by room type (for reservations not yet given a room): rooms of type minus overlapping reserved count.

## 4. Night audit (N4)
- Run once per business day: post one room-night charge for every in-house stay (rate, GST per stay), close the day, lock edits for that day, daily report (occupancy, arrivals, departures, revenue, cash collected, no-shows).
- Must be repeatable without double posting (the unique key above) and must report stays that cannot be rated.
- Force mode (existing `force_logs`) can reopen a day; every reopen is logged.
Data gaps
- `night_audits`: business_date (unique), status open|closed, run_by, run_at, totals (rooms occupied, revenue, collected), reopened_by/at/reason.
- Rule: any charge or payment dated on a closed day is refused unless reopened.
- Auto no-show: confirmed reservations with check_in before the audited date and no stay become no_show (confirm with MJ before enabling).

## Cross-cutting
- Every new table: per-hotel schema, RLS/role grants like `0035_portal_rls`, `touch_updated_at`, `version` where edited by several people, rollback line in the migration header, indexes for the queries above.
- Migration numbers: hotel starts at 0036; one Neon SQL file per migration in `docs/NEON-SQL-<n>-<name>.sql`; run locally with `npm run db:cli -- migrate`, then MJ runs the Neon SQL.
- Permissions: which roles may see/act (front desk, housekeeping, manager); housekeeping staff see only the housekeeping list.
- Audit trail: charges, payments, room status and reopen actions logged (existing `system_logs` / `user_audit_logs`).
- Phones: the board, housekeeping list and maintenance tickets must work on a phone (staff walk the floors).
- Demo data: rooms in every status, a few reservations across the next 2 weeks, one closed night audit.
- Tests: availability and no-double-booking, night audit run twice, check-out of a stay with advance, closed-day edit refused.

## Questions to confirm with MJ
1. Do housekeeping staff get their own login role? (Employee role was removed, so this needs a decision.)
2. Auto no-show at night audit: yes or no?
3. Check-out with a balance: block, or allow "bill to company / pay later"?
4. Drag-to-move on the calendar now or later?
5. GST on room-night charges: use the stay's `hotel_gst_percent` (exists) or slab by rate?
