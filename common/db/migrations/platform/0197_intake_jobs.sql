-- rollback: DROP TABLE IF EXISTS public.worker_heartbeat; DROP TABLE IF EXISTS public.intake_jobs;
-- The ID reader's job queue (MJ, 6 Nov 2026): HMS queues one job per ID picture of a check-in and the reader worker (other-features/intake-worker) pulls it
-- with FOR UPDATE SKIP LOCKED and writes the fields back. This is the table of other-features/intake-worker/sql/proposal.sql, unchanged, so the worker needs no change.
-- It holds the signed links of the picture (valid 15 minutes) and what the worker read; the web app only inserts and reads. HMS reaches it through
-- INTAKE_QUEUE_DATABASE_URL (may be this database as hms_app). The worker's own login (intake_worker) is made by hand, never in a migration: its grants are given here
-- only if that role already exists.
CREATE TABLE IF NOT EXISTS public.intake_jobs (
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
  read_at          timestamptz,
  saving_started_at timestamptz,
  finished_at      timestamptz,
  download_url     text NOT NULL,
  back_download_url text,
  upload_url       text NOT NULL,
  wrapped_key      text NOT NULL,
  profile          text NOT NULL DEFAULT 'id-card',
  gate_action      text NOT NULL DEFAULT 'reject' CHECK (gate_action IN ('reject','warn')),
  size_cap_bytes   int  NOT NULL DEFAULT 512000,
  lossless         boolean NOT NULL DEFAULT false,
  document_type    text,
  type_config      jsonb,
  mask_id_numbers  boolean NOT NULL DEFAULT false,
  languages        text[],
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
  timings          jsonb,
  person           jsonb,
  clarity          jsonb,
  photo            jsonb,
  suggested_name   text,
  result_bytes     int,
  background       jsonb
);
CREATE INDEX IF NOT EXISTS intake_jobs_queued_idx ON public.intake_jobs (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS intake_jobs_read_idx ON public.intake_jobs (read_at) WHERE status = 'read';
CREATE INDEX IF NOT EXISTS intake_jobs_processing_idx ON public.intake_jobs (started_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS intake_jobs_saving_idx ON public.intake_jobs (saving_started_at) WHERE status = 'saving';
CREATE INDEX IF NOT EXISTS intake_jobs_hotel_idx ON public.intake_jobs (hotel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.worker_heartbeat (
  id             bigserial PRIMARY KEY,
  last_seen      timestamptz NOT NULL DEFAULT now(),
  version        text NOT NULL,
  queue_depth    int  NOT NULL,
  signature_date text,
  feeds_date     text
);
CREATE INDEX IF NOT EXISTS worker_heartbeat_seen_idx ON public.worker_heartbeat (last_seen DESC);

GRANT SELECT, INSERT ON public.intake_jobs TO hms_app;
GRANT SELECT ON public.worker_heartbeat TO hms_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intake_worker') THEN
    GRANT USAGE ON SCHEMA public TO intake_worker;
    GRANT SELECT ON public.intake_jobs TO intake_worker;
    GRANT UPDATE (status, attempts, background_attempts, started_at, read_at, saving_started_at, finished_at, step, reason_code,
                  message, needs_human_check, document_type_read, fields, doubtful_fields, same_person, flags, scores, scan_engine,
                  result_bytes, pages, timings, person, clarity, photo, suggested_name, background)
      ON public.intake_jobs TO intake_worker;
    GRANT INSERT ON public.worker_heartbeat TO intake_worker;
    GRANT USAGE ON SEQUENCE public.worker_heartbeat_id_seq TO intake_worker;
  END IF;
END $$;
