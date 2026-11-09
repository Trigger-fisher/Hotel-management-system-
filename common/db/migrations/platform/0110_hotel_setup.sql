-- rollback: DROP TABLE IF EXISTS platform.hotel_setup;
-- "Set up your hotel" checklist state (the first-run guide a new Hotel Admin sees). One row per hotel that came through approval; a hotel without a row
-- (every hotel made before this, or by the CLI) has no checklist. It lives on the PLATFORM side because the sign-in answer (/auth/session) is built from
-- platform tables and must not open a hotel schema.
--   status  pending     created by the approval of the hotel; nothing done yet
--           in_progress some steps ticked
--           done / skipped  the admin finished ("Go live") or skipped the whole guide (final)
--   steps   {"<step key>": "todo"|"visited"|"done"|"skipped"}, keys chosen by the screen (letters, digits, underscore), at most 20
--   hidden  "Skip for now": the card is hidden and a link on the dashboard brings it back (not final)
-- Who finished it and when: updated_by / done_at on the row; 'hotel_setup.done' and 'hotel_setup.skipped' are also written to platform.audit_log.

CREATE TABLE platform.hotel_setup (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'skipped')),
  steps jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(steps) = 'object' AND pg_column_size(steps) <= 2000),
  hidden boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_setup_done_fields CHECK ((status IN ('done', 'skipped')) = (done_at IS NOT NULL))
);
CREATE UNIQUE INDEX hotel_setup_hotel_id_key ON platform.hotel_setup (hotel_id);
CREATE INDEX hotel_setup_updated_by_idx ON platform.hotel_setup (updated_by);
CREATE TRIGGER hotel_setup_touch_updated_at BEFORE UPDATE ON platform.hotel_setup
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- the app creates the row at approval and the admin changes it; it is never removed
GRANT SELECT, INSERT, UPDATE ON platform.hotel_setup TO hms_app;
