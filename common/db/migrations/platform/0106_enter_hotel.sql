-- rollback: DROP TABLE IF EXISTS platform.hotel_visits; DROP FUNCTION IF EXISTS platform.check_hotel_visit();
-- Enter hotel: the entered-hotel context of platform staff (BRIEF rule 5, RESEARCH MUST 4).
--
-- One row per visit: who (platform user), which hotel, the written reason, when it started, when it ends (60 minutes: the service's
-- ENTER_HOTEL_MINUTES constant; the CHECK pins the same ceiling), when and how it ended and by whom. read_only is always true: the server
-- refuses every write method of hotel routes while a visit is active (P4), and nothing here can switch that off.
-- Bound to the platform sign-in session (session_id): signing out or a replaced session ends the visit (the service ends it in the same
-- transaction; SET NULL only keeps the row when the session purge removes old sessions). token_hash is optional: a separate visit token
-- (256 random bits, keyed HMAC like the invitation token) if P4 sends one; NULL when the visit is read from the session alone.
-- One active visit per person (partial unique index); the service ends visits past expires_at ('expired') before it starts a new one.
-- The audit rows of everything done inside point here (platform.audit_log.visit_id, 0107).
-- A trigger checks who may enter: an active Super Admin or Platform Admin (any live hotel), or a Group Hotel Admin (only a live hotel of a
-- group they administer); the hotel must be live (active or suspended) and provisioned. The visit's who / where / why never change afterwards.

CREATE TABLE platform.hotel_visits (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE RESTRICT,
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  session_id uuid REFERENCES platform.sessions (id) ON DELETE SET NULL,
  token_hash text CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  read_only boolean NOT NULL DEFAULT true CHECK (read_only),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text CHECK (ended_reason IN ('exit', 'expired', 'signed_out', 'session_ended', 'hotel_unavailable', 'replaced')),
  -- who ended it (the visitor on Exit, NULL for the system on expiry)
  ended_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  ip inet,
  user_agent text CHECK (char_length(user_agent) <= 400),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_visits_window CHECK (expires_at > started_at AND expires_at <= started_at + interval '60 minutes'),
  CONSTRAINT hotel_visits_ended_pair CHECK ((ended_at IS NULL) = (ended_reason IS NULL)),
  CONSTRAINT hotel_visits_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX hotel_visits_one_active_per_user_key ON platform.hotel_visits (user_id) WHERE ended_at IS NULL;
CREATE INDEX hotel_visits_user_id_idx ON platform.hotel_visits (user_id, started_at DESC);
CREATE INDEX hotel_visits_hotel_id_idx ON platform.hotel_visits (hotel_id, started_at DESC);
CREATE INDEX hotel_visits_session_id_idx ON platform.hotel_visits (session_id);
CREATE INDEX hotel_visits_ended_by_idx ON platform.hotel_visits (ended_by);
CREATE UNIQUE INDEX hotel_visits_token_hash_key ON platform.hotel_visits (token_hash);
CREATE TRIGGER hotel_visits_touch_updated_at BEFORE UPDATE ON platform.hotel_visits
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE FUNCTION platform.check_hotel_visit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_role text;
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.user_id, NEW.hotel_id, NEW.reason, NEW.started_at, NEW.token_hash) IS DISTINCT FROM (OLD.user_id, OLD.hotel_id, OLD.reason, OLD.started_at, OLD.token_hash)
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
  IF v_role = 'group_hotel_admin' AND NOT EXISTS (
    SELECT 1 FROM platform.group_members gm JOIN platform.hotel_groups g ON g.id = gm.group_id
     WHERE gm.hotel_id = NEW.hotel_id AND g.admin_user_id = NEW.user_id AND g.status = 'active' AND g.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a group admin can enter only a hotel of their own group' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hotel_visits_rules BEFORE INSERT OR UPDATE ON platform.hotel_visits
  FOR EACH ROW EXECUTE FUNCTION platform.check_hotel_visit();

-- the app starts and ends visits; it never deletes one
GRANT SELECT, INSERT, UPDATE ON platform.hotel_visits TO hms_app;
REVOKE ALL ON FUNCTION platform.check_hotel_visit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.check_hotel_visit() TO hms_app;
