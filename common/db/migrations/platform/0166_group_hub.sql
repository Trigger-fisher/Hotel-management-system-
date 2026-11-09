-- rollback: DROP TABLE IF EXISTS platform.group_conv_logs, platform.group_conv_mail_positions, platform.group_conv_quick_replies, platform.group_conv_notes, platform.group_conv_mail_sources, platform.group_conv_messages, platform.group_conv_conversations, platform.group_conv_contact_handles, platform.group_conv_contacts; DROP FUNCTION IF EXISTS platform.conv_group_id();
-- A group's own inbox (MJ, 2 Nov 2026: "group's own inbox"): mail to <group slug without dashes>@<the platform sending domain> arrives here, kept whole, and the Group Admin reads, writes and
-- replies from the group console's Email page. The same tables as a hotel's or the platform's Conversations hub (hotel 0050/0052/0053, platform 0139/0163), so the one conversations
-- repository and service serve them (tables platform.group_conv_*), every row carrying its group:
--   - group_id is filled from the transaction's setting hms.group_id (set by the app for the group of the signed-in Group Admin, or of the mail's address); a row without it is refused;
--   - row level security (forced, also for the owner) shows and changes only the rows of THAT group: one group never reads another's mail, whatever the query;
--   - the natural keys (an address, a Message-ID, a folder, a quick reply's title) are unique per group.
-- Retention 12 months (C5); skipped by backups (pg_dump --exclude-table-data=*.conv_*). A group that is deleted takes its inbox with it (ON DELETE CASCADE).
-- the group of the current transaction (NULL when the app did not set it: nothing is visible and nothing can be written)
CREATE FUNCTION platform.conv_group_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('hms.group_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION platform.conv_group_id() TO hms_app;

-- hard-delete: purge job conversations-retention (a contact left without a conversation) and "Remove link"
CREATE TABLE platform.group_conv_contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  legacy_id bigint,
  display_name varchar(160),
  user_id uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE SET NULL,
  link_source text CHECK (link_source IN ('auto', 'manual')),
  linked_by uuid,
  linked_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conv_contacts_link_check CHECK (link_source IS NOT NULL OR (user_id IS NULL AND hotel_id IS NULL))
);
CREATE UNIQUE INDEX group_conv_contacts_legacy_id_key ON platform.group_conv_contacts (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX group_conv_contacts_group_id_idx ON platform.group_conv_contacts (group_id);
CREATE INDEX group_conv_contacts_user_id_idx ON platform.group_conv_contacts (user_id);
CREATE INDEX group_conv_contacts_hotel_id_idx ON platform.group_conv_contacts (hotel_id);
CREATE TRIGGER group_conv_contacts_touch_updated_at BEFORE UPDATE ON platform.group_conv_contacts FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (with its contact)
CREATE TABLE platform.group_conv_contact_handles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  legacy_id bigint,
  contact_id uuid NOT NULL REFERENCES platform.group_conv_contacts (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  value varchar(254) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conv_contact_handles_value_check CHECK ((kind = 'email' AND value = lower(value) AND value ~ '^[^\s@]+@[^\s@]+$') OR (kind = 'phone' AND value ~ '^[0-9]{8,15}$'))
);
CREATE UNIQUE INDEX group_conv_contact_handles_legacy_id_key ON platform.group_conv_contact_handles (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX group_conv_contact_handles_kind_value_key ON platform.group_conv_contact_handles (group_id, kind, value);
CREATE INDEX group_conv_contact_handles_contact_id_idx ON platform.group_conv_contact_handles (contact_id);
CREATE TRIGGER group_conv_contact_handles_touch_updated_at BEFORE UPDATE ON platform.group_conv_contact_handles FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (no message left in 12 months)
CREATE TABLE platform.group_conv_conversations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  legacy_id bigint,
  contact_id uuid NOT NULL REFERENCES platform.group_conv_contacts (id) ON DELETE CASCADE,
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
CREATE UNIQUE INDEX group_conv_conversations_legacy_id_key ON platform.group_conv_conversations (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX group_conv_conversations_contact_id_key ON platform.group_conv_conversations (contact_id);
CREATE INDEX group_conv_conversations_group_id_last_message_at_idx ON platform.group_conv_conversations (group_id, last_message_at DESC);
CREATE INDEX group_conv_conversations_assigned_to_idx ON platform.group_conv_conversations (assigned_to);
CREATE TRIGGER group_conv_conversations_touch_updated_at BEFORE UPDATE ON platform.group_conv_conversations FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (older than 12 months, C5)
CREATE TABLE platform.group_conv_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  legacy_id bigint,
  conversation_id uuid NOT NULL REFERENCES platform.group_conv_conversations (id) ON DELETE CASCADE,
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
  CONSTRAINT conv_messages_channel_fields CHECK ((channel = 'whatsapp') = (wa_type IS NOT NULL))
);
CREATE UNIQUE INDEX group_conv_messages_legacy_id_key ON platform.group_conv_messages (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX group_conv_messages_channel_external_id_key ON platform.group_conv_messages (group_id, channel, external_id);
CREATE INDEX group_conv_messages_conversation_id_sent_at_idx ON platform.group_conv_messages (conversation_id, sent_at DESC);
CREATE INDEX group_conv_messages_sent_at_idx ON platform.group_conv_messages (sent_at);
CREATE INDEX group_conv_messages_sent_by_idx ON platform.group_conv_messages (sent_by);
CREATE TRIGGER group_conv_messages_touch_updated_at BEFORE UPDATE ON platform.group_conv_messages FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (with its message)
CREATE TABLE platform.group_conv_mail_sources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  legacy_id bigint,
  message_id uuid NOT NULL UNIQUE REFERENCES platform.group_conv_messages (id) ON DELETE CASCADE,
  source bytea NOT NULL CHECK (octet_length(source) BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_conv_mail_sources_legacy_id_key ON platform.group_conv_mail_sources (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX group_conv_mail_sources_group_id_idx ON platform.group_conv_mail_sources (group_id);
CREATE TRIGGER group_conv_mail_sources_touch_updated_at BEFORE UPDATE ON platform.group_conv_mail_sources FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (with its conversation); a note is also removed by its author
CREATE TABLE platform.group_conv_notes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  legacy_id bigint,
  conversation_id uuid NOT NULL REFERENCES platform.group_conv_conversations (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_conv_notes_legacy_id_key ON platform.group_conv_notes (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX group_conv_notes_group_id_idx ON platform.group_conv_notes (group_id);
CREATE INDEX group_conv_notes_conversation_id_idx ON platform.group_conv_notes (conversation_id);
CREATE INDEX group_conv_notes_author_id_idx ON platform.group_conv_notes (author_id);
CREATE TRIGGER group_conv_notes_touch_updated_at BEFORE UPDATE ON platform.group_conv_notes FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: a quick reply is removed on the Quick replies page
CREATE TABLE platform.group_conv_quick_replies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  legacy_id bigint,
  title varchar(80) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  channel text NOT NULL DEFAULT 'any' CHECK (channel IN ('any', 'email', 'whatsapp')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_conv_quick_replies_legacy_id_key ON platform.group_conv_quick_replies (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX group_conv_quick_replies_title_key ON platform.group_conv_quick_replies (group_id, lower(title));
CREATE INDEX group_conv_quick_replies_created_by_idx ON platform.group_conv_quick_replies (created_by);
CREATE TRIGGER group_conv_quick_replies_touch_updated_at BEFORE UPDATE ON platform.group_conv_quick_replies FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- where a mailbox check stopped (a group has no mailbox to read today; the shared repository keeps the table)
CREATE TABLE platform.group_conv_mail_positions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
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
CREATE UNIQUE INDEX group_conv_mail_positions_folder_key ON platform.group_conv_mail_positions (group_id, folder);
CREATE TRIGGER group_conv_mail_positions_touch_updated_at BEFORE UPDATE ON platform.group_conv_mail_positions FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- What was done in the group's inbox (who, when, fixed words; never a word of the mail); it goes with its group.
CREATE TABLE platform.group_conv_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL DEFAULT platform.conv_group_id() REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
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
CREATE INDEX group_conv_logs_group_id_created_at_idx ON platform.group_conv_logs (group_id, created_at DESC);
CREATE TRIGGER group_conv_logs_touch_updated_at BEFORE UPDATE ON platform.group_conv_logs FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- one group sees and changes only its own rows: every table, every command, the owner too
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['group_conv_contacts', 'group_conv_contact_handles', 'group_conv_conversations', 'group_conv_messages', 'group_conv_mail_sources', 'group_conv_notes', 'group_conv_quick_replies', 'group_conv_mail_positions', 'group_conv_logs'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON platform.%I USING (group_id = platform.conv_group_id()) WITH CHECK (group_id = platform.conv_group_id())', t || '_own_group', t);
  END LOOP;
END
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.group_conv_contacts, platform.group_conv_contact_handles, platform.group_conv_conversations, platform.group_conv_messages, platform.group_conv_mail_sources,
  platform.group_conv_notes, platform.group_conv_quick_replies, platform.group_conv_mail_positions TO hms_app;
GRANT SELECT, INSERT ON platform.group_conv_logs TO hms_app;
