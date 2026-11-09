-- rollback: DROP TABLE IF EXISTS platform.pmail_conv_logs, platform.pmail_conv_mail_positions, platform.pmail_conv_quick_replies, platform.pmail_conv_notes, platform.pmail_conv_mail_sources, platform.pmail_conv_messages, platform.pmail_conv_conversations, platform.pmail_conv_contact_handles, platform.pmail_conv_contacts, platform.pmail_accounts; DROP FUNCTION IF EXISTS platform.pmail_keep_login_id(); DROP FUNCTION IF EXISTS platform.pmail_login_id();
-- A personal mailbox for the Super Admin and for each Platform Admin (MJ, 3 Nov 2026: "their own individual mailbox, isolated"). Each person connects ONE mailbox of their own (Gmail or any
-- IMAP/SMTP mailbox); only a list entry per email is kept here (12 months), the email itself is opened from the mailbox. The tables are the same shape as the group inbox (0166) so the one
-- conversations repository serves them (platform.pmail_conv_*), and every row carries its person:
--   - login_id is filled from the transaction's setting hms.pmail_login_id (set by the app from the signed-in session, never from a request); a row without it is refused;
--   - row level security, FORCED (also for the owner), shows and changes only the rows of THAT login: not the other admin, not another Super Admin, not a hotel or a group, whatever the query;
--   - an unset or empty setting shows NO rows; USING and WITH CHECK both need login_id = the setting; a trigger refuses any change of login_id;
--   - a person deleted from platform.logins takes their mailbox with them (ON DELETE CASCADE).
-- Retention 12 months (C5); skipped by backups like the other conv_ tables.
-- the login of the current transaction (NULL when the app did not set it, or set it empty: nothing is visible and nothing can be written)
CREATE FUNCTION platform.pmail_login_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('hms.pmail_login_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION platform.pmail_login_id() TO hms_app;

-- login_id is the row's owner for ever: no UPDATE may move a row to another person
CREATE FUNCTION platform.pmail_keep_login_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.login_id IS DISTINCT FROM OLD.login_id THEN
    RAISE EXCEPTION 'login_id of a personal mailbox row cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

-- hard-delete: "Remove my mailbox" (with every list entry of that person)
CREATE TABLE platform.pmail_accounts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() UNIQUE REFERENCES platform.logins (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gmail', 'smtp')),
  address varchar(254) NOT NULL CHECK (address = lower(address) AND address ~ '^[^\s@]+@[^\s@]+$'),
  username varchar(254) NOT NULL,
  -- the mailbox password, sealed with the server key and bound to this login (mail/smtp.ts sealSmtpSecret); never returned by any route
  secret text NOT NULL CHECK (secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  from_name varchar(160),
  smtp_host varchar(253) NOT NULL,
  smtp_port integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_security text NOT NULL CHECK (smtp_security IN ('starttls', 'ssl')),
  imap_host varchar(253) NOT NULL,
  imap_port integer NOT NULL CHECK (imap_port IN (993, 143)),
  status text NOT NULL DEFAULT 'on' CHECK (status IN ('on', 'off')),
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error varchar(40) CHECK (last_error IS NULL OR last_error ~ '^[A-Z_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER pmail_accounts_touch_updated_at BEFORE UPDATE ON platform.pmail_accounts FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_accounts_keep_login_id BEFORE UPDATE ON platform.pmail_accounts FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- hard-delete: purge (a contact left without a conversation) and "Remove my mailbox"
CREATE TABLE platform.pmail_conv_contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name varchar(160),
  user_id uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE SET NULL,
  link_source text CHECK (link_source IN ('auto', 'manual')),
  linked_by uuid,
  linked_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pmail_conv_contacts_link_check CHECK (link_source IS NOT NULL OR (user_id IS NULL AND hotel_id IS NULL))
);
CREATE INDEX pmail_conv_contacts_login_id_idx ON platform.pmail_conv_contacts (login_id);
CREATE INDEX pmail_conv_contacts_user_id_idx ON platform.pmail_conv_contacts (user_id);
CREATE INDEX pmail_conv_contacts_hotel_id_idx ON platform.pmail_conv_contacts (hotel_id);
CREATE TRIGGER pmail_conv_contacts_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_contacts FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_contacts_keep_login_id BEFORE UPDATE ON platform.pmail_conv_contacts FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

CREATE TABLE platform.pmail_conv_contact_handles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES platform.pmail_conv_contacts (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  value varchar(254) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pmail_conv_contact_handles_value_check CHECK ((kind = 'email' AND value = lower(value) AND value ~ '^[^\s@]+@[^\s@]+$') OR (kind = 'phone' AND value ~ '^[0-9]{8,15}$'))
);
CREATE UNIQUE INDEX pmail_conv_contact_handles_kind_value_key ON platform.pmail_conv_contact_handles (login_id, kind, value);
CREATE INDEX pmail_conv_contact_handles_contact_id_idx ON platform.pmail_conv_contact_handles (contact_id);
CREATE TRIGGER pmail_conv_contact_handles_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_contact_handles FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_contact_handles_keep_login_id BEFORE UPDATE ON platform.pmail_conv_contact_handles FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

CREATE TABLE platform.pmail_conv_conversations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES platform.pmail_conv_contacts (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  box text NOT NULL DEFAULT 'main' CHECK (box IN ('main', 'other')),
  assigned_to uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  assigned_by uuid,
  assigned_at timestamptz,
  last_message_at timestamptz NOT NULL,
  last_channel text NOT NULL CHECK (last_channel IN ('email', 'whatsapp')),
  last_direction text NOT NULL CHECK (last_direction IN ('in', 'out')),
  last_inbound_at timestamptz,
  channels text[] NOT NULL DEFAULT '{}' CHECK (channels <@ ARRAY['email', 'whatsapp']::text[]),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count BETWEEN 0 AND 100000),
  wa_window_closes_at timestamptz,
  starred boolean NOT NULL DEFAULT false,
  labels text[] NOT NULL DEFAULT '{}' CHECK (cardinality(labels) <= 10),
  snoozed_until timestamptz,
  trashed_at timestamptz,
  draft jsonb CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pmail_conv_conversations_contact_id_key ON platform.pmail_conv_conversations (contact_id);
CREATE INDEX pmail_conv_conversations_login_id_last_message_at_idx ON platform.pmail_conv_conversations (login_id, last_message_at DESC);
CREATE INDEX pmail_conv_conversations_assigned_to_idx ON platform.pmail_conv_conversations (assigned_to);
CREATE TRIGGER pmail_conv_conversations_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_conversations FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_conversations_keep_login_id BEFORE UPDATE ON platform.pmail_conv_conversations FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- hard-delete: purge (older than 12 months, C5)
CREATE TABLE platform.pmail_conv_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES platform.pmail_conv_conversations (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  status text NOT NULL CHECK (status IN ('pending', 'received', 'sent', 'delivered', 'read', 'failed')),
  external_id varchar(998) NOT NULL,
  sent_at timestamptz NOT NULL,
  sent_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  sent_from text NOT NULL CHECK (sent_from IN ('contact', 'hms', 'mailbox', 'phone', 'auto')),
  sender_verified boolean,
  failure_code varchar(40) CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z_]{1,40}$'),
  preview varchar(240),
  mail_box varchar(254),
  mail_folder text CHECK (mail_folder IN ('inbox', 'sent')),
  mail_uid bigint CHECK (mail_uid IS NULL OR mail_uid > 0),
  mail_uid_validity bigint,
  subject varchar(500),
  from_addr varchar(254),
  reply_to_addr varchar(254),
  to_addrs varchar(2000),
  cc_addrs varchar(2000),
  in_reply_to varchar(998),
  reference_ids varchar(4000),
  has_attachments boolean NOT NULL DEFAULT false,
  has_bill boolean NOT NULL DEFAULT false,
  wa_type text CHECK (wa_type IN ('text', 'image', 'video', 'document', 'audio', 'sticker', 'location', 'contacts', 'template', 'unsupported')),
  wa_text varchar(4096),
  wa_media jsonb CHECK (wa_media IS NULL OR jsonb_typeof(wa_media) = 'object'),
  wa_context_id varchar(200),
  wa_reactions jsonb CHECK (wa_reactions IS NULL OR jsonb_typeof(wa_reactions) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pmail_conv_messages_channel_fields CHECK ((channel = 'whatsapp') = (wa_type IS NOT NULL))
);
CREATE UNIQUE INDEX pmail_conv_messages_channel_external_id_key ON platform.pmail_conv_messages (login_id, channel, external_id);
CREATE INDEX pmail_conv_messages_conversation_id_sent_at_idx ON platform.pmail_conv_messages (conversation_id, sent_at DESC);
CREATE INDEX pmail_conv_messages_sent_at_idx ON platform.pmail_conv_messages (sent_at);
CREATE INDEX pmail_conv_messages_sent_by_idx ON platform.pmail_conv_messages (sent_by);
CREATE TRIGGER pmail_conv_messages_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_messages FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_messages_keep_login_id BEFORE UPDATE ON platform.pmail_conv_messages FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- hard-delete: purge (with its message): the copy of an email this person SENT (an email received is never stored, only opened from the mailbox)
CREATE TABLE platform.pmail_conv_mail_sources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  message_id uuid NOT NULL UNIQUE REFERENCES platform.pmail_conv_messages (id) ON DELETE CASCADE,
  source bytea NOT NULL CHECK (octet_length(source) BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pmail_conv_mail_sources_login_id_idx ON platform.pmail_conv_mail_sources (login_id);
CREATE TRIGGER pmail_conv_mail_sources_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_mail_sources FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_mail_sources_keep_login_id BEFORE UPDATE ON platform.pmail_conv_mail_sources FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- hard-delete: purge (with its conversation); a note is also removed by its author
CREATE TABLE platform.pmail_conv_notes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES platform.pmail_conv_conversations (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pmail_conv_notes_login_id_idx ON platform.pmail_conv_notes (login_id);
CREATE INDEX pmail_conv_notes_conversation_id_idx ON platform.pmail_conv_notes (conversation_id);
CREATE INDEX pmail_conv_notes_author_id_idx ON platform.pmail_conv_notes (author_id);
CREATE TRIGGER pmail_conv_notes_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_notes FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_notes_keep_login_id BEFORE UPDATE ON platform.pmail_conv_notes FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- hard-delete: a quick reply is removed on the Quick replies page
CREATE TABLE platform.pmail_conv_quick_replies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  title varchar(80) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  channel text NOT NULL DEFAULT 'any' CHECK (channel IN ('any', 'email', 'whatsapp')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pmail_conv_quick_replies_title_key ON platform.pmail_conv_quick_replies (login_id, lower(title));
CREATE INDEX pmail_conv_quick_replies_created_by_idx ON platform.pmail_conv_quick_replies (created_by);
CREATE TRIGGER pmail_conv_quick_replies_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_quick_replies FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_quick_replies_keep_login_id BEFORE UPDATE ON platform.pmail_conv_quick_replies FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- where a mailbox check stopped
CREATE TABLE platform.pmail_conv_mail_positions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  folder text NOT NULL CHECK (folder IN ('inbox', 'sent')),
  mailbox varchar(254) NOT NULL,
  uid_validity bigint,
  last_uid bigint NOT NULL DEFAULT 0 CHECK (last_uid >= 0),
  checked_at timestamptz,
  last_ok_at timestamptz,
  lease_until timestamptz,
  last_error varchar(40) CHECK (last_error IS NULL OR last_error ~ '^[A-Z_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pmail_conv_mail_positions_folder_key ON platform.pmail_conv_mail_positions (login_id, folder);
CREATE TRIGGER pmail_conv_mail_positions_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_mail_positions FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_mail_positions_keep_login_id BEFORE UPDATE ON platform.pmail_conv_mail_positions FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- What was done in the personal mailbox (who, when, fixed words; never a word of the mail); it goes with its person.
CREATE TABLE platform.pmail_conv_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL DEFAULT platform.pmail_login_id() REFERENCES platform.logins (id) ON DELETE CASCADE,
  action varchar(20) NOT NULL,
  summary varchar(300) NOT NULL,
  conversation_id uuid,
  user_id uuid,
  user_name varchar(160),
  ip_address varchar(64),
  trace_id varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pmail_conv_logs_login_id_created_at_idx ON platform.pmail_conv_logs (login_id, created_at DESC);
CREATE TRIGGER pmail_conv_logs_touch_updated_at BEFORE UPDATE ON platform.pmail_conv_logs FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER pmail_conv_logs_keep_login_id BEFORE UPDATE ON platform.pmail_conv_logs FOR EACH ROW EXECUTE FUNCTION platform.pmail_keep_login_id();

-- one person sees and changes only their own rows: every table, every command, the owner too
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pmail_accounts', 'pmail_conv_contacts', 'pmail_conv_contact_handles', 'pmail_conv_conversations', 'pmail_conv_messages', 'pmail_conv_mail_sources', 'pmail_conv_notes', 'pmail_conv_quick_replies', 'pmail_conv_mail_positions', 'pmail_conv_logs'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON platform.%I USING (login_id = platform.pmail_login_id()) WITH CHECK (login_id = platform.pmail_login_id())', t || '_own_login', t);
  END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pmail_accounts, platform.pmail_conv_contacts, platform.pmail_conv_contact_handles, platform.pmail_conv_conversations, platform.pmail_conv_messages,
  platform.pmail_conv_mail_sources, platform.pmail_conv_notes, platform.pmail_conv_quick_replies, platform.pmail_conv_mail_positions TO hms_app;
GRANT SELECT, INSERT ON platform.pmail_conv_logs TO hms_app;
