-- rollback: DROP TABLE IF EXISTS platform.group_mail;
-- A group's own mail accounts (MJ, 1 Nov 2026), set by the Super Admin: an Amazon SES login and a Google (Gmail) login for ONE group, the same shape as platform.hotel_mail (0161).
-- The order of use for a hotel's mail is: the hotel's own SES, its own Google, then its group's SES, the group's Google, then the platform's SES and the platform's Google backup. A group
-- with no row (or an empty one) is skipped. The two passwords are sealed (v1.<...>) with the mail key, bound to the group, and never returned by any API.
CREATE TABLE platform.group_mail (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL UNIQUE REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  ses_region text CHECK (ses_region IS NULL OR ses_region ~ '^[a-z]{2}(-[a-z]+)+-[0-9]$'),
  ses_user text CHECK (ses_user IS NULL OR char_length(ses_user) BETWEEN 1 AND 254),
  ses_password text,
  ses_from text CHECK (ses_from IS NULL OR char_length(ses_from) BETWEEN 3 AND 254),
  gmail_user text CHECK (gmail_user IS NULL OR char_length(gmail_user) BETWEEN 3 AND 254),
  gmail_password text,
  from_name text CHECK (from_name IS NULL OR char_length(from_name) BETWEEN 1 AND 100),
  reply_to text CHECK (reply_to IS NULL OR char_length(reply_to) BETWEEN 3 AND 254),
  ses_test jsonb,
  gmail_test jsonb,
  updated_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_mail_updated_by_idx ON platform.group_mail (updated_by);
CREATE TRIGGER group_mail_touch BEFORE UPDATE ON platform.group_mail FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.group_mail TO hms_app;
