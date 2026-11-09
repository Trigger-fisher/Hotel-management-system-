-- rollback: ALTER TABLE pathik_settings DROP COLUMN IF EXISTS runner_started_at, DROP COLUMN IF EXISTS runner_finished_at, DROP COLUMN IF EXISTS runner_trigger, DROP COLUMN IF EXISTS runner_ok, DROP COLUMN IF EXISTS runner_jobs, DROP COLUMN IF EXISTS runner_error;
-- Pathik online runner (MJ, 13 Oct 2026: "host everything from one place"): the run record of the ONLINE runner (HMS_PATHIK_RUNNER=online, the cycle
-- run by the web app itself in a serverless function), so the Pathik page can show what happened even when no cycle reached Pathik at all (the browser
-- could not start, two runs collided). The worker's own heartbeat (last_checked_at, worker_last_ok, worker_note) stays the cycle's result.
--   runner_started_at / runner_finished_at: the last run for this hotel; a started run with no finish is "running" (stale after 6 minutes);
--   runner_trigger: what started it (refresh, check_in, check_out, page, cron);
--   runner_ok, runner_jobs, runner_error: whether it finished well, the rows it sent, and a short fixed error text (never guest data, never a secret).
-- The start is claimed with one UPDATE (two functions never run the same hotel at once).
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS runner_started_at timestamptz;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS runner_finished_at timestamptz;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS runner_trigger varchar(20) CHECK (runner_trigger IN ('refresh', 'check_in', 'check_out', 'page', 'cron'));
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS runner_ok boolean;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS runner_jobs integer CHECK (runner_jobs >= 0);
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS runner_error varchar(300);
