-- rollback: DELETE FROM room_service_orders WHERE stay_id IS NULL; ALTER TABLE room_service_orders DROP CONSTRAINT IF EXISTS room_service_orders_where; ALTER TABLE room_service_orders DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS table_label; ALTER TABLE room_service_orders ALTER COLUMN stay_id SET NOT NULL;
-- Dining orders taken by staff (MJ, 5 Nov 2026): the hotel's own people take an order at a restaurant table, or for a room, on the same order rows the guest portal uses.
-- A table order has no stay (it is billed at the table), so stay_id may be empty when a table is named; `source` says who took the order (guest portal or staff).
-- Additive: every existing row stays a guest order of a stay. A guest account still sees only the orders of its own stays (the policy of 0041 is unchanged).
ALTER TABLE room_service_orders ALTER COLUMN stay_id DROP NOT NULL;
ALTER TABLE room_service_orders ADD COLUMN table_label varchar(40);
ALTER TABLE room_service_orders ADD COLUMN source text NOT NULL DEFAULT 'guest' CHECK (source IN ('guest', 'staff'));
ALTER TABLE room_service_orders ADD CONSTRAINT room_service_orders_where CHECK (stay_id IS NOT NULL OR (table_label IS NOT NULL AND btrim(table_label) <> ''));
