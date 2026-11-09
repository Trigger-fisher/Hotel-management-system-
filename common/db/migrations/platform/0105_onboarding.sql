-- rollback: DROP TRIGGER IF EXISTS sessions_sign_in_allowed ON platform.sessions; DROP FUNCTION IF EXISTS platform.check_session_allowed(); DROP TABLE IF EXISTS platform.onboarding_submissions; ALTER TABLE platform.users DROP CONSTRAINT IF EXISTS users_status_known, ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'invited', 'disabled'));
-- Onboarding: what the invited hotel (or group) sent, its first account, and the review decision. BRIEF rule 3.
--
-- DESIGN: the first admin is a PENDING platform.users row (status 'pending_approval'), not a separate pending-registration table:
--   * the username / email / mobile must be unique across real AND pending accounts at the moment of submit; the existing partial unique
--     indexes on platform.users give that atomically (a separate table could only be checked, never guaranteed, across two tables);
--   * the password is stored once, as Argon2id, under the existing users_password_hash CHECK; approval only flips status (no copying a hash);
--   * the contract lists pending admins with everyone else (PlatformAdminStatus / PlatformUserStatus 'pending'), so the lists read one table;
--   * it is linked like any admin: user_hotels -> the pending hotel (built-in role super_admin), or hotel_groups.admin_user_id -> the
--     pending group (account_role group_hotel_admin). The hotel/group row exists from submit (status pending_approval, no schema yet).
--   A pending account CANNOT sign in: the sign-in service refuses it (ACCOUNT_BLOCKED, reason hotel_pending / group_pending), and as a backstop
--   a trigger on platform.sessions refuses a session for a pending account, and for a hotel that is not active (suspended, waiting, rejected,
--   archived or deleted). Reject: the account becomes 'disabled' (the contract shows it disabled), the hotel 'rejected'; nothing was provisioned.
-- platform.onboarding_submissions keeps the form AS SENT (payload, never a password: a CHECK refuses any password key at any depth), the
--   address it came from, and the review decision (who, when, why). One submission per invitation (single use).

-- 1. the pending account
ALTER TABLE platform.users DROP CONSTRAINT IF EXISTS users_status_check;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'platform.users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%''invited''%') THEN
    RAISE EXCEPTION 'the old users status check is still present under another name';
  END IF;
END $$;
ALTER TABLE platform.users
  ADD CONSTRAINT users_status_known CHECK (status IN ('active', 'invited', 'disabled', 'pending_approval'));

-- 2. the form as sent, and the decision
CREATE TABLE platform.onboarding_submissions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  invitation_id uuid NOT NULL REFERENCES platform.invitations (id) ON DELETE RESTRICT,
  -- 'hotel' (invitation types individual and member_hotel) or 'group'
  kind text NOT NULL CHECK (kind IN ('hotel', 'group')),
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  group_id uuid REFERENCES platform.hotel_groups (id) ON DELETE RESTRICT,
  -- the pending first account (Hotel Admin or Group Hotel Admin)
  admin_user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE RESTRICT,
  -- the form minus both password fields: {hotel|group: {...}, admin: {name, username, email, mobile}} incl. the optional "More about your hotel"
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 20000
    AND NOT (payload @? '$.**.password') AND NOT (payload @? '$.**.passwordConfirm') AND NOT (payload @? '$.**.password_hash')
  ),
  submitted_ip inet,
  submitted_user_agent text CHECK (char_length(submitted_user_agent) <= 400),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text CHECK (char_length(decision_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_submissions_subject CHECK (
    (kind = 'hotel' AND hotel_id IS NOT NULL AND group_id IS NULL) OR (kind = 'group' AND group_id IS NOT NULL AND hotel_id IS NULL)
  ),
  CONSTRAINT onboarding_submissions_decided_pair CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT onboarding_submissions_reject_reason CHECK (status <> 'rejected' OR decision_reason IS NOT NULL)
);
-- single use: one form per invitation, one per hotel / group, one per pending account (unique indexes allow many NULLs)
CREATE UNIQUE INDEX onboarding_submissions_invitation_id_key ON platform.onboarding_submissions (invitation_id);
CREATE UNIQUE INDEX onboarding_submissions_hotel_id_key ON platform.onboarding_submissions (hotel_id);
CREATE UNIQUE INDEX onboarding_submissions_group_id_key ON platform.onboarding_submissions (group_id);
CREATE UNIQUE INDEX onboarding_submissions_admin_user_id_key ON platform.onboarding_submissions (admin_user_id);
CREATE INDEX onboarding_submissions_decided_by_idx ON platform.onboarding_submissions (decided_by);
CREATE INDEX onboarding_submissions_status_idx ON platform.onboarding_submissions (status, submitted_at DESC);
CREATE TRIGGER onboarding_submissions_touch_updated_at BEFORE UPDATE ON platform.onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- 3. backstop: no session for an account waiting for approval, or into a hotel that is not open. The service checks first and answers with
--    the contract's message; this only makes a forgotten check impossible. 42501 = "not allowed".
CREATE FUNCTION platform.check_session_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.users u WHERE u.id = NEW.user_id AND u.status = 'pending_approval') THEN
    RAISE EXCEPTION 'an account waiting for approval cannot sign in' USING ERRCODE = '42501';
  END IF;
  IF NEW.hotel_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform.hotels h WHERE h.id = NEW.hotel_id AND (h.status <> 'active' OR h.deleted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'nobody can sign in to a hotel that is not active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_sign_in_allowed BEFORE INSERT ON platform.sessions
  FOR EACH ROW EXECUTE FUNCTION platform.check_session_allowed();

-- 4. what the app may do: the submission is updated once (the decision); no DELETE
GRANT SELECT, INSERT, UPDATE ON platform.onboarding_submissions TO hms_app;
REVOKE ALL ON FUNCTION platform.check_session_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.check_session_allowed() TO hms_app;
