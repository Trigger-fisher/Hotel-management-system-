-- rollback: DROP TABLE IF EXISTS menu_items;
-- The room-service menu: what an in-house guest can order to the room from the Guest portal, and what the hotel edits under Master Data. Three fixed groups
-- (restaurant, laundry, room service: their label, icon, business and kind are the app's); the hotel owns the items. Prices are whole paise. An order becomes
-- stay charges that carry their own text and price, so nothing points at an item and removing one changes no bill. Removing an item marks it deleted (deleted_at);
-- the name is free again for a new item.

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  menu_group text NOT NULL CHECK (menu_group IN ('restaurant', 'laundry', 'service')),
  name varchar(120) NOT NULL CHECK (btrim(name) <> ''),
  note varchar(200),
  price_paise bigint NOT NULL CHECK (price_paise >= 0),
  available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX menu_items_legacy_id_key ON menu_items (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX menu_items_group_name_key ON menu_items (menu_group, lower(name)) WHERE deleted_at IS NULL;
CREATE TRIGGER menu_items_touch_updated_at BEFORE UPDATE ON menu_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
