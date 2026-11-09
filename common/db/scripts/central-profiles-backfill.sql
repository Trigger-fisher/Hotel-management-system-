-- The one common guest and company profile: the BACKFILL (platform migration 0132 must be applied; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md).
-- Run as the owner (hms_owner: it reads every hotel's schema). The same text is the RUN block of docs/neon-sql/NEON-SQL-0132-BACKFILL-CENTRAL-PROFILES.sql and is run by
-- web-app/tests/db/centralProfiles.backfill.test.ts on hms_test, so what MJ runs on Neon is exactly what the test proves.
-- What it does, per hotel whose schema exists (any status; a deleted hotel's schema is gone and is skipped):
--   * every customers row with no link yet gets ITS OWN new platform.guests row and a link (guest_hotels);
--   * every company_profiles row that is not in the recycle bin and has no link yet gets ITS OWN new platform.companies row and a link (company_hotels);
--   * the one exception: records tied to the SAME portal login (platform.user_hotels subject) share one profile, owned by that login (the login is the person's own proof).
-- It NEVER merges two profiles (same mobile, email or GSTIN only shows up in the Super Admin's "possible duplicates" list), never deletes anything and never reads or writes a
-- hotel's records other than SELECT. Safe to run again: a record that already has a link is skipped, so a second run adds nothing.
-- Values are copied as the hotel keeps them, trimmed to the profile's limits: mobile becomes +91 and ten digits when it can be read (else empty: the hotel's own copy still
-- matches its bills), email lower case, the main contact is the first contact's name.
DO $backfill$
DECLARE
  h record;
  rec record;
  login uuid;
  profile uuid;
  digits text;
  ten text;
  g_new int; g_shared int; g_linked int; c_new int; c_shared int; c_linked int;
  total_g int := 0; total_c int := 0; total_g_new int := 0; total_c_new int := 0; hotels_done int := 0;
BEGIN
  IF to_regclass('platform.guests') IS NULL OR to_regclass('platform.company_hotels') IS NULL THEN
    RAISE EXCEPTION 'Platform migration 0132 is not applied yet: run NEON-SQL-0132-CENTRAL-PROFILES.sql first';
  END IF;
  FOR h IN SELECT id, name, schema_name FROM platform.hotels WHERE deleted_at IS NULL ORDER BY created_at, id LOOP
    CONTINUE WHEN to_regclass(format('%I.customers', h.schema_name)) IS NULL OR to_regclass(format('%I.company_profiles', h.schema_name)) IS NULL;
    g_new := 0; g_shared := 0; g_linked := 0; c_new := 0; c_shared := 0; c_linked := 0;

    -- guests
    FOR rec IN EXECUTE format('SELECT id, name, mobile, email, address, city FROM %I.customers ORDER BY created_at, id', h.schema_name) LOOP
      IF EXISTS (SELECT 1 FROM platform.guest_hotels gh WHERE gh.hotel_id = h.id AND gh.customer_id = rec.id) THEN
        g_linked := g_linked + 1;
        CONTINUE;
      END IF;
      SELECT uh.user_id INTO login FROM platform.user_hotels uh
        WHERE uh.hotel_id = h.id AND uh.subject_kind = 'guest' AND uh.subject_id = rec.id ORDER BY uh.created_at, uh.id LIMIT 1;
      profile := NULL;
      IF login IS NOT NULL THEN
        SELECT g.id INTO profile FROM platform.guests g WHERE g.user_id = login AND g.merged_into IS NULL;
      END IF;
      IF profile IS NOT NULL THEN
        g_shared := g_shared + 1;
      ELSE
        digits := regexp_replace(coalesce(rec.mobile, ''), '\D', '', 'g');
        ten := CASE WHEN length(digits) = 10 THEN digits
                    WHEN length(digits) = 11 AND left(digits, 1) = '0' THEN right(digits, 10)
                    WHEN length(digits) = 12 AND left(digits, 2) = '91' THEN right(digits, 10) END;
        INSERT INTO platform.guests (display_name, mobile, email, address, city, user_id)
        VALUES (
          coalesce(nullif(left(btrim(coalesce(rec.name, '')), 100), ''), 'Guest'),
          CASE WHEN ten ~ '^[6-9][0-9]{9}$' THEN '+91' || ten END,
          CASE WHEN char_length(btrim(coalesce(rec.email, ''))) BETWEEN 1 AND 254 THEN lower(btrim(rec.email)) END,
          nullif(left(btrim(coalesce(rec.address, '')), 255), ''),
          nullif(left(btrim(coalesce(rec.city, '')), 100), ''),
          login)
        RETURNING id INTO profile;
        g_new := g_new + 1;
      END IF;
      INSERT INTO platform.guest_hotels (hotel_id, customer_id, guest_id) VALUES (h.id, rec.id, profile);
    END LOOP;

    -- companies (not the recycle bin's)
    FOR rec IN EXECUTE format('SELECT id, name, address, country, email, pincode, mobile_number, phone_number, gst_number, contacts FROM %I.company_profiles WHERE deleted_at IS NULL ORDER BY created_at, id', h.schema_name) LOOP
      IF EXISTS (SELECT 1 FROM platform.company_hotels ch WHERE ch.hotel_id = h.id AND ch.company_profile_id = rec.id) THEN
        c_linked := c_linked + 1;
        CONTINUE;
      END IF;
      SELECT uh.user_id INTO login FROM platform.user_hotels uh
        WHERE uh.hotel_id = h.id AND uh.subject_kind = 'company' AND uh.subject_id = rec.id ORDER BY uh.created_at, uh.id LIMIT 1;
      profile := NULL;
      IF login IS NOT NULL THEN
        SELECT c.id INTO profile FROM platform.companies c WHERE c.user_id = login AND c.merged_into IS NULL;
      END IF;
      IF profile IS NOT NULL THEN
        c_shared := c_shared + 1;
      ELSE
        INSERT INTO platform.companies (name, main_contact_name, gstin, email, mobile, landline, address, pincode, country, contacts, user_id)
        VALUES (
          coalesce(nullif(left(btrim(coalesce(rec.name, '')), 100), ''), 'Company'),
          CASE WHEN jsonb_typeof(rec.contacts) = 'array' THEN nullif(left(btrim(coalesce(rec.contacts -> 0 ->> 'name', '')), 100), '') END,
          nullif(left(upper(btrim(coalesce(rec.gst_number, ''))), 50), ''),
          CASE WHEN char_length(btrim(coalesce(rec.email, ''))) BETWEEN 1 AND 254 THEN lower(btrim(rec.email)) END,
          nullif(left(btrim(coalesce(rec.mobile_number, '')), 15), ''),
          nullif(left(btrim(coalesce(rec.phone_number, '')), 15), ''),
          nullif(left(btrim(coalesce(rec.address, '')), 100), ''),
          nullif(left(btrim(coalesce(rec.pincode, '')), 20), ''),
          nullif(left(btrim(coalesce(rec.country, '')), 100), ''),
          CASE WHEN jsonb_typeof(rec.contacts) = 'array' THEN rec.contacts END,
          login)
        RETURNING id INTO profile;
        c_new := c_new + 1;
      END IF;
      INSERT INTO platform.company_hotels (hotel_id, company_profile_id, company_id) VALUES (h.id, rec.id, profile);
    END LOOP;

    hotels_done := hotels_done + 1;
    total_g := total_g + g_new + g_shared;
    total_c := total_c + c_new + c_shared;
    total_g_new := total_g_new + g_new;
    total_c_new := total_c_new + c_new;
    RAISE NOTICE 'Hotel "%": guests % new profiles, % joined a login''s profile, % already linked; companies % new, % joined a login''s profile, % already linked',
      h.name, g_new, g_shared, g_linked, c_new, c_shared, c_linked;
  END LOOP;
  RAISE NOTICE 'Done: % hotels; % guest records linked now (% new profiles); % company records linked now (% new profiles). Nothing was merged.',
    hotels_done, total_g, total_g_new, total_c, total_c_new;
END $backfill$;
