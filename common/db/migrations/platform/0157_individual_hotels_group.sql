-- rollback: DROP TRIGGER IF EXISTS hotels_individual_group ON platform.hotels; DROP TRIGGER IF EXISTS group_members_individual_swap ON platform.group_members; DROP TRIGGER IF EXISTS group_members_individual_return ON platform.group_members; DROP FUNCTION IF EXISTS platform.hotel_to_individual_group(); DROP FUNCTION IF EXISTS platform.group_member_swap(); DROP FUNCTION IF EXISTS platform.group_member_return(); (then remove the kind column and the system group)
-- MJ, 1 Nov 2026: there are two kinds of group and both work the same way.
--   * a GROUP: created each time a group is created, it has a Group Hotel Admin and its member hotels;
--   * the INDIVIDUAL HOTELS group: ONE shared system group; every single hotel (no group of its own) goes under it.
-- So every hotel is always in exactly one group. A hotel that joins a real group leaves the individual group; a hotel that leaves a real group falls back to it.
-- The individual group has no Group Hotel Admin and is managed by the platform; screens list only the real groups (kind = 'group').

ALTER TABLE platform.hotel_groups ADD COLUMN kind text NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'individual'));
CREATE UNIQUE INDEX hotel_groups_one_individual_key ON platform.hotel_groups (kind) WHERE kind = 'individual' AND deleted_at IS NULL;
INSERT INTO platform.hotel_groups (name, slug, status, kind) VALUES ('Individual hotels', 'individual-hotels', 'active', 'individual');

-- every hotel without a group goes under the individual group
INSERT INTO platform.group_members (group_id, hotel_id)
SELECT (SELECT id FROM platform.hotel_groups WHERE kind = 'individual' AND deleted_at IS NULL), h.id
  FROM platform.hotels h
 WHERE h.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM platform.group_members gm WHERE gm.hotel_id = h.id);

-- a new hotel starts in the individual group
CREATE FUNCTION platform.hotel_to_individual_group() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  INSERT INTO platform.group_members (group_id, hotel_id)
  SELECT g.id, NEW.id FROM platform.hotel_groups g WHERE g.kind = 'individual' AND g.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM platform.group_members gm WHERE gm.hotel_id = NEW.id);
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.hotel_to_individual_group() FROM PUBLIC;
CREATE TRIGGER hotels_individual_group AFTER INSERT ON platform.hotels FOR EACH ROW EXECUTE FUNCTION platform.hotel_to_individual_group();

-- joining a real group takes the hotel out of the individual group
CREATE FUNCTION platform.group_member_swap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.hotel_groups g WHERE g.id = NEW.group_id AND g.kind = 'group') THEN
    DELETE FROM platform.group_members gm USING platform.hotel_groups ig
     WHERE gm.hotel_id = NEW.hotel_id AND gm.group_id = ig.id AND ig.kind = 'individual';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION platform.group_member_swap() FROM PUBLIC;
CREATE TRIGGER group_members_individual_swap BEFORE INSERT ON platform.group_members FOR EACH ROW EXECUTE FUNCTION platform.group_member_swap();

-- leaving a real group puts the hotel back under the individual group (not when the swap above removed the individual membership)
CREATE FUNCTION platform.group_member_return() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM platform.hotels h WHERE h.id = OLD.hotel_id AND h.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM platform.hotel_groups g WHERE g.id = OLD.group_id AND g.kind = 'group')
     AND NOT EXISTS (SELECT 1 FROM platform.group_members gm WHERE gm.hotel_id = OLD.hotel_id) THEN
    INSERT INTO platform.group_members (group_id, hotel_id) SELECT g.id, OLD.hotel_id FROM platform.hotel_groups g WHERE g.kind = 'individual' AND g.deleted_at IS NULL;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.group_member_return() FROM PUBLIC;
CREATE TRIGGER group_members_individual_return AFTER DELETE ON platform.group_members FOR EACH ROW EXECUTE FUNCTION platform.group_member_return();

-- which kind each hotel is: it is in the individual group, or in a real group
CREATE OR REPLACE VIEW platform.hotel_kinds AS
  SELECT h.id AS hotel_id, CASE WHEN g.kind = 'group' THEN 'group_member' ELSE 'individual' END AS kind, CASE WHEN g.kind = 'group' THEN g.id END AS group_id
    FROM platform.hotels h
    LEFT JOIN platform.group_members gm ON gm.hotel_id = h.id
    LEFT JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
   WHERE h.deleted_at IS NULL;
