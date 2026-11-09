-- rollback: DROP POLICY IF EXISTS room_service_order_lines_scope ON room_service_order_lines; DROP POLICY IF EXISTS room_service_orders_scope ON room_service_orders; DROP TABLE IF EXISTS room_service_order_lines; DROP TABLE IF EXISTS room_service_orders; ALTER TABLE menu_items DROP COLUMN IF EXISTS veg; ALTER TABLE menu_items DROP COLUMN IF EXISTS category;
-- Room service with a status (guest portal round 3, decision 61, rebuilt on main 18 Oct 2026; the backup branch's 0031_guest_round3 was only the reference, its number is main's guest_requests).
--   1. ROOM-SERVICE ORDERS get their own rows: placed -> accepted -> preparing -> on_the_way -> delivered, or cancelled. The charges still go on the stay exactly as before (each line
--      points at its charge); cancelling an order removes its charges in the same transaction. Who cancelled (the guest or the hotel), when and why is kept on the row.
--      The HOTEL decides (MJ, 18 Oct 2026): staff may cancel until delivered, with a reason; a guest may cancel only while the order is still "placed" and inside the hotel's window
--      (app setting room_service.guest_cancel_minutes, default 5, 0 = never, at most 60), measured from placed_at by the server's clock.
--   2. The menu gets a category the hotel names itself (falls back to the fixed group) and a veg mark. (Photos follow in a later step.)
-- Row-level security as 0035: a guest account sees and changes only the orders of its own stays (the stays policy decides which those are); a company account sees none;
-- staff, platform visits and workers see everything. No migration depends on another new one.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS category varchar(60);
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS veg text NOT NULL DEFAULT 'unknown' CHECK (veg IN ('yes', 'no', 'unknown'));

-- no-standard-columns: an HMS-only record (no Pallav import); an order is cancelled, never deleted; its status is its history
CREATE TABLE room_service_orders (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  order_no varchar(20) NOT NULL,
  stay_id uuid NOT NULL REFERENCES pms_stays (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'accepted', 'preparing', 'on_the_way', 'delivered', 'cancelled')),
  scheduled_for timestamptz,
  note varchar(500),
  total_paise bigint NOT NULL CHECK (total_paise >= 0),
  placed_by uuid,
  placed_at timestamptz NOT NULL DEFAULT now(),
  status_at timestamptz NOT NULL DEFAULT now(),
  status_by uuid,
  status_by_name varchar(150),
  cancelled_by_kind text CHECK (cancelled_by_kind IN ('guest', 'hotel')),
  cancel_reason varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_service_orders_cancel_pair CHECK ((status = 'cancelled') = (cancelled_by_kind IS NOT NULL)),
  CONSTRAINT room_service_orders_hotel_reason CHECK (cancelled_by_kind IS DISTINCT FROM 'hotel' OR btrim(coalesce(cancel_reason, '')) <> '')
);
CREATE UNIQUE INDEX room_service_orders_order_no_key ON room_service_orders (order_no);
CREATE INDEX room_service_orders_stay_idx ON room_service_orders (stay_id, placed_at DESC);
CREATE INDEX room_service_orders_status_idx ON room_service_orders (status, placed_at DESC);
CREATE TRIGGER room_service_orders_touch_updated_at BEFORE UPDATE ON room_service_orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- no-standard-columns: the lines of an order, written once with it (name and price as ordered, so a later menu change changes nothing)
CREATE TABLE room_service_order_lines (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id uuid NOT NULL REFERENCES room_service_orders (id) ON DELETE CASCADE,
  item_id uuid REFERENCES menu_items (id) ON DELETE SET NULL,
  name varchar(120) NOT NULL,
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 1000),
  unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0),
  charge_id uuid REFERENCES pms_charges (id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_service_order_lines_order_idx ON room_service_order_lines (order_id, sort_order);
CREATE INDEX room_service_order_lines_item_idx ON room_service_order_lines (item_id);
CREATE INDEX room_service_order_lines_charge_idx ON room_service_order_lines (charge_id);
CREATE TRIGGER room_service_order_lines_touch_updated_at BEFORE UPDATE ON room_service_order_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE room_service_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_service_orders_scope ON room_service_orders USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND stay_id IN (SELECT s.id FROM pms_stays s))
);

ALTER TABLE room_service_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_service_order_lines_scope ON room_service_order_lines USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND order_id IN (SELECT o.id FROM room_service_orders o))
);
