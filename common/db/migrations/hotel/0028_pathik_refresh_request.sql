-- rollback: ALTER TABLE pathik_settings DROP COLUMN IF EXISTS refresh_requested_at, DROP COLUMN IF EXISTS refresh_last_at, DROP COLUMN IF EXISTS check_every_minutes;
-- Pathik "Refresh now" (decision 44, MJ, 11 Oct 2026): the website cannot start a program on the worker's PC, so a button leaves a REQUEST that the running worker picks up
-- (it asks HMS every ~20 seconds which hotels have one) and serves with an immediate cycle (claim jobs, reconcile, send the active list), then clears it.
--   refresh_requested_at: when the button was pressed; null once the worker has finished the cycle that served it (like test_requested_at for the connection test);
--   refresh_last_at: when the button was last accepted, kept after the worker cleared the request: one request per hotel per 30 seconds is allowed.
--   check_every_minutes: how often the worker checks Pathik for this hotel by itself (decision 45; Settings > Pathik "Check Pathik every"): 5, 10, 15, 30 or 60 minutes, default 15;
--   every cycle replaces the kept active list, so a guest who is gone from Pathik disappears after the next check or Refresh.
-- No guest data here: two timestamps and a number.
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS refresh_requested_at timestamptz;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS refresh_last_at timestamptz;
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS check_every_minutes integer NOT NULL DEFAULT 15 CHECK (check_every_minutes IN (5, 10, 15, 30, 60));
