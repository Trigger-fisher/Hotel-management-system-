-- rollback: DROP TABLE IF EXISTS platform.hotel_backups;
-- Nightly backup copy per hotel (MJ's plan T6, 13 Oct 2026): the website itself copies every live hotel's records once a night (the Super Admin
-- export format, gzip NDJSON) into the private object store under "backups/<hotel id>/", through /api/v1/cron/backup (Vercel Cron, CRON_SECRET).
-- One row per run and hotel: a ready copy (file, size, checksum, tables and rows) or a failed one (a short step name, never hotel data).
-- Platform health reads the newest ready row as "Last backup"; the nightly run deletes the files and rows older than its retention
-- (14 daily copies, the Sunday copy for 8 weeks). Neon's own point-in-time history stays the first line of restore; this is the copy off Neon.
CREATE TABLE platform.hotel_backups (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('ready', 'failed')),
  -- e.g. "backup-2026-10-13-1a2b3c4d.ndjson.gz"
  file_name text CHECK (file_name ~ '^[a-z0-9][a-z0-9._-]{0,199}$'),
  -- where the copy is kept (private storage key, never a public URL)
  file_ref text CHECK (char_length(file_ref) BETWEEN 1 AND 500),
  byte_size bigint CHECK (byte_size >= 0),
  -- SHA-256 of the gzip file, so a later check can prove it is the same file
  file_sha256 text CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  table_count integer CHECK (table_count >= 0),
  row_count integer CHECK (row_count >= 0),
  -- a short step name when it failed (read, write, record); never data from the hotel
  error_code text CHECK (char_length(error_code) BETWEEN 1 AND 80),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_backups_ready_fields CHECK (status <> 'ready' OR (file_name IS NOT NULL AND file_ref IS NOT NULL AND file_sha256 IS NOT NULL AND byte_size IS NOT NULL)),
  CONSTRAINT hotel_backups_failed_fields CHECK (status <> 'failed' OR error_code IS NOT NULL)
);
CREATE INDEX hotel_backups_hotel_finished_idx ON platform.hotel_backups (hotel_id, finished_at DESC);
CREATE TRIGGER hotel_backups_touch BEFORE UPDATE ON platform.hotel_backups FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, DELETE ON platform.hotel_backups TO hms_app;
