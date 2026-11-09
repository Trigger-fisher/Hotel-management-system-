-- rollback: DELETE FROM platform.platform_settings WHERE key IN ('mail.smtp_host', 'mail.smtp_port', 'mail.smtp_security', 'mail.smtp_user', 'mail.smtp_password', 'mail.reply_to', 'mail.test_result'); ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_values; ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_secret_keys; ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_are_not_secret; (then add back the three constraints of 0108)
-- The platform mail server, set by the Super Admin (Platform settings > Mail), next to the sender name and address of 0108:
--     mail.smtp_host       null (= use the server's own mail configuration) or a host name
--     mail.smtp_port       1 to 65535 (the screen offers 587, 465 and 25)
--     mail.smtp_security   'starttls' (a plain port upgraded to TLS, required), 'ssl' (TLS from the first byte, port 465) or 'none' (an internal relay)
--     mail.smtp_user       null or the login name
--     mail.smtp_password   SECRET (is_secret = true): never returned by an API, never written to the audit log. The value is ENCRYPTED by the application
--                          (AES-256-GCM, a fresh random IV per value, key = SMTP_SECRET_KEY on the server): the column holds only the sealed text "v1.<iv>.<tag>.<data>".
--                          null = no password. (0108 said "stored as typed"; the Super Admin's SMTP password is the first secret and is encrypted instead.)
--     mail.reply_to        null or an address replies should go to
--     mail.test_result     null or { at, ok, message }: the last "Send test email" (the recipient is not kept)
-- Applied migrations are never edited, so the two constraints of 0108 that list the known keys are replaced here by the same rules plus the new keys.
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
    ELSE true
  END
);
ALTER TABLE platform.platform_settings ADD CONSTRAINT platform_settings_known_are_not_secret CHECK (
  NOT is_secret OR key NOT IN ('new_hotel.role_keys', 'new_hotel.gst_percent', 'new_hotel.time_zone', 'mail.from_name', 'mail.from_email', 'mail.smtp_host', 'mail.smtp_port', 'mail.smtp_security', 'mail.smtp_user', 'mail.reply_to', 'mail.test_result')
);
-- the SMTP password is always a secret row, so no API can ever read it back by mistake
ALTER TABLE platform.platform_settings ADD CONSTRAINT platform_settings_secret_keys CHECK (key <> 'mail.smtp_password' OR is_secret);

INSERT INTO platform.platform_settings (key, value, is_secret) VALUES
  ('mail.smtp_host', 'null', false),
  ('mail.smtp_port', '587', false),
  ('mail.smtp_security', '"starttls"', false),
  ('mail.smtp_user', 'null', false),
  ('mail.smtp_password', 'null', true),
  ('mail.reply_to', 'null', false),
  ('mail.test_result', 'null', false)
ON CONFLICT (key) DO NOTHING;