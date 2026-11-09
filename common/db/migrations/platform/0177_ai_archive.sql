-- rollback: DROP SCHEMA IF EXISTS ai_archive CASCADE; DROP ROLE IF EXISTS hms_ai_archive;
-- The AI archive (MJ, 3 Nov 2026, "AI Archive Tables and Columns in the HMS Main Database", Plan A): old AI rows are copied out of every AI database into the HMS main database, checked, and only then
-- removed from the AI database. One schema, `ai_archive`, seven tables, for all AI databases and every place AI is used (a row says which hotel it belongs to; the group, platform and person scopes use their
-- own ids in hotel_id as the AI database does). Nothing goes into `platform` or a hotel schema.
--   1 archived_conversations   old chats               2 archived_messages     old chat messages (monthly partitions)
--   3 archived_tool_calls      data tools the bot used (monthly partitions)       4 archived_feedback     thumbs up or down
--   5 archived_audit_logs      security and action log (monthly partitions)       6 archived_usage_daily  daily usage and cost per hotel, copied by closed month
--   7 archive_pull_log         HMS's own record of every archive run (not a copy)
-- Tables 1 to 5 keep the AI row's own id and its own created_at, so copying the same row twice does nothing (ON CONFLICT DO NOTHING). A partitioned table must hold its partition column in its primary key,
-- so there it is (id, created_at): the conflict target is both, which is the same row because an AI row's created_at never changes. A DEFAULT partition catches any month nobody made yet, so a copy never fails.
-- No foreign keys on purpose: an archive is kept after the hotel or the person is gone.
-- Who may touch it (the plan's "no anon, no authenticated, one archive role that can only insert and read"):
--   * nobody by default: no access for PUBLIC, and none for the Supabase API roles when they exist;
--   * hms_ai_archive (a NOLOGIN role; the archive job's login is made by the setup tool, never here): INSERT and SELECT on the copies, SELECT and INSERT on the pull log plus UPDATE of its status, error and confirmed_at;
--     it cannot update or delete a copy and cannot reach any other schema;
--   * hms_app (the web app): SELECT on the three tables that hold no message text (usage, audit, pull log) for the Super Admin's screens. It has NO access to the four tables that hold what people wrote
--     (conversations, messages, tool calls, feedback) until MJ decides who may read them: the isolation rule of the AI feature says a person's chats are only that person's.
CREATE SCHEMA ai_archive;
REVOKE ALL ON SCHEMA ai_archive FROM PUBLIC;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_ai_archive') THEN
    CREATE ROLE hms_ai_archive NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- the Supabase API roles, where the database has them: none of them may reach this schema
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA ai_archive FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA ai_archive FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN REVOKE ALL ON SCHEMA ai_archive FROM service_role; END IF;
END
$do$;

-- no-standard-columns: a copy of an AI row; created_at and updated_at are the AI row's own times and received_at is when HMS saved it
CREATE TABLE ai_archive.archived_conversations (
  id uuid NOT NULL,
  hotel_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (char_length(role) BETWEEN 1 AND 40),
  stay_id uuid,
  language text NOT NULL CHECK (language IN ('en', 'hi', 'gu', 'hinglish')),
  audience text CHECK (audience IS NULL OR audience IN ('guest', 'hotel', 'corporate', 'group')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  archive_batch_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX archived_conversations_hotel_created_idx ON ai_archive.archived_conversations (hotel_id, created_at);

-- no-standard-columns: a copy of an AI row; created_at is the AI row's own time and received_at is when HMS saved it
CREATE TABLE ai_archive.archived_messages (
  id uuid NOT NULL,
  hotel_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  source text CHECK (source IS NULL OR source IN ('faq', 'model', 'fallback')),
  prompt_version_id text CHECK (prompt_version_id IS NULL OR char_length(prompt_version_id) <= 120),
  model text CHECK (model IS NULL OR char_length(model) <= 200),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL,
  archived_at timestamptz,
  archive_batch_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX archived_messages_hotel_created_idx ON ai_archive.archived_messages (hotel_id, created_at);
CREATE INDEX archived_messages_conversation_idx ON ai_archive.archived_messages (conversation_id);

-- no-standard-columns: a copy of an AI row; created_at is the AI row's own time and received_at is when HMS saved it
CREATE TABLE ai_archive.archived_tool_calls (
  id uuid NOT NULL,
  hotel_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  tool_name text NOT NULL CHECK (char_length(tool_name) BETWEEN 1 AND 120),
  args jsonb NOT NULL CHECK (jsonb_typeof(args) = 'object'),
  ok boolean NOT NULL,
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL,
  archived_at timestamptz,
  archive_batch_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX archived_tool_calls_hotel_created_idx ON ai_archive.archived_tool_calls (hotel_id, created_at);

-- no-standard-columns: a copy of an AI row; created_at is the AI row's own time and received_at is when HMS saved it
CREATE TABLE ai_archive.archived_feedback (
  id uuid NOT NULL,
  hotel_id uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating text NOT NULL CHECK (rating IN ('up', 'down')),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 2000),
  created_at timestamptz NOT NULL,
  archived_at timestamptz,
  archive_batch_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (message_id, user_id)
);

-- no-standard-columns: a copy of an AI row; created_at is the AI row's own time and received_at is when HMS saved it
CREATE TABLE ai_archive.archived_audit_logs (
  id uuid NOT NULL,
  -- the nil uuid for platform actions such as an archive run
  hotel_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL,
  archived_at timestamptz,
  archive_batch_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX archived_audit_logs_hotel_created_idx ON ai_archive.archived_audit_logs (hotel_id, created_at);

-- no-standard-columns: a closed month copied whole; received_at is when HMS saved it
CREATE TABLE ai_archive.archived_usage_daily (
  hotel_id uuid NOT NULL,
  day date NOT NULL,
  feature text NOT NULL CHECK (feature IN ('chatbot', 'writing')),
  audience text NOT NULL CHECK (audience IN ('guest', 'hotel', 'corporate', 'group')),
  calls integer NOT NULL CHECK (calls >= 0),
  faq_hits integer NOT NULL CHECK (faq_hits >= 0),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  cost_usd numeric(12, 6) NOT NULL CHECK (cost_usd >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, day, feature, audience)
);

-- no-standard-columns: HMS's own record of an archive run; pulled_at and confirmed_at are its times
CREATE TABLE ai_archive.archive_pull_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  table_name text NOT NULL CHECK (table_name IN ('archived_conversations', 'archived_messages', 'archived_tool_calls', 'archived_feedback', 'archived_audit_logs', 'archived_usage_daily')),
  day date NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  checksum text NOT NULL CHECK (char_length(checksum) BETWEEN 8 AND 200),
  status text NOT NULL CHECK (status IN ('pulled', 'confirmed', 'failed')),
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  pulled_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  -- the Super Admin who started the archive: a plain id, so a closed account never blocks it
  started_by uuid NOT NULL,
  UNIQUE (batch_id, table_name, day),
  CONSTRAINT archive_pull_log_confirmed_has_time CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);

-- Monthly partitions of the three partitioned tables. ensure_month makes the partitions of one month (idempotent); the archive job calls it before it copies a day, so a new month never needs a migration.
-- It is SECURITY DEFINER with a fixed search_path, takes a date and nothing else, and only ever creates partitions of these three tables.
CREATE FUNCTION ai_archive.ensure_month(p_month date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ai_archive, pg_temp AS $fn$
DECLARE
  first_day date := date_trunc('month', p_month)::date;
  next_day date := (date_trunc('month', p_month) + interval '1 month')::date;
  t text;
BEGIN
  IF p_month IS NULL OR p_month < date '2020-01-01' OR p_month > date '2100-01-01' THEN RAISE EXCEPTION 'month out of range'; END IF;
  FOREACH t IN ARRAY ARRAY['archived_messages', 'archived_tool_calls', 'archived_audit_logs'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS ai_archive.%I PARTITION OF ai_archive.%I FOR VALUES FROM (%L) TO (%L)', t || '_p' || to_char(first_day, 'YYYYMM'), t, first_day::timestamptz, next_day::timestamptz);
  END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION ai_archive.ensure_month(date) FROM PUBLIC;

CREATE TABLE ai_archive.archived_messages_default PARTITION OF ai_archive.archived_messages DEFAULT;
CREATE TABLE ai_archive.archived_tool_calls_default PARTITION OF ai_archive.archived_tool_calls DEFAULT;
CREATE TABLE ai_archive.archived_audit_logs_default PARTITION OF ai_archive.archived_audit_logs DEFAULT;
-- the months from now to the end of next year are made up front
DO $do$
DECLARE m date := date '2026-11-01';
BEGIN
  WHILE m <= date '2027-12-01' LOOP
    PERFORM ai_archive.ensure_month(m);
    m := (m + interval '1 month')::date;
  END LOOP;
END
$do$;

-- the grants
GRANT USAGE ON SCHEMA ai_archive TO hms_ai_archive, hms_app;
GRANT SELECT, INSERT ON ai_archive.archived_conversations, ai_archive.archived_messages, ai_archive.archived_tool_calls, ai_archive.archived_feedback, ai_archive.archived_audit_logs, ai_archive.archived_usage_daily TO hms_ai_archive;
GRANT SELECT, INSERT ON ai_archive.archive_pull_log TO hms_ai_archive;
GRANT UPDATE (status, error, confirmed_at) ON ai_archive.archive_pull_log TO hms_ai_archive;
GRANT EXECUTE ON FUNCTION ai_archive.ensure_month(date) TO hms_ai_archive;
GRANT SELECT ON ai_archive.archived_usage_daily, ai_archive.archived_audit_logs, ai_archive.archive_pull_log TO hms_app;
