-- rollback: ALTER TABLE pathik_sync DROP COLUMN IF EXISTS lease_until; ALTER TABLE pathik_sync DROP CONSTRAINT IF EXISTS pathik_sync_status_check; ALTER TABLE pathik_sync ADD CONSTRAINT pathik_sync_status_check CHECK (status IN ('pending', 'sent', 'failed', 'needs_staff', 'manual_done')); ALTER TABLE pathik_settings DROP COLUMN IF EXISTS worker_last_ok; ALTER TABLE pathik_settings DROP COLUMN IF EXISTS worker_note; ALTER TABLE pathik_settings DROP COLUMN IF EXISTS test_requested_at; ALTER TABLE pathik_settings DROP COLUMN IF EXISTS last_extra_count; ALTER TABLE pathik_lists DROP COLUMN IF EXISTS active;
-- Pathik phase 2 support (the worker talks to /api/v1/pathik-worker; docs/BACKEND.md section 15):
--   pathik_sync.lease_until: a claimed row is the worker's until then (5 minutes), so two workers never take the same row;
--   status 'void': a row whose stay was cancelled or changed before it was sent (it is never sent);
--   pathik_settings: the worker's last run (last_checked_at was already there), whether it went well and a short note (never guest data), a pending
--   "test connection" request from the Hotel Admin, and how many entries Pathik had that HMS does not know (only the count is kept).
ALTER TABLE pathik_sync ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE pathik_sync DROP CONSTRAINT IF EXISTS pathik_sync_status_check;
ALTER TABLE pathik_sync ADD CONSTRAINT pathik_sync_status_check CHECK (status IN ('pending', 'sent', 'failed', 'needs_staff', 'manual_done', 'void'));
CREATE INDEX IF NOT EXISTS pathik_sync_due ON pathik_sync (next_try_at) WHERE status IN ('pending', 'failed');

ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS worker_last_ok boolean;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS worker_note varchar(200);
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS test_requested_at timestamptz;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS last_extra_count integer CHECK (last_extra_count >= 0);

-- pathik_lists.active: a list the worker reads again replaces the old one by switching the old values off (the hotel role deletes nothing here)
ALTER TABLE pathik_lists ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
