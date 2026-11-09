-- rollback: DROP TABLE IF EXISTS wa_campaign_recipients, wa_campaigns;
-- WhatsApp campaigns, phase 6 (MJ, 4 Nov 2026): one approved message sent to the guests who agreed to hear from the hotel, a few at a time, through the same sender as every other message (its checks, the
-- daily limit, STOP). A campaign belongs to ONE hotel and lives in its own schema:
--   wa_campaigns            the campaign: its approved message, who it goes to, the values of the message's blanks, how far it has got
--   wa_campaign_recipients  one row per guest, written when the campaign starts (so the audience is fixed then), with what happened to each
-- A guest's number is kept here as digits because the hotel already holds it on the guest's record; no message text is kept (the message is the approved template and its values).

-- hard-delete: purge job whatsapp-campaigns (a hotel removes a draft or a finished campaign)
CREATE TABLE wa_campaigns (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(120) NOT NULL,
  template_id uuid NOT NULL REFERENCES wa_templates (id) ON DELETE RESTRICT,
  -- who: {} = every guest who agreed; { "stayedWithinDays": 90 } narrows it to recent guests (applied when the campaign starts)
  audience jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(audience) = 'object'),
  -- the values of the template's blanks, in order; the text {guest_name} is replaced by each guest's name
  variables jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(variables) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'done', 'cancelled')),
  -- why it paused or stopped, a fixed sentence (no guest data)
  status_reason varchar(300),
  recipient_count integer NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  created_by uuid NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wa_campaigns_legacy_id_key ON wa_campaigns (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX wa_campaigns_status_idx ON wa_campaigns (status, created_at);
CREATE INDEX wa_campaigns_template_idx ON wa_campaigns (template_id);
CREATE TRIGGER wa_campaigns_touch_updated_at BEFORE UPDATE ON wa_campaigns FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job whatsapp-campaigns (the rows go with their campaign)
CREATE TABLE wa_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  campaign_id uuid NOT NULL REFERENCES wa_campaigns (id) ON DELETE CASCADE,
  customer_id uuid,
  phone_digits varchar(15) NOT NULL CHECK (phone_digits ~ '^[0-9]{8,15}$'),
  guest_name varchar(100),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent', 'failed', 'skipped')),
  -- the sender's refusal or failure code (opted_out, consent_missing, daily_cap_reached ...), no text
  reason varchar(60),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wa_campaign_recipients_legacy_id_key ON wa_campaign_recipients (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX wa_campaign_recipients_phone_key ON wa_campaign_recipients (campaign_id, phone_digits);
CREATE INDEX wa_campaign_recipients_state_idx ON wa_campaign_recipients (campaign_id, state);
CREATE TRIGGER wa_campaign_recipients_touch_updated_at BEFORE UPDATE ON wa_campaign_recipients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
