-- rollback: DELETE FROM platform.api_tokens WHERE level = 'ai'; ALTER TABLE platform.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_level_check, DROP CONSTRAINT IF EXISTS api_tokens_ai_scope, DROP CONSTRAINT IF EXISTS api_tokens_full_ip, DROP CONSTRAINT IF EXISTS api_tokens_expiry_max, DROP CONSTRAINT IF EXISTS api_tokens_read_calls_per_minute; ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_level_check CHECK (level IN ('read', 'full')), ADD CONSTRAINT api_tokens_full_ip CHECK (level = 'read' OR cardinality(ip_allow) >= 1), ADD CONSTRAINT api_tokens_expiry_max CHECK (expires_at > created_at AND expires_at <= created_at + CASE WHEN level = 'full' THEN interval '24 hours' ELSE interval '30 days' END), ADD CONSTRAINT api_tokens_read_calls_per_minute CHECK (level = 'full' OR calls_per_minute = 60);
-- A third key level for the other developer's AI (MJ, 4 Nov 2026: "one key for all, it can read all data, no time limit, log is good, block only secrets"):
--   'ai' = READ ONLY like 'read' (GET only; hotels are served in a READ ONLY transaction, so it can never change anything), scope 'all' (the console plus any hotel named per call), no short life
--   (a long expiry of up to 10 years, shown as "Never"; the Super Admin can still revoke it at any time), and a higher call rate (10 to 3000 a minute, default 600). The deny list of an 'ai' key
--   holds only SECRETS (sign-in, passwords and one-time links, key management, the settings that hold a secret, backups, scheduled jobs and invitation links); the guest and staff data a
--   'read' key may not see is open to it. Who made it, why and the audit rows are as for every key; a first use from a new address and a refused call are still noted.
ALTER TABLE platform.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_level_check;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_level_check CHECK (level IN ('read', 'full', 'ai'));

-- an 'ai' key has the console and every hotel in reach, so its scope is always 'all'; it is made with a reason (who it is for), like a full key
ALTER TABLE platform.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_ai_scope;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_ai_scope CHECK (level <> 'ai' OR (scope_kind = 'all' AND reason IS NOT NULL));

-- the address list is required for a FULL key only (an 'ai' key may have none, or a list when the developer has fixed addresses)
ALTER TABLE platform.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_full_ip;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_full_ip CHECK (level <> 'full' OR cardinality(ip_allow) >= 1);

-- life: full 24 hours, read 30 days, ai up to 10 years
ALTER TABLE platform.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_expiry_max;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_expiry_max CHECK (expires_at > created_at AND expires_at <= created_at + CASE level WHEN 'full' THEN interval '24 hours' WHEN 'read' THEN interval '30 days' ELSE interval '3660 days' END);

-- calls a minute: read keys 60 exactly; full and ai keys 10 to 3000 (the column's own check already bounds it)
ALTER TABLE platform.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_read_calls_per_minute;
ALTER TABLE platform.api_tokens ADD CONSTRAINT api_tokens_read_calls_per_minute CHECK (level <> 'read' OR calls_per_minute = 60);
