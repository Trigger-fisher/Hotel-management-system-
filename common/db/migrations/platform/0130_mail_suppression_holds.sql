-- rollback: DROP TABLE IF EXISTS platform.mail_campaign_runs; DROP TABLE IF EXISTS platform.hotel_mail_holds; DROP TABLE IF EXISTS platform.mail_suppressions; ALTER TABLE platform.mail_send_counts DROP COLUMN IF EXISTS complained; ALTER TABLE platform.mail_send_counts DROP COLUMN IF EXISTS bounced;
-- Deliverability and the campaign engine (MAIL-PROVIDERS-50K plan, 18 Oct 2026; session A's slices H1 and H2, built by claude-d3).
--
-- 1. Bounces and complaints. The mail services tell us when a mail bounced or the person marked it as spam: Amazon SES through an SNS topic, Brevo through its webhook
--    (POST /api/v1/public/mail-events/<provider>?key=..., services/mail/events.ts). Each event adds to the day's count of the hotel that sent the mail (next to `sent`), so
--    the bounce and complaint RATES of a hotel can be read; a hotel whose rates pass the limits is put on HOLD (below).
ALTER TABLE platform.mail_send_counts ADD COLUMN IF NOT EXISTS bounced integer NOT NULL DEFAULT 0 CHECK (bounced >= 0);
ALTER TABLE platform.mail_send_counts ADD COLUMN IF NOT EXISTS complained integer NOT NULL DEFAULT 0 CHECK (complained >= 0);

-- 2. The suppression list: addresses no campaign mail may go to again. A hard bounce suppresses the address for EVERY hotel (it does not exist); a complaint or an
--    unsubscribe through the service suppresses it for the hotel that sent the mail. The Super Admin can add an address by hand and remove one (Platform settings > Mail).
--    Only campaign mail (the bulk lane) is held back: a sign-in code or an invoice still goes, because the person asked for it.
-- hard-delete: the Super Admin lifts a suppression (services/mail/safetyService.ts unsuppress; audit row mail_unsuppressed)
CREATE TABLE IF NOT EXISTS platform.mail_suppressions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email))),
  -- null = every hotel (a hard bounce, or the Super Admin's choice); else only this hotel's campaign mail
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('bounce', 'complaint', 'unsubscribe', 'manual')),
  source text NOT NULL CHECK (source IN ('ses', 'brevo', 'manual')),
  -- a short word from the service ("Permanent / General", "abuse"), never the mail's content
  detail text CHECK (detail IS NULL OR char_length(detail) <= 200),
  created_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_suppressions_email_hotel_key ON platform.mail_suppressions (email, COALESCE(hotel_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS mail_suppressions_hotel_idx ON platform.mail_suppressions (hotel_id);
CREATE INDEX IF NOT EXISTS mail_suppressions_created_by_idx ON platform.mail_suppressions (created_by);
CREATE INDEX IF NOT EXISTS mail_suppressions_created_at_idx ON platform.mail_suppressions (created_at DESC, id DESC);
CREATE TRIGGER mail_suppressions_touch BEFORE UPDATE ON platform.mail_suppressions FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.mail_suppressions TO hms_app;

-- 3. A hotel's campaign mail on HOLD: put there automatically when its bounce or complaint rate passes the limit (services/mail/safety.ts HOLD_LIMITS), or by the Super Admin.
--    While held (released_at IS NULL) no campaign mail of the hotel is sent or fed to the queue; system mail (codes, invoices) still goes. The Super Admin releases it with a
--    reason; the rates are then counted again from that moment (counted_from), so an old bad week does not hold the hotel again at once. One row per hotel; its history is
--    the platform audit log (mail_hold, mail_hold_released).
-- no-standard-columns: one state per hotel, keyed by the hotel; the history is the platform audit log
CREATE TABLE IF NOT EXISTS platform.hotel_mail_holds (
  hotel_id uuid PRIMARY KEY REFERENCES platform.hotels (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('bounces', 'complaints', 'manual')),
  -- the rates when it was held ("bounces 7.5% of 400 mails"), or the Super Admin's words
  detail text NOT NULL CHECK (char_length(btrim(detail)) BETWEEN 1 AND 300),
  held_at timestamptz NOT NULL,
  -- null = held automatically
  held_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  released_at timestamptz,
  released_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  release_reason text CHECK (release_reason IS NULL OR char_length(btrim(release_reason)) BETWEEN 1 AND 300),
  -- the rates of the hold check are counted from here (the later of this and seven days ago)
  counted_from timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_mail_holds_release_pair CHECK ((released_at IS NULL) = (release_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS hotel_mail_holds_held_by_idx ON platform.hotel_mail_holds (held_by);
CREATE INDEX IF NOT EXISTS hotel_mail_holds_released_by_idx ON platform.hotel_mail_holds (released_by);
CREATE INDEX IF NOT EXISTS hotel_mail_holds_active_idx ON platform.hotel_mail_holds (hotel_id) WHERE released_at IS NULL;
CREATE TRIGGER hotel_mail_holds_touch BEFORE UPDATE ON platform.hotel_mail_holds FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE ON platform.hotel_mail_holds TO hms_app;

-- 4. The campaigns being sent now, across hotels (the campaign itself and its recipients live in the hotel's schema, hotel migration 0044). The feeder of the mail worker
--    (services/companies/campaignFeed.ts) reads this small list on every pass instead of opening every hotel: it moves the next recipients of each running campaign into the
--    outbox, within what the hotel may send today, and removes the row when the campaign is finished or cancelled.
-- no-standard-columns: a work list keyed by the hotel and its campaign; a row lives only while the campaign is sending or paused
-- hard-delete: the feeder removes the row when the campaign is finished or cancelled (services/companies/campaignFeed.ts)
CREATE TABLE IF NOT EXISTS platform.mail_campaign_runs (
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('sending', 'paused')),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS mail_campaign_runs_state_idx ON platform.mail_campaign_runs (state, started_at);
CREATE TRIGGER mail_campaign_runs_touch BEFORE UPDATE ON platform.mail_campaign_runs FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.mail_campaign_runs TO hms_app;
