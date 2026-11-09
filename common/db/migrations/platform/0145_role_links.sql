-- rollback: DROP TRIGGER IF EXISTS user_hotels_role_links ON platform.user_hotels; DROP TRIGGER IF EXISTS group_members_role_links ON platform.group_members; DROP TRIGGER IF EXISTS guests_role_links ON platform.guests; DROP TRIGGER IF EXISTS companies_role_links ON platform.companies; DROP FUNCTION IF EXISTS platform.role_links_trigger(); DROP FUNCTION IF EXISTS platform.refresh_role_links(uuid); ALTER TABLE platform.guest_users DROP COLUMN IF EXISTS guest_id; ALTER TABLE platform.corporate_users DROP COLUMN IF EXISTS company_id; ALTER TABLE platform.hotel_admins DROP COLUMN IF EXISTS hotel_id; ALTER TABLE platform.hotel_users DROP COLUMN IF EXISTS hotel_id; ALTER TABLE platform.group_hotel_admins DROP COLUMN IF EXISTS group_id;
-- Each role table now says WHAT the person is attached to (MJ, 1 Nov 2026, decision 72: "the same data and a link"):
--   * guest_users.guest_id         -> platform.guests    the Guest ID record (the ID used at check-in), saved once and shared by every hotel
--   * corporate_users.company_id   -> platform.companies the Company GST record, saved once and shared by every hotel
--   * hotel_admins.hotel_id, hotel_users.hotel_id -> platform.hotels      the person's own hotel (the default membership)
--   * group_hotel_admins.group_id  -> platform.hotel_groups the group their hotel belongs to
-- These are LINKS, never copies. They are worked out from the tables that already hold the facts (platform.guests.user_id, platform.companies.user_id, platform.user_hotels,
-- platform.group_members) and kept in step by triggers on those tables, so no screen or service has to write them. Existing people are linked below.

ALTER TABLE platform.guest_users ADD COLUMN guest_id uuid REFERENCES platform.guests (id) ON DELETE SET NULL;
ALTER TABLE platform.corporate_users ADD COLUMN company_id uuid REFERENCES platform.companies (id) ON DELETE SET NULL;
ALTER TABLE platform.hotel_admins ADD COLUMN hotel_id uuid REFERENCES platform.hotels (id) ON DELETE SET NULL;
ALTER TABLE platform.hotel_users ADD COLUMN hotel_id uuid REFERENCES platform.hotels (id) ON DELETE SET NULL;
ALTER TABLE platform.group_hotel_admins ADD COLUMN group_id uuid REFERENCES platform.hotel_groups (id) ON DELETE SET NULL;
CREATE INDEX guest_users_guest_id_idx ON platform.guest_users (guest_id);
CREATE INDEX corporate_users_company_id_idx ON platform.corporate_users (company_id);
CREATE INDEX hotel_admins_hotel_id_idx ON platform.hotel_admins (hotel_id);
CREATE INDEX hotel_users_hotel_id_idx ON platform.hotel_users (hotel_id);
CREATE INDEX group_hotel_admins_group_id_idx ON platform.group_hotel_admins (group_id);

-- Works the links of ONE person out again from the facts. Safe to run any number of times.
CREATE FUNCTION platform.refresh_role_links(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
DECLARE
  h uuid;
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- the hotel the person lands in: their default membership, else the oldest active one
  SELECT uh.hotel_id INTO h FROM platform.user_hotels uh WHERE uh.user_id = p_user AND uh.status = 'active' ORDER BY uh.is_default DESC, uh.created_at, uh.hotel_id LIMIT 1;
  UPDATE platform.hotel_admins SET hotel_id = h WHERE login_id = p_user AND hotel_id IS DISTINCT FROM h;
  UPDATE platform.hotel_users SET hotel_id = h WHERE login_id = p_user AND hotel_id IS DISTINCT FROM h;
  UPDATE platform.group_hotel_admins SET group_id = (SELECT gm.group_id FROM platform.group_members gm JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL WHERE gm.hotel_id = h ORDER BY gm.created_at LIMIT 1)
   WHERE login_id = p_user;
  UPDATE platform.guest_users SET guest_id = (SELECT g.id FROM platform.guests g WHERE g.user_id = p_user AND g.merged_into IS NULL LIMIT 1) WHERE login_id = p_user;
  UPDATE platform.corporate_users SET company_id = (SELECT c.id FROM platform.companies c WHERE c.user_id = p_user AND c.merged_into IS NULL LIMIT 1) WHERE login_id = p_user;
END
$fn$;
REVOKE ALL ON FUNCTION platform.refresh_role_links(uuid) FROM PUBLIC;

-- The one trigger function for the four fact tables: it names the people the changed row touches and refreshes each.
CREATE FUNCTION platform.role_links_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
DECLARE
  u uuid;
BEGIN
  IF TG_TABLE_NAME = 'user_hotels' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM platform.refresh_role_links(OLD.user_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM platform.refresh_role_links(NEW.user_id); END IF;
  ELSIF TG_TABLE_NAME = 'group_members' THEN
    -- every person attached to the hotel whose group changed
    FOR u IN SELECT uh.user_id FROM platform.user_hotels uh WHERE uh.hotel_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.hotel_id ELSE NEW.hotel_id END) LOOP
      PERFORM platform.refresh_role_links(u);
    END LOOP;
  ELSE
    -- guests and companies: the person whose login the record belongs to (before and after the change)
    IF TG_OP <> 'INSERT' THEN PERFORM platform.refresh_role_links(OLD.user_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM platform.refresh_role_links(NEW.user_id); END IF;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.role_links_trigger() FROM PUBLIC;
CREATE TRIGGER user_hotels_role_links AFTER INSERT OR UPDATE OR DELETE ON platform.user_hotels FOR EACH ROW EXECUTE FUNCTION platform.role_links_trigger();
CREATE TRIGGER group_members_role_links AFTER INSERT OR UPDATE OR DELETE ON platform.group_members FOR EACH ROW EXECUTE FUNCTION platform.role_links_trigger();
CREATE TRIGGER guests_role_links AFTER INSERT OR UPDATE OF user_id, merged_into OR DELETE ON platform.guests FOR EACH ROW EXECUTE FUNCTION platform.role_links_trigger();
CREATE TRIGGER companies_role_links AFTER INSERT OR UPDATE OF user_id, merged_into OR DELETE ON platform.companies FOR EACH ROW EXECUTE FUNCTION platform.role_links_trigger();

-- A new profile row (a person who has just been added to the directory, or has changed role) is linked at once: the directory trigger of 0142 creates the row, this one fills the link.
CREATE FUNCTION platform.role_profile_link_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  PERFORM platform.refresh_role_links(NEW.login_id);
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.role_profile_link_trigger() FROM PUBLIC;
CREATE TRIGGER guest_users_link AFTER INSERT ON platform.guest_users FOR EACH ROW EXECUTE FUNCTION platform.role_profile_link_trigger();
CREATE TRIGGER corporate_users_link AFTER INSERT ON platform.corporate_users FOR EACH ROW EXECUTE FUNCTION platform.role_profile_link_trigger();
CREATE TRIGGER hotel_admins_link AFTER INSERT ON platform.hotel_admins FOR EACH ROW EXECUTE FUNCTION platform.role_profile_link_trigger();
CREATE TRIGGER hotel_users_link AFTER INSERT ON platform.hotel_users FOR EACH ROW EXECUTE FUNCTION platform.role_profile_link_trigger();
CREATE TRIGGER group_hotel_admins_link AFTER INSERT ON platform.group_hotel_admins FOR EACH ROW EXECUTE FUNCTION platform.role_profile_link_trigger();

-- Existing people are linked once.
DO $link$
DECLARE
  u uuid;
BEGIN
  FOR u IN SELECT id FROM platform.logins LOOP
    PERFORM platform.refresh_role_links(u);
  END LOOP;
END
$link$;
