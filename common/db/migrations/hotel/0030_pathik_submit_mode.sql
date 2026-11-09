-- rollback: ALTER TABLE pathik_settings DROP COLUMN IF EXISTS submit_mode;
-- Pathik submit mode (decision 54, MJ, 12 Oct 2026), per hotel: "manual" = the worker fills the Add Guest form and a person presses Submit in the visible
-- window (default, the safe choice); "auto" = the worker presses Submit itself (only when the worker's own gate PATHIK_ALLOW_REAL permits the real portal).
-- The worker gets the value with the hotel's credentials; the PATHIK_MANUAL_SUBMIT setting on the worker PC stays a global override that forces manual.
-- No guest data here: one word.
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS submit_mode text NOT NULL DEFAULT 'manual' CHECK (submit_mode IN ('manual', 'auto'));