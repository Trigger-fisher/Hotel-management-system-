-- rollback: DROP TABLE IF EXISTS platform.whatsapp_campaign_runs;
-- WhatsApp campaigns (MJ, 4 Nov 2026): a campaign lives in its hotel's own schema (hotel 0058); this is only the short list of campaigns that are RUNNING, so the one-minute sweep knows which hotels have work
-- without opening every hotel. One row per running campaign; it is removed when the campaign ends, pauses or is cancelled, and `next_at` says when the sweep may take the next few guests (a day later after the
-- hotel's daily limit, a quarter of an hour later when WhatsApp is off). No guest data and no text.
CREATE TABLE platform.whatsapp_campaign_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  next_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_campaign_runs_campaign_key ON platform.whatsapp_campaign_runs (hotel_id, campaign_id);
CREATE INDEX whatsapp_campaign_runs_due_idx ON platform.whatsapp_campaign_runs (next_at);
CREATE TRIGGER whatsapp_campaign_runs_touch_updated_at BEFORE UPDATE ON platform.whatsapp_campaign_runs FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.whatsapp_campaign_runs TO hms_app;
