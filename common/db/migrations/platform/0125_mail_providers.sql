-- rollback: DELETE FROM platform.platform_settings WHERE key IN ('mail.provider', 'mail.daily_limit', 'mail.sending_domain'); ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_values; ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_are_not_secret; (then add back the two constraints of 0123)
-- The platform mail service (MAIL-PROVIDERS-50K plan, 18 Oct 2026): Platform settings > Mail now offers Amazon SES (recommended), Brevo, Gmail and any other SMTP server. The server, login and
-- (sealed) password stay in the mail.smtp_* rows of 0123; two rows are new:
--     mail.provider      'gmail' | 'brevo' | 'ses' | 'smtp' (absent = taken from the saved host, so what is saved today keeps working)
--     mail.daily_limit   null (= the service's own limit) or a whole number of mails a day the Super Admin allows for platform mail
--     mail.sending_domain null or the domain the platform's own sending identity lives on (e.g. mail.easyhotelsolutions.in): a hotel that uses the platform's mail sends from <hotel>@<this domain>
-- Applied migrations are never edited, so the two constraints of 0123 that list the known keys are replaced here by the same rules plus the two new keys.
ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_values;
ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_are_not_secret;
ALTER TABLE platform.platform_settings ADD CONSTRAINT platform_settings_known_values CHECK (
  CASE key
    WHEN 'new_hotel.role_keys' THEN jsonb_typeof(value) = 'array' AND value @> '["super_admin"]'::jsonb
    WHEN 'new_hotel.gst_percent' THEN jsonb_typeof(value) = 'number' AND '[0, 5, 12, 18, 28]'::jsonb @> value
    WHEN 'new_hotel.time_zone' THEN jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 1 AND 64
    WHEN 'mail.from_name' THEN jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 1 AND 120
    WHEN 'mail.from_email' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^[^@[:space:]]+@[^@[:space:]]+$')
    WHEN 'mail.smtp_host' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 1 AND 253 AND (value #>> '{}') ~ '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$')
    WHEN 'mail.smtp_port' THEN jsonb_typeof(value) = 'number' AND (value #>> '{}') ~ '^[0-9]{1,5}$' AND (value #>> '{}')::int BETWEEN 1 AND 65535
    WHEN 'mail.smtp_security' THEN jsonb_typeof(value) = 'string' AND (value #>> '{}') IN ('starttls', 'ssl', 'none')
    WHEN 'mail.smtp_user' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 1 AND 254 AND (value #>> '{}') !~ '[[:cntrl:]]')
    WHEN 'mail.smtp_password' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' AND char_length(value #>> '{}') <= 2000)
    WHEN 'mail.reply_to' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') <= 254 AND (value #>> '{}') ~ '^[^@[:space:]]+@[^@[:space:]]+$')
    WHEN 'mail.test_result' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'object' AND value ?& ARRAY['at', 'ok', 'message'])
    WHEN 'mail.provider' THEN jsonb_typeof(value) = 'string' AND (value #>> '{}') IN ('gmail', 'brevo', 'ses', 'smtp')
    WHEN 'mail.daily_limit' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'number' AND (value #>> '{}') ~ '^[0-9]{1,8}$')
    WHEN 'mail.sending_domain' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 3 AND 253 AND (value #>> '{}') ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
    ELSE true
  END
);
ALTER TABLE platform.platform_settings ADD CONSTRAINT platform_settings_known_are_not_secret CHECK (
  NOT is_secret OR key NOT IN ('new_hotel.role_keys', 'new_hotel.gst_percent', 'new_hotel.time_zone', 'mail.from_name', 'mail.from_email', 'mail.smtp_host', 'mail.smtp_port', 'mail.smtp_security', 'mail.smtp_user', 'mail.reply_to', 'mail.test_result', 'mail.provider', 'mail.daily_limit', 'mail.sending_domain')
);

INSERT INTO platform.platform_settings (key, value, is_secret) VALUES
  ('mail.daily_limit', 'null', false)
ON CONFLICT (key) DO NOTHING;