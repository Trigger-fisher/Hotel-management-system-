-- rollback: DROP TABLE IF EXISTS platform.platform_admin_hotel_access_hotels; DROP TABLE IF EXISTS platform.platform_admin_hotel_access; ALTER TABLE platform.hotel_visits DROP CONSTRAINT IF EXISTS hotel_visits_extended_pair; ALTER TABLE platform.hotel_visits DROP COLUMN IF EXISTS extended_from; ALTER TABLE platform.hotel_visits DROP COLUMN IF EXISTS access; (and restore check_hotel_visit() and the ended_reason CHECK of 0106)
-- Entering a hotel with the right level (MJ, 18 Oct 2026; design approved by the PM; services/platform/visitService.ts):
--   * the SUPER ADMIN enters with FULL access (read and write as the hotel's SuperAdmin role), every write audited in the hotel's and the platform's log;
--   * a PLATFORM ADMIN enters with the level the Super Admin gave them: none (cannot enter), view (read only, as before) or full (writes allowed and audited), for all hotels
--     or only the hotels listed; no row = view, all hotels (what every platform admin had before this migration);
--   * a GROUP HOTEL ADMIN enters only a hotel of their own group, view only (as before).
-- Hard limits stay even for full (the route wrapper's deny list and the services): no payments, saved secrets, backups, exports, salary records; no change to the hotel's own
-- SuperAdmin account or role; a platform admin may change no account or role at all.
-- A visit lasts 60 minutes. "Extend" never stretches a visit (the 0106 trigger forbids it, so a visit row stays the record of what was decided): it ends the visit with the
-- reason 'extended' and starts a new one with the same access, linked by extended_from.

-- 1. the visit's access, fixed when it starts
ALTER TABLE platform.hotel_visits ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'view' CHECK (access IN ('view', 'full'));
ALTER TABLE platform.hotel_visits ADD COLUMN IF NOT EXISTS extended_from uuid;
ALTER TABLE platform.hotel_visits ADD CONSTRAINT hotel_visits_extended_from_fkey FOREIGN KEY (extended_from) REFERENCES platform.hotel_visits (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS hotel_visits_extended_from_idx ON platform.hotel_visits (extended_from);
ALTER TABLE platform.hotel_visits DROP CONSTRAINT IF EXISTS hotel_visits_ended_reason_check;
ALTER TABLE platform.hotel_visits ADD CONSTRAINT hotel_visits_ended_reason_check CHECK (ended_reason IN ('exit', 'expired', 'signed_out', 'session_ended', 'hotel_unavailable', 'replaced', 'extended'));

-- 2. what the Super Admin allows each platform admin inside hotels
CREATE TABLE IF NOT EXISTS platform.platform_admin_hotel_access (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'view' CHECK (level IN ('none', 'view', 'full')),
  all_hotels boolean NOT NULL DEFAULT true,
  -- why the Super Admin set it (kept with the row; the platform audit log has the history)
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 300),
  updated_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_hotel_access_user_key UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS platform_admin_hotel_access_updated_by_idx ON platform.platform_admin_hotel_access (updated_by);
CREATE TRIGGER platform_admin_hotel_access_touch BEFORE UPDATE ON platform.platform_admin_hotel_access FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE ON platform.platform_admin_hotel_access TO hms_app;

-- the hotels of a "selected hotels" scope (all_hotels = false)
-- hard-delete: the Super Admin changes the list (services/platform/staffAccessService.ts set: the old list is replaced)
CREATE TABLE IF NOT EXISTS platform.platform_admin_hotel_access_hotels (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_hotel_access_hotels_key UNIQUE (user_id, hotel_id)
);
CREATE INDEX IF NOT EXISTS platform_admin_hotel_access_hotels_hotel_idx ON platform.platform_admin_hotel_access_hotels (hotel_id);
CREATE TRIGGER platform_admin_hotel_access_hotels_touch BEFORE UPDATE ON platform.platform_admin_hotel_access_hotels FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, DELETE ON platform.platform_admin_hotel_access_hotels TO hms_app;

-- 3. the database checks the levels too (the app checks first; this holds even if the app were wrong): who may enter, with which access; access never changes on a visit
CREATE OR REPLACE FUNCTION platform.check_hotel_visit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_role text;
  v_status text;
  v_level text;
  v_all boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.user_id, NEW.hotel_id, NEW.reason, NEW.started_at, NEW.token_hash, NEW.access, NEW.extended_from) IS DISTINCT FROM (OLD.user_id, OLD.hotel_id, OLD.reason, OLD.started_at, OLD.token_hash, OLD.access, OLD.extended_from)
       OR NEW.expires_at > OLD.expires_at OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN
      RAISE EXCEPTION 'a hotel visit cannot be moved, extended or reopened' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT account_role, status INTO v_role, v_status FROM platform.users WHERE id = NEW.user_id AND deleted_at IS NULL;
  IF v_status IS DISTINCT FROM 'active' OR v_role IS NULL OR v_role NOT IN ('super_admin', 'platform_admin', 'group_hotel_admin') THEN
    RAISE EXCEPTION 'only active platform staff or a group admin can enter a hotel' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform.hotels h
     WHERE h.id = NEW.hotel_id AND h.status IN ('active', 'suspended') AND h.deleted_at IS NULL AND h.provisioned_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'only a live hotel can be entered' USING ERRCODE = '23514';
  END IF;
  IF v_role = 'group_hotel_admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM platform.group_members gm JOIN platform.hotel_groups g ON g.id = gm.group_id
       WHERE gm.hotel_id = NEW.hotel_id AND g.admin_user_id = NEW.user_id AND g.status = 'active' AND g.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'a group admin can enter only a hotel of their own group' USING ERRCODE = '42501';
    END IF;
    IF NEW.access <> 'view' THEN
      RAISE EXCEPTION 'a group admin enters view only' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role = 'platform_admin' THEN
    SELECT level, all_hotels INTO v_level, v_all FROM platform.platform_admin_hotel_access WHERE user_id = NEW.user_id;
    v_level := COALESCE(v_level, 'view');
    v_all := COALESCE(v_all, true);
    IF v_level = 'none' THEN
      RAISE EXCEPTION 'this platform admin may not enter hotels' USING ERRCODE = '42501';
    END IF;
    IF NOT v_all AND NOT EXISTS (SELECT 1 FROM platform.platform_admin_hotel_access_hotels WHERE user_id = NEW.user_id AND hotel_id = NEW.hotel_id) THEN
      RAISE EXCEPTION 'this hotel is outside the platform admin''s hotels' USING ERRCODE = '42501';
    END IF;
    IF NEW.access = 'full' AND v_level <> 'full' THEN
      RAISE EXCEPTION 'this platform admin enters view only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
