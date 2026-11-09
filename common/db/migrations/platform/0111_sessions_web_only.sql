-- rollback: ALTER TABLE platform.sessions DROP CONSTRAINT IF EXISTS sessions_client_web; ALTER TABLE platform.sessions ADD COLUMN IF NOT EXISTS device_id text CHECK (char_length(device_id) BETWEEN 8 AND 128); ALTER TABLE platform.sessions ADD CONSTRAINT sessions_client_check CHECK (client IN ('web', 'mobile')); CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_device_key ON platform.sessions (user_id, device_id) WHERE client = 'mobile' AND revoked_at IS NULL;
-- HMS has no phone app: a session is a browser (cookie) session only. 0004 allowed a second kind, 'mobile', with its own device id, a 90-day lifetime and a bearer
-- token; none of that is used any more, so it goes: any session of that kind is removed (a session is disposable: the person signs in again), the rules and the
-- one-active-device index are dropped, the device id column is dropped, and `client` may only be 'web'. 0004 is never edited (checksums); this moves forward.

DELETE FROM platform.sessions WHERE client <> 'web';
DROP INDEX IF EXISTS platform.sessions_one_active_device_key;
ALTER TABLE platform.sessions DROP CONSTRAINT IF EXISTS sessions_device_iff_mobile;
ALTER TABLE platform.sessions DROP CONSTRAINT IF EXISTS sessions_mobile_lifetime;
ALTER TABLE platform.sessions DROP CONSTRAINT IF EXISTS sessions_client_check;
ALTER TABLE platform.sessions DROP COLUMN IF EXISTS device_id;
ALTER TABLE platform.sessions ADD CONSTRAINT sessions_client_web CHECK (client = 'web');
