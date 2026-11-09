-- rollback: DELETE FROM platform.role_permissions WHERE permission_id IN (SELECT id FROM platform.permissions WHERE key = 'conversations'); DELETE FROM platform.permissions WHERE key = 'conversations'; DROP TABLE IF EXISTS platform.conv_quick_replies, platform.conv_notes, platform.conv_messages, platform.conv_conversations, platform.conv_contact_handles, platform.conv_contacts, platform.conv_mail_positions, platform.conv_channel_accounts;
-- Conversations (decision 66; docs/plans/CONVERSATIONS-PLAN-2026-10-24.md), the platform side:
--   conv_channel_accounts  the platform's own mailbox and WhatsApp number (hotel_id NULL: the reading switch and the IMAP server; the login and the sealed password stay in
--                          Platform settings > Mail) and one REGISTRY row per hotel (hotel_id set): whether the hotel reads its mailbox, when it was last checked and purged.
--                          A hotel's row is made when it first saves Settings > Email with reading on, or when the daily purge first visits it; it is never deleted when
--                          reading is switched off (status 'off'), so the 12-month purge keeps running. No message content here.
--   conv_mail_positions    where the platform mailbox's last check stopped in Inbox and Sent
--   conv_contacts ... conv_quick_replies
--                          the platform's own hub (Super Admin and Platform Admin: hotel owners and staff who write to the platform), the same shapes as a hotel's
--                          (hotel migration 0050); a contact links to a platform user or a hotel. Only a list entry per email (C3), never the body or the attachments.
-- The permission "conversations" (module, View and Edit) for the hotels' roles: on a live database the two built-in roles Admin and SuperAdmin get Edit here; a fresh database
-- runs its seeds after every migration, so seed 0003_hms_permissions does the same there. Viewer and Editor get nothing by default.
-- Retention 12 months (C5); skipped by backups (pg_dump --exclude-table-data=*.conv_*) and by the idempotency store.

-- hard-delete: a registry row goes with its hotel (ON DELETE CASCADE); the platform rows are never deleted
CREATE TABLE platform.conv_channel_accounts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status text NOT NULL DEFAULT 'off' CHECK (status IN ('off', 'on')),
  imap_host varchar(253) CHECK (imap_host IS NULL OR imap_host ~ '^[A-Za-z0-9.-]{1,253}$'),
  imap_port integer CHECK (imap_port IN (993, 143)),
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_purged_at timestamptz,
  last_error varchar(40) CHECK (last_error IS NULL OR last_error ~ '^[A-Z_]{1,40}$'),
  updated_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conv_channel_accounts_imap_platform_only CHECK (hotel_id IS NULL OR (imap_host IS NULL AND imap_port IS NULL))
);
CREATE UNIQUE INDEX conv_channel_accounts_owner_channel_key ON platform.conv_channel_accounts (COALESCE(hotel_id, '00000000-0000-0000-0000-000000000000'::uuid), channel);
CREATE INDEX conv_channel_accounts_hotel_id_idx ON platform.conv_channel_accounts (hotel_id);
CREATE INDEX conv_channel_accounts_updated_by_idx ON platform.conv_channel_accounts (updated_by);
CREATE INDEX conv_channel_accounts_due_sync_idx ON platform.conv_channel_accounts (channel, last_checked_at) WHERE status = 'on';
CREATE INDEX conv_channel_accounts_due_purge_idx ON platform.conv_channel_accounts (channel, last_purged_at);
CREATE TRIGGER conv_channel_accounts_touch_updated_at BEFORE UPDATE ON platform.conv_channel_accounts FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: the positions are reset when the platform mailbox address changes
CREATE TABLE platform.conv_mail_positions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
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
CREATE UNIQUE INDEX conv_mail_positions_folder_key ON platform.conv_mail_positions (folder);
CREATE TRIGGER conv_mail_positions_touch_updated_at BEFORE UPDATE ON platform.conv_mail_positions FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (a contact left without a conversation) and "Remove link"
CREATE TABLE platform.conv_contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  display_name varchar(160),
  user_id uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE SET NULL,
  link_source text CHECK (link_source IN ('auto', 'manual')),
  linked_by uuid,
  linked_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- one direction only: a deleted account or hotel (ON DELETE SET NULL) leaves a stale link_source, which reads as "not linked"
  CONSTRAINT conv_contacts_link_check CHECK (link_source IS NOT NULL OR (user_id IS NULL AND hotel_id IS NULL))
);
CREATE UNIQUE INDEX conv_contacts_legacy_id_key ON platform.conv_contacts (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX conv_contacts_user_id_idx ON platform.conv_contacts (user_id);
CREATE INDEX conv_contacts_hotel_id_idx ON platform.conv_contacts (hotel_id);
CREATE TRIGGER conv_contacts_touch_updated_at BEFORE UPDATE ON platform.conv_contacts FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (with its contact)
CREATE TABLE platform.conv_contact_handles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  contact_id uuid NOT NULL REFERENCES platform.conv_contacts (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  value varchar(254) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conv_contact_handles_value_check CHECK ((kind = 'email' AND value = lower(value) AND value ~ '^[^\s@]+@[^\s@]+$') OR (kind = 'phone' AND value ~ '^[0-9]{8,15}$'))
);
CREATE UNIQUE INDEX conv_contact_handles_legacy_id_key ON platform.conv_contact_handles (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_contact_handles_kind_value_key ON platform.conv_contact_handles (kind, value);
CREATE INDEX conv_contact_handles_contact_id_idx ON platform.conv_contact_handles (contact_id);
CREATE TRIGGER conv_contact_handles_touch_updated_at BEFORE UPDATE ON platform.conv_contact_handles FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (no message left in 12 months)
CREATE TABLE platform.conv_conversations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  contact_id uuid NOT NULL REFERENCES platform.conv_contacts (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  box text NOT NULL DEFAULT 'main' CHECK (box IN ('main', 'other')),
  assigned_to uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  assigned_by uuid,
  assigned_at timestamptz,
  last_message_at timestamptz NOT NULL,
  last_channel text NOT NULL CHECK (last_channel IN ('email', 'whatsapp')),
  last_direction text NOT NULL CHECK (last_direction IN ('in', 'out')),
  last_inbound_at timestamptz,
  channels text[] NOT NULL DEFAULT '{}' CHECK (channels <@ ARRAY['email', 'whatsapp']::text[]),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count BETWEEN 0 AND 100000),
  wa_window_closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conv_conversations_legacy_id_key ON platform.conv_conversations (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_conversations_contact_id_key ON platform.conv_conversations (contact_id);
CREATE INDEX conv_conversations_last_message_at_idx ON platform.conv_conversations (last_message_at DESC);
CREATE INDEX conv_conversations_assigned_to_idx ON platform.conv_conversations (assigned_to);
CREATE TRIGGER conv_conversations_touch_updated_at BEFORE UPDATE ON platform.conv_conversations FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (older than 12 months, C5)
CREATE TABLE platform.conv_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  conversation_id uuid NOT NULL REFERENCES platform.conv_conversations (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  status text NOT NULL CHECK (status IN ('pending', 'received', 'sent', 'delivered', 'read', 'failed')),
  external_id varchar(998) NOT NULL,
  sent_at timestamptz NOT NULL,
  sent_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
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
CREATE UNIQUE INDEX conv_messages_legacy_id_key ON platform.conv_messages (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_messages_channel_external_id_key ON platform.conv_messages (channel, external_id);
CREATE INDEX conv_messages_conversation_id_sent_at_idx ON platform.conv_messages (conversation_id, sent_at DESC);
CREATE INDEX conv_messages_sent_at_idx ON platform.conv_messages (sent_at);
CREATE INDEX conv_messages_sent_by_idx ON platform.conv_messages (sent_by);
CREATE TRIGGER conv_messages_touch_updated_at BEFORE UPDATE ON platform.conv_messages FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: purge job conversations-retention (with its conversation); a note is also removed by its author
CREATE TABLE platform.conv_notes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  conversation_id uuid NOT NULL REFERENCES platform.conv_conversations (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conv_notes_legacy_id_key ON platform.conv_notes (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX conv_notes_conversation_id_idx ON platform.conv_notes (conversation_id);
CREATE INDEX conv_notes_author_id_idx ON platform.conv_notes (author_id);
CREATE TRIGGER conv_notes_touch_updated_at BEFORE UPDATE ON platform.conv_notes FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- hard-delete: a quick reply is removed on the Quick replies page
CREATE TABLE platform.conv_quick_replies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  title varchar(80) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  channel text NOT NULL DEFAULT 'any' CHECK (channel IN ('any', 'email', 'whatsapp')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conv_quick_replies_legacy_id_key ON platform.conv_quick_replies (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_quick_replies_title_key ON platform.conv_quick_replies (lower(title));
CREATE INDEX conv_quick_replies_created_by_idx ON platform.conv_quick_replies (created_by);
CREATE TRIGGER conv_quick_replies_touch_updated_at BEFORE UPDATE ON platform.conv_quick_replies FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.conv_channel_accounts, platform.conv_mail_positions, platform.conv_contacts, platform.conv_contact_handles, platform.conv_conversations, platform.conv_messages, platform.conv_notes, platform.conv_quick_replies TO hms_app;

-- the platform's own mailbox and number, both off until the Super Admin or a Platform Admin switches reading on (Console > Conversations > Settings)
INSERT INTO platform.conv_channel_accounts (hotel_id, channel, status) VALUES (NULL, 'email', 'off'), (NULL, 'whatsapp', 'off') ON CONFLICT DO NOTHING;

-- the permission: Front Office group, after Website; the built-in Admin and SuperAdmin roles get Edit (a fresh database: seed 0003_hms_permissions)
INSERT INTO platform.permissions (key, kind, label, about, group_name, section, icon, sensitive, sort_order)
VALUES ('conversations', 'module', 'Conversations', 'Email and WhatsApp messages in one inbox: read (View), reply, assign and add notes (Edit).', 'Front Office', NULL, 'bi-chat-left-text', false, 450)
ON CONFLICT (key) DO NOTHING;
INSERT INTO platform.role_permissions (role_id, permission_id, level)
SELECT r.id, p.id, 'edit' FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.hotel_id IS NULL AND r.key IN ('super_admin', 'admin') AND p.key = 'conversations'
ON CONFLICT (role_id, permission_id) DO NOTHING;
