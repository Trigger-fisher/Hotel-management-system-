-- rollback: DROP TABLE IF EXISTS platform.hotel_mail_limits; DROP TABLE IF EXISTS platform.mail_send_counts; DROP INDEX IF EXISTS platform.outbox_due_system_idx; DROP INDEX IF EXISTS platform.outbox_due_bulk_idx;
-- Mail lanes, daily caps and usage (MAIL-PROVIDERS-50K plan, 18 Oct 2026). The worker serves the SYSTEM lane first (every kind but 'campaign': codes, resets, invitations, invoices, enquiry answers, ...) and the
-- BULK lane (campaign mail) after it, so a 50,000-mail campaign can never delay a sign-in code. No lane column: the lane is the mail kind (web-app/src/server/mail/routes.ts MAIL_LANE), and each lane reads its own
-- small partial index (the predicates below are written the same way in the queries):
CREATE INDEX IF NOT EXISTS outbox_due_system_idx ON platform.outbox (next_attempt_at, id) WHERE status = 'pending' AND kind <> 'campaign';
CREATE INDEX IF NOT EXISTS outbox_due_bulk_idx ON platform.outbox (hotel_id, next_attempt_at, id) WHERE status = 'pending' AND kind = 'campaign';

-- Mails SENT per owner per (UTC) day: the owner is a hotel id, or 'platform' for platform mail. Read by the daily caps (a mail service only allows so many a day) and, summed by month, by the usage report
-- (what each hotel used, so the platform owner can see the cost and bill hotels later). Written by the mail worker after each batch.
-- no-standard-columns: a counter keyed by its owner and the day it counts; no id, no timestamps beyond the day
CREATE TABLE IF NOT EXISTS platform.mail_send_counts (
  scope text NOT NULL CHECK (scope = 'platform' OR scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  day date NOT NULL,
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  PRIMARY KEY (scope, day)
);
CREATE INDEX IF NOT EXISTS mail_send_counts_day_idx ON platform.mail_send_counts (day);
GRANT SELECT, INSERT, UPDATE ON platform.mail_send_counts TO hms_app;

-- The Super Admin's daily mail cap for one hotel (Platform > hotel): the most mails the hotel may send a day, whatever its mail service allows. No row = no cap of the Super Admin. Who changed it and when
-- is in the platform audit log.
-- no-standard-columns: one setting per hotel, keyed by the hotel; its history is the platform audit log
CREATE TABLE IF NOT EXISTS platform.hotel_mail_limits (
  hotel_id uuid PRIMARY KEY REFERENCES platform.hotels (id) ON DELETE CASCADE,
  daily_cap integer NOT NULL CHECK (daily_cap >= 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.hotel_mail_limits TO hms_app;