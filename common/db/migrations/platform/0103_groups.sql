-- rollback: DROP TABLE IF EXISTS platform.group_history; DROP INDEX IF EXISTS platform.group_members_one_group_per_hotel_key; DROP INDEX IF EXISTS platform.group_members_linked_by_idx; ALTER TABLE platform.group_members DROP COLUMN IF EXISTS linked_by; DROP INDEX IF EXISTS platform.hotel_groups_name_key; DROP INDEX IF EXISTS platform.hotel_groups_admin_user_id_idx; DROP INDEX IF EXISTS platform.hotel_groups_status_idx; ALTER TABLE platform.hotel_groups DROP CONSTRAINT IF EXISTS hotel_groups_status_known, DROP CONSTRAINT IF EXISTS hotel_groups_rejected_fields, DROP COLUMN IF EXISTS admin_user_id, DROP COLUMN IF EXISTS legal_name, DROP COLUMN IF EXISTS gstin, DROP COLUMN IF EXISTS address, DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS state, DROP COLUMN IF EXISTS pin, DROP COLUMN IF EXISTS phone, DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS reject_reason, ADD CONSTRAINT hotel_groups_status_check CHECK (status IN ('active', 'suspended', 'closed'));
-- Hotel groups (Platform console Groups page, the 'group' invitation and its onboarding form).
--
-- * hotel_groups gets the group facts from the group onboarding form (legal name, GSTIN, address, phone, email), its review timestamps
--   and reason, and ONE link to its Group Hotel Admin (admin_user_id): either the group-level account made by the 'group' invitation
--   (account_role group_hotel_admin) or a Hotel Admin of a member hotel chosen with "Set group admin". NULL = nobody yet.
--   The member count is derived (COUNT over group_members), never stored.
-- * Status: pending_approval (the group form was sent), active, suspended, rejected (reason kept), archived. The old 'closed' (never
--   used by the app) becomes 'archived'. A group still waiting for its admin's form is an INVITATION, not a group row.
-- * A hotel is in at most one group (unique hotel_id below). Linking inserts a group_members row, unlinking deletes it (hms_app already
--   holds DELETE on group_members); every link, unlink, admin change and status change is kept in the append-only platform.group_history.
-- * Group names are unique case-insensitively among live groups that are not rejected (the contract's "group name taken" rule).

ALTER TABLE platform.hotel_groups
  ADD COLUMN legal_name text CHECK (char_length(legal_name) BETWEEN 1 AND 200),
  ADD COLUMN gstin text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  ADD COLUMN address text CHECK (char_length(address) BETWEEN 1 AND 500),
  ADD COLUMN city text CHECK (char_length(city) BETWEEN 1 AND 100),
  ADD COLUMN state text CHECK (char_length(state) BETWEEN 1 AND 60),
  ADD COLUMN pin text CHECK (pin ~ '^[1-9][0-9]{5}$'),
  ADD COLUMN phone text CHECK (char_length(phone) BETWEEN 6 AND 20),
  ADD COLUMN email text CHECK (email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN reject_reason text CHECK (char_length(reject_reason) BETWEEN 1 AND 500);

-- the Group Hotel Admin; SET NULL: closing that account never rewrites the group (the change is in group_history)
ALTER TABLE platform.hotel_groups ADD COLUMN admin_user_id uuid REFERENCES platform.users (id) ON DELETE SET NULL;
CREATE INDEX hotel_groups_admin_user_id_idx ON platform.hotel_groups (admin_user_id);

ALTER TABLE platform.hotel_groups DROP CONSTRAINT IF EXISTS hotel_groups_status_check;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'platform.hotel_groups'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%''closed''%') THEN
    RAISE EXCEPTION 'the old hotel_groups status check is still present under another name';
  END IF;
END $$;
UPDATE platform.hotel_groups SET status = 'archived' WHERE status = 'closed';
ALTER TABLE platform.hotel_groups
  ADD CONSTRAINT hotel_groups_status_known CHECK (status IN ('pending_approval', 'active', 'suspended', 'rejected', 'archived')),
  ADD CONSTRAINT hotel_groups_rejected_fields CHECK (status <> 'rejected' OR (rejected_at IS NOT NULL AND reject_reason IS NOT NULL));
CREATE INDEX hotel_groups_status_idx ON platform.hotel_groups (status, created_at DESC);
CREATE UNIQUE INDEX hotel_groups_name_key ON platform.hotel_groups (lower(name)) WHERE deleted_at IS NULL AND status <> 'rejected';

-- one group per hotel (the contract: "a hotel is in at most one group")
CREATE UNIQUE INDEX group_members_one_group_per_hotel_key ON platform.group_members (hotel_id);
-- who linked it (SET NULL like users.created_by); the full story is group_history
ALTER TABLE platform.group_members ADD COLUMN linked_by uuid REFERENCES platform.users (id) ON DELETE SET NULL;
CREATE INDEX group_members_linked_by_idx ON platform.group_members (linked_by);

-- append-only: every change of a group (status, a hotel linked or unlinked, the group admin set or cleared): who, why, when
CREATE TABLE platform.group_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL REFERENCES platform.hotel_groups (id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event IN (
    'created', 'submitted', 'approved', 'rejected', 'suspended', 'reactivated', 'archived', 'restored',
    'hotel_linked', 'hotel_unlinked', 'admin_set', 'admin_cleared'
  )),
  from_status text CHECK (from_status IN ('pending_approval', 'active', 'suspended', 'rejected', 'archived')),
  to_status text CHECK (to_status IN ('pending_approval', 'active', 'suspended', 'rejected', 'archived')),
  -- the hotel linked or unlinked (or, for admin_set, the hotel the chosen admin belongs to)
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  -- the Group Hotel Admin set or cleared
  admin_user_id uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  -- NULL = nobody signed in (the invited person's form) or the system
  changed_by uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  actor_role text CHECK (actor_role IN ('super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'employee_user', 'corporate_user', 'guest_user')),
  reason text CHECK (char_length(reason) BETWEEN 1 AND 500),
  trace_id text CHECK (trace_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_history_membership_names_hotel CHECK (event NOT IN ('hotel_linked', 'hotel_unlinked') OR hotel_id IS NOT NULL),
  CONSTRAINT group_history_admin_names_user CHECK (event <> 'admin_set' OR admin_user_id IS NOT NULL),
  CONSTRAINT group_history_status_events CHECK (
    event NOT IN ('created', 'submitted', 'approved', 'rejected', 'suspended', 'reactivated', 'archived', 'restored') OR to_status IS NOT NULL
  ),
  CONSTRAINT group_history_reject_reason CHECK (event <> 'rejected' OR reason IS NOT NULL)
);
CREATE INDEX group_history_group_at_idx ON platform.group_history (group_id, at DESC);
CREATE INDEX group_history_hotel_id_idx ON platform.group_history (hotel_id);
CREATE INDEX group_history_admin_user_id_idx ON platform.group_history (admin_user_id);
CREATE INDEX group_history_changed_by_idx ON platform.group_history (changed_by, at DESC);
CREATE TRIGGER group_history_forbid_change BEFORE UPDATE OR DELETE ON platform.group_history
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- hotel_groups (SELECT/INSERT/UPDATE) and group_members (SELECT/INSERT/DELETE) are already granted in 0099_grants.sql; linked_by is written
-- on INSERT, so no new right is needed. The history is insert-only for the app.
GRANT SELECT, INSERT ON platform.group_history TO hms_app;
