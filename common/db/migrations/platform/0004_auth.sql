-- rollback: DROP TABLE IF EXISTS platform.outbox; DROP TABLE IF EXISTS platform.rate_limits; DROP TABLE IF EXISTS platform.auth_codes; DROP TABLE IF EXISTS platform.login_attempts; DROP TABLE IF EXISTS platform.sessions;
-- Sessions, the sign-in attempt record behind the lock, one-time codes, in-database rate counters and the email outbox.
-- Pallav signs in with username + password + an emailed 6-digit code (AuthController.php); there is no authenticator app and no
-- recovery code, and there are no refresh tokens here (MASTER 4.2): one web session per person, and one long-lived token per phone.
-- HASHING RULE: a token, reset code or login code is never stored; only a 64 lower-case hex hash is.
--   * High-entropy secrets (session token, reset-link token) are 256 random bits: plain SHA-256 is enough.
--   * Low-entropy values (a 6-digit emailed code, a username or mobile number) are guessable, so a bare SHA-256 could be
--     reversed from a leaked table in moments. They are hashed with a keyed HMAC-SHA256 whose secret (HMS_HASH_KEY) lives
--     only in the server environment: hmac(key, purpose | user_id | code) for codes, hmac(key, identifier) for attempts and counters.
--     See Web App/src/server/crypto/hash.ts. The column shape (64 hex) is the same either way.

-- One row per sign-in that is still (or was) valid. WEB: at most one active session per person, idle expiry 120 minutes that the
-- service moves forward on activity (last_seen_at and expires_at are set together, to the same now()). MOBILE: one token per phone
-- (device_id), valid 90 days from issue, not extended. A new web sign-in revokes the old web session (reason 'replaced') in the same
-- transaction; the service also revokes rows past expires_at ('expired') before it inserts, because the unique indexes below look
-- at revoked_at only.
CREATE TABLE platform.sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  -- the hotel chosen at sign-in; the server reads the hotel from here, never from the request
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE SET NULL,
  client text NOT NULL DEFAULT 'web' CHECK (client IN ('web', 'mobile')),
  -- the phone's own id (app-generated, stored in the secure store); present for mobile, absent for web
  device_id text CHECK (char_length(device_id) BETWEEN 8 AND 128),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  device_label text CHECK (char_length(device_label) <= 120),
  user_agent text CHECK (char_length(user_agent) <= 400),
  ip inet,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('logout', 'replaced', 'expired', 'admin', 'blocked', 'password_changed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_revoked_pair CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT sessions_expiry_after_issue CHECK (expires_at > issued_at),
  CONSTRAINT sessions_device_iff_mobile CHECK ((client = 'mobile') = (device_id IS NOT NULL)),
  -- ceilings, so a clock difference of a microsecond never fails a write: mobile never longer than 90 days from issue; web never longer than 120 idle minutes after the last activity (or sign-in); the service sets the exact values
  CONSTRAINT sessions_mobile_lifetime CHECK (client <> 'mobile' OR expires_at <= issued_at + interval '90 days'),
  CONSTRAINT sessions_web_idle_window CHECK (client <> 'web' OR expires_at <= COALESCE(last_seen_at, issued_at) + interval '120 minutes')
);
CREATE UNIQUE INDEX sessions_one_active_web_per_user_key ON platform.sessions (user_id) WHERE client = 'web' AND revoked_at IS NULL;
CREATE UNIQUE INDEX sessions_one_active_device_key ON platform.sessions (user_id, device_id) WHERE client = 'mobile' AND revoked_at IS NULL;
CREATE INDEX sessions_user_id_idx ON platform.sessions (user_id);
CREATE UNIQUE INDEX sessions_token_hash_key ON platform.sessions (token_hash);
CREATE INDEX sessions_hotel_id_idx ON platform.sessions (hotel_id);
CREATE INDEX sessions_expires_at_idx ON platform.sessions (expires_at);
CREATE TRIGGER sessions_touch_updated_at BEFORE UPDATE ON platform.sessions
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- append-only: every sign-in try, kept for the lock rule and for review; purged by age, never edited
-- The identifier (username, mobile or email as typed, normalised) is stored only as a KEYED hash (see the hashing rule above).
-- Users are soft-deleted, so the user reference is RESTRICT: an append-only row must never need rewriting.
CREATE TABLE platform.login_attempts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  identifier_hash text NOT NULL CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid REFERENCES platform.users (id) ON DELETE RESTRICT,
  ip inet,
  outcome text NOT NULL CHECK (outcome IN ('success', 'bad_password', 'unknown_user', 'locked', 'blocked', 'bad_code', 'rate_limited')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_identifier_at_idx ON platform.login_attempts (identifier_hash, at DESC);
CREATE INDEX login_attempts_ip_at_idx ON platform.login_attempts (ip, at DESC);
CREATE INDEX login_attempts_user_id_idx ON platform.login_attempts (user_id);

-- append-only, like the audit tables: a row is added and purged by age, never edited
CREATE TRIGGER login_attempts_no_update BEFORE UPDATE ON platform.login_attempts
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();

-- Emailed sign-in codes and password-reset codes, one table, one rule: hashed, expiring, limited tries and limited resends.
-- (Pallav has no invite flow: a new account gets a temporary password by email and sets its own on first sign-in, so there is no
-- 'invite' purpose.) The service refuses a resend inside the cool-down after last_sent_at and past the resend limit.
CREATE TABLE platform.auth_codes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  purpose text NOT NULL CHECK (purpose IN ('login', 'reset')),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  -- wrong tries on THIS code (Pallav otp_attempts)
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  -- how many times this code was sent again, and when it last went out (Pallav otp_sends, otp_cooldown_until)
  resend_count smallint NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 20),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_codes_expiry_after_creation CHECK (expires_at > created_at)
);
-- one live code per person and purpose: issuing a new one marks the old one used in the same transaction
CREATE UNIQUE INDEX auth_codes_one_live_per_purpose_key ON platform.auth_codes (user_id, purpose) WHERE used_at IS NULL;
CREATE INDEX auth_codes_user_id_idx ON platform.auth_codes (user_id, purpose);
CREATE INDEX auth_codes_code_hash_idx ON platform.auth_codes (code_hash);
CREATE INDEX auth_codes_expires_at_idx ON platform.auth_codes (expires_at);
CREATE TRIGGER auth_codes_touch_updated_at BEFORE UPDATE ON platform.auth_codes
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- no-standard-columns: a counter keyed by what it counts and the window it counts in; no id, no legacy_id, no timestamps beyond the window
-- In-database counters for rate limits: one row per (keyed hash of what is limited, window start). key_hash is an HMAC (HMS_HASH_KEY)
-- of "<what>|<who>", for example the 24-hour cap on wrong reset codes per account or sign-in tries per address. The service does
-- INSERT ... ON CONFLICT (key_hash, window_start) DO UPDATE SET count = rate_limits.count + 1 and reads count; rows past their window
-- are purged by age.
CREATE TABLE platform.rate_limits (
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  PRIMARY KEY (key_hash, window_start)
);
CREATE INDEX rate_limits_window_start_idx ON platform.rate_limits (window_start);

-- Every email the system sends goes through here (sign-in and reset codes, "your password changed", "your account was locked", "new phone",
-- the temporary password of a new or reset account). The payload (the only place a one-time code or temporary password ever appears)
-- is deleted (set NULL) as soon as the mail is sent or has failed for good; the table is never shown to the app's users.
CREATE TABLE platform.outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid REFERENCES platform.users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset')),
  to_email text NOT NULL CHECK (char_length(to_email) BETWEEN 3 AND 320),
  template text NOT NULL CHECK (template ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  payload text CHECK (char_length(payload) <= 8000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_payload_while_waiting CHECK (status NOT IN ('pending', 'sending') OR payload IS NOT NULL),
  CONSTRAINT outbox_sent_pair CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX outbox_due_idx ON platform.outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX outbox_user_id_idx ON platform.outbox (user_id);
CREATE TRIGGER outbox_touch_updated_at BEFORE UPDATE ON platform.outbox
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
