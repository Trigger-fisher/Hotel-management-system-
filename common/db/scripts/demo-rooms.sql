-- HMS demo rooms for Hotel Demo on the LOCAL dev database (hms). Never run this on Neon. Mock data only. INSERTS ONLY: nothing is changed or deleted.
-- IDEMPOTENT: a room type is added only if its slug is missing, a plan only if the room type has none by that name, a room only if its number is missing.
-- Why: every room of Hotel Demo already has an in-house test stay, so a walk-in check-in had no free room to offer.
--
-- It creates (Hotel Demo only):
--   2 room types   "Demo Deluxe" (slug demo-deluxe, sleeps 3, 3 rooms) and "Demo Suite" (slug demo-suite, sleeps 4, 3 rooms), each with the plan "Room Only" (EP):
--                  Deluxe 4,000 double / 3,200 single / 500 extra person; Suite 7,500 double / 6,000 single / 800 extra person (rupees);
--   6 rooms        floor 1: D101, D102, D103 (Demo Deluxe); floor 2: S201, S202, S203 (Demo Suite), all clean and in order.
-- Run (owner connection, dev DB):  psql "$PG_OWNER_URL" -f db/scripts/demo-rooms.sql   (or paste it into any SQL client on the dev database)

DO $demo$
DECLARE s text; hid uuid; t record; rid uuid;
BEGIN
  SELECT id INTO hid FROM platform.hotels WHERE slug = 'hotel-demo' AND deleted_at IS NULL;
  IF hid IS NULL THEN RAISE EXCEPTION 'hotel-demo is missing: this script is for the dev database only'; END IF;
  s := 'hotel_' || replace(hid::text, '-', '');
  PERFORM set_config('search_path', s || ', pg_catalog', true);

  FOR t IN SELECT * FROM (VALUES
    ('demo-deluxe', 'Demo Deluxe', 3, 3, 'King bed, 280 sq ft', 400000::bigint, 320000::bigint, 50000::bigint, 1),
    ('demo-suite',  'Demo Suite',  4, 3, 'King bed and sofa bed, 420 sq ft', 750000::bigint, 600000::bigint, 80000::bigint, 2)
  ) AS v(slug, name, max_guests, total_count, bed_type, dbl, sgl, extra, sort_order) LOOP
    SELECT id INTO rid FROM site_rooms WHERE slug = t.slug;
    IF rid IS NULL THEN
      INSERT INTO site_rooms (slug, name, bed_type, max_guests, total_count, show_price, available, sort_order)
      VALUES (t.slug, t.name, t.bed_type, t.max_guests, t.total_count, true, true, t.sort_order)
      RETURNING id INTO rid;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM site_rate_plans WHERE room_id = rid AND name = 'Room Only') THEN
      INSERT INTO site_rate_plans (room_id, name, code, price_double_paise, price_single_paise, occupancy_prices, extra_person_price_paise, is_default, active, sort_order)
      VALUES (rid, 'Room Only', 'EP', t.dbl, t.sgl,
              jsonb_build_array(jsonb_build_object('guests', 1, 'pricePaise', t.sgl::text), jsonb_build_object('guests', 2, 'pricePaise', t.dbl::text)),
              t.extra, true, true, 0);
    END IF;
  END LOOP;

  FOR t IN SELECT * FROM (VALUES
    ('D101', '1', 'demo-deluxe', 101), ('D102', '1', 'demo-deluxe', 102), ('D103', '1', 'demo-deluxe', 103),
    ('S201', '2', 'demo-suite', 201),  ('S202', '2', 'demo-suite', 202),  ('S203', '2', 'demo-suite', 203)
  ) AS v(number, floor, slug, sort_order) LOOP
    IF NOT EXISTS (SELECT 1 FROM pms_rooms WHERE number = t.number) THEN
      INSERT INTO pms_rooms (number, floor, room_type_id, hk_status, out_of_order, notes, sort_order)
      VALUES (t.number, t.floor, (SELECT id FROM site_rooms WHERE slug = t.slug), 'clean', false, 'demo room', t.sort_order);
    END IF;
  END LOOP;
END $demo$;

-- Check: the six rooms with their type.
-- SELECT r.number, r.floor, t.name, r.hk_status FROM pms_rooms r JOIN site_rooms t ON t.id = r.room_type_id WHERE r.notes = 'demo room' ORDER BY r.number;   (run with the Hotel Demo schema as search_path)
