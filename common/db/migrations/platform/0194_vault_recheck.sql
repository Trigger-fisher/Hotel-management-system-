-- rollback: ALTER TABLE platform.sessions DROP COLUMN IF EXISTS rechecked_at; ALTER TABLE platform.auth_codes DROP CONSTRAINT IF EXISTS auth_codes_purpose_check; ALTER TABLE platform.auth_codes ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset', 'reset_link')) NOT VALID;
-- Vault re-check (MJ, 5 Nov 2026): before a vault shows a secret the person proves it is them again, with their password or a fresh 6-digit code
-- emailed to them (purpose 'recheck'). The proof belongs to the session (rechecked_at) and is good for 5 minutes; a reveal without it is refused.
ALTER TABLE platform.sessions ADD COLUMN IF NOT EXISTS rechecked_at timestamptz;
ALTER TABLE platform.auth_codes DROP CONSTRAINT IF EXISTS auth_codes_purpose_check;
ALTER TABLE platform.auth_codes ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset', 'reset_link', 'recheck'));
