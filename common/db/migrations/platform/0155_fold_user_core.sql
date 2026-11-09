-- rollback: forward-only because platform.user_core is removed after its data moved into platform.logins (restore from a backup taken before this migration).
-- MJ, 1 Nov 2026: "remove all the things, or migrate, which is not part of the new design". The new design is: a shared login, one table per role, Guest ID and Company GST shared, isolated hotels.
-- platform.user_core was the last piece of the old users table and is not in that design, so its fields move onto the login (the usual role, the creator, the theme, the photo, the
-- legacy id) and the table is removed. Every foreign key that pointed at the old users table now points at platform.logins (the same ids).

-- 1. the fields move onto the login
ALTER TABLE platform.logins ADD COLUMN role_id uuid;
ALTER TABLE platform.logins ADD COLUMN legacy_id bigint;
ALTER TABLE platform.logins ADD COLUMN created_by uuid;
ALTER TABLE platform.logins ADD COLUMN deleted_by uuid;
ALTER TABLE platform.logins ADD COLUMN ui_theme text CHECK (ui_theme IN ('light', 'dark'));
ALTER TABLE platform.logins ADD COLUMN photo_file text CHECK (photo_file IS NULL OR photo_file ~ '^[a-z0-9-]{8,120}\.webp$');

UPDATE platform.logins l SET role_id = c.role_id, legacy_id = c.legacy_id, created_by = c.created_by, deleted_by = c.deleted_by, ui_theme = c.ui_theme, photo_file = c.photo_file
  FROM platform.user_core c WHERE c.id = l.id;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.user_core c WHERE NOT EXISTS (SELECT 1 FROM platform.logins l WHERE l.id = c.id)) THEN
    RAISE EXCEPTION 'a person of platform.user_core has no login: nothing is moved';
  END IF;
END
$check$;

ALTER TABLE platform.logins ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE platform.logins ADD CONSTRAINT logins_role_id_fkey FOREIGN KEY (role_id) REFERENCES platform.roles (id) ON DELETE RESTRICT;
ALTER TABLE platform.logins ADD CONSTRAINT logins_created_by_fkey FOREIGN KEY (created_by) REFERENCES platform.logins (id) ON DELETE SET NULL;
ALTER TABLE platform.logins ADD CONSTRAINT logins_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES platform.logins (id) ON DELETE SET NULL;
CREATE INDEX logins_role_id_idx ON platform.logins (role_id);
CREATE INDEX logins_created_by_idx ON platform.logins (created_by);
CREATE INDEX logins_deleted_by_idx ON platform.logins (deleted_by);
CREATE UNIQUE INDEX logins_legacy_id_key ON platform.logins (legacy_id) WHERE legacy_id IS NOT NULL;

-- 2. everything that pointed at the old table now points at the login (same ids, same rules)
DROP VIEW IF EXISTS platform.people;
DO $fk$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT c.conrelid::regclass AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.contype = 'f' AND c.confrelid = 'platform.user_core'::regclass AND c.conrelid <> 'platform.user_core'::regclass AND c.conrelid <> 'platform.logins'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', f.tbl, f.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', f.tbl, f.conname, replace(f.def, 'user_core(', 'logins('));
  END LOOP;
END
$fk$;
ALTER TABLE platform.logins DROP CONSTRAINT IF EXISTS logins_id_fkey;

-- 3. the role-scope rule is now a rule of the login
CREATE OR REPLACE FUNCTION platform.check_user_role_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('users', 'user_core', 'logins') THEN
    PERFORM platform.check_user_role(COALESCE(NEW.id, OLD.id));
  ELSE
    PERFORM platform.check_user_role(COALESCE(NEW.user_id, OLD.user_id));
  END IF;
  RETURN NULL;
END $$;

DROP TABLE IF EXISTS platform.user_core;
CREATE CONSTRAINT TRIGGER users_role_scope AFTER INSERT OR UPDATE OF role_id ON platform.logins
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION platform.check_user_role_trg();
GRANT UPDATE (photo_file, ui_theme) ON platform.logins TO hms_app;

-- 4. the read-only list of people
CREATE VIEW platform.people AS
  SELECT l.id, l.username, l.email, l.mobile, COALESCE(p.display_name, l.username) AS display_name, l.password_hash, l.role_id, l.role_type AS account_role, l.status,
         l.must_change_password, l.password_changed_at, l.failed_attempts, l.lock_level, l.locked_until, l.blocked_at, l.blocked_kind, l.code_required, l.last_login_at,
         l.legacy_id, l.created_at, l.updated_at, l.deleted_at, l.deleted_by, l.created_by, l.ui_theme, l.photo_file
    FROM platform.logins l
    LEFT JOIN platform.login_profiles p ON p.login_id = l.id;
GRANT SELECT ON platform.people TO hms_app;

-- 5. the two writers now write the login (and the name in the role table)
CREATE OR REPLACE FUNCTION platform.create_person(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, public, pg_temp AS $fn$
DECLARE
  v_id uuid := COALESCE((p ->> 'id')::uuid, uuidv7());
  v_created timestamptz := COALESCE((p ->> 'created_at')::timestamptz, now());
  v_deleted timestamptz := (p ->> 'deleted_at')::timestamptz;
BEGIN
  INSERT INTO platform.logins (id, username, email, mobile, role_type, role_id, legacy_id, created_by, deleted_by, ui_theme, photo_file, password_hash, status, must_change_password,
                               password_changed_at, failed_attempts, lock_level, locked_until, blocked_at, blocked_kind, code_required, last_login_at, deleted_at, created_at)
  VALUES (v_id, p ->> 'username', p ->> 'email', p ->> 'mobile', p ->> 'account_role', (p ->> 'role_id')::uuid, (p ->> 'legacy_id')::bigint, (p ->> 'created_by')::uuid,
          (p ->> 'deleted_by')::uuid, p ->> 'ui_theme', p ->> 'photo_file', p ->> 'password_hash', COALESCE(p ->> 'status', 'active'), COALESCE((p ->> 'must_change_password')::boolean, false),
          (p ->> 'password_changed_at')::timestamptz, COALESCE((p ->> 'failed_attempts')::smallint, 0), COALESCE((p ->> 'lock_level')::smallint, 0), (p ->> 'locked_until')::timestamptz,
          (p ->> 'blocked_at')::timestamptz, p ->> 'blocked_kind', COALESCE((p ->> 'code_required')::boolean, false), (p ->> 'last_login_at')::timestamptz, v_deleted, v_created);
  PERFORM platform.write_login_profile(v_id, p ->> 'account_role', COALESCE(p ->> 'display_name', p ->> 'username'), v_deleted, v_created);
  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION platform.change_person(p_id uuid, p jsonb, only_live boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, public, pg_temp AS $fn$
DECLARE
  cur platform.people;
  v_role text;
  v_deleted timestamptz;
BEGIN
  SELECT * INTO cur FROM platform.people WHERE id = p_id;
  IF NOT FOUND OR (only_live AND cur.deleted_at IS NOT NULL) THEN
    RETURN 0;
  END IF;
  v_role := CASE WHEN p ? 'account_role' THEN p ->> 'account_role' ELSE cur.account_role END;
  v_deleted := CASE WHEN p ? 'deleted_at' THEN (p ->> 'deleted_at')::timestamptz ELSE cur.deleted_at END;
  UPDATE platform.logins SET
    username = CASE WHEN p ? 'username' THEN p ->> 'username' ELSE username END,
    email = CASE WHEN p ? 'email' THEN p ->> 'email' ELSE email END,
    mobile = CASE WHEN p ? 'mobile' THEN p ->> 'mobile' ELSE mobile END,
    role_type = v_role,
    role_id = CASE WHEN p ? 'role_id' THEN (p ->> 'role_id')::uuid ELSE role_id END,
    legacy_id = CASE WHEN p ? 'legacy_id' THEN (p ->> 'legacy_id')::bigint ELSE legacy_id END,
    created_by = CASE WHEN p ? 'created_by' THEN (p ->> 'created_by')::uuid ELSE created_by END,
    deleted_by = CASE WHEN p ? 'deleted_by' THEN (p ->> 'deleted_by')::uuid ELSE deleted_by END,
    ui_theme = CASE WHEN p ? 'ui_theme' THEN p ->> 'ui_theme' ELSE ui_theme END,
    photo_file = CASE WHEN p ? 'photo_file' THEN p ->> 'photo_file' ELSE photo_file END,
    password_hash = CASE WHEN p ? 'password_hash' THEN p ->> 'password_hash' ELSE password_hash END,
    status = CASE WHEN p ? 'status' THEN p ->> 'status' ELSE status END,
    must_change_password = CASE WHEN p ? 'must_change_password' THEN (p ->> 'must_change_password')::boolean ELSE must_change_password END,
    password_changed_at = CASE WHEN p ? 'password_changed_at' THEN (p ->> 'password_changed_at')::timestamptz ELSE password_changed_at END,
    failed_attempts = CASE WHEN p ? 'failed_attempts' THEN (p ->> 'failed_attempts')::smallint ELSE failed_attempts END,
    lock_level = CASE WHEN p ? 'lock_level' THEN (p ->> 'lock_level')::smallint ELSE lock_level END,
    locked_until = CASE WHEN p ? 'locked_until' THEN (p ->> 'locked_until')::timestamptz ELSE locked_until END,
    blocked_at = CASE WHEN p ? 'blocked_at' THEN (p ->> 'blocked_at')::timestamptz ELSE blocked_at END,
    blocked_kind = CASE WHEN p ? 'blocked_kind' THEN p ->> 'blocked_kind' ELSE blocked_kind END,
    code_required = CASE WHEN p ? 'code_required' THEN (p ->> 'code_required')::boolean ELSE code_required END,
    last_login_at = CASE WHEN p ? 'last_login_at' THEN (p ->> 'last_login_at')::timestamptz ELSE last_login_at END,
    deleted_at = v_deleted
   WHERE id = p_id;
  IF p ? 'display_name' OR p ? 'account_role' OR p ? 'deleted_at' THEN
    PERFORM platform.write_login_profile(p_id, v_role, CASE WHEN p ? 'display_name' THEN p ->> 'display_name' ELSE cur.display_name END, v_deleted, cur.created_at);
  END IF;
  RETURN 1;
END
$fn$;
