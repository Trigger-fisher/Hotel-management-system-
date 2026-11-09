-- rollback: DROP TABLE IF EXISTS platform.demo_requests;
-- Demo requests (MJ, 2 Nov 2026): a hotel that asked for a demo on the product website's form (/contact). A prospect, not a tenant: the row holds what the visitor typed and
-- where the Super Admin got to with it (new, contacted, closed), and who changed that last. Never removed by the app; a closed request stays for the record.
CREATE TABLE platform.demo_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text CHECK (phone IS NULL OR phone ~ '^[0-9+() -]{6,20}$'),
  hotel_name text NOT NULL CHECK (char_length(btrim(hotel_name)) BETWEEN 1 AND 160),
  city text CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 1 AND 100),
  rooms integer CHECK (rooms IS NULL OR rooms BETWEEN 1 AND 5000),
  properties integer CHECK (properties IS NULL OR properties BETWEEN 1 AND 500),
  message text CHECK (message IS NULL OR char_length(message) <= 2000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  source text NOT NULL DEFAULT 'website' CHECK (source ~ '^[a-z0-9_-]{1,40}$'),
  handled_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  handled_by_name text CHECK (handled_by_name IS NULL OR char_length(handled_by_name) <= 120),
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- the list: newest first, by status
CREATE INDEX demo_requests_status_created_idx ON platform.demo_requests (status, created_at DESC);
CREATE INDEX demo_requests_created_at_idx ON platform.demo_requests (created_at DESC);
CREATE INDEX demo_requests_handled_by_idx ON platform.demo_requests (handled_by);
CREATE TRIGGER demo_requests_touch_updated_at BEFORE UPDATE ON platform.demo_requests FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON platform.demo_requests TO hms_app;
