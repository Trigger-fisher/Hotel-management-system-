-- rollback: DROP TABLE IF EXISTS platform.security_resets; DROP TABLE IF EXISTS platform.security_events;
-- Security detection and emergency reset (docs: security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md, sections 7 and 9). security_events holds Warning and Critical events ONLY
-- (a honeypot hit, a failed-login burst, a cross-hotel attempt, a reset); Info stays in the platform audit log, so this table stays small. Nothing secret is stored: the
-- summary and detail are written by services/security/events.ts, which cuts every text to a short, printable length. security_resets is one row per emergency reset
-- (layer 1 edge, 2 application, 3 database); layer 3 needs a second Super Admin to approve, and the row keeps the steps and the health check that decided the outcome.
-- no-standard-columns: an append-only event list; a row is never changed except for the delivery marks of its own alert, and never removed by the app
CREATE TABLE platform.security_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{2,40}$'),
  summary varchar(300) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip varchar(45),
  trace_id varchar(64),
  slack_status text NOT NULL DEFAULT 'skipped' CHECK (slack_status IN ('sent', 'skipped', 'failed', 'throttled')),
  sms_status text NOT NULL DEFAULT 'skipped' CHECK (sms_status IN ('sent', 'skipped', 'failed', 'throttled'))
);
CREATE INDEX security_events_at_idx ON platform.security_events (at DESC);
CREATE INDEX security_events_severity_at_idx ON platform.security_events (severity, at DESC);

-- no-standard-columns: one row per emergency reset; the state moves forward only and the row is never removed
CREATE TABLE platform.security_resets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  layer smallint NOT NULL CHECK (layer IN (1, 2, 3)),
  state text NOT NULL CHECK (state IN ('awaiting_approval', 'running', 'healthy', 'unhealthy', 'rejected')),
  reason varchar(500) NOT NULL,
  requested_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  requested_by_name varchar(120) NOT NULL,
  approved_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  approved_by_name varchar(120),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  health_ok boolean,
  health_detail varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- two people for the database layer: the approver is never the requester
  CONSTRAINT security_resets_two_people CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX security_resets_layer_created_idx ON platform.security_resets (layer, created_at DESC);
CREATE INDEX security_resets_requested_by_idx ON platform.security_resets (requested_by);
CREATE INDEX security_resets_approved_by_idx ON platform.security_resets (approved_by);

GRANT SELECT, INSERT, UPDATE ON platform.security_events TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.security_resets TO hms_app;
