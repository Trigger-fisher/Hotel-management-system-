-- rollback: DELETE FROM platform.platform_settings WHERE key IN ('mail.backup_user', 'mail.backup_password', 'mail.backup_test_result', 'mail.failover_enabled', 'mail.failover_return_minutes', 'mail.failover_state'); ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_values; ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_are_not_secret; ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_secret_keys; (then add back the three constraints of 0125 and 0123)
-- The platform mail service gets a BACKUP (MJ, 31 Oct 2026): Amazon SES stays the main service (the mail.smtp_* and mail.provider rows of 0123 and 0125); a Google address with an app password is the
-- backup, and platform mail moves to it on its own when the main service fails. Six rows are new:
--     mail.backup_user              null or the Google (Gmail / Workspace) address that sends; it is also the From address, Google sends as the account itself
--     mail.backup_password          SECRET (is_secret = true): the app password, sealed by the application exactly like mail.smtp_password (AES-256-GCM, scope "platform:backup"); null = none
--     mail.backup_test_result       null or { at, ok, message }: the last "Send test email" through the backup
--     mail.failover_enabled         true / false: switch to the backup by itself when the main service fails (default true)
--     mail.failover_return_minutes  1 to 1440: after this long on the backup the main service is tried again (default 15)
--     mail.failover_state           null or { active: 'primary' | 'backup', since, events: [ { at, from, to, reason } ] }: where mail goes out from now, and the last ten switches (written by the mail worker)
-- Applied migrations are never edited, so the three constraints that list the known keys are replaced here by the same rules plus the new keys.
ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_values;
ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_known_are_not_secret;
ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_secret_keys;

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
    WHEN 'mail.backup_user' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND char_length(value #>> '{}') BETWEEN 3 AND 254 AND (value #>> '{}') !~ '[[:cntrl:]]')
    WHEN 'mail.backup_password' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' AND char_length(value #>> '{}') <= 2000)
    WHEN 'mail.backup_test_result' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'object' AND value ?& ARRAY['at', 'ok', 'message'])
    WHEN 'mail.failover_enabled' THEN jsonb_typeof(value) = 'boolean'
    WHEN 'mail.failover_return_minutes' THEN jsonb_typeof(value) = 'number' AND (value #>> '{}') ~ '^[0-9]{1,4}$' AND (value #>> '{}')::int BETWEEN 1 AND 1440
    WHEN 'mail.failover_state' THEN jsonb_typeof(value) = 'null' OR (jsonb_typeof(value) = 'object' AND value ? 'active' AND (value ->> 'active') IN ('primary', 'backup'))
    ELSE true
  END
);
ALTER TABLE platform.platform_settings ADD CONSTRAINT platform_settings_known_are_not_secret CHECK (
  NOT is_secret OR key NOT IN ('new_hotel.role_keys', 'new_hotel.gst_percent', 'new_hotel.time_zone', 'mail.from_name', 'mail.from_email', 'mail.smtp_host', 'mail.smtp_port', 'mail.smtp_security', 'mail.smtp_user', 'mail.reply_to', 'mail.test_result', 'mail.provider', 'mail.daily_limit', 'mail.sending_domain', 'mail.backup_user', 'mail.backup_test_result', 'mail.failover_enabled', 'mail.failover_return_minutes', 'mail.failover_state')
);
-- both passwords are always secret rows, so no API can ever read one back by mistake
ALTER TABLE platform.platform_settings ADD CONSTRAINT platform_settings_secret_keys CHECK (key NOT IN ('mail.smtp_password', 'mail.backup_password') OR is_secret);

INSERT INTO platform.platform_settings (key, value, is_secret) VALUES
  ('mail.backup_user', 'null', false),
  ('mail.backup_password', 'null', true),
  ('mail.backup_test_result', 'null', false),
  ('mail.failover_enabled', 'true', false),
  ('mail.failover_return_minutes', '15', false),
  ('mail.failover_state', 'null', false)
ON CONFLICT (key) DO NOTHING;
