-- rollback: ALTER TABLE platform.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_security_values; DELETE FROM platform.platform_settings WHERE key IN ('security.session_minutes', 'security.temp_password_minutes');
-- Platform settings > Security (MJ, 5 Nov 2026), Super Admin only:
--   security.session_minutes       how long each user kind stays signed in after its sign-in, one number of minutes per account role (15 minutes to 30 days);
--                                  a role missing from the object uses its default (12 hours for the staff kinds, 7 days for company and guest)
--   security.temp_password_minutes how long a temporary password (a new account, an administrator's reset) works before it is refused (5 minutes to 24 hours)
-- The session resolver reads the first on every request, so a change applies to sessions already open at their next request.
ALTER TABLE platform.platform_settings ADD CONSTRAINT platform_settings_security_values CHECK (
  CASE key
    WHEN 'security.session_minutes' THEN NOT is_secret AND jsonb_typeof(value) = 'object'
      AND NOT jsonb_path_exists(value, '$.* ? (@.type() != "number" || @ < 15 || @ > 43200 || @ != @.floor())')
    WHEN 'security.temp_password_minutes' THEN NOT is_secret AND jsonb_typeof(value) = 'number'
      AND (value #>> '{}')::numeric BETWEEN 5 AND 1440 AND (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
    ELSE true
  END
);

INSERT INTO platform.platform_settings (key, value) VALUES
  ('security.session_minutes', '{"super_admin": 720, "platform_admin": 720, "group_hotel_admin": 720, "hotel_admin": 720, "hotel_user": 720, "corporate_user": 10080, "guest_user": 10080}'),
  ('security.temp_password_minutes', '30')
ON CONFLICT (key) DO NOTHING;
