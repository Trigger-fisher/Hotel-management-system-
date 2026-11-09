-- rollback: DROP TABLE IF EXISTS pathik_shot; DROP TABLE IF EXISTS pathik_start; ALTER TABLE pathik_settings DROP COLUMN IF EXISTS prepared_minutes;
-- Pathik on click (MJ, 18 Oct 2026; docs/plans/PATHIK-ON-CLICK-BOT-2026-10-18.md): a user presses "Submit to Pathik" on one entry; a bot on the server opens Pathik, signs in, opens
-- the form and FILLS it (PREPARE, state ready); the user checks the filled form (a screenshot) and presses Submit once; the bot then presses Pathik's own Submit (SUBMIT). Nothing
-- runs unless someone clicked.
--
-- pathik_start: one run of one queue row. It holds NO guest data: `note` is one of a fixed set of keys the service turns into a sentence, `steps` are step keys with their state
-- and time, `serial` is Pathik's own serial of the guest.
--   state        waiting -> running (prepare steps) -> ready (filled; valid until valid_until) -> submitting (submit steps) -> a final state:
--                submitted | stopped | failed | expired | needs_check | unknown
--   phase        prepare until the user presses Submit, then submit
--   seal         keyed hash of the form the person SAW when they clicked (a stay changed since is refused at the click, at the confirm and when the bot runs)
--   page_print   hash of the values read back from Pathik's filled form at the end of PREPARE; the SUBMIT run must fill the very same values or it stops
--   expires_at   while waiting: no run started by then -> expired (60 seconds)
--   lease_until  while running or submitting: the bot owes a sign of life by then; past it the run ends as failed, or as unknown when Pathik's Submit was already pressed
--                (submit_pressed_at): a person may have been entered, so it is never back to pending and never a second entry
--   valid_until  while ready: after it the prepared form is dropped (expired)
--   claim_token  the bot's proof for this run (steps, result and screenshots are accepted only with it)
--   acknowledged_at  a run that ended unknown blocks the next click on its row until a person looked in Pathik and recorded the outcome (Mark as submitted, or Undo); this is set then, and the run keeps its true state
--   stop_requested_at  the user pressed Stop: the bot looks at it between steps and before it presses Submit
CREATE TABLE pathik_start (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  row_id uuid NOT NULL REFERENCES pathik_sync (id),
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'running', 'ready', 'submitting', 'submitted', 'stopped', 'failed', 'expired', 'needs_check', 'unknown')),
  phase text NOT NULL DEFAULT 'prepare' CHECK (phase IN ('prepare', 'submit')),
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  seal text,
  page_print char(64) CHECK (page_print IS NULL OR page_print ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  claim_token text,
  lease_until timestamptz,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array'),
  valid_until timestamptz,
  stop_requested_at timestamptz,
  submit_pressed_at timestamptz,
  serial varchar(40),
  note text CHECK (note IS NULL OR note ~ '^[a-zA-Z]{1,30}$'),
  finished_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pathik_start_legacy_id_key ON pathik_start (legacy_id) WHERE legacy_id IS NOT NULL;
-- ONE live run per row (the double-click fence, one statement) ...
CREATE UNIQUE INDEX pathik_start_one_live ON pathik_start (row_id) WHERE state IN ('waiting', 'running', 'ready', 'submitting');
-- ... and ONE browser at a time per hotel: a run that is waiting for a browser or using one (a form that is only ready holds none)
CREATE UNIQUE INDEX pathik_start_one_browser ON pathik_start ((true)) WHERE state IN ('waiting', 'running', 'submitting');
CREATE INDEX pathik_start_row ON pathik_start (row_id, requested_at DESC);
CREATE TRIGGER pathik_start_touch_updated_at BEFORE UPDATE ON pathik_start FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: purge job pathik-shot-expiry (a screenshot holds the guest's details: those of a run that ended more than 10 minutes ago are deleted on every settle of the hotel's runs, whatever else is going on)
-- pathik_shot: the screenshots of a run (JPEG), one per step that has one; they show the filled form to the person who must check it. They never leave the hotel's own session
-- (served only by GET /pathik/queue/{id}/submit-now/shots/{key}).
CREATE TABLE pathik_shot (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  start_id uuid NOT NULL REFERENCES pathik_start (id) ON DELETE CASCADE,
  step_key text NOT NULL CHECK (step_key IN ('open', 'signin', 'form', 'fill', 'check', 'compare', 'submit', 'answer')),
  jpeg bytea NOT NULL CHECK (octet_length(jpeg) BETWEEN 1 AND 1500000),
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pathik_shot_legacy_id_key ON pathik_shot (legacy_id) WHERE legacy_id IS NOT NULL;
-- one picture per run and step (a second replaces the first)
CREATE UNIQUE INDEX pathik_shot_start_step_key ON pathik_shot (start_id, step_key);
CREATE TRIGGER pathik_shot_touch_updated_at BEFORE UPDATE ON pathik_shot FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- how long a prepared (filled, not yet submitted) form stays valid, in minutes; the Hotel Admin sets it in Settings > Pathik
ALTER TABLE pathik_settings ADD COLUMN IF NOT EXISTS prepared_minutes smallint NOT NULL DEFAULT 10 CHECK (prepared_minutes BETWEEN 2 AND 30);
