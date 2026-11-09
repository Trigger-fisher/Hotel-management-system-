-- rollback: forward-only because the old columns of platform.users are removed after their data was moved into platform.logins and the role tables (restore from a backup taken before this migration).
-- Step 5 of decision 72 (MJ, 1 Nov 2026: "migrate all the data which we can and delete the other"): the data of platform.users now lives in ONE place each.
--   * who signs in and how           -> platform.logins          (username, password hash, status, locks, blocks, emailed-code rule, last sign-in, deleted flag)
--   * the person's own profile       -> the role table           (name, email, mobile)
--   * what is left of the old table  -> platform.user_core       (id, usual role, dashboard role, legacy id, creator, theme, photo, timestamps)
--   * email and mobile stay unique across ALL roles through platform.login_contacts (the same rule the old partial unique indexes gave)
-- platform.users stays as a VIEW over those tables with the same columns, so every existing query keeps working, while the old columns no longer exist as stored data.
-- Writes through the view are carried to the right tables by INSTEAD OF triggers (SECURITY DEFINER).

-- 0. make sure every person is in the new tables before the old columns go
DO $copy$
DECLARE
  u platform.users;
BEGIN
  FOR u IN SELECT * FROM platform.users LOOP
    PERFORM platform.sync_login_directory(u);
  END LOOP;
END
$copy$;

-- 1. the contact guard: one email and one mobile belong to one living person, whatever their role
-- no-app-access: written only by the platform.users view triggers (SECURITY DEFINER).
CREATE TABLE platform.login_contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'mobile')),
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX login_contacts_login_kind_key ON platform.login_contacts (login_id, kind);
CREATE TRIGGER login_contacts_touch BEFORE UPDATE ON platform.login_contacts FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
INSERT INTO platform.login_contacts (login_id, kind, value) SELECT id, 'email', email FROM platform.users WHERE email IS NOT NULL AND deleted_at IS NULL;
INSERT INTO platform.login_contacts (login_id, kind, value) SELECT id, 'mobile', mobile FROM platform.users WHERE mobile IS NOT NULL AND deleted_at IS NULL;

-- 2. the old directory triggers go (the view triggers below replace them)
DROP TRIGGER IF EXISTS logins_credentials_to_users ON platform.logins;
DROP FUNCTION IF EXISTS platform.logins_credentials_to_users();
DROP TRIGGER IF EXISTS users_login_directory ON platform.users;
DROP FUNCTION IF EXISTS platform.users_login_directory();
DROP FUNCTION IF EXISTS platform.sync_login_directory(platform.users);

-- 3. the old table becomes the core and loses the moved columns
ALTER TABLE platform.users RENAME TO user_core;
ALTER TABLE platform.user_core
  DROP COLUMN IF EXISTS username, DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS mobile, DROP COLUMN IF EXISTS display_name, DROP COLUMN IF EXISTS password_hash, DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS must_change_password, DROP COLUMN IF EXISTS password_changed_at, DROP COLUMN IF EXISTS failed_attempts, DROP COLUMN IF EXISTS lock_level, DROP COLUMN IF EXISTS locked_until,
  DROP COLUMN IF EXISTS blocked_at, DROP COLUMN IF EXISTS blocked_kind, DROP COLUMN IF EXISTS code_required, DROP COLUMN IF EXISTS last_login_at, DROP COLUMN IF EXISTS deleted_at;

CREATE UNIQUE INDEX users_email_key ON platform.login_contacts (value) WHERE kind = 'email';
CREATE UNIQUE INDEX users_mobile_key ON platform.login_contacts (value) WHERE kind = 'mobile';

-- the role-scope check read a table named users
CREATE OR REPLACE FUNCTION platform.check_user_role_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME IN ('users', 'user_core') THEN
    PERFORM platform.check_user_role(COALESCE(NEW.id, OLD.id));
  ELSE
    PERFORM platform.check_user_role(COALESCE(NEW.user_id, OLD.user_id));
  END IF;
  RETURN NULL;
END $$;

-- 4. every role's profile as one list (read only)
CREATE VIEW platform.login_profiles AS
  SELECT login_id, display_name, email, mobile FROM platform.super_admins
  UNION ALL SELECT login_id, display_name, email, mobile FROM platform.platform_admins
  UNION ALL SELECT login_id, display_name, email, mobile FROM platform.group_hotel_admins
  UNION ALL SELECT login_id, display_name, email, mobile FROM platform.hotel_admins
  UNION ALL SELECT login_id, display_name, email, mobile FROM platform.hotel_users
  UNION ALL SELECT login_id, display_name, email, mobile FROM platform.corporate_users
  UNION ALL SELECT login_id, display_name, email, mobile FROM platform.guest_users;

-- 5. platform.users: the same columns as before, read from their new homes
CREATE VIEW platform.users AS
  SELECT c.id, l.username, p.email, p.mobile, COALESCE(p.display_name, l.username) AS display_name, l.password_hash, c.role_id, c.account_role, l.status,
         l.must_change_password, l.password_changed_at, l.failed_attempts, l.lock_level, l.locked_until, l.blocked_at, l.blocked_kind, l.code_required, l.last_login_at,
         c.legacy_id, c.created_at, c.updated_at, l.deleted_at, c.deleted_by, c.created_by, c.ui_theme, c.photo_file
    FROM platform.user_core c
    JOIN platform.logins l ON l.id = c.id
    LEFT JOIN platform.login_profiles p ON p.login_id = c.id;
ALTER VIEW platform.users ALTER COLUMN id SET DEFAULT uuidv7();
ALTER VIEW platform.users ALTER COLUMN status SET DEFAULT 'active';
ALTER VIEW platform.users ALTER COLUMN must_change_password SET DEFAULT false;
ALTER VIEW platform.users ALTER COLUMN failed_attempts SET DEFAULT 0;
ALTER VIEW platform.users ALTER COLUMN lock_level SET DEFAULT 0;
ALTER VIEW platform.users ALTER COLUMN code_required SET DEFAULT false;
ALTER VIEW platform.users ALTER COLUMN created_at SET DEFAULT now();
ALTER VIEW platform.users ALTER COLUMN updated_at SET DEFAULT now();

-- 6. the one function that writes a person's profile row (of the right role, and only that one) and their contact guard
CREATE FUNCTION platform.write_login_profile(p_id uuid, p_role text, p_name text, p_email text, p_mobile text, p_deleted timestamptz, p_created timestamptz) RETURNS void
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
    'INSERT INTO platform.%I (login_id, display_name, email, mobile, deleted_at, created_at) VALUES ($1, $2, $3, $4, $5, $6) '
    'ON CONFLICT (login_id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, mobile = EXCLUDED.mobile, deleted_at = EXCLUDED.deleted_at',
    t) USING p_id, p_name, p_email, p_mobile, p_deleted, p_created;
  -- the contact guard: a living person holds their email and mobile, a deleted one holds nothing
  DELETE FROM platform.login_contacts WHERE login_id = p_id AND ((kind = 'email' AND (p_email IS NULL OR p_deleted IS NOT NULL)) OR (kind = 'mobile' AND (p_mobile IS NULL OR p_deleted IS NOT NULL)));
  IF p_deleted IS NULL AND p_email IS NOT NULL THEN
    INSERT INTO platform.login_contacts (login_id, kind, value) VALUES (p_id, 'email', p_email) ON CONFLICT (login_id, kind) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF p_deleted IS NULL AND p_mobile IS NOT NULL THEN
    INSERT INTO platform.login_contacts (login_id, kind, value) VALUES (p_id, 'mobile', p_mobile) ON CONFLICT (login_id, kind) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION platform.write_login_profile(uuid, text, text, text, text, timestamptz, timestamptz) FROM PUBLIC;

CREATE FUNCTION platform.users_view_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  INSERT INTO platform.user_core (id, role_id, account_role, legacy_id, created_at, created_by, ui_theme, photo_file, deleted_by)
  VALUES (NEW.id, NEW.role_id, NEW.account_role, NEW.legacy_id, NEW.created_at, NEW.created_by, NEW.ui_theme, NEW.photo_file, NEW.deleted_by);
  INSERT INTO platform.logins (id, username, role_type, password_hash, status, must_change_password, password_changed_at, failed_attempts, lock_level, locked_until,
                               blocked_at, blocked_kind, code_required, last_login_at, deleted_at, created_at)
  VALUES (NEW.id, NEW.username, NEW.account_role, NEW.password_hash, NEW.status, NEW.must_change_password, NEW.password_changed_at, NEW.failed_attempts, NEW.lock_level,
          NEW.locked_until, NEW.blocked_at, NEW.blocked_kind, NEW.code_required, NEW.last_login_at, NEW.deleted_at, NEW.created_at);
  PERFORM platform.write_login_profile(NEW.id, NEW.account_role, NEW.display_name, NEW.email, NEW.mobile, NEW.deleted_at, NEW.created_at);
  RETURN NEW;
END
$fn$;

CREATE FUNCTION platform.users_view_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  UPDATE platform.user_core SET role_id = NEW.role_id, account_role = NEW.account_role, legacy_id = NEW.legacy_id, created_by = NEW.created_by, ui_theme = NEW.ui_theme,
         photo_file = NEW.photo_file, deleted_by = NEW.deleted_by
   WHERE id = OLD.id AND (role_id, account_role, legacy_id, created_by, ui_theme, photo_file, deleted_by) IS DISTINCT FROM
         (NEW.role_id, NEW.account_role, NEW.legacy_id, NEW.created_by, NEW.ui_theme, NEW.photo_file, NEW.deleted_by);
  UPDATE platform.logins SET username = NEW.username, role_type = NEW.account_role, password_hash = NEW.password_hash, status = NEW.status,
         must_change_password = NEW.must_change_password, password_changed_at = NEW.password_changed_at, failed_attempts = NEW.failed_attempts, lock_level = NEW.lock_level,
         locked_until = NEW.locked_until, blocked_at = NEW.blocked_at, blocked_kind = NEW.blocked_kind, code_required = NEW.code_required, last_login_at = NEW.last_login_at,
         deleted_at = NEW.deleted_at
   WHERE id = OLD.id;
  IF (OLD.display_name, OLD.email, OLD.mobile, OLD.account_role, OLD.deleted_at) IS DISTINCT FROM (NEW.display_name, NEW.email, NEW.mobile, NEW.account_role, NEW.deleted_at) THEN
    PERFORM platform.write_login_profile(OLD.id, NEW.account_role, NEW.display_name, NEW.email, NEW.mobile, NEW.deleted_at, OLD.created_at);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION platform.users_view_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  DELETE FROM platform.user_core WHERE id = OLD.id;
  RETURN OLD;
END
$fn$;

REVOKE ALL ON FUNCTION platform.users_view_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.users_view_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.users_view_delete() FROM PUBLIC;
CREATE TRIGGER users_view_insert INSTEAD OF INSERT ON platform.users FOR EACH ROW EXECUTE FUNCTION platform.users_view_insert();
CREATE TRIGGER users_view_update INSTEAD OF UPDATE ON platform.users FOR EACH ROW EXECUTE FUNCTION platform.users_view_update();
CREATE TRIGGER users_view_delete INSTEAD OF DELETE ON platform.users FOR EACH ROW EXECUTE FUNCTION platform.users_view_delete();

-- 7. rights: the app reads and changes people through the view exactly as before; it never touches the core table or the guard
GRANT SELECT, INSERT, UPDATE ON platform.users TO hms_app;
GRANT SELECT ON platform.login_profiles TO hms_app;
