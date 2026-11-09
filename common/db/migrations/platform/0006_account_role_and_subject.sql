-- rollback: ALTER TABLE platform.users DROP CONSTRAINT IF EXISTS users_admin_code_required; DROP INDEX IF EXISTS platform.user_hotels_subject_idx; ALTER TABLE platform.user_hotels DROP CONSTRAINT IF EXISTS user_hotels_subject_pair; ALTER TABLE platform.user_hotels DROP COLUMN IF EXISTS subject_kind; ALTER TABLE platform.user_hotels DROP COLUMN IF EXISTS subject_id; ALTER TABLE platform.users DROP CONSTRAINT IF EXISTS users_account_role_known; ALTER TABLE platform.users DROP COLUMN IF EXISTS account_role;
-- Two separate ideas, kept apart on purpose:
--   * account_role picks the DASHBOARD a person lands on. It is the 8-value Role of ui-shared/auth/types.ts.
--   * role_id (Pallav's Viewer/Editor/Admin/custom) picks the PERMISSIONS inside the hotel dashboard.
-- A corporate or guest user also points at their company or guest record, which lives INSIDE the hotel's own schema:
-- user_hotels.subject_id is a plain uuid (no foreign key across schemas); the service checks it exists.
-- Written for an empty table: a database that already has users must backfill account_role before this runs.

ALTER TABLE platform.users
  ADD COLUMN account_role text NOT NULL;
ALTER TABLE platform.users
  ADD CONSTRAINT users_account_role_known CHECK (account_role IN (
    'super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'employee_user', 'corporate_user', 'guest_user'
  ));

ALTER TABLE platform.user_hotels
  ADD COLUMN subject_id uuid,
  ADD COLUMN subject_kind text;
ALTER TABLE platform.user_hotels
  ADD CONSTRAINT user_hotels_subject_pair CHECK (
    (subject_id IS NULL AND subject_kind IS NULL) OR (subject_id IS NOT NULL AND subject_kind IN ('company', 'guest'))
  );
CREATE INDEX user_hotels_subject_idx ON platform.user_hotels (hotel_id, subject_kind, subject_id) WHERE subject_id IS NOT NULL;

-- An administrator always signs in with the emailed code: the flag may be false only for the other roles (D4).
ALTER TABLE platform.users
  ADD CONSTRAINT users_admin_code_required CHECK (code_required OR account_role NOT IN ('super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin'));
