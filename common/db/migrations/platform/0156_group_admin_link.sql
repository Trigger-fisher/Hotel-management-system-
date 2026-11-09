-- rollback: DROP VIEW IF EXISTS platform.hotel_kinds; DROP TRIGGER IF EXISTS hotel_groups_role_links ON platform.hotel_groups; (then put refresh_role_links and role_links_trigger back as in 0145)
-- MJ, 1 Nov 2026: a hotel is either a MEMBER of a group (it sits under that group's Group Hotel Admin) or an INDIVIDUAL hotel (no group).
--   * a Group Hotel Admin belongs to the group they administer: platform.hotel_groups.admin_user_id (0103). Migration 0145 wrongly took the group of their default hotel; this fixes it.
--   * a Hotel Admin and a Hotel User belong to their hotel, whether it is a group member or an individual hotel (unchanged).
--   * platform.hotel_kinds says which kind each hotel is (worked out from platform.group_members, so it can never disagree with it).

CREATE OR REPLACE FUNCTION platform.refresh_role_links(p_user uuid) RETURNS void
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
  -- a Group Hotel Admin: the group they administer
  UPDATE platform.group_hotel_admins SET group_id = (SELECT g.id FROM platform.hotel_groups g WHERE g.admin_user_id = p_user AND g.deleted_at IS NULL ORDER BY g.created_at LIMIT 1) WHERE login_id = p_user;
  UPDATE platform.guest_users SET guest_id = (SELECT g.id FROM platform.guests g WHERE g.user_id = p_user AND g.merged_into IS NULL LIMIT 1) WHERE login_id = p_user;
  UPDATE platform.corporate_users SET company_id = (SELECT c.id FROM platform.companies c WHERE c.user_id = p_user AND c.merged_into IS NULL LIMIT 1) WHERE login_id = p_user;
END
$fn$;

CREATE OR REPLACE FUNCTION platform.role_links_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'user_hotels' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM platform.refresh_role_links(OLD.user_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM platform.refresh_role_links(NEW.user_id); END IF;
  ELSIF TG_TABLE_NAME = 'hotel_groups' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM platform.refresh_role_links(OLD.admin_user_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM platform.refresh_role_links(NEW.admin_user_id); END IF;
  ELSE
    -- guests and companies: the person whose login the record belongs to (before and after the change)
    IF TG_OP <> 'INSERT' THEN PERFORM platform.refresh_role_links(OLD.user_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM platform.refresh_role_links(NEW.user_id); END IF;
  END IF;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS group_members_role_links ON platform.group_members;
CREATE TRIGGER hotel_groups_role_links AFTER INSERT OR UPDATE OF admin_user_id, deleted_at OR DELETE ON platform.hotel_groups FOR EACH ROW EXECUTE FUNCTION platform.role_links_trigger();

DO $link$
DECLARE
  u uuid;
BEGIN
  FOR u IN SELECT id FROM platform.logins LOOP
    PERFORM platform.refresh_role_links(u);
  END LOOP;
END
$link$;

-- which kind each hotel is
CREATE VIEW platform.hotel_kinds AS
  SELECT h.id AS hotel_id, CASE WHEN gm.group_id IS NULL THEN 'individual' ELSE 'group_member' END AS kind, gm.group_id
    FROM platform.hotels h
    LEFT JOIN platform.group_members gm ON gm.hotel_id = h.id
    LEFT JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
   WHERE h.deleted_at IS NULL;
GRANT SELECT ON platform.hotel_kinds TO hms_app;
