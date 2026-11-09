-- rollback: forward-only because the old writable platform.users view is gone; the data stays in platform.logins, the role tables and platform.user_core.
-- Step 7 of decision 72 (MJ, 1 Nov 2026: "I want the data structure as we decided"): nothing writes through a fake users table any more.
--   * platform.users (the compatibility view with write triggers) is now platform.people: a READ-ONLY list of every person (login + profile + core), for screens that list or look people up.
--   * people are made and changed by two functions that write the real tables: platform.create_person and platform.change_person (SECURITY DEFINER, so the web app keeps its narrow table rights).
--   * the sign-in fields are still written straight to platform.logins (0144); the photo and theme straight to platform.user_core (0149).

DROP TRIGGER IF EXISTS users_view_insert ON platform.users;
DROP TRIGGER IF EXISTS users_view_update ON platform.users;
DROP TRIGGER IF EXISTS users_view_delete ON platform.users;
DROP FUNCTION IF EXISTS platform.users_view_insert();
DROP FUNCTION IF EXISTS platform.users_view_update();
DROP FUNCTION IF EXISTS platform.users_view_delete();
ALTER VIEW platform.users RENAME TO people;
REVOKE INSERT, UPDATE ON platform.people FROM hms_app;

-- the database rules that read a person (role scope, session and visit gates, hotel deletion) now read platform.people
DO $re$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.prokind = 'f' AND p.prosrc LIKE '%platform.users%' LOOP
    EXECUTE replace(pg_get_functiondef(f.oid), 'platform.users', 'platform.people');
  END LOOP;
END
$re$;

CREATE FUNCTION platform.create_person(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, public, pg_temp AS $fn$
DECLARE
  v_id uuid := COALESCE((p ->> 'id')::uuid, uuidv7());
  v_created timestamptz := COALESCE((p ->> 'created_at')::timestamptz, now());
  v_deleted timestamptz := (p ->> 'deleted_at')::timestamptz;
BEGIN
  INSERT INTO platform.user_core (id, role_id, account_role, legacy_id, created_at, created_by, ui_theme, photo_file, deleted_by)
  VALUES (v_id, (p ->> 'role_id')::uuid, p ->> 'account_role', (p ->> 'legacy_id')::bigint, v_created, (p ->> 'created_by')::uuid, p ->> 'ui_theme', p ->> 'photo_file', (p ->> 'deleted_by')::uuid);
  INSERT INTO platform.logins (id, username, role_type, password_hash, status, must_change_password, password_changed_at, failed_attempts, lock_level, locked_until,
                               blocked_at, blocked_kind, code_required, last_login_at, deleted_at, created_at)
  VALUES (v_id, p ->> 'username', p ->> 'account_role', p ->> 'password_hash', COALESCE(p ->> 'status', 'active'), COALESCE((p ->> 'must_change_password')::boolean, false),
          (p ->> 'password_changed_at')::timestamptz, COALESCE((p ->> 'failed_attempts')::smallint, 0), COALESCE((p ->> 'lock_level')::smallint, 0), (p ->> 'locked_until')::timestamptz,
          (p ->> 'blocked_at')::timestamptz, p ->> 'blocked_kind', COALESCE((p ->> 'code_required')::boolean, false), (p ->> 'last_login_at')::timestamptz, v_deleted, v_created);
  PERFORM platform.write_login_profile(v_id, p ->> 'account_role', COALESCE(p ->> 'display_name', p ->> 'username'), p ->> 'email', p ->> 'mobile', v_deleted, v_created);
  RETURN v_id;
END
$fn$;

-- Changes the fields NAMED in p (a key with a null value clears the field; a key that is missing is left alone). Returns how many people it changed (0 or 1).
-- With only_live the change is skipped for a deleted person.
CREATE FUNCTION platform.change_person(p_id uuid, p jsonb, only_live boolean DEFAULT false) RETURNS integer
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
  IF p ? 'display_name' OR p ? 'email' OR p ? 'mobile' OR p ? 'account_role' OR p ? 'deleted_at' THEN
    PERFORM platform.write_login_profile(p_id, v_role, CASE WHEN p ? 'display_name' THEN p ->> 'display_name' ELSE cur.display_name END,
                                         CASE WHEN p ? 'email' THEN p ->> 'email' ELSE cur.email END, CASE WHEN p ? 'mobile' THEN p ->> 'mobile' ELSE cur.mobile END, v_deleted, cur.created_at);
  END IF;
  RETURN 1;
END
$fn$;

REVOKE ALL ON FUNCTION platform.create_person(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.change_person(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.create_person(jsonb) TO hms_app;
GRANT EXECUTE ON FUNCTION platform.change_person(uuid, jsonb, boolean) TO hms_app;
