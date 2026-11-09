-- rollback: DROP TABLE IF EXISTS platform.conv_mail_sources;
-- The whole email of the PLATFORM's own inbox (MJ, 2 Nov 2026: the desks sales@ and support@). Mail to sales@ or support@ at the platform's sending domain reaches HMS through
-- Amazon SES receiving, not through the platform mailbox, so there is no mailbox to read its body from: the message itself is kept here, the full source (headers, text, HTML and
-- attachments) exactly as received, as a hotel keeps it (hotel 0053) and a group keeps it (platform 0166, group_conv_mail_sources). The platform hub's other tables are 0139/0163.
--   One row per message; it goes with its message (ON DELETE CASCADE), so the 12-month purge (C5) removes it too.
--   Like every conv_* table it stays out of the backups' table data (pg_dump --exclude-table-data=*.conv_*).
--   1 MB at most per message (Amazon SES hands over 150 KB at most).

-- hard-delete: purge job conversations-retention (with its message)
CREATE TABLE platform.conv_mail_sources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  message_id uuid NOT NULL UNIQUE REFERENCES platform.conv_messages (id) ON DELETE CASCADE,
  source bytea NOT NULL CHECK (octet_length(source) BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conv_mail_sources_legacy_id_key ON platform.conv_mail_sources (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER conv_mail_sources_touch_updated_at BEFORE UPDATE ON platform.conv_mail_sources FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.conv_mail_sources TO hms_app;
