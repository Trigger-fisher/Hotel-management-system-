-- rollback: DROP TABLE IF EXISTS conv_mail_sources;
-- The whole email, kept in the hotel's own schema (MJ, 2 Nov 2026: "store full all data in the database, hotel wise, isolated"). Conversations first kept only a list entry per email
-- and read the body from the hotel's mailbox when it was opened (C3, 0050). Mail that reaches a hotel through Amazon SES receiving has no mailbox to read it from, and a reply sent through
-- the hotel's own mail (its SES address) is in no Sent folder, so the message itself is kept here: the full source (headers, text, HTML and attachments), exactly as received or sent.
--   One row per message; it goes with its message (ON DELETE CASCADE), so the 12-month purge (C5) removes it too.
--   Like every conv_* table it stays out of the hotel data export and of the backups' table data (pg_dump --exclude-table-data=*.conv_*).
--   1 MB at most per message (Amazon SES hands over 150 KB at most; a reply with a bill is under 10 MB of PDF only on the mailbox path, which keeps its copy in the mailbox).

-- hard-delete: with its message (purge job conversations-retention)
CREATE TABLE conv_mail_sources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  message_id uuid NOT NULL UNIQUE REFERENCES conv_messages (id) ON DELETE CASCADE,
  source bytea NOT NULL CHECK (octet_length(source) BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER conv_mail_sources_touch_updated_at BEFORE UPDATE ON conv_mail_sources FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
