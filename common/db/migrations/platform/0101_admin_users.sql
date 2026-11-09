-- rollback: DROP TABLE IF EXISTS platform.sign_in_removals; DROP INDEX IF EXISTS platform.users_created_by_idx; ALTER TABLE platform.users DROP COLUMN IF EXISTS created_by;
-- What the Admin users screens need beside the sign-in tables.
--
-- 1. Who made an account (the Users screen shows "added by"). SET NULL: closing the maker's own account never rewrites history.
ALTER TABLE platform.users ADD COLUMN created_by uuid REFERENCES platform.users (id) ON DELETE SET NULL;
CREATE INDEX users_created_by_idx ON platform.users (created_by);

-- 2. A person may remove an ENDED sign-in from their own history list. auth_events is insert-only (a trigger stops UPDATE and DELETE even for the
--    owner), so the removal is its own small record and the list simply leaves those events out.
CREATE TABLE platform.sign_in_removals (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES platform.auth_events (id) ON DELETE RESTRICT,
  removed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sign_in_removals_event_id_key ON platform.sign_in_removals (event_id);
CREATE INDEX sign_in_removals_user_id_idx ON platform.sign_in_removals (user_id);
CREATE TRIGGER sign_in_removals_touch_updated_at BEFORE UPDATE ON platform.sign_in_removals
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT ON platform.sign_in_removals TO hms_app;
