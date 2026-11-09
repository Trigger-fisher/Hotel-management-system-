-- rollback: DROP TABLE IF EXISTS platform.api_tokens; DROP TABLE IF EXISTS platform.api_access_settings;
-- API access keys (MJ, 18 Oct 2026, docs/plans/API-ACCESS-TOKENS-PLAN-2026-10-18.md): the Super Admin makes a key (Platform settings > API access) that a tool can send as
-- "Authorization: Bearer hms_pat_..." to test the site without a browser session. The key is shown ONCE; only a keyed hash of it (HMAC under HMS_HASH_KEY) is kept here, so a copy of
-- this table cannot be used to call the API. A key acts through the Super Admin who made it (the account must still be an active Super Admin on every call).
-- Two levels (MJ, same day: "a Full access level as well as read-only, for heavy testing"):
--   'read' = GET only; the hotel scopes are served like an Enter-hotel visit (a READ ONLY transaction), so a read key can never change anything.
--   'full' = read and write, in the console AND in hotels. It is the dangerous one, so the database itself insists on its safeguards: an IP allow-list with at least one address,
--     a life of at most 24 hours (read keys: 30 days), a reason, and the key is only usable while the Super Admin's "allow full access keys" switch (api_access_settings) is on.
-- Scopes: 'platform' = the console only; 'hotel' = ONE hotel; 'all' = the console plus any hotel named per call (header X-HMS-Hotel).
-- test_mode: while on, a call made with the key never sends real mail and never queues or submits to Pathik (the load tests); on by default, and a full key can only turn it off with a
-- reason of its own (test_mode_off_reason). Every write made with a key is an audit row "API token: <name>". The app role may read, add and change rows but never delete them (a revoked key stays).
-- ip_allow: when not empty, only these addresses may use the key. ip_seen: the addresses the key was used from (newest 20), so a first use from a new address is noticed and audited.
-- calls_day / calls_count: the key's calls on that UTC day (shown in the list). calls_per_minute: the most calls a minute (read keys 60; full keys 10 to 3000).
-- Nothing here holds a guest's or a hotel's data, and the key itself is never stored.
CREATE TABLE platform.api_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- what the person called it, e.g. "Claude testing"
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  -- HMAC-SHA-256 (hex) of the whole key; the key itself is never stored
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- the first characters of the key ("hms_pat_ab12"), only so the list can tell keys apart
  token_prefix text NOT NULL CHECK (token_prefix ~ '^hms_pat_[A-Za-z0-9_-]{4}$'),
  level text NOT NULL CHECK (level IN ('read', 'full')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('platform', 'hotel', 'all')),
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  ip_allow text[] NOT NULL DEFAULT '{}',
  ip_seen text[] NOT NULL DEFAULT '{}',
  -- why a full key was made (asked for in the form; kept for the audit trail)
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 300),
  test_mode boolean NOT NULL DEFAULT true,
  test_mode_off_reason text CHECK (test_mode_off_reason IS NULL OR char_length(btrim(test_mode_off_reason)) BETWEEN 1 AND 300),
  calls_per_minute integer NOT NULL DEFAULT 60 CHECK (calls_per_minute BETWEEN 10 AND 3000),
  created_by uuid NOT NULL REFERENCES platform.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  last_ip text,
  calls_day date,
  calls_count integer NOT NULL DEFAULT 0 CHECK (calls_count >= 0),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT api_tokens_hotel_scope CHECK ((scope_kind = 'hotel') = (hotel_id IS NOT NULL)),
  CONSTRAINT api_tokens_full_reason CHECK (level = 'read' OR reason IS NOT NULL),
  CONSTRAINT api_tokens_full_ip CHECK (level = 'read' OR cardinality(ip_allow) >= 1),
  CONSTRAINT api_tokens_expiry_max CHECK (expires_at > created_at AND expires_at <= created_at + CASE WHEN level = 'full' THEN interval '24 hours' ELSE interval '30 days' END),
  CONSTRAINT api_tokens_test_mode_off_reason CHECK (test_mode OR test_mode_off_reason IS NOT NULL),
  CONSTRAINT api_tokens_read_calls_per_minute CHECK (level = 'full' OR calls_per_minute = 60),
  CONSTRAINT api_tokens_ip_size CHECK (cardinality(ip_allow) <= 10 AND cardinality(ip_seen) <= 20)
);
CREATE INDEX api_tokens_active_idx ON platform.api_tokens (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX api_tokens_hotel_idx ON platform.api_tokens (hotel_id);
CREATE INDEX api_tokens_created_by_idx ON platform.api_tokens (created_by);
CREATE INDEX api_tokens_revoked_by_idx ON platform.api_tokens (revoked_by);
CREATE TRIGGER api_tokens_touch BEFORE UPDATE ON platform.api_tokens FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE ON platform.api_tokens TO hms_app;

-- The Super Admin's switch for FULL access keys: ONE row (the table cannot hold two), off until a Super Admin turns it on with a reason; a full key is refused on every call while it is off.
-- Who turned it on or off, when and why stays here (and in the audit log).
CREATE TABLE platform.api_access_settings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- always true and unique: the table cannot hold a second row
  singleton boolean NOT NULL DEFAULT true CONSTRAINT api_access_settings_one_row UNIQUE CHECK (singleton),
  full_access_enabled boolean NOT NULL DEFAULT false,
  changed_by uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  changed_at timestamptz,
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_access_settings_changed_by_idx ON platform.api_access_settings (changed_by);
CREATE TRIGGER api_access_settings_touch BEFORE UPDATE ON platform.api_access_settings FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
INSERT INTO platform.api_access_settings (full_access_enabled) VALUES (false);
GRANT SELECT, INSERT, UPDATE ON platform.api_access_settings TO hms_app;
