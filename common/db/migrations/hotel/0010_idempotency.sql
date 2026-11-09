-- rollback: DROP TABLE IF EXISTS idempotency_keys;
-- Not a Pallav table. A client that retries a create (a dropped connection, a double tap) sends the same Idempotency-Key; the
-- service stores the first answer here and replays it instead of creating a second booking or payment. One row per (person, key).
-- Rows are only useful until expires_at; the purge job (marked below) deletes the expired ones, so this table is one of the
-- few the hotel's role may DELETE from (only tables marked "-- hard-delete" are).

-- hard-delete: purge job idempotency-expiry (HMS removes rows past expires_at)
CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  method text NOT NULL CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  path varchar(255) NOT NULL,
  -- SHA-256 of the request body: the same key with a different body is refused, never replayed
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_status smallint CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_completed_ck CHECK (status = 'in_progress' OR response_status IS NOT NULL)
);
CREATE UNIQUE INDEX idempotency_keys_user_key_key ON idempotency_keys (user_id, key);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);
CREATE TRIGGER idempotency_keys_touch_updated_at BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
