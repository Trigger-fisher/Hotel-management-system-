-- rollback: DROP TABLE IF EXISTS platform.whatsapp_suppressions, platform.whatsapp_message_index, platform.whatsapp_events, platform.whatsapp_holds, platform.whatsapp_line_hotels, platform.whatsapp_lines; DROP FUNCTION IF EXISTS platform.whatsapp_line_hotel_kind(); ALTER TABLE platform.guest_hotels DROP COLUMN IF EXISTS wa_last_out_at, DROP COLUMN IF EXISTS wa_last_in_at; DELETE FROM platform.platform_settings WHERE key LIKE 'whatsapp.%';
-- WhatsApp, phase 1 (MJ, 4 Nov 2026; docs/plans/WHATSAPP-MASTER-PLAN.md part 8). Content lives in the hotel's own schema (or the platform's own conversation tables for the platform line); what is here is
-- ROUTING and CONNECTION state: which number belongs to whom, which hotel may use a line, a message waiting for "which hotel?", the saved webhook events, an index of message ids, and the numbers
-- that must not be messaged. Invariant I1: no message text, media or name is ever kept here except SEALED and short-lived (a hold, about 10 minutes; a saved event until it is processed, 7 days at most when it failed).
--   whatsapp_lines        one row per connected number (platform, shared guest, a hotel's own, a group's, a person's); the token is sealed with the server key and never returned by any route
--   whatsapp_line_hotels  which hotel may use which line, with history (valid_from / valid_to), the move state (pending, transition, active), per-hotel caps and switch overrides
--   whatsapp_holds        a guest message waiting for the answer to "which hotel?" (sealed, deleted on expiry)
--   whatsapp_events       every webhook event saved BEFORE it is processed (durable intake; processing is a function of the event id; retry, dead letter, replay)
--   whatsapp_message_index  message id -> line and hotel, no content, so a swipe-reply finds its hotel with one query (30 days)
--   whatsapp_suppressions numbers (keyed hash) that must never receive automatic or marketing messages: STOP, complaint, blocked by staff; per hotel or platform-wide
-- The kill switch, the routing timeframe and the switch profiles are rows of platform.platform_settings (seeded at the end, WhatsApp OFF).
-- The names of the sealed columns end in _secret, not _sealed: the schema lint forbids names shaped for ciphertext, and these hold the same "v1.iv.tag.body" text as platform.pmail_accounts.secret.

CREATE TABLE platform.whatsapp_lines (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind text NOT NULL CHECK (kind IN ('platform', 'shared', 'hotel', 'group', 'person')),
  -- Meta's id of the number (not the phone number itself): the key every webhook event is matched on
  phone_number_id varchar(40) NOT NULL CHECK (phone_number_id ~ '^[0-9]{5,40}$'),
  waba_id varchar(40) NOT NULL CHECK (waba_id ~ '^[0-9]{5,40}$'),
  display_phone varchar(32),
  display_name varchar(120),
  status text NOT NULL DEFAULT 'test' CHECK (status IN ('test', 'active', 'paused', 'needs_reconnect', 'banned')),
  quality text NOT NULL DEFAULT 'unknown' CHECK (quality IN ('green', 'yellow', 'red', 'unknown')),
  -- the person who owns a 'person' line; a login that owns a line cannot be deleted until the line is disconnected
  owner_login_id uuid REFERENCES platform.logins (id) ON DELETE RESTRICT,
  -- the system-user access token, sealed with the server key and bound to this line (whatsapp/seal.ts); never returned by any route, never logged
  token_secret text NOT NULL CHECK (token_secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- the two-step verification PIN set when the number was registered, sealed the same way; never shown
  pin_secret text CHECK (pin_secret IS NULL OR pin_secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- a number hosted in the owner's account for a hotel (plan 28.4, off by default): recorded so the ownership statement can say so
  managed boolean NOT NULL DEFAULT false,
  webhook_subscribed boolean NOT NULL DEFAULT false,
  subscribed_fields text[] NOT NULL DEFAULT '{}',
  last_event_at timestamptz,
  registered boolean NOT NULL DEFAULT false,
  name_status varchar(40),
  messaging_tier varchar(40),
  token_checked_at timestamptz,
  last_verified_at timestamptz,
  last_error_code varchar(60) CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Za-z0-9_.-]{1,60}$'),
  last_error_at timestamptz,
  -- how many 401s in a row (a token that fails twice marks the line needs_reconnect)
  token_failures integer NOT NULL DEFAULT 0 CHECK (token_failures >= 0),
  connected_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_lines_person_has_owner CHECK (kind <> 'person' OR owner_login_id IS NOT NULL)
);
CREATE UNIQUE INDEX whatsapp_lines_phone_number_id_key ON platform.whatsapp_lines (phone_number_id);
-- only one platform line (Super Admin and Platform Admin share it); extra platform numbers are 'person' lines
CREATE UNIQUE INDEX whatsapp_lines_one_platform_key ON platform.whatsapp_lines (kind) WHERE kind = 'platform' AND status <> 'banned';
CREATE INDEX whatsapp_lines_owner_idx ON platform.whatsapp_lines (owner_login_id);
CREATE INDEX whatsapp_lines_connected_by_idx ON platform.whatsapp_lines (connected_by);
CREATE TRIGGER whatsapp_lines_touch_updated_at BEFORE UPDATE ON platform.whatsapp_lines FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE ON platform.whatsapp_lines TO hms_app;

-- which hotel may use which line. History is kept: closing a row sets valid_to, it is never deleted. `own` is filled from the line's kind by a trigger (it cannot be set wrong by a caller).
CREATE FUNCTION platform.whatsapp_line_hotel_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT (kind = 'hotel') INTO NEW.own FROM platform.whatsapp_lines WHERE id = NEW.line_id;
  IF NEW.own IS NULL THEN
    RAISE EXCEPTION 'whatsapp line not found' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE TABLE platform.whatsapp_line_hotels (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  line_id uuid NOT NULL REFERENCES platform.whatsapp_lines (id) ON DELETE RESTRICT,
  -- a hotel that is removed for good takes its line history with it (the line itself stays)
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  -- true when the line is the hotel's own number (filled by the trigger from the line's kind)
  own boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  -- NULL = current
  valid_to timestamptz,
  -- the move from the shared line to an own line (plan part 14)
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('pending', 'transition', 'active')),
  transition_ends_at timestamptz,
  -- the hotel's own number as digits, given to a guest who writes to the shared line after the move
  redirect_phone varchar(20) CHECK (redirect_phone IS NULL OR redirect_phone ~ '^[0-9]{8,15}$'),
  -- NULL = the global setting
  daily_cap integer CHECK (daily_cap IS NULL OR daily_cap >= 0),
  marketing_allowed boolean NOT NULL DEFAULT false,
  may_message_anyone boolean NOT NULL DEFAULT false,
  -- per-hotel overrides of any restriction switch (plan part 6); resolution: this, then the line's profile, then the global default
  rules_override jsonb CHECK (rules_override IS NULL OR jsonb_typeof(rules_override) = 'object'),
  -- the short code a guest can type (or a wa.me link can carry) to choose this hotel on the shared line; unique among current rows
  hotel_code varchar(24) CHECK (hotel_code IS NULL OR hotel_code ~ '^[a-z0-9]{3,24}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_line_hotels_window CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT whatsapp_line_hotels_transition_end CHECK (state = 'transition' OR transition_ends_at IS NULL)
);
CREATE TRIGGER whatsapp_line_hotels_kind BEFORE INSERT ON platform.whatsapp_line_hotels FOR EACH ROW EXECUTE FUNCTION platform.whatsapp_line_hotel_kind();
-- one current row per (line, hotel)
CREATE UNIQUE INDEX whatsapp_line_hotels_current_key ON platform.whatsapp_line_hotels (line_id, hotel_id) WHERE valid_to IS NULL;
-- a hotel has at most one current own line
CREATE UNIQUE INDEX whatsapp_line_hotels_one_own_key ON platform.whatsapp_line_hotels (hotel_id) WHERE own AND valid_to IS NULL;
CREATE UNIQUE INDEX whatsapp_line_hotels_code_key ON platform.whatsapp_line_hotels (hotel_code) WHERE hotel_code IS NOT NULL AND valid_to IS NULL;
CREATE INDEX whatsapp_line_hotels_line_idx ON platform.whatsapp_line_hotels (line_id, valid_to);
CREATE INDEX whatsapp_line_hotels_hotel_idx ON platform.whatsapp_line_hotels (hotel_id, valid_to);
CREATE TRIGGER whatsapp_line_hotels_touch_updated_at BEFORE UPDATE ON platform.whatsapp_line_hotels FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE ON platform.whatsapp_line_hotels TO hms_app;

-- a guest message waiting for the answer to "which hotel?". The message is sealed, the guest is a keyed hash of the number (never the number), and the row is deleted when it expires.
CREATE TABLE platform.whatsapp_holds (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  line_id uuid NOT NULL REFERENCES platform.whatsapp_lines (id) ON DELETE CASCADE,
  guest_hash bytea NOT NULL CHECK (octet_length(guest_hash) = 32),
  payload_secret text NOT NULL CHECK (payload_secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- who was offered
  candidate_hotels uuid[] NOT NULL DEFAULT '{}',
  -- the interactive question's own message id, so an answer is tied to the question that was asked
  question_wamid varchar(200),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- one open hold per guest per line: a second message is appended to it, the guest is not asked twice
CREATE UNIQUE INDEX whatsapp_holds_guest_key ON platform.whatsapp_holds (line_id, guest_hash);
CREATE INDEX whatsapp_holds_expires_idx ON platform.whatsapp_holds (expires_at);
CREATE TRIGGER whatsapp_holds_touch_updated_at BEFORE UPDATE ON platform.whatsapp_holds FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.whatsapp_holds TO hms_app;

-- every webhook event, saved before it is processed. dedupe_key makes a repeat delivery harmless: "m:<line>:<wamid>" for a message, "s:<line>:<wamid>:<status>" for a status, "t:<line>:<hash>" for a template event.
-- The payload is the sealed JSON of the one change (it carries the guest's text): it is cleared when the event is done and the row is deleted a day later; a failed one is kept 7 days at most.
CREATE TABLE platform.whatsapp_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  line_id uuid NOT NULL REFERENCES platform.whatsapp_lines (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('message', 'status', 'template', 'other')),
  dedupe_key varchar(300) NOT NULL,
  payload_secret text CHECK (payload_secret IS NULL OR payload_secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  state text NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'processing', 'done', 'failed', 'dead', 'parked')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- a worker holds an event until this time; a crashed worker's lease simply runs out
  locked_until timestamptz,
  last_error_code varchar(60) CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Za-z0-9_.-]{1,60}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_events_payload_until_done CHECK (state = 'done' OR payload_secret IS NOT NULL OR state = 'dead')
);
CREATE UNIQUE INDEX whatsapp_events_dedupe_key ON platform.whatsapp_events (dedupe_key);
-- the sweep: events that are due, oldest first
CREATE INDEX whatsapp_events_due_idx ON platform.whatsapp_events (next_attempt_at) WHERE state IN ('received', 'failed', 'processing', 'parked');
CREATE INDEX whatsapp_events_line_idx ON platform.whatsapp_events (line_id, received_at);
CREATE TRIGGER whatsapp_events_touch_updated_at BEFORE UPDATE ON platform.whatsapp_events FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.whatsapp_events TO hms_app;

-- message id -> line and hotel, nothing else. Meta's reply context carries a message id; this finds the hotel that sent or received it without asking every hotel. Deleted after 30 days.
CREATE TABLE platform.whatsapp_message_index (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  line_id uuid NOT NULL REFERENCES platform.whatsapp_lines (id) ON DELETE CASCADE,
  wamid varchar(200) NOT NULL,
  -- NULL for a platform thread
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_message_index_key ON platform.whatsapp_message_index (line_id, wamid);
CREATE INDEX whatsapp_message_index_hotel_idx ON platform.whatsapp_message_index (hotel_id);
CREATE INDEX whatsapp_message_index_created_idx ON platform.whatsapp_message_index (created_at);
CREATE TRIGGER whatsapp_message_index_touch_updated_at BEFORE UPDATE ON platform.whatsapp_message_index FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.whatsapp_message_index TO hms_app;

-- numbers that must never receive automatic or marketing messages. The number is a keyed hash; hotel_id NULL = the whole platform.
CREATE TABLE platform.whatsapp_suppressions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  number_hash bytea NOT NULL CHECK (octet_length(number_hash) = 32),
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('stop', 'stop_all', 'complaint', 'blocked', 'invalid')),
  created_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_suppressions_platform_key ON platform.whatsapp_suppressions (number_hash) WHERE hotel_id IS NULL;
CREATE UNIQUE INDEX whatsapp_suppressions_hotel_key ON platform.whatsapp_suppressions (number_hash, hotel_id) WHERE hotel_id IS NOT NULL;
CREATE INDEX whatsapp_suppressions_hotel_idx ON platform.whatsapp_suppressions (hotel_id);
CREATE INDEX whatsapp_suppressions_created_by_idx ON platform.whatsapp_suppressions (created_by);
CREATE TRIGGER whatsapp_suppressions_touch_updated_at BEFORE UPDATE ON platform.whatsapp_suppressions FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.whatsapp_suppressions TO hms_app;

-- when this guest last wrote to a hotel on WhatsApp and when a hotel last wrote to them: the "who is active" input of the routing rules
ALTER TABLE platform.guest_hotels ADD COLUMN wa_last_out_at timestamptz, ADD COLUMN wa_last_in_at timestamptz;

-- settings: WhatsApp is OFF until the owner turns it on for the pilot. Values are JSON; the switch profiles (plan part 6) start as the plan's table.
INSERT INTO platform.platform_settings (key, value) VALUES
  ('whatsapp.enabled', 'false'),
  ('whatsapp.routing_timeframe_minutes', '120'),
  ('whatsapp.default_daily_cap', '50'),
  ('whatsapp.hold_minutes', '10'),
  ('whatsapp.routing_mode', '"strict"'),
  ('whatsapp.transition_days', '30'),
  ('whatsapp.rules.shared', '{"hotel_may_start_chats":false,"recipients_stay_guests_only":true,"templates_only_for_new_messages":true,"marketing_allowed":false,"consent_required_for_automatic":true,"hotel_label_on_messages":true,"wrong_hotel_button":true,"automatic_messages_one_way":true,"platform_blocklist_enabled":true}'),
  ('whatsapp.rules.platform', '{"hotel_may_start_chats":true,"recipients_stay_guests_only":false,"templates_only_for_new_messages":true,"marketing_allowed":false,"hotel_label_on_messages":false,"platform_blocklist_enabled":true}'),
  ('whatsapp.rules.own_default', '{"hotel_may_start_chats":true,"recipients_stay_guests_only":false,"templates_only_for_new_messages":true,"marketing_allowed":false,"consent_required_for_automatic":true,"hotel_label_on_messages":false,"automatic_messages_one_way":false,"platform_blocklist_enabled":true}')
ON CONFLICT (key) DO NOTHING;
