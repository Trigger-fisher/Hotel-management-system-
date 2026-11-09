-- rollback: DROP TABLE IF EXISTS platform.mail_event_receipts;
-- The mail-events webhooks remember what they already took (security review round 2, M2; 18 Oct 2026, Backend session A). Amazon SNS delivers a notification at least once
-- and a webhook call can be replayed: before this, the same bounce or complaint counted again on every delivery and could put a hotel on hold by itself. Each event the
-- webhook records leaves one row here, keyed by a keyed hash of the service's own id (SNS MessageId; for Brevo its event, address, message id and time); a second delivery of
-- the same key is left out. Nothing of the mail or the address is kept: only the hash and when it came. Rows older than seven days are removed as new ones arrive
-- (services/platform/mailSafetyService.ts), well past SNS's one-hour signature window and Brevo's retries.
-- no-standard-columns: a receipt list keyed by the service and the event's hash; a row is never changed, only removed after seven days
-- hard-delete: receipts older than seven days are removed by the webhook (mailSafety.receive)
CREATE TABLE IF NOT EXISTS platform.mail_event_receipts (
  provider text NOT NULL CHECK (provider IN ('ses', 'brevo')),
  event_key text NOT NULL CHECK (event_key ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_key)
);
CREATE INDEX IF NOT EXISTS mail_event_receipts_received_at_idx ON platform.mail_event_receipts (received_at);
GRANT SELECT, INSERT, DELETE ON platform.mail_event_receipts TO hms_app;
