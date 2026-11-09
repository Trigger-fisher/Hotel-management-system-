-- rollback: DROP TABLE IF EXISTS guest_requests;
-- Guest requests (MJ's plan, G2): "Need something?" on the guest portal home. A guest who is staying asks for towels, water, room cleaning, a late check-out,
-- a longer stay or something else (a short note); the front desk sees the open ones under Front Office > Guest requests and on the dashboard's bell, and
-- marks each done (or declined, with a word back to the guest). One row per request; it stays with the stay. No money here: a late check-out or a longer
-- stay is granted by the desk on the stay itself, this is only the ask.
-- no-standard-columns: a short request record; created by the guest's own account (created_by), closed by the desk (done_by); no edits, no soft delete, no import
CREATE TABLE guest_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  stay_id uuid NOT NULL REFERENCES pms_stays (id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('towels', 'water', 'cleaning', 'late_checkout', 'extend_stay', 'other')),
  note varchar(300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined')),
  reply varchar(300),
  created_by uuid,
  done_by uuid,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_requests_done_pair CHECK ((status = 'open') = (done_at IS NULL))
);
CREATE INDEX guest_requests_stay_idx ON guest_requests (stay_id, created_at);
CREATE INDEX guest_requests_open_idx ON guest_requests (created_at) WHERE status = 'open';
CREATE TRIGGER guest_requests_touch_updated_at BEFORE UPDATE ON guest_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
