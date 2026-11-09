-- rollback: forward-only because the email and mobile move from the role tables to platform.logins and platform.login_contacts is removed (restore from a backup taken before this migration).
-- MJ, 1 Nov 2026: "can we do in one?" Email and mobile are saved ONCE, on the login, next to the username they sign in with:
--   * platform.logins now holds email and mobile, each unique among living people through a normal unique index (so the guard table platform.login_contacts is not needed and is removed);
--   * the seven role tables keep the person's name only (plus their own links to hotel, group, Guest ID or Company GST).

-- 1. the shared columns, with the rules the users table had
ALTER TABLE platform.logins ADD COLUMN email text CONSTRAINT users_email_check CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
ALTER TABLE platform.logins ADD COLUMN mobile text CONSTRAINT users_mobile_check CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$');

DO $move$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['super_admins', 'platform_admins', 'group_hotel_admins', 'hotel_admins', 'hotel_users', 'corporate_users', 'guest_users'] LOOP
    EXECUTE format('UPDATE platform.logins l SET email = p.email, mobile = p.mobile FROM platform.%I p WHERE p.login_id = l.id AND l.deleted_at IS NULL', t);
  END LOOP;
END
$move$;

-- 2. the guard table goes, its two rules become indexes on the login
DROP TRIGGER IF EXISTS logins_free_contacts ON platform.logins;
DROP FUNCTION IF EXISTS platform.logins_free_contacts();
DROP TABLE IF EXISTS platform.login_contacts;
CREATE UNIQUE INDEX users_email_key ON platform.logins (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_mobile_key ON platform.logins (mobile) WHERE mobile IS NOT NULL AND deleted_at IS NULL;

-- 3. the role tables lose email and mobile; the lists that read them are made again
DROP VIEW IF EXISTS platform.people;
DROP VIEW IF EXISTS platform.login_profiles;
ALTER TABLE platform.super_admins DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile;
ALTER TABLE platform.platform_admins DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile;
ALTER TABLE platform.group_hotel_admins DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile;
ALTER TABLE platform.hotel_admins DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile;
ALTER TABLE platform.hotel_users DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile;
ALTER TABLE platform.corporate_users DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile;
ALTER TABLE platform.guest_users DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile;

CREATE VIEW platform.login_profiles AS
  SELECT login_id, display_name FROM platform.super_admins
  UNION ALL SELECT login_id, display_name FROM platform.platform_admins
  UNION ALL SELECT login_id, display_name FROM platform.group_hotel_admins
  UNION ALL SELECT login_id, display_name FROM platform.hotel_admins
  UNION ALL SELECT login_id, display_name FROM platform.hotel_users
  UNION ALL SELECT login_id, display_name FROM platform.corporate_users
  UNION ALL SELECT login_id, display_name FROM platform.guest_users;

CREATE VIEW platform.people AS
  SELECT c.id, l.username, l.email, l.mobile, COALESCE(p.display_name, l.username) AS display_name, l.password_hash, c.role_id, c.account_role, l.status,
         l.must_change_password, l.password_changed_at, l.failed_attempts, l.lock_level, l.locked_until, l.blocked_at, l.blocked_kind, l.code_required, l.last_login_at,
         c.legacy_id, c.created_at, c.updated_at, l.deleted_at, c.deleted_by, c.created_by, c.ui_theme, c.photo_file
    FROM platform.user_core c
    JOIN platform.logins l ON l.id = c.id
    LEFT JOIN platform.login_profiles p ON p.login_id = c.id;
GRANT SELECT ON platform.people TO hms_app;
GRANT SELECT ON platform.login_profiles TO hms_app;

-- 4. the writers: the profile row now holds the name only
DROP FUNCTION IF EXISTS platform.write_login_profile(uuid, text, text, text, text, timestamptz, timestamptz);
CREATE FUNCTION platform.write_login_profile(p_id uuid, p_role text, p_name text, p_deleted timestamptz, p_created timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
DECLARE
  t text;
BEGIN
  t := CASE p_role
    WHEN 'super_admin' THEN 'super_admins' WHEN 'platform_admin' THEN 'platform_admins' WHEN 'group_hotel_admin' THEN 'group_hotel_admins'
    WHEN 'hotel_admin' THEN 'hotel_admins' WHEN 'hotel_user' THEN 'hotel_users' WHEN 'corporate_user' THEN 'corporate_users' ELSE 'guest_users' END;
  -- a person whose role changed leaves the old profile table
  DELETE FROM platform.super_admins WHERE login_id = p_id AND t <> 'super_admins';
  DELETE FROM platform.platform_admins WHERE login_id = p_id AND t <> 'platform_admins';
  DELETE FROM platform.group_hotel_admins WHERE login_id = p_id AND t <> 'group_hotel_admins';
  DELETE FROM platform.hotel_admins WHERE login_id = p_id AND t <> 'hotel_admins';
  DELETE FROM platform.hotel_users WHERE login_id = p_id AND t <> 'hotel_users';
  DELETE FROM platform.corporate_users WHERE login_id = p_id AND t <> 'corporate_users';
  DELETE FROM platform.guest_users WHERE login_id = p_id AND t <> 'guest_users';
  EXECUTE format(
    'INSERT INTO platform.%I (login_id, display_name, deleted_at, created_at) VALUES ($1, $2, $3, $4) '
    'ON CONFLICT (login_id) DO UPDATE SET display_name = EXCLUDED.display_name, deleted_at = EXCLUDED.deleted_at',
    t) USING p_id, p_name, p_deleted, p_created;
END
$fn$;
REVOKE ALL ON FUNCTION platform.write_login_profile(uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION platform.create_person(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, public, pg_temp AS $fn$
DECLARE
  v_id uuid := COALESCE((p ->> 'id')::uuid, uuidv7());
  v_created timestamptz := COALESCE((p ->> 'created_at')::timestamptz, now());
  v_deleted timestamptz := (p ->> 'deleted_at')::timestamptz;
BEGIN
  INSERT INTO platform.user_core (id, role_id, account_role, legacy_id, created_at, created_by, ui_theme, photo_file, deleted_by)
  VALUES (v_id, (p ->> 'role_id')::uuid, p ->> 'account_role', (p ->> 'legacy_id')::bigint, v_created, (p ->> 'created_by')::uuid, p ->> 'ui_theme', p ->> 'photo_file', (p ->> 'deleted_by')::uuid);
  INSERT INTO platform.logins (id, username, email, mobile, role_type, password_hash, status, must_change_password, password_changed_at, failed_attempts, lock_level, locked_until,
                               blocked_at, blocked_kind, code_required, last_login_at, deleted_at, created_at)
  VALUES (v_id, p ->> 'username', p ->> 'email', p ->> 'mobile', p ->> 'account_role', p ->> 'password_hash', COALESCE(p ->> 'status', 'active'), COALESCE((p ->> 'must_change_password')::boolean, false),
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
  UPDATE platform.user_core SET
    role_id = CASE WHEN p ? 'role_id' THEN (p ->> 'role_id')::uuid ELSE role_id END,
    account_role = v_role,
    legacy_id = CASE WHEN p ? 'legacy_id' THEN (p ->> 'legacy_id')::bigint ELSE legacy_id END,
    created_by = CASE WHEN p ? 'created_by' THEN (p ->> 'created_by')::uuid ELSE created_by END,
    deleted_by = CASE WHEN p ? 'deleted_by' THEN (p ->> 'deleted_by')::uuid ELSE deleted_by END,
    ui_theme = CASE WHEN p ? 'ui_theme' THEN p ->> 'ui_theme' ELSE ui_theme END,
    photo_file = CASE WHEN p ? 'photo_file' THEN p ->> 'photo_file' ELSE photo_file END
   WHERE id = p_id;
  UPDATE platform.logins SET
    username = CASE WHEN p ? 'username' THEN p ->> 'username' ELSE username END,
    email = CASE WHEN p ? 'email' THEN p ->> 'email' ELSE email END,
    mobile = CASE WHEN p ? 'mobile' THEN p ->> 'mobile' ELSE mobile END,
    role_type = v_role,
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
