-- rollback: ALTER TABLE pathik_sync DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_seal, DROP COLUMN IF EXISTS claim_token; ALTER TABLE pathik_settings DROP COLUMN IF EXISTS lists_read_at; ALTER TABLE pathik_settings DROP CONSTRAINT IF EXISTS pathik_settings_runner_trigger_check; UPDATE pathik_settings SET runner_trigger = 'cron' WHERE runner_trigger IN ('approve', 'interval'); ALTER TABLE pathik_settings ADD CONSTRAINT pathik_settings_runner_trigger_check CHECK (runner_trigger IN ('refresh', 'check_in', 'check_out', 'page', 'cron'));
-- Pathik run by the server only (MJ, 17 Oct 2026: "no PC worker"; decision 62). A server has no screen, so "Manual" submit becomes REVIEW IN HMS: staff look at
-- the guest row on the Pathik page and press Approve, and the online runner then submits that row by itself (headless). Plus the safety fixes of the review:
--   pathik_sync.approved_at / approved_by: when and by whom a row was approved (a hotel user id, like done_by); with the online runner a hotel whose Submit is
--     Manual hands out approved rows only. Nothing else about the guest: the row still holds NO guest data (see 0021).
--   pathik_sync.approved_seal: a keyed hash (HMAC with the server's secret key, the hotel and the row bound in) of the Pathik form staff approved. It cannot be
--     turned back into the guest's details; the claim compares it with the form it is about to send, so an edit of the stay after the approval needs a new one.
--   pathik_sync.claim_token: a fresh random id per claim, given to the runner with the job; its result and the ID photo are accepted only with the same token,
--     so a slow runner whose lease ran out can never write over (or double) the work of the runner that took the row after it.
--   pathik_settings.lists_read_at: when the runner last sent Pathik's country and state lists (it reads them once a day; the online runner keeps no memory
--     between runs, so the time is kept here).
--   pathik_settings.runner_trigger: two more things start an online run: 'approve' (a row was approved) and 'interval' (the server's own timer on a VPS).
--     The rollback turns those two back into 'cron' before the old check is put back (it would refuse them).
ALTER TABLE pathik_sync ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE pathik_sync ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE pathik_sync ADD COLUMN IF NOT EXISTS approved_seal text;
ALTER TABLE pathik_sync ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS lists_read_at timestamptz;
ALTER TABLE pathik_settings DROP CONSTRAINT IF EXISTS pathik_settings_runner_trigger_check;
ALTER TABLE pathik_settings ADD CONSTRAINT pathik_settings_runner_trigger_check CHECK (runner_trigger IN ('refresh', 'check_in', 'check_out', 'page', 'cron', 'approve', 'interval'));
