-- rollback: DROP TABLE IF EXISTS platform.audit_log; DROP TABLE IF EXISTS platform.auth_events;
-- Who signed in and what changed. Both tables are insert-only: hms_app is granted INSERT and SELECT only (0099_grants.sql),
-- and a trigger stops UPDATE and DELETE even for the table owner. Retention purges are a deliberate owner action
-- (DISABLE TRIGGER, delete, ENABLE TRIGGER) logged by the operator, never part of the running app.

-- Foreign keys on these two tables are ON DELETE RESTRICT on purpose: the insert-only trigger would turn the UPDATE that
-- SET NULL performs into an error, and a log row must never lose its who or where. Users and hotels are soft-deleted
-- (deleted_at), never removed, so RESTRICT never gets in the way of normal operation.

-- append-only: Pallav's activity log (sign-in, sign-out, failures, reset requests) with the address it came from
CREATE TABLE platform.auth_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event IN (
    'login_success', 'login_failed', 'logout', 'code_sent', 'code_failed',
    'password_reset_requested', 'password_reset_done', 'password_changed',
    'account_locked', 'account_unlocked', 'account_blocked', 'account_unblocked', 'session_replaced'
  )),
  ip inet,
  user_agent text CHECK (char_length(user_agent) <= 400),
  location text CHECK (char_length(location) <= 120),
  -- small facts only (for example the lock length); never a password, code, token or ID number
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_hotel_at_idx ON platform.auth_events (hotel_id, at DESC);
CREATE INDEX auth_events_user_at_idx ON platform.auth_events (user_id, at DESC);
CREATE TRIGGER auth_events_forbid_change BEFORE UPDATE OR DELETE ON platform.auth_events
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- append-only: changes to bookings, rates, folios, payments, users, roles and permissions (standard X6)
CREATE TABLE platform.audit_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  entity text NOT NULL CHECK (char_length(entity) BETWEEN 1 AND 80),
  entity_id uuid,
  -- before/after carry changed fields (money in paise); never secrets, tokens or ID numbers
  before jsonb,
  after jsonb,
  -- why a group admin or platform staff member opened another hotel (withHotelAs)
  reason text CHECK (char_length(reason) <= 500),
  trace_id text CHECK (trace_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_hotel_at_idx ON platform.audit_log (hotel_id, at DESC);
CREATE INDEX audit_log_entity_idx ON platform.audit_log (entity, entity_id);
CREATE INDEX audit_log_actor_at_idx ON platform.audit_log (actor_user_id, at DESC);
CREATE TRIGGER audit_log_forbid_change BEFORE UPDATE OR DELETE ON platform.audit_log
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
