-- rollback: DROP TABLE IF EXISTS conv_quick_replies, conv_notes, conv_messages, conv_conversations, conv_contact_handles, conv_contacts, conv_mail_positions; DROP INDEX IF EXISTS customers_email_lower_idx, customers_mobile_last10_idx, pms_stays_email_lower_idx, pms_stays_mobile_last10_idx, pms_reservations_email_lower_idx, pms_reservations_mobile_last10_idx, company_profiles_email_lower_idx;
-- Conversations (decision 66; docs/plans/CONVERSATIONS-PLAN-2026-10-24.md): one inbox where the hotel's email and WhatsApp messages arrive together, one thread per person.
--   conv_contacts          one person (an email address and/or a phone number), with its link to a guest, a stay or a company (automatic only for a sender the mail server verified)
--   conv_contact_handles   the person's addresses (lower case) and numbers (digits with the country code; a bare 10-digit Indian mobile gets 91); matching uses the last 10 digits
--   conv_conversations     one per contact: open/done, main list or Other (bulk and automated mail), who it is assigned to, the newest message, the shared unread count
--   conv_messages          C3: only a LIST ENTRY per email (sender, recipients, subject, date, a short preview, the message ids, the IMAP UID), never the body or the attachments;
--                          the full email is read from the mailbox when it is opened. Mail HMS itself sends (bills, receipts, codes, the daily summary) and account-security
--                          mail are never listed (A10, A11). The wa_* columns exist for the WhatsApp design and stay empty until the Meta integration.
--   conv_notes             staff notes the guest never sees
--   conv_quick_replies     canned replies
--   conv_mail_positions    where the last mail check stopped in Inbox and Sent (the IMAP UID), and the lease that keeps two checks from running at once
-- Retention (C5): the messages are removed after 12 months by the daily purge, with conversations and contacts left empty, whatever the reading switch says.
-- These tables are skipped by the hotel data export, by the backups (pg_dump --exclude-table-data=*.conv_*) and by the idempotency store: nothing personal leaves in plain form.

-- hard-delete: purge job conversations-retention (a contact left without a conversation) and "Remove link"
CREATE TABLE conv_contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  display_name varchar(160),
  customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  stay_id uuid REFERENCES pms_stays (id) ON DELETE SET NULL,
  -- a booking not yet checked in (the contract's "reservation" link)
  reservation_id uuid REFERENCES pms_reservations (id) ON DELETE SET NULL,
  company_id uuid REFERENCES company_profiles (id) ON DELETE SET NULL,
  link_source text CHECK (link_source IN ('auto', 'manual')),
  linked_by uuid,
  linked_at timestamptz,
  -- "Always move this sender to Other"
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- one direction only: a link always says how it was made, but a deleted guest, stay or company (ON DELETE SET NULL) leaves a stale link_source, which reads as "not linked"
  CONSTRAINT conv_contacts_link_check CHECK (link_source IS NOT NULL OR (customer_id IS NULL AND stay_id IS NULL AND reservation_id IS NULL AND company_id IS NULL))
);
CREATE UNIQUE INDEX conv_contacts_legacy_id_key ON conv_contacts (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX conv_contacts_customer_id_idx ON conv_contacts (customer_id);
CREATE INDEX conv_contacts_stay_id_idx ON conv_contacts (stay_id);
CREATE INDEX conv_contacts_reservation_id_idx ON conv_contacts (reservation_id);
CREATE INDEX conv_contacts_company_id_idx ON conv_contacts (company_id);
CREATE TRIGGER conv_contacts_touch_updated_at BEFORE UPDATE ON conv_contacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job conversations-retention (with its contact)
CREATE TABLE conv_contact_handles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  contact_id uuid NOT NULL REFERENCES conv_contacts (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  value varchar(254) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conv_contact_handles_value_check CHECK ((kind = 'email' AND value = lower(value) AND value ~ '^[^\s@]+@[^\s@]+$') OR (kind = 'phone' AND value ~ '^[0-9]{8,15}$'))
);
CREATE UNIQUE INDEX conv_contact_handles_legacy_id_key ON conv_contact_handles (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_contact_handles_kind_value_key ON conv_contact_handles (kind, value);
CREATE INDEX conv_contact_handles_contact_id_idx ON conv_contact_handles (contact_id);
CREATE TRIGGER conv_contact_handles_touch_updated_at BEFORE UPDATE ON conv_contact_handles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job conversations-retention (no message left in 12 months)
CREATE TABLE conv_conversations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  contact_id uuid NOT NULL REFERENCES conv_contacts (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  -- other = bulk and automated mail (newsletters, notices), kept out of the main list (A11)
  box text NOT NULL DEFAULT 'main' CHECK (box IN ('main', 'other')),
  -- platform user ids (no foreign key across schemas)
  assigned_to uuid,
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
CREATE UNIQUE INDEX conv_conversations_legacy_id_key ON conv_conversations (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_conversations_contact_id_key ON conv_conversations (contact_id);
CREATE INDEX conv_conversations_last_message_at_idx ON conv_conversations (last_message_at DESC);
CREATE INDEX conv_conversations_assigned_to_idx ON conv_conversations (assigned_to);
CREATE TRIGGER conv_conversations_touch_updated_at BEFORE UPDATE ON conv_conversations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job conversations-retention (older than 12 months, C5)
CREATE TABLE conv_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  conversation_id uuid NOT NULL REFERENCES conv_conversations (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  status text NOT NULL CHECK (status IN ('pending', 'received', 'sent', 'delivered', 'read', 'failed')),
  -- email: the validated Message-ID, else "uid:<folder>:<uidvalidity>:<uid>"; WhatsApp: the wamid
  external_id varchar(998) NOT NULL,
  sent_at timestamptz NOT NULL,
  sent_by uuid,
  sent_from text NOT NULL CHECK (sent_from IN ('contact', 'hms', 'mailbox', 'phone', 'auto')),
  -- email inbound: the receiving server's verdict on the sender (A12); NULL for outbound and WhatsApp
  sender_verified boolean,
  failure_code varchar(40) CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z_]{1,40}$'),
  preview varchar(240),
  -- the mailbox address this row was read from or sent by: an email of an earlier address is not opened
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
  -- an HMS reply that carried a bill PDF (opening it needs the Bills permission)
  has_bill boolean NOT NULL DEFAULT false,
  wa_type text CHECK (wa_type IN ('text', 'image', 'video', 'document', 'audio', 'sticker', 'location', 'contacts', 'template', 'unsupported')),
  wa_text varchar(4096),
  wa_media jsonb CHECK (wa_media IS NULL OR jsonb_typeof(wa_media) = 'object'),
  -- the wamid this message replies to
  wa_context_id varchar(200),
  wa_reactions jsonb CHECK (wa_reactions IS NULL OR jsonb_typeof(wa_reactions) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conv_messages_channel_fields CHECK ((channel = 'whatsapp') = (wa_type IS NOT NULL))
);
CREATE UNIQUE INDEX conv_messages_legacy_id_key ON conv_messages (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_messages_channel_external_id_key ON conv_messages (channel, external_id);
CREATE INDEX conv_messages_conversation_id_sent_at_idx ON conv_messages (conversation_id, sent_at DESC);
CREATE INDEX conv_messages_sent_at_idx ON conv_messages (sent_at);
CREATE TRIGGER conv_messages_touch_updated_at BEFORE UPDATE ON conv_messages FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job conversations-retention (with its conversation); a note is also removed by its author or the Hotel Admin
CREATE TABLE conv_notes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  conversation_id uuid NOT NULL REFERENCES conv_conversations (id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conv_notes_legacy_id_key ON conv_notes (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX conv_notes_conversation_id_idx ON conv_notes (conversation_id);
CREATE TRIGGER conv_notes_touch_updated_at BEFORE UPDATE ON conv_notes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job conversations-quick-replies (a quick reply is removed on the Quick replies page)
CREATE TABLE conv_quick_replies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  title varchar(80) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  body varchar(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  channel text NOT NULL DEFAULT 'any' CHECK (channel IN ('any', 'email', 'whatsapp')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conv_quick_replies_legacy_id_key ON conv_quick_replies (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_quick_replies_title_key ON conv_quick_replies (lower(title));
CREATE TRIGGER conv_quick_replies_touch_updated_at BEFORE UPDATE ON conv_quick_replies FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job conversations-positions (the positions are reset when the mailbox address changes)
CREATE TABLE conv_mail_positions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
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
CREATE UNIQUE INDEX conv_mail_positions_legacy_id_key ON conv_mail_positions (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX conv_mail_positions_folder_key ON conv_mail_positions (folder);
CREATE TRIGGER conv_mail_positions_touch_updated_at BEFORE UPDATE ON conv_mail_positions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- matching an address or a number to a guest on every mail check (the same expressions as repos/postgres/conversations.ts)
CREATE INDEX customers_email_lower_idx ON customers (lower(btrim(email))) WHERE email IS NOT NULL;
CREATE INDEX customers_mobile_last10_idx ON customers (right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10));
CREATE INDEX pms_stays_email_lower_idx ON pms_stays (lower(btrim(email))) WHERE email IS NOT NULL;
CREATE INDEX pms_stays_mobile_last10_idx ON pms_stays (right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10)) WHERE mobile IS NOT NULL;
CREATE INDEX pms_reservations_email_lower_idx ON pms_reservations (lower(btrim(email))) WHERE email IS NOT NULL;
CREATE INDEX pms_reservations_mobile_last10_idx ON pms_reservations (right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10)) WHERE mobile IS NOT NULL;
CREATE INDEX company_profiles_email_lower_idx ON company_profiles (lower(btrim(email))) WHERE email IS NOT NULL;
