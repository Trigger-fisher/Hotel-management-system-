-- rollback: DROP TABLE IF EXISTS pathik_sync; DROP TABLE IF EXISTS pathik_settings; DROP TABLE IF EXISTS pathik_lists;
-- Pathik (the Gujarat Police guest register), phase 1: docs/sessions/PLAN-PATHIK.md. No contact with Pathik yet: HMS tracks every stay that must be
-- registered and what happened to it, and keeps the hotel's own Pathik account for the phase 2 worker.
--
-- pathik_settings: one row per hotel (made on first save). The switch is off by default. The password is the ONE encrypted value in HMS (PLAN-PATHIK
-- decision 2, an exception to DECISIONS #11): AES-256-GCM with HMS_SECRET_KEY, stored as "v1.<iv>.<tag>.<ciphertext>" in base64url; it is never returned,
-- never logged. "Delete credentials" sets username and password_encrypted to NULL (really erased, audited in system_logs), it deletes no row.
CREATE TABLE pathik_settings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  enabled boolean NOT NULL DEFAULT false,
  username varchar(100),
  password_encrypted text,
  alert_minutes smallint NOT NULL DEFAULT 15 CHECK (alert_minutes BETWEEN 1 AND 240),
  -- the Hotel Admin's own mapping of our ID types to Pathik's five document types ({"Voter ID": "Election Card", "Ration card": null}); a type not listed
  -- uses the built-in closest same-kind match (services/pathik/fields.ts); null = no Pathik type: the row needs staff
  id_type_map jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(id_type_map) = 'object'),
  -- when an ID type has no close match: send it as this Pathik type (the row shows "sent as X, original: Y"), or NULL = the row needs staff (default)
  id_fallback text CHECK (id_fallback IN ('Aadhar Card', 'Election Card', 'Driving License', 'Pan Card', 'Passport No')),
  saved_by uuid,
  saved_by_name varchar(150),
  saved_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- the switch can be on only with both halves of the account saved
  CHECK (NOT enabled OR (username IS NOT NULL AND password_encrypted IS NOT NULL))
);
CREATE UNIQUE INDEX pathik_settings_legacy_id_key ON pathik_settings (legacy_id) WHERE legacy_id IS NOT NULL;
-- one row per hotel schema
CREATE UNIQUE INDEX pathik_settings_one_row ON pathik_settings ((true));
CREATE TRIGGER pathik_settings_touch_updated_at BEFORE UPDATE ON pathik_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- pathik_sync: the queue. One row per stay and kind (check-in, check-out): a second event for the same stay changes nothing. It holds NO guest data (MJ):
-- the guest's details, the mapped values (sent against original) and the ID image are read live from the stay whenever they are shown or sent. The note is a
-- short reason or a staff note, never a secret and never guest data. external_ref is Pathik's serial number once the guest is registered.
CREATE TABLE pathik_sync (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  stay_id uuid NOT NULL REFERENCES pms_stays (id),
  kind text NOT NULL CHECK (kind IN ('check_in', 'check_out')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'needs_staff', 'manual_done')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_note varchar(500),
  external_ref varchar(40),
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  next_try_at timestamptz,
  done_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pathik_sync_legacy_id_key ON pathik_sync (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX pathik_sync_stay_kind_key ON pathik_sync (stay_id, kind);
CREATE INDEX pathik_sync_status_queued ON pathik_sync (status, queued_at);
CREATE INDEX pathik_sync_queued ON pathik_sync (queued_at DESC);
CREATE TRIGGER pathik_sync_touch_updated_at BEFORE UPDATE ON pathik_sync FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- pathik_lists: our copy of the choices Pathik's Add Guest form accepts, so the match is made in HMS at check-in (MJ). The document and vehicle types are
-- known now; country and state are added by the phase 2 worker's first read-only run (until then those two go as free text).
CREATE TABLE pathik_lists (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  list_key text NOT NULL CHECK (list_key IN ('document_type', 'vehicle_type', 'country', 'state')),
  value varchar(100) NOT NULL CHECK (btrim(value) <> ''),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pathik_lists_legacy_id_key ON pathik_lists (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX pathik_lists_key_value ON pathik_lists (list_key, lower(value));
CREATE TRIGGER pathik_lists_touch_updated_at BEFORE UPDATE ON pathik_lists FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
INSERT INTO pathik_lists (list_key, value, sort_order) VALUES
  ('document_type', 'Aadhar Card', 1), ('document_type', 'Election Card', 2), ('document_type', 'Driving License', 3), ('document_type', 'Pan Card', 4), ('document_type', 'Passport No', 5),
  ('vehicle_type', 'Car', 1), ('vehicle_type', 'Bike', 2), ('vehicle_type', 'Bus', 3), ('vehicle_type', 'Auto', 4), ('vehicle_type', 'Other', 5);
