-- PROPOSAL ONLY. Nothing here has been run anywhere. HMS (Supabase) owns the real migration; this shows what the worker needs.
--
-- A job runs in two parts (MJ, 5 Nov 2026):
--   queued -> processing (FAST part: scan, re-save, gate, find, read, check) -> read (the fields are in the row: the form fills)
--   read -> saving (BACKGROUND part: model cutter, pairing, enhance, compress, encrypt, upload) -> done
-- A crash in the background part puts the job back to `read` (background_attempts + 1); the fields stay. After 3 attempts it is
-- `needs_attention` with the fields kept and no picture. The background part never writes the fields (see the grants below):
-- what it reads differently is in `background.disagreements`, with needs_human_check set, so the form turns yellow.

CREATE TABLE IF NOT EXISTS intake_jobs (
  id               uuid PRIMARY KEY,
  hotel_id         uuid NOT NULL,
  stay_id          uuid,
  person_id        uuid,
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','processing','read','saving','done','rejected','needs_attention')),
  attempts         int  NOT NULL DEFAULT 0,
  background_attempts int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  read_at          timestamptz,              -- the fast part finished: the form can fill
  saving_started_at timestamptz,
  finished_at      timestamptz,              -- the picture is saved (or the job ended)
  -- written by HMS: what to do and the signed links (15 minutes, one object each; the background part may download again)
  download_url     text NOT NULL,
  back_download_url text,
  upload_url       text NOT NULL,
  wrapped_key      text NOT NULL,            -- per-hotel data key, wrapped by the master key
  profile          text NOT NULL DEFAULT 'id-card',
  gate_action      text NOT NULL DEFAULT 'reject' CHECK (gate_action IN ('reject','warn')),
  size_cap_bytes   int  NOT NULL DEFAULT 512000,  -- 500 KB; optional auto_enhance boolean (default true, falls back to the worker's AUTO_ENHANCE)
  -- the hotel's "ID pictures: keep an exact copy (bigger files)" (MJ, 5 Nov 2026), set by the Super Admin on the hotel's Integrations tab and stored in
  -- platform.hotels.id_photo_exact_copy (HMS platform migration 0196). HMS copies it here when it queues the job: false = a sharp JPEG, 150 KB tried
  -- first, never above 500 KB, SSIM >= 0.98 and the OCR round trip; true = WebP lossless, no enhance, a copy above the cap flagged sizeCapExceeded.
  lossless         boolean NOT NULL DEFAULT false,
  document_type    text,                     -- optional hint from the Super Admin list
  type_config      jsonb,                    -- optional configured type (see app/typeconfig.py)
  mask_id_numbers  boolean NOT NULL DEFAULT false,
  languages        text[],
  -- written by the worker's FAST part: never the full OCR text, never content
  step             text,
  reason_code      text,
  message          text,
  needs_human_check boolean,
  document_type_read jsonb,
  fields           jsonb,
  doubtful_fields  jsonb,
  same_person      jsonb,
  flags            jsonb,
  scores           jsonb,
  scan_engine      text,
  pages            int,
  timings          jsonb,                    -- steps in ms, formMs (the form-ready moment), background.ms (the saved moment)
  person           jsonb,                    -- cards, sides, evidence, card corners (numbers only), cardsFound, peopleFound
  clarity          jsonb,
  photo            jsonb,                    -- outcomes and 2-decimal scores only, never an embedding
  suggested_name   text,
  -- written by the worker's BACKGROUND part (it may also raise needs_human_check, add flags and add to scores and timings)
  result_bytes     int,
  background       jsonb                     -- disagreements with the fast part, cards and people it found
);

-- The pull queries: oldest queued job first (the form), then the oldest read job (the picture), no lock waits.
CREATE INDEX IF NOT EXISTS intake_jobs_queued_idx ON intake_jobs (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS intake_jobs_read_idx ON intake_jobs (read_at) WHERE status = 'read';
-- The stuck-job sweeps.
CREATE INDEX IF NOT EXISTS intake_jobs_processing_idx ON intake_jobs (started_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS intake_jobs_saving_idx ON intake_jobs (saving_started_at) WHERE status = 'saving';

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id             bigserial PRIMARY KEY,
  last_seen      timestamptz NOT NULL DEFAULT now(),
  version        text NOT NULL,
  queue_depth    int  NOT NULL,              -- queued + read (forms and pictures waiting)
  signature_date text,                       -- ClamAV signature date: HMS alerts when older than 48 hours
  feeds_date     text                        -- oldest good Sanesecurity check (ISO, UTC): HMS alerts when older than 48 hours
);
ALTER TABLE worker_heartbeat ADD COLUMN IF NOT EXISTS feeds_date text;
CREATE INDEX IF NOT EXISTS worker_heartbeat_seen_idx ON worker_heartbeat (last_seen DESC);

-- The worker's login: it can do these things and nothing else.
CREATE ROLE intake_worker LOGIN PASSWORD 'set-by-hms-never-committed' NOINHERIT;
REVOKE ALL ON SCHEMA public FROM intake_worker;
GRANT USAGE ON SCHEMA public TO intake_worker;
-- (No access to any hotel schema: nothing is granted, so every other table fails with "permission denied".)
GRANT SELECT ON intake_jobs TO intake_worker;
-- The attempt guard (5 Nov 2026): just before the upload the background part runs
--   UPDATE intake_jobs SET saving_started_at = now() WHERE id = $1 AND background_attempts = $2 AND status = 'saving'
-- and uploads only when one row changed, so a swept attempt that wakes up late never overwrites the live attempt's picture.
GRANT UPDATE (status, attempts, background_attempts, started_at, read_at, saving_started_at, finished_at, step, reason_code,
              message, needs_human_check, document_type_read, fields, doubtful_fields, same_person, flags, scores, scan_engine,
              result_bytes, pages, timings, person, clarity, photo, suggested_name, background)
  ON intake_jobs TO intake_worker;
GRANT INSERT ON worker_heartbeat TO intake_worker;
GRANT USAGE ON SEQUENCE worker_heartbeat_id_seq TO intake_worker;
-- The rule "the background part never changes a field" is kept by the worker (app/store.py SAVE_COLUMNS, tested). One login runs
-- both parts, so the grant alone cannot enforce it; HMS may add a trigger that refuses a change of `fields` once status is not
-- 'processing'.

-- Retention (HMS owns it): rows older than 90 days trimmed to status and timings; heartbeat rows older than 7 days deleted.
