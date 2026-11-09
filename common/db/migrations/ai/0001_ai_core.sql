-- rollback: DROP SCHEMA IF EXISTS ai CASCADE;
-- The AI database, core tables (MJ, 3 Nov 2026: "full isolation"). This runs in an AI database only (hms_ai), never in the main database, as hms_ai_owner.
-- Isolation is done by the database itself, per PERSON inside one hotel (or one group):
--   * every table has ROW LEVEL SECURITY enabled AND forced (the owner obeys it too);
--   * a policy reads transaction-local settings ai.scope_kind, ai.scope_id, ai.login_id, ai.role_type (set by src/db/aiScope.ts from the signed-in session, never from a request);
--     a setting that is missing or empty gives NO rows (fail closed);
--   * a row is visible and writable only when scope_kind, scope_id AND login_id all match; WITH CHECK stops a row being written into another scope or person, and the app
--     login may not even name scope_id, login_id, role_type or scope_kind in an UPDATE (column grants);
--   * hms_ai_app (the app's login) gets the least privilege each table needs, and nothing else. No personal data columns: no names, phones or emails.
-- Adding a role: widen the role_type / audience checks here in a NEW migration (the list of who may use AI is src/server/ai/access.ts).

CREATE FUNCTION ai.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- the settings, read safely: unset or empty gives NULL, so every comparison with it is not true and no row passes. A malformed uuid raises an error (also closed).
CREATE FUNCTION ai.cur_scope_kind() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('ai.scope_kind', true), '') $$;
CREATE FUNCTION ai.cur_scope_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('ai.scope_id', true), '')::uuid $$;
CREATE FUNCTION ai.cur_login_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('ai.login_id', true), '')::uuid $$;
CREATE FUNCTION ai.cur_role_type() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('ai.role_type', true), '') $$;

-- a conversation with the assistant. keeps_text: the messages of this thread may hold their text (only where the route turned history on)
CREATE TABLE ai.ai_threads (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('hotel', 'group')),
  scope_id uuid NOT NULL,
  login_id uuid NOT NULL,
  role_type text NOT NULL CHECK (role_type IN ('group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user')),
  title text CHECK (title IS NULL OR char_length(title) <= 200),
  last_at timestamptz NOT NULL DEFAULT now(),
  keeps_text boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_threads_owner_key UNIQUE (id, scope_kind, scope_id, login_id)
);
CREATE INDEX ai_threads_owner_last_idx ON ai.ai_threads (scope_id, login_id, last_at DESC);
CREATE TRIGGER ai_threads_touch BEFORE UPDATE ON ai.ai_threads FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- one turn. The foreign key carries the owner too, so a message can only hang on a thread of the same person in the same scope.
CREATE TABLE ai.ai_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('hotel', 'group')),
  scope_id uuid NOT NULL,
  login_id uuid NOT NULL,
  role_type text NOT NULL CHECK (role_type IN ('group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user')),
  thread_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text CHECK (content IS NULL OR char_length(content) <= 20000),
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_owner_key UNIQUE (id, scope_kind, scope_id, login_id),
  CONSTRAINT ai_messages_thread_fk FOREIGN KEY (thread_id, scope_kind, scope_id, login_id) REFERENCES ai.ai_threads (id, scope_kind, scope_id, login_id) ON DELETE CASCADE
);
CREATE INDEX ai_messages_thread_idx ON ai.ai_messages (thread_id, scope_kind, scope_id, login_id, created_at);
CREATE TRIGGER ai_messages_touch BEFORE UPDATE ON ai.ai_messages FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- knowledge text the AI may search: belongs to a hotel or group (audience = which roles may read it) or to one person (owner_login_id). Read only for the app.
CREATE TABLE ai.ai_documents (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('hotel', 'group')),
  scope_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(body) <= 200000),
  audience text[] NOT NULL CHECK (cardinality(audience) BETWEEN 1 AND 5 AND audience <@ ARRAY['group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user']::text[]),
  owner_login_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_documents_scope_idx ON ai.ai_documents (scope_id, scope_kind);
CREATE TRIGGER ai_documents_touch BEFORE UPDATE ON ai.ai_documents FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- the cost ledger. The app can add rows and read its own, never change or remove one.
CREATE TABLE ai.ai_usage (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('hotel', 'group')),
  scope_id uuid NOT NULL,
  login_id uuid NOT NULL,
  role_type text NOT NULL CHECK (role_type IN ('group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user')),
  feature text NOT NULL CHECK (char_length(feature) BETWEEN 1 AND 60),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 80),
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_paise bigint NOT NULL DEFAULT 0 CHECK (cost_paise >= 0),
  took_ms integer NOT NULL DEFAULT 0 CHECK (took_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('answered', 'refused', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_owner_day_idx ON ai.ai_usage (scope_id, login_id, created_at DESC);
CREATE TRIGGER ai_usage_touch BEFORE UPDATE ON ai.ai_usage FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- thumbs up or down on a message, by its owner (one per message)
CREATE TABLE ai.ai_feedback (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('hotel', 'group')),
  scope_id uuid NOT NULL,
  login_id uuid NOT NULL,
  role_type text NOT NULL CHECK (role_type IN ('group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user')),
  message_id uuid NOT NULL,
  rating text NOT NULL CHECK (rating IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_feedback_message_key UNIQUE (message_id),
  CONSTRAINT ai_feedback_message_fk FOREIGN KEY (message_id, scope_kind, scope_id, login_id) REFERENCES ai.ai_messages (id, scope_kind, scope_id, login_id) ON DELETE CASCADE
);
CREATE INDEX ai_feedback_owner_idx ON ai.ai_feedback (message_id, scope_kind, scope_id, login_id);
CREATE TRIGGER ai_feedback_touch BEFORE UPDATE ON ai.ai_feedback FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ROW LEVEL SECURITY, enabled and forced on every table
ALTER TABLE ai.ai_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_feedback FORCE ROW LEVEL SECURITY;

-- person-owned rows: the three settings must match the row (and for a new row the role must be the signed-in one)
CREATE POLICY ai_threads_select ON ai.ai_threads FOR SELECT TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());
CREATE POLICY ai_threads_insert ON ai.ai_threads FOR INSERT TO hms_ai_app WITH CHECK (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id() AND role_type = ai.cur_role_type());
CREATE POLICY ai_threads_update ON ai.ai_threads FOR UPDATE TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id()) WITH CHECK (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());
CREATE POLICY ai_threads_delete ON ai.ai_threads FOR DELETE TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());

CREATE POLICY ai_messages_select ON ai.ai_messages FOR SELECT TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());
CREATE POLICY ai_messages_insert ON ai.ai_messages FOR INSERT TO hms_ai_app WITH CHECK (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id() AND role_type = ai.cur_role_type());
CREATE POLICY ai_messages_update ON ai.ai_messages FOR UPDATE TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id()) WITH CHECK (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());
CREATE POLICY ai_messages_delete ON ai.ai_messages FOR DELETE TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());

CREATE POLICY ai_usage_select ON ai.ai_usage FOR SELECT TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());
CREATE POLICY ai_usage_insert ON ai.ai_usage FOR INSERT TO hms_ai_app WITH CHECK (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id() AND role_type = ai.cur_role_type());

CREATE POLICY ai_feedback_select ON ai.ai_feedback FOR SELECT TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());
CREATE POLICY ai_feedback_insert ON ai.ai_feedback FOR INSERT TO hms_ai_app WITH CHECK (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id() AND role_type = ai.cur_role_type());
CREATE POLICY ai_feedback_update ON ai.ai_feedback FOR UPDATE TO hms_ai_app USING (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id()) WITH CHECK (scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id() AND login_id = ai.cur_login_id());

-- shared knowledge: same scope AND the person's role is in the audience (a document of one person is for that person only); a person's own document needs the scope too
CREATE POLICY ai_documents_select ON ai.ai_documents FOR SELECT TO hms_ai_app USING (
  scope_kind = ai.cur_scope_kind() AND scope_id = ai.cur_scope_id()
  AND ((owner_login_id IS NULL AND ai.cur_role_type() = ANY (audience)) OR owner_login_id = ai.cur_login_id())
);

-- privileges: nothing for PUBLIC, then only what each table needs for hms_ai_app
REVOKE ALL ON SCHEMA ai FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ai FROM PUBLIC;
GRANT USAGE ON SCHEMA ai TO hms_ai_app;
GRANT EXECUTE ON FUNCTION ai.cur_scope_kind(), ai.cur_scope_id(), ai.cur_login_id(), ai.cur_role_type(), ai.touch_updated_at() TO hms_ai_app;
GRANT SELECT, INSERT, DELETE ON ai.ai_threads TO hms_ai_app;
GRANT UPDATE (title, last_at, keeps_text) ON ai.ai_threads TO hms_ai_app;
GRANT SELECT, INSERT, DELETE ON ai.ai_messages TO hms_ai_app;
GRANT UPDATE (content, tokens_in, tokens_out) ON ai.ai_messages TO hms_ai_app;
GRANT SELECT ON ai.ai_documents TO hms_ai_app;
GRANT SELECT, INSERT ON ai.ai_usage TO hms_ai_app;
GRANT SELECT, INSERT ON ai.ai_feedback TO hms_ai_app;
GRANT UPDATE (rating) ON ai.ai_feedback TO hms_ai_app;
