-- rollback: DROP TABLE IF EXISTS platform.hotel_deletions; DROP FUNCTION IF EXISTS platform.check_hotel_deletion(); DROP TABLE IF EXISTS platform.hotel_exports; DROP TABLE IF EXISTS platform.hotel_status_history; DROP INDEX IF EXISTS platform.hotels_status_idx; ALTER TABLE platform.hotels DROP CONSTRAINT IF EXISTS hotels_status_known, DROP CONSTRAINT IF EXISTS hotels_suspended_fields, DROP CONSTRAINT IF EXISTS hotels_rejected_fields, DROP CONSTRAINT IF EXISTS hotels_archived_fields, DROP CONSTRAINT IF EXISTS hotels_deleted_fields, DROP CONSTRAINT IF EXISTS hotels_live_is_provisioned, DROP CONSTRAINT IF EXISTS hotels_waiting_not_provisioned, DROP COLUMN IF EXISTS address, DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS state, DROP COLUMN IF EXISTS pin, DROP COLUMN IF EXISTS gstin, DROP COLUMN IF EXISTS phone, DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS logo_name, DROP COLUMN IF EXISTS logo_ref, DROP COLUMN IF EXISTS last_activity_at, DROP COLUMN IF EXISTS provisioned_at, DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS reject_reason, DROP COLUMN IF EXISTS suspended_at, DROP COLUMN IF EXISTS suspend_reason, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archive_reason, DROP COLUMN IF EXISTS restore_until, DROP COLUMN IF EXISTS status_before_archive, ADD CONSTRAINT hotels_status_check CHECK (status IN ('active', 'suspended', 'closed'));
-- Hotel lifecycle (Platform console, BRIEF-BACKEND-PLATFORM rule 1).
--
-- STATUS. platform.hotels.status moves through:
--   invited -> onboarding -> pending_approval -> active <-> suspended ; pending_approval -> rejected ; active|suspended|rejected -> archived
--   archived -> (restore, inside the grace period) the status it had before ; archived -> deleted (Super Admin only, after an export).
--   'invited' and 'onboarding' are reserved for a hotel row made before its form is sent (today the row is made AT submit, as pending_approval).
--   'pending_approval' is the contract's word (ui-shared PlatformHotelStatus) for the brief's "pending review". The old 'closed' (never used by
--   the app) becomes 'archived'. A row in pending_approval / rejected has NO schema yet: provisioned_at says when create-hotel built it.
-- CURRENT STATE lives on the hotel row (the list screens read it without joins): when and why it was submitted, approved, rejected,
--   suspended, archived, and what Restore returns to. WHO did each change, and every change ever made, is the append-only
--   platform.hotel_status_history below (the service writes one row in the SAME transaction as each status change).
-- ARCHIVE keeps the data. restore_until = archived_at + ARCHIVE_GRACE_DAYS (90, ui-shared/dashboards/platform.ts; the service sets it).
--   After it, the Super Admin may delete for good: a ready export (platform.hotel_exports) and the typed slug are required, and the
--   permanent-delete record (platform.hotel_deletions) is refused by a trigger unless the actor is an active Super Admin, the hotel is
--   archived, the grace period is over and the export belongs to the hotel. The hotels row itself stays (status 'deleted', deleted_at set):
--   the audit tables point at it with RESTRICT, and the slug is freed by the existing partial unique index (WHERE deleted_at IS NULL).
-- PROFILE: what the onboarding form and Hotel details need. "kind" (individual | group member) and the group are NOT stored here: they are
--   derived from platform.group_members (one group per hotel, 0103), so they can never disagree with the membership.

-- 1. profile and lifecycle columns (all nullable: existing hotels keep working)
ALTER TABLE platform.hotels
  ADD COLUMN address text CHECK (char_length(address) BETWEEN 1 AND 500),
  ADD COLUMN city text CHECK (char_length(city) BETWEEN 1 AND 100),
  ADD COLUMN state text CHECK (char_length(state) BETWEEN 1 AND 60),
  ADD COLUMN pin text CHECK (pin ~ '^[1-9][0-9]{5}$'),
  -- GSTIN shape only (15 characters); the state code check is the service's (ui-shared gstinShapeOk)
  ADD COLUMN gstin text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  ADD COLUMN phone text CHECK (char_length(phone) BETWEEN 6 AND 20),
  ADD COLUMN email text CHECK (email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- the file name the hotel chose, and where the stored file lives (private storage key); never a public URL
  ADD COLUMN logo_name text CHECK (char_length(logo_name) <= 200 AND logo_name ~* '\.(png|jpe?g|svg|webp)$'),
  ADD COLUMN logo_ref text CHECK (char_length(logo_ref) BETWEEN 1 AND 300),
  -- moved forward by the app on sign-in / activity in the hotel ("inactive N days" on the dashboard)
  ADD COLUMN last_activity_at timestamptz,
  -- when create-hotel built the schema and role; NULL = no schema yet (pending_approval, rejected)
  ADD COLUMN provisioned_at timestamptz,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN reject_reason text CHECK (char_length(reject_reason) BETWEEN 1 AND 500),
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspend_reason text CHECK (char_length(suspend_reason) BETWEEN 1 AND 500),
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archive_reason text CHECK (char_length(archive_reason) BETWEEN 1 AND 500),
  -- end of the archive grace period (archived_at + 90 days, set by the service); Restore only before it, permanent delete only after it
  ADD COLUMN restore_until timestamptz,
  -- what Restore returns to (never straight to active for a suspended or rejected hotel)
  ADD COLUMN status_before_archive text CHECK (status_before_archive IN ('active', 'suspended', 'rejected'));

-- every hotel made so far was made by create-hotel, which builds the schema in the same transaction
UPDATE platform.hotels SET provisioned_at = created_at WHERE provisioned_at IS NULL;
-- create-hotel (CLI and approval) inserts live hotels: they are provisioned in that transaction. The onboarding service inserts NULL explicitly.
ALTER TABLE platform.hotels ALTER COLUMN provisioned_at SET DEFAULT now();

-- 2. the status set
ALTER TABLE platform.hotels DROP CONSTRAINT IF EXISTS hotels_status_check;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'platform.hotels'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%''closed''%') THEN
    RAISE EXCEPTION 'the old hotels status check is still present under another name';
  END IF;
END $$;
UPDATE platform.hotels
   SET status = 'archived', archived_at = updated_at, restore_until = updated_at + interval '90 days', status_before_archive = 'active',
       archive_reason = 'Closed before the hotel lifecycle existed'
 WHERE status = 'closed';
ALTER TABLE platform.hotels
  ADD CONSTRAINT hotels_status_known CHECK (status IN ('invited', 'onboarding', 'pending_approval', 'active', 'suspended', 'archived', 'rejected', 'deleted')),
  ADD CONSTRAINT hotels_suspended_fields CHECK (status <> 'suspended' OR suspended_at IS NOT NULL),
  ADD CONSTRAINT hotels_rejected_fields CHECK (status <> 'rejected' OR (rejected_at IS NOT NULL AND reject_reason IS NOT NULL)),
  ADD CONSTRAINT hotels_archived_fields CHECK (
    status <> 'archived' OR (archived_at IS NOT NULL AND restore_until IS NOT NULL AND restore_until > archived_at AND status_before_archive IS NOT NULL)
  ),
  ADD CONSTRAINT hotels_deleted_fields CHECK (status <> 'deleted' OR deleted_at IS NOT NULL),
  -- a live hotel always has its schema; a hotel still waiting never has one (approval builds it in the same transaction as status -> active)
  ADD CONSTRAINT hotels_live_is_provisioned CHECK (status NOT IN ('active', 'suspended') OR provisioned_at IS NOT NULL),
  ADD CONSTRAINT hotels_waiting_not_provisioned CHECK (status NOT IN ('invited', 'onboarding', 'pending_approval') OR provisioned_at IS NULL);
CREATE INDEX hotels_status_idx ON platform.hotels (status, created_at DESC);

-- 3. every status change: who, why, when
-- append-only: one row per change of platform.hotels.status, written by the service in the same transaction; never edited or deleted
CREATE TABLE platform.hotel_status_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  -- NULL for the first row of a hotel (made by the onboarding form or by create-hotel)
  from_status text CHECK (from_status IN ('invited', 'onboarding', 'pending_approval', 'active', 'suspended', 'archived', 'rejected', 'deleted')),
  to_status text NOT NULL CHECK (to_status IN ('invited', 'onboarding', 'pending_approval', 'active', 'suspended', 'archived', 'rejected', 'deleted')),
  -- NULL = nobody signed in: the invited person's onboarding form, or the system (for example a scheduled job)
  changed_by uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  -- the actor's account role at that moment (users.account_role can change later)
  actor_role text CHECK (actor_role IN ('super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'employee_user', 'corporate_user', 'guest_user')),
  reason text CHECK (char_length(reason) BETWEEN 1 AND 500),
  trace_id text CHECK (trace_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_status_history_is_a_change CHECK (from_status IS DISTINCT FROM to_status),
  -- a rejection always says why (the contract requires the reason; suspend and archive reasons are optional)
  CONSTRAINT hotel_status_history_reject_reason CHECK (to_status <> 'rejected' OR reason IS NOT NULL)
);
CREATE INDEX hotel_status_history_hotel_at_idx ON platform.hotel_status_history (hotel_id, at DESC);
CREATE INDEX hotel_status_history_changed_by_idx ON platform.hotel_status_history (changed_by, at DESC);
CREATE TRIGGER hotel_status_history_forbid_change BEFORE UPDATE OR DELETE ON platform.hotel_status_history
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- 4. data exports (required before a permanent delete; also offered before archiving)
CREATE TABLE platform.hotel_exports (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES platform.users (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ready', 'failed')),
  -- e.g. "gir-forest-lodge-export-2026-10-05.zip"
  file_name text CHECK (file_name ~ '^[a-z0-9][a-z0-9._-]{0,199}$'),
  -- where the archive is kept (private storage key, never a public URL)
  file_ref text CHECK (char_length(file_ref) BETWEEN 1 AND 500),
  byte_size bigint CHECK (byte_size >= 0),
  -- SHA-256 of the archive file, so a later restore can prove it is the same file
  file_sha256 text CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- a short code (SQLSTATE or step name) when it failed; never data from the hotel
  error_code text CHECK (char_length(error_code) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_exports_ready_fields CHECK (status <> 'ready' OR (file_name IS NOT NULL AND file_ref IS NOT NULL AND file_sha256 IS NOT NULL AND finished_at IS NOT NULL)),
  CONSTRAINT hotel_exports_failed_fields CHECK (status <> 'failed' OR finished_at IS NOT NULL),
  CONSTRAINT hotel_exports_finish_after_start CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX hotel_exports_hotel_id_idx ON platform.hotel_exports (hotel_id, created_at DESC);
CREATE INDEX hotel_exports_requested_by_idx ON platform.hotel_exports (requested_by);
CREATE TRIGGER hotel_exports_touch_updated_at BEFORE UPDATE ON platform.hotel_exports
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- 5. the permanent-delete record (Super Admin only; one per hotel; the schema itself is dropped by the owner-side job in the same unit of work)
-- append-only: the proof that a hotel's data was deleted for good, by whom, after which export, with the slug they typed
CREATE TABLE platform.hotel_deletions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  -- snapshots: what the hotel was called when it was deleted
  hotel_name text NOT NULL CHECK (char_length(hotel_name) BETWEEN 1 AND 200),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 63),
  schema_name text NOT NULL CHECK (schema_name ~ '^hotel_[0-9a-f]{32}$'),
  -- exactly what the Super Admin typed in the confirmation box
  confirm_slug text NOT NULL,
  export_id uuid NOT NULL REFERENCES platform.hotel_exports (id) ON DELETE RESTRICT,
  deleted_by uuid NOT NULL REFERENCES platform.users (id) ON DELETE RESTRICT,
  reason text CHECK (char_length(reason) BETWEEN 1 AND 500),
  trace_id text CHECK (trace_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_deletions_slug_typed CHECK (confirm_slug = slug)
);
CREATE UNIQUE INDEX hotel_deletions_hotel_id_key ON platform.hotel_deletions (hotel_id);
CREATE INDEX hotel_deletions_export_id_idx ON platform.hotel_deletions (export_id);
CREATE INDEX hotel_deletions_deleted_by_idx ON platform.hotel_deletions (deleted_by);
CREATE TRIGGER hotel_deletions_forbid_change BEFORE UPDATE OR DELETE ON platform.hotel_deletions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- The rules of a permanent delete, checked by the database whatever the service does.
CREATE FUNCTION platform.check_hotel_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_role text;
  v_user_status text;
  v_hotel record;
BEGIN
  SELECT account_role, status INTO v_role, v_user_status FROM platform.users WHERE id = NEW.deleted_by AND deleted_at IS NULL;
  IF v_role IS DISTINCT FROM 'super_admin' OR v_user_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'only an active Super Admin can delete a hotel for good' USING ERRCODE = '42501';
  END IF;
  SELECT name, slug, schema_name, status, restore_until, deleted_at INTO v_hotel FROM platform.hotels WHERE id = NEW.hotel_id;
  IF NOT FOUND OR v_hotel.status <> 'archived' OR v_hotel.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'only an archived hotel can be deleted for good' USING ERRCODE = '23514';
  END IF;
  IF v_hotel.restore_until > NEW.at THEN
    RAISE EXCEPTION 'the archive grace period of this hotel is not over' USING ERRCODE = '23514';
  END IF;
  IF NEW.slug <> v_hotel.slug OR NEW.schema_name <> v_hotel.schema_name THEN
    RAISE EXCEPTION 'the typed address does not match the hotel' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.hotel_exports e WHERE e.id = NEW.export_id AND e.hotel_id = NEW.hotel_id AND e.status = 'ready') THEN
    RAISE EXCEPTION 'a finished export of this hotel is required before it is deleted for good' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hotel_deletions_rules BEFORE INSERT ON platform.hotel_deletions
  FOR EACH ROW EXECUTE FUNCTION platform.check_hotel_deletion();

-- 6. what the app may do (files 0100+ grant their own tables). History and deletion records: INSERT + SELECT only.
GRANT SELECT, INSERT ON platform.hotel_status_history TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.hotel_exports TO hms_app;
GRANT SELECT, INSERT ON platform.hotel_deletions TO hms_app;
REVOKE ALL ON FUNCTION platform.check_hotel_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.check_hotel_deletion() TO hms_app;
