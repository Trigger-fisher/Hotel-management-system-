-- rollback: DROP POLICY IF EXISTS support_requests_scope ON support_requests; DROP TABLE IF EXISTS support_requests;
-- Customer support (guest portal round 3, decision 61, rebuilt on main 18 Oct 2026; the backup branch was only the reference). A signed-in guest writes to the hotel (a subject,
-- a plain-text message, optionally the bill or room-service order it is about); the front desk answers it and marks it answered or closed. One reply per request (the hotel can
-- change it while the request is open). Its own table, not Guest Enquiries (site_enquiries): an enquiry is a stranger asking for a room with its own confirm/decline steps; this is a
-- guest linked by the customer id, with a reply. The guest name is a snapshot for the hotel's list. Nothing else is copied.
-- Row-level security as 0035: a guest account sees and writes only its own customer's requests; a company sees none; staff, visits and workers see everything.
-- no-standard-columns: an HMS-only record (no Pallav import); a request is closed, never deleted
CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  number varchar(20) NOT NULL,
  customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  guest_name varchar(150) NOT NULL,
  subject varchar(120) NOT NULL CHECK (btrim(subject) <> ''),
  message varchar(2000) NOT NULL CHECK (btrim(message) <> ''),
  bill_ref varchar(60),
  order_ref varchar(20),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  reply varchar(2000),
  replied_at timestamptz,
  replied_by uuid,
  replied_by_name varchar(150),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_requests_answer_pair CHECK (status <> 'answered' OR (reply IS NOT NULL AND btrim(reply) <> ''))
);
CREATE UNIQUE INDEX support_requests_number_key ON support_requests (number);
CREATE INDEX support_requests_customer_idx ON support_requests (customer_id, created_at DESC);
CREATE INDEX support_requests_status_idx ON support_requests (status, created_at DESC);
CREATE TRIGGER support_requests_touch_updated_at BEFORE UPDATE ON support_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_requests_scope ON support_requests USING (
  nullif(current_setting('hms.scope_kind', true), '') IS NULL
  OR (current_setting('hms.scope_kind', true) = 'guest' AND customer_id = nullif(current_setting('hms.scope_id', true), '')::uuid)
);
