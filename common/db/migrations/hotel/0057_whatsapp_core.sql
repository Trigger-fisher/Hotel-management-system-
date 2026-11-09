-- rollback: DROP TABLE IF EXISTS wa_optouts, wa_usage, wa_templates; ALTER TABLE conv_messages DROP COLUMN IF EXISTS line_id; ALTER TABLE customers DROP COLUMN IF EXISTS wa_consent_at, DROP COLUMN IF EXISTS wa_consent_by;
-- WhatsApp, phase 1 (MJ, 4 Nov 2026; docs/plans/WHATSAPP-MASTER-PLAN.md part 8): what belongs to ONE hotel. The messages themselves are rows of conv_messages (channel 'whatsapp', 0050); this adds
--   wa_templates   the hotel's message templates and their approval by Meta
--   wa_usage       messages counted per day, line and category (the daily cap is checked against it; the month's bill-back is its sum)
--   wa_optouts     guests who sent STOP to this hotel
--   conv_messages.line_id   which number carried the message (the platform's whatsapp_lines id; no foreign key: it lives in another schema). A hotel that moves to its own number keeps one thread; old
--                           messages keep the shared line's id and new ones the own line's id.
--   customers.wa_consent_at / wa_consent_by   the guest agreed to automatic WhatsApp messages (a tick at booking or check-in), with who recorded it
-- Nothing here is shared with another hotel; every table sits in the hotel's own schema.

-- hard-delete: purge job whatsapp-templates (a hotel removes a draft or a rejected template)
CREATE TABLE wa_templates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(512) NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
  language varchar(10) NOT NULL DEFAULT 'en' CHECK (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  category text NOT NULL CHECK (category IN ('utility', 'authentication', 'marketing')),
  body varchar(1024) NOT NULL,
  -- the numbered variables the body uses, in order: [{ "index": 1, "name": "guest_name", "example": "Asha" }]
  variables jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(variables) = 'array'),
  meta_template_id varchar(60),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'paused')),
  -- why Meta rejected or paused it, as a short code or sentence from Meta (no guest data)
  status_reason varchar(300),
  -- which line it was submitted on (the platform's whatsapp_lines id); a template is approved per number account
  line_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wa_templates_legacy_id_key ON wa_templates (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX wa_templates_name_key ON wa_templates (name, language, coalesce(line_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TRIGGER wa_templates_touch_updated_at BEFORE UPDATE ON wa_templates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE wa_usage (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  -- the calendar day in the hotel's time zone
  day date NOT NULL,
  line_id uuid NOT NULL,
  -- the Meta category of what was sent (a free-text reply inside the 24-hour window is 'service')
  category text NOT NULL CHECK (category IN ('service', 'utility', 'authentication', 'marketing')),
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  -- messages the HOTEL started (a template outside the window): the number the daily cap is checked against
  started integer NOT NULL DEFAULT 0 CHECK (started >= 0),
  received integer NOT NULL DEFAULT 0 CHECK (received >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wa_usage_legacy_id_key ON wa_usage (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX wa_usage_key ON wa_usage (day, line_id, category);
CREATE TRIGGER wa_usage_touch_updated_at BEFORE UPDATE ON wa_usage FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job whatsapp-opt-in (a guest who sends START takes the opt-out row away)
CREATE TABLE wa_optouts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  -- the guest's number as digits with the country code (8 to 15, the conversation handle rule)
  phone_digits varchar(15) NOT NULL CHECK (phone_digits ~ '^[0-9]{8,15}$'),
  -- the line the guest wrote STOP to
  line_id uuid,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wa_optouts_legacy_id_key ON wa_optouts (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX wa_optouts_phone_key ON wa_optouts (phone_digits);
CREATE TRIGGER wa_optouts_touch_updated_at BEFORE UPDATE ON wa_optouts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE conv_messages ADD COLUMN line_id uuid;
ALTER TABLE customers ADD COLUMN wa_consent_at timestamptz, ADD COLUMN wa_consent_by uuid;
