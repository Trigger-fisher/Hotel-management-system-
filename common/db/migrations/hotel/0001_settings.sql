-- rollback: DROP TABLE IF EXISTS force_logs; DROP TABLE IF EXISTS user_audit_logs; DROP TABLE IF EXISTS system_logs; DROP TABLE IF EXISTS feature_errors; DROP TABLE IF EXISTS health_checks; DROP TABLE IF EXISTS business_units; DROP TABLE IF EXISTS app_settings; DROP TABLE IF EXISTS option_items; DROP TABLE IF EXISTS option_sets;
-- Settings, master lists and logs. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

-- hard-delete: Pallav app/Http/Controllers/MasterDataController.php:179
CREATE TABLE option_sets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  key varchar(255) NOT NULL,
  name varchar(255) NOT NULL,
  description varchar(255),
  icon varchar(40) NOT NULL DEFAULT 'bi-list-ul',
  input text NOT NULL DEFAULT 'select' CHECK (input IN ('select', 'radio', 'checkbox')),
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX option_sets_key_key ON option_sets (key);
CREATE UNIQUE INDEX option_sets_legacy_id_key ON option_sets (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER option_sets_touch_updated_at BEFORE UPDATE ON option_sets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/MasterDataController.php:266
CREATE TABLE option_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  option_set_id uuid NOT NULL REFERENCES option_sets (id) ON DELETE CASCADE,
  label varchar(255) NOT NULL,
  value varchar(255) NOT NULL,
  color varchar(7),
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX option_items_legacy_id_key ON option_items (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX option_items_option_set_id_value_key ON option_items (option_set_id, value);
CREATE INDEX option_items_option_set_id_sort_order_idx ON option_items (option_set_id, sort_order);
CREATE TRIGGER option_items_touch_updated_at BEFORE UPDATE ON option_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Settings the hotel changes on screen. is_secret rows are integration secrets: stored as plain text, never returned by any API (the app answers "set" only).
CREATE TABLE app_settings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  key varchar(100) NOT NULL,
  value text,
  is_secret boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_settings_key_key ON app_settings (key);
CREATE UNIQUE INDEX app_settings_legacy_id_key ON app_settings (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER app_settings_touch_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE business_units (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(255) NOT NULL,
  slug varchar(255) NOT NULL,
  code varchar(10) NOT NULL,
  accent varchar(7) NOT NULL DEFAULT '#7C3AED',
  icon varchar(40) NOT NULL DEFAULT 'bi-buildings',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_units_slug_key ON business_units (slug);
CREATE UNIQUE INDEX business_units_code_key ON business_units (code);
CREATE UNIQUE INDEX business_units_legacy_id_key ON business_units (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER business_units_touch_updated_at BEFORE UPDATE ON business_units FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/Health/Monitor.php:177 (pruned by the health job)
-- append-only: a health probe result per check, never edited, purged by age
CREATE TABLE health_checks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(40) NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'warn', 'down')),
  message varchar(400),
  latency_ms bigint CHECK (latency_ms >= 0),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX health_checks_legacy_id_key ON health_checks (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX health_checks_name_checked_at_idx ON health_checks (name, checked_at);

-- hard-delete: Pallav app/Support/Health/Monitor.php:178 (resolved errors pruned by the health job)
CREATE TABLE feature_errors (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  feature varchar(60) NOT NULL DEFAULT 'unknown',
  fingerprint varchar(40) NOT NULL,
  exception varchar(190) NOT NULL,
  message varchar(1000),
  file varchar(400),
  line bigint CHECK (line >= 0),
  trace text,
  method varchar(10),
  path varchar(255),
  user_name varchar(150),
  ip_address varchar(45),
  occurrences bigint NOT NULL DEFAULT 1 CHECK (occurrences >= 0),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  resolved_at timestamptz,
  resolved_by varchar(150),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX feature_errors_fingerprint_key ON feature_errors (fingerprint);
CREATE UNIQUE INDEX feature_errors_legacy_id_key ON feature_errors (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX feature_errors_feature_last_seen_at_idx ON feature_errors (feature, last_seen_at);
CREATE INDEX feature_errors_resolved_at_idx ON feature_errors (resolved_at);
CREATE INDEX feature_errors_last_seen_at_idx ON feature_errors (last_seen_at) WHERE resolved_at IS NULL;
CREATE TRIGGER feature_errors_touch_updated_at BEFORE UPDATE ON feature_errors FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- append-only: what happened and who did it, never edited
CREATE TABLE system_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  module varchar(40) NOT NULL,
  user_id uuid,
  user_name varchar(150),
  action varchar(30) NOT NULL,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  entity varchar(60) NOT NULL,
  subject_id uuid,
  subject_label varchar(255),
  summary varchar(500) NOT NULL,
  details jsonb,
  ip_address varchar(45),
  trace_id text CHECK (trace_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_logs_user_id_idx ON system_logs (user_id);
CREATE UNIQUE INDEX system_logs_legacy_id_key ON system_logs (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX system_logs_module_created_at_idx ON system_logs (module, created_at);
CREATE INDEX system_logs_entity_action_idx ON system_logs (entity, action);
CREATE INDEX system_logs_created_at_idx ON system_logs (created_at);
CREATE INDEX system_logs_action_created_at_idx ON system_logs (action, created_at);
CREATE INDEX system_logs_status_created_at_idx ON system_logs (status, created_at);

-- append-only: what was done to a user account, never edited
CREATE TABLE user_audit_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  actor_id uuid,
  target_user_id uuid,
  target_username varchar(50),
  action varchar(50) NOT NULL,
  details jsonb,
  ip_address varchar(45),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_audit_logs_actor_id_idx ON user_audit_logs (actor_id);
CREATE INDEX user_audit_logs_target_user_id_idx ON user_audit_logs (target_user_id);
CREATE UNIQUE INDEX user_audit_logs_legacy_id_key ON user_audit_logs (legacy_id) WHERE legacy_id IS NOT NULL;

-- append-only: every force-mode override, never edited
CREATE TABLE force_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  user_id uuid,
  user_name varchar(150),
  action varchar(20) NOT NULL,
  module varchar(40) NOT NULL DEFAULT 'system',
  summary varchar(500) NOT NULL,
  details jsonb,
  route varchar(120),
  path varchar(255),
  method varchar(10),
  ip_address varchar(45),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX force_logs_user_id_idx ON force_logs (user_id);
CREATE UNIQUE INDEX force_logs_legacy_id_key ON force_logs (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX force_logs_created_at_idx ON force_logs (created_at);
CREATE INDEX force_logs_module_created_at_idx ON force_logs (module, created_at);
CREATE INDEX force_logs_action_created_at_idx ON force_logs (action, created_at);
