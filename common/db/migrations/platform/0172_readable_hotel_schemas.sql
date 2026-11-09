-- rollback: forward-only because the schemas are renamed by a separate script (npm run db:cli -- rename-schemas) and a hotel's old hotel_<id> name is not kept; restore from the backup taken before that script ran
-- Readable hotel schemas (MJ, 2 Nov 2026): a hotel's schema is named for the hotel, not for its id.
--   a hotel of a real group:  <group>_<hotel>   (sunrise_group_hotel_sunrise_rajkot)
--   an individual hotel:      <hotel>            (blue_lagoon_residency)
-- Lower-case letters, digits and underscores only (PostgreSQL folds anything else and the app checks this shape), at most 63 characters.
-- What does NOT change: the hotel's ROLE. The login-less role that holds every privilege on a hotel's schema stays hotel_<32 hex>_rw (from the id, never renamed), so the
-- isolation the tests prove (the app can only SET ROLE into one hotel's role, and that role holds one schema only) is exactly as before; a role keeps its grants when its schema is renamed.
-- The name is made in ONE place, platform.hotel_schema_name_for(), which create-hotel / provisionHotel call before they build a schema and the rename script calls for the hotels that exist.

-- 1. the schema name is stored, not generated from the id (the values stay as they are until a hotel is renamed)
ALTER TABLE platform.hotels ALTER COLUMN schema_name DROP EXPRESSION;

-- 2. the role of a hotel, from its id: the only place a role name is decided (scripts read it from here instead of building it from the schema name)
ALTER TABLE platform.hotels ADD COLUMN role_name text GENERATED ALWAYS AS ('hotel_' || replace(id::text, '-', '') || '_rw') STORED;
CREATE UNIQUE INDEX hotels_role_name_key ON platform.hotels (role_name);

-- 3. the shape check: any safe lower-case identifier that is not a system schema
ALTER TABLE platform.hotels DROP CONSTRAINT IF EXISTS hotels_schema_name_format;
ALTER TABLE platform.hotels ADD CONSTRAINT hotels_schema_name_format CHECK (schema_name ~ '^[a-z_][a-z0-9_]{0,62}$' AND schema_name NOT IN ('platform', 'public', 'information_schema') AND schema_name !~ '^pg_');
ALTER TABLE platform.hotel_deletions DROP CONSTRAINT IF EXISTS hotel_deletions_schema_name_check;
ALTER TABLE platform.hotel_deletions ADD CONSTRAINT hotel_deletions_schema_name_check CHECK (schema_name ~ '^[a-z_][a-z0-9_]{0,62}$' AND schema_name NOT IN ('platform', 'public', 'information_schema') AND schema_name !~ '^pg_');

-- 4. a hotel row made without a schema name (the onboarding form, older code) gets the old hotel_<id> name until its schema is built; provisioning then gives it the readable one
CREATE FUNCTION platform.hotel_default_schema() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.schema_name IS NULL THEN
    NEW.schema_name := 'hotel_' || replace(NEW.id::text, '-', '');
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER hotels_default_schema BEFORE INSERT ON platform.hotels FOR EACH ROW EXECUTE FUNCTION platform.hotel_default_schema();

-- 5. the readable name of a hotel's schema: <group>_<hotel> for a hotel of a real group (kind 'group'), <hotel> for an individual hotel.
--    Lower-case ASCII words joined by single underscores; a name with no usable letters (written in Gujarati or Devanagari only) falls back to "hotel"; a leading digit gets "h_";
--    cut at 54 characters; a name that is a system schema, or is already another hotel's (or any other schema's), gets "_" and the last 6 characters of the hotel id (always unique in practice).
CREATE FUNCTION platform.hotel_schema_name_for(p_hotel uuid) RETURNS text LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_hotel text;
  v_group text;
  v_base text;
  v_name text;
BEGIN
  SELECT h.name INTO v_hotel FROM platform.hotels h WHERE h.id = p_hotel;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT g.name INTO v_group
    FROM platform.group_members gm JOIN platform.hotel_groups g ON g.id = gm.group_id
   WHERE gm.hotel_id = p_hotel AND g.kind = 'group' AND g.deleted_at IS NULL
   ORDER BY gm.created_at LIMIT 1;
  v_base := trim(both '_' from regexp_replace(lower(coalesce(v_group, '') || ' ' || v_hotel), '[^a-z0-9]+', '_', 'g'));
  IF v_base = '' THEN
    v_base := 'hotel';
  END IF;
  IF v_base ~ '^[0-9]' THEN
    v_base := 'h_' || v_base;
  END IF;
  v_base := trim(both '_' from left(v_base, 54));
  v_name := v_base;
  IF v_name IN ('platform', 'public', 'information_schema', 'postgres')
     OR v_name ~ '^pg_'
     OR EXISTS (SELECT 1 FROM platform.hotels o WHERE o.schema_name = v_name AND o.id <> p_hotel)
     OR (EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = v_name)
         AND NOT EXISTS (SELECT 1 FROM platform.hotels s WHERE s.id = p_hotel AND s.schema_name = v_name)) THEN
    v_name := v_base || '_' || right(replace(p_hotel::text, '-', ''), 6);
  END IF;
  RETURN v_name;
END
$fn$;
