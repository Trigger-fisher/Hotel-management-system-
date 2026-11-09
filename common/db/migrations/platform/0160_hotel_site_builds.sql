-- rollback: DROP TABLE IF EXISTS platform.hotel_site_builds;
-- The design (template) of a hotel's own website and what happened when it was applied (website-templates/docs/PLAN-CUSTOM-HOTEL-SITES.md).
-- One row each time a hotel (or the platform) picks a template: HMS starts the "Create hotel site" job, and the job reports back queued -> building -> live or failed.
-- created_at is when the design was asked for. The newest `live` row is the hotel's current design; older rows are the history (going back is picking an older template again).
-- At most ONE build per hotel may be queued or building at a time: the partial unique index below is the database's own guard against a double click or two admins.
-- The template key is a folder name under website-templates/templates (template-1 .. template-10, later a hotel's own custom one), so a new template needs no migration.
CREATE TABLE platform.hotel_site_builds (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'building', 'live', 'failed')),
  message text CHECK (message IS NULL OR char_length(message) <= 500),
  run_url text CHECK (run_url IS NULL OR (char_length(run_url) <= 500 AND run_url ~ '^https://')),
  site_url text CHECK (site_url IS NULL OR (char_length(site_url) <= 500 AND site_url ~ '^https://')),
  requested_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_site_builds_finished_when_final CHECK ((status IN ('live', 'failed')) = (finished_at IS NOT NULL))
);
CREATE INDEX hotel_site_builds_hotel_idx ON platform.hotel_site_builds (hotel_id, created_at DESC);
CREATE INDEX hotel_site_builds_requested_by_idx ON platform.hotel_site_builds (requested_by);
CREATE UNIQUE INDEX hotel_site_builds_one_active_idx ON platform.hotel_site_builds (hotel_id) WHERE status IN ('queued', 'building');
CREATE TRIGGER hotel_site_builds_touch BEFORE UPDATE ON platform.hotel_site_builds FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON platform.hotel_site_builds TO hms_app;
