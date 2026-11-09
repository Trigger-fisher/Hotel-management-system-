-- rollback: DROP TABLE IF EXISTS platform.announcement_reads; DROP TABLE IF EXISTS platform.announcements;
-- Platform announcements (MJ's plan, P4): a message the Super Admin writes once (maintenance tonight, a new feature) that every hotel admin, or everyone in
-- every hotel, sees on their dashboard until they dismiss it. One row per announcement; one row per person who dismissed it (created_at is when). An announcement ends by its
-- end time, or when the Super Admin ends it (ended_at); it is never deleted, so the audit log keeps its reference.
CREATE TABLE platform.announcements (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  title varchar(120) NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  audience text NOT NULL DEFAULT 'admins' CHECK (audience IN ('admins', 'everyone')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  ended_at timestamptz,
  created_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_ends_after_start CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX announcements_live_idx ON platform.announcements (starts_at) WHERE ended_at IS NULL;
CREATE INDEX announcements_created_by_idx ON platform.announcements (created_by);
CREATE TRIGGER announcements_touch BEFORE UPDATE ON platform.announcements FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.announcement_reads (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  announcement_id uuid NOT NULL REFERENCES platform.announcements (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX announcement_reads_user_idx ON platform.announcement_reads (user_id);
CREATE INDEX announcement_reads_announcement_idx ON platform.announcement_reads (announcement_id);
CREATE TRIGGER announcement_reads_touch BEFORE UPDATE ON platform.announcement_reads FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON platform.announcements TO hms_app;
GRANT SELECT, INSERT ON platform.announcement_reads TO hms_app;
