# Data created on the LOCAL dev database on 12 Oct 2026 (and how to remove it)

For MJ, to clean the dev database later (database `hms` on this PC; never Neon). Ids and usernames only: no password is written here (the dev passwords are in `db/.dev-login.txt`, git-ignored). Found by asking the database for everything created since 12 Oct 00:00 IST, so it covers sessions A, B, C and D together: only A and B created rows today (C and D created none). Older test data (the `live.*`, `lt.*`, `perf.*`, `ui.*` accounts and hotels of 7 to 11 Oct) is not listed here.

## What exists
| Who | What | Id / name |
|---|---|---|
| A | Login `demo.group` (Group Hotel Admin, no hotel) | 01a12ce7-8ae3-7056-9497-efc231aa4118 |
| A | Login `smoke.admin` (Hotel Admin, Super Admin level, Hotel Demo): used by `web-app/scripts/route-smoke.mjs` | 01a12d17-6d36-7b07-9690-b1f8de7915d5 |
| A | Login `smoke.user` (Hotel User, Hotel Demo) | 01a12d17-71d2-744e-86e7-fca3147d3cde |
| A | Login `smoke.group` (Group Hotel Admin, no hotel) | 01a12d17-751f-7bbf-a252-727f9d6e4dc1 |
| A | Group "Demo Hotel Group" (`demo-hotel-group`), members Hotel Demo and PERF-Test Hotel; its admin is still empty until MJ sets `demo.group` in Platform > Groups | 01a12ce4-194d-7a3e-b03b-1925c167be6a |
| B | Login `demo.guest` (Guest, Hotel Demo), linked to the customer below | 01a12d0d-dd9e-78d0-b136-3eef266e99d8 |
| B | Customer "Demo Guest", mobile 9000099001 (Hotel Demo) | 01a12d0f-4bc5-798b-91e3-3dc0bf25c4d3 |
| B | In-house stay "Demo Guest" in room PE7881 (Hotel Demo), with 8 charges (the room-service orders) | 01a12d0e-f2b5-7d84-8c54-fb1f81f3ad82 |
| B | Room-service menu items "B-test Dal Tadka", "B-test Masala Dosa", "B-test Shirt", "B-test Tea (2 cups)" (Hotel Demo) | 01a12d11-4d7c-7925-a3f7-7978df56d4e6, 01a12d11-4da8-7d8f-9000-f12feec1cd24, 01a12d11-4dcc-75b5-8771-da8ff2809819, 01a12d11-4def-7bb9-86df-febe51f8f9a0 |

Not removable, but changed today: the dev passwords of `dev.guest` and `dev.corporate` (reset with `db:cli dev-password`; the new ones are in `db/.dev-login.txt`). Platform migrations 0114 to 0117 are applied on dev (schema, keep). System-log and audit lines are append-only and stay. Room PE7881 itself was not changed (it was made on 11 Oct by the Pathik test).

## Clean-up (run in a SQL client on the dev database as the owner; review first, it was written but NOT run)
Nothing here touches Neon. Each block is one transaction. Do B's block first (the stay and the customer), then the logins, then the group.

```sql
-- 1. Hotel Demo: the demo guest's stay (its charges and ID scans go with it), the customer and the four B-test menu items
BEGIN;
DELETE FROM hotel_01a118abdab77846a59f117467b8c6b4.pms_stays WHERE id = '01a12d0e-f2b5-7d84-8c54-fb1f81f3ad82';
DELETE FROM hotel_01a118abdab77846a59f117467b8c6b4.customers WHERE id = '01a12d0f-4bc5-798b-91e3-3dc0bf25c4d3';
DELETE FROM hotel_01a118abdab77846a59f117467b8c6b4.menu_items WHERE id IN (
  '01a12d11-4d7c-7925-a3f7-7978df56d4e6', '01a12d11-4da8-7d8f-9000-f12feec1cd24', '01a12d11-4dcc-75b5-8771-da8ff2809819', '01a12d11-4def-7bb9-86df-febe51f8f9a0');
COMMIT;

-- 2. The five logins: signed out, taken out of their hotel, then switched off and renamed so the names can be used again (the accounts are kept for the history, as `db:cli perf-hotel remove` does)
BEGIN;
UPDATE platform.sessions SET revoked_at = now(), revoked_reason = 'admin'
 WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM platform.users WHERE username IN ('demo.group', 'demo.guest', 'smoke.admin', 'smoke.user', 'smoke.group'));
DELETE FROM platform.user_hotels WHERE user_id IN (SELECT id FROM platform.users WHERE username IN ('demo.group', 'demo.guest', 'smoke.admin', 'smoke.user', 'smoke.group'));
UPDATE platform.users
   SET status = 'disabled', deleted_at = now(),
       username = username || '-removed-' || to_char(now(), 'YYMMDDHH24MISS'),
       email = 'removed-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substr(id::text, 1, 8) || '@example.test'
 WHERE username IN ('demo.group', 'demo.guest', 'smoke.admin', 'smoke.user', 'smoke.group') AND deleted_at IS NULL;
COMMIT;

-- 3. The demo group: unlink its hotels and mark it removed (the history rows stay)
BEGIN;
DELETE FROM platform.group_members WHERE group_id = '01a12ce4-194d-7a3e-b03b-1925c167be6a';
UPDATE platform.hotel_groups
   SET deleted_at = now(), slug = slug || '-removed-' || to_char(now(), 'YYMMDDHH24MISS'), name = name || ' (removed ' || to_char(now(), 'YYMMDDHH24MISS') || ')'
 WHERE id = '01a12ce4-194d-7a3e-b03b-1925c167be6a' AND deleted_at IS NULL;
COMMIT;
```
After step 1, room PE7881 is free again but may need "Clean" set in Front Office (its housekeeping status was already "dirty" before today). If you want the demo group to stay for the next demo, skip step 3 and the `demo.group` part of step 2.

## Where the lists came from
Session A's rows: this session's own commands (`db/scripts/demo-group.sql`, `db:cli create-user`, `db:cli dev-password`). Session B's rows: `docs/sessions/audits/GUEST-WALK-2026-10-12.md` ("Real-mode data created on the LOCAL dev database"), cross-checked against the database by the query above (customer, stay, four menu items, login, link).

## Demo rooms for Hotel Demo (run by the Project Manager on the local dev DB with `db/scripts/demo-rooms.sql`)
Every one of Hotel Demo's 9 rooms already had an in-house test stay, so a walk-in check-in found no free room. The script added 2 room types (each with the plan "Room Only") and 6 clean rooms: Hotel Demo now has 15 rooms. Inserts only; safe to run twice.
| What | Ids |
|---|---|
| Room type "Demo Deluxe" (`demo-deluxe`) and its plan | 01a12d6e-ff02-7f26-803f-215824f0b25b; plan 01a12d6e-ff03-77d6-8825-f32e043b9850 |
| Room type "Demo Suite" (`demo-suite`) and its plan | 01a12d6e-ff03-7de1-8b5c-9a2859ad5a4e; plan 01a12d6e-ff03-7fb2-bc5d-c413e6c88fa5 |
| Rooms D101, D102, D103 (floor 1) | 01a12d6e-ff04-74a6-80ee-ec990db4ddea, 01a12d6e-ff04-795e-a037-fbb2d329932a, 01a12d6e-ff04-7bab-bbb7-938bfd4d63fd |
| Rooms S201, S202, S203 (floor 2) | 01a12d6e-ff04-7dd3-813d-0a27e3cbfe43, 01a12d6e-ff05-701d-b3cf-5f2ebb23e91e, 01a12d6e-ff05-726a-aff3-311d2c3e366b |
```sql
-- clean-up of the demo rooms (run only when no stay uses them; the plans go with their room type)
BEGIN;
DELETE FROM hotel_01a118abdab77846a59f117467b8c6b4.pms_rooms WHERE id IN (
  '01a12d6e-ff04-74a6-80ee-ec990db4ddea', '01a12d6e-ff04-795e-a037-fbb2d329932a', '01a12d6e-ff04-7bab-bbb7-938bfd4d63fd',
  '01a12d6e-ff04-7dd3-813d-0a27e3cbfe43', '01a12d6e-ff05-701d-b3cf-5f2ebb23e91e', '01a12d6e-ff05-726a-aff3-311d2c3e366b');
DELETE FROM hotel_01a118abdab77846a59f117467b8c6b4.site_rooms WHERE id IN ('01a12d6e-ff02-7f26-803f-215824f0b25b', '01a12d6e-ff03-7de1-8b5c-9a2859ad5a4e');
COMMIT;
```