-- HMS demo hotel group for the LOCAL DEV database (hms). Never run this on Neon: Neon has its own script (D:\HMS-group-demo.sql).
-- Mock data only (invented address and contact). ADDITIVE ONLY: it inserts rows and changes or deletes nothing that exists.
-- IDEMPOTENT: if the group 'demo-hotel-group' already exists, it does nothing.
--
-- It creates:
--   1. the group "Demo Hotel Group" (active, Ahmedabad, Gujarat), with NO group admin yet (see the end of this file);
--   2. two members: Hotel Demo (9 rooms, 11 stays) and PERF-Test Hotel (30 rooms, 1141 stays), the two dev hotels that already hold data;
--   3. group_history rows 'created' and 'hotel_linked' x2, written by dev.platform.
-- A hotel that is already in a group is left alone and the script stops with a plain message instead.
--
-- Run (owner connection, dev DB): psql "$PG_OWNER_URL" -f db/scripts/demo-group.sql      (or paste it into any SQL client on the dev database)
-- See it: sign in as dev.platform > Platform > Groups > Demo Hotel Group.
-- Group admin: the Group Hotel Admin screens show the OLDEST group of an admin, and dev.group already administers 'LT-Dev Group'; so give this group its own admin:
--   npm run db:cli -- create-user --username demo.group --name "Demo Group Admin" --email demo.group@example.test --account-role group_hotel_admin --role admin --write-file
--   then Platform > Groups > Demo Hotel Group > set the group admin to demo.group.

DO $group$
DECLARE g uuid; plat uuid; h record; found int := 0;
BEGIN
  SELECT id INTO plat FROM platform.users WHERE username = 'dev.platform' AND deleted_at IS NULL;
  IF plat IS NULL THEN RAISE EXCEPTION 'dev.platform is missing: this script is for the dev database only'; END IF;
  IF EXISTS (SELECT 1 FROM platform.hotel_groups WHERE slug = 'demo-hotel-group' AND deleted_at IS NULL) THEN
    RAISE NOTICE 'The demo group already exists: nothing changed';
    RETURN;
  END IF;
  SELECT count(*) INTO found FROM platform.hotels WHERE slug IN ('hotel-demo', 'perf-test-hotel') AND status = 'active';
  IF found <> 2 THEN RAISE EXCEPTION 'hotel-demo and perf-test-hotel must both exist and be active (found %)', found; END IF;
  IF EXISTS (SELECT 1 FROM platform.group_members gm JOIN platform.hotels ho ON ho.id = gm.hotel_id WHERE ho.slug IN ('hotel-demo', 'perf-test-hotel')) THEN
    RAISE EXCEPTION 'One of the two hotels is already in a group: nothing changed';
  END IF;

  INSERT INTO platform.hotel_groups (name, slug, status, legal_name, address, city, state, pin, phone, email, submitted_at, approved_at)
  VALUES ('Demo Hotel Group', 'demo-hotel-group', 'active', 'Demo Hotel Group Pvt Ltd', 'Ring Road', 'Ahmedabad', 'Gujarat', '380015', '9000012345', 'group@example.test', now(), now())
  RETURNING id INTO g;

  INSERT INTO platform.group_history (group_id, event, to_status, changed_by, actor_role) VALUES (g, 'created', 'active', plat, 'platform_admin');

  FOR h IN SELECT id FROM platform.hotels WHERE slug IN ('hotel-demo', 'perf-test-hotel') ORDER BY slug LOOP
    INSERT INTO platform.group_members (group_id, hotel_id, linked_by) VALUES (g, h.id, plat);
    INSERT INTO platform.group_history (group_id, event, hotel_id, changed_by, actor_role) VALUES (g, 'hotel_linked', h.id, plat, 'platform_admin');
  END LOOP;
END $group$;

-- Check: the group with its hotels.
SELECT g.name, g.status, (SELECT count(*) FROM platform.group_members gm WHERE gm.group_id = g.id) AS hotels
FROM platform.hotel_groups g WHERE g.slug = 'demo-hotel-group' AND g.deleted_at IS NULL;
