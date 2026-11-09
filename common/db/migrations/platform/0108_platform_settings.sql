-- rollback: DROP TABLE IF EXISTS platform.platform_settings;
-- Platform settings (Super Admin, Platform settings page): defaults for new hotels and the mail sender. One row per key.
--
-- * key/value (jsonb); the known keys have their value shape checked here (a typo cannot store a string where a percent belongs):
--     new_hotel.role_keys    array of built-in permission role keys a new hotel starts with; always contains "super_admin"
--     new_hotel.gst_percent  one of the contract's PLATFORM_GST_RATES (0, 5, 12, 18, 28); default 5
--     new_hotel.time_zone    IANA name; default "Asia/Kolkata"
--     mail.from_name         sender name of platform mail
--     mail.from_email        sender address; JSON null = use the server's mail configuration
--   The invitation validity (INVITATION_VALID_HOURS) and the 2-step rule are constants, not settings (the contract shows them read-only).
-- * who and when: updated_by / updated_at on the row; the full before/after goes to platform.audit_log ('settings_updated', scope platform).
-- * Secrets (a later SMTP password or API key) are rows with is_secret = true, stored as typed (MJ: no field encryption) and NEVER returned by
--   an API: the service answers { set: true|false } for them and never writes their value to the audit log.
-- The defaults below are inserted once (ON CONFLICT DO NOTHING); updated_by NULL means "never changed" (the contract's updatedBy null).

CREATE TABLE platform.platform_settings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length(key) <= 80),
  value jsonb NOT NULL,
  is_secret boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_known_values CHECK (
    CASE key
      WHEN 'new_hotel.role_keys' THEN jsonb_typeof(value) = 'array' AND value @> '["super_admin"]'::jsonb
      WHEN 'new_hotel.gst_percent' THEN jsonb_typeof(value) = 'number' AND '[0, 5, 12, 18, 28]'::jsonb @> value
      WHEN 'new_hotel.time_zone' THEN jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 1 AND 64
      WHEN 'mail.from_name' THEN jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 1 AND 120
      WHEN 'mail.from_email' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^[^@[:space:]]+@[^@[:space:]]+$')
      ELSE true
    END
  ),
  CONSTRAINT platform_settings_secret_is_text CHECK (NOT is_secret OR jsonb_typeof(value) IN ('string', 'null')),
  CONSTRAINT platform_settings_known_are_not_secret CHECK (NOT is_secret OR key NOT IN ('new_hotel.role_keys', 'new_hotel.gst_percent', 'new_hotel.time_zone', 'mail.from_name', 'mail.from_email'))
);
CREATE UNIQUE INDEX platform_settings_key_key ON platform.platform_settings (key);
CREATE INDEX platform_settings_updated_by_idx ON platform.platform_settings (updated_by);
CREATE TRIGGER platform_settings_touch_updated_at BEFORE UPDATE ON platform.platform_settings
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

INSERT INTO platform.platform_settings (key, value) VALUES
  ('new_hotel.role_keys', '["super_admin", "admin", "editor", "viewer"]'),
  ('new_hotel.gst_percent', '5'),
  ('new_hotel.time_zone', '"Asia/Kolkata"'),
  ('mail.from_name', '"HMS Platform"'),
  ('mail.from_email', 'null')
ON CONFLICT (key) DO NOTHING;

-- settings are changed, never removed, by the app
GRANT SELECT, INSERT, UPDATE ON platform.platform_settings TO hms_app;
