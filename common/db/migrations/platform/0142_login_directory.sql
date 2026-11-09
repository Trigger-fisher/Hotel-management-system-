-- rollback: DROP TRIGGER IF EXISTS users_login_directory ON platform.users; DROP FUNCTION IF EXISTS platform.users_login_directory(); DROP FUNCTION IF EXISTS platform.sync_login_directory(platform.users); DROP TABLE IF EXISTS platform.guest_users, platform.corporate_users, platform.hotel_users, platform.hotel_admins, platform.group_hotel_admins, platform.platform_admins, platform.super_admins, platform.logins;
-- The login directory and one table per role (MJ, 1 Nov 2026: "Superadmin, Platform admin, Group Hotel Admin, Hotel Admin, Corporate user, Guest user: individual table; username login: shared").
--
-- EXPAND STEP of a safe move (the old table stays the working copy until the code is switched):
--   * platform.logins          the ONE shared place for the username and everything about signing in (password hash, locks, blocks, the emailed-code rule, last sign-in).
--                              Its id IS the id of the same person in platform.users, so every existing reference (sessions, user_hotels, audit, guests, companies ...) keeps working.
--   * one table per role       super_admins, platform_admins, group_hotel_admins, hotel_admins, hotel_users, corporate_users, guest_users: the person's own profile (name, email, mobile).
--                              A login points to exactly one of them, chosen by logins.role_type. (employee_user was retired in decision 58 and has no table.)
--   * Guest ID and Company GST stay shared in platform.guests and platform.companies (0132); a hotel's guest or corporate profile links to them by key.
--   * Existing users are copied in below; a trigger on platform.users keeps the new tables in step with every later insert, change and delete, so the app can be moved over one part at a time
--     (the next steps read from platform.logins, then retire the profile columns of platform.users).

-- no-app-access: written only by the sign-in directory triggers (SECURITY DEFINER) and the migration runner until the sign-in code is moved over.
CREATE TABLE platform.logins (
  id uuid PRIMARY KEY REFERENCES platform.users (id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  role_type text NOT NULL CHECK (role_type IN ('super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user')),
  password_hash text NOT NULL CHECK (password_hash ~ '^\$argon2id\$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled', 'pending_approval')),
  must_change_password boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  lock_level smallint NOT NULL DEFAULT 0 CHECK (lock_level BETWEEN 0 AND 6),
  locked_until timestamptz,
  blocked_at timestamptz,
  blocked_kind text CHECK (blocked_kind IN ('admin', 'auto')),
  code_required boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logins_blocked_pair CHECK ((blocked_at IS NULL) = (blocked_kind IS NULL))
);
-- the one username rule of the whole system: unique among the people who are not deleted
CREATE UNIQUE INDEX logins_username_key ON platform.logins (username) WHERE deleted_at IS NULL;
CREATE INDEX logins_role_type_idx ON platform.logins (role_type);
CREATE TRIGGER logins_touch BEFORE UPDATE ON platform.logins FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- One profile table per role. login_id points to platform.logins (one profile per login); the table keeps its own id for the references the next steps add.
-- no-app-access: only the sign-in directory triggers (SECURITY DEFINER) and the migration runner write these tables for now; the app is granted rights when it is moved over.
CREATE TABLE platform.super_admins (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX super_admins_login_key ON platform.super_admins (login_id);
CREATE TRIGGER super_admins_touch BEFORE UPDATE ON platform.super_admins FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
-- no-app-access: same as super_admins above.
CREATE TABLE platform.platform_admins (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admins_login_key ON platform.platform_admins (login_id);
CREATE TRIGGER platform_admins_touch BEFORE UPDATE ON platform.platform_admins FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
-- no-app-access: same as super_admins above.
CREATE TABLE platform.group_hotel_admins (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_hotel_admins_login_key ON platform.group_hotel_admins (login_id);
CREATE TRIGGER group_hotel_admins_touch BEFORE UPDATE ON platform.group_hotel_admins FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
-- no-app-access: same as super_admins above.
CREATE TABLE platform.hotel_admins (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hotel_admins_login_key ON platform.hotel_admins (login_id);
CREATE TRIGGER hotel_admins_touch BEFORE UPDATE ON platform.hotel_admins FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
-- no-app-access: same as super_admins above.
CREATE TABLE platform.hotel_users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hotel_users_login_key ON platform.hotel_users (login_id);
CREATE TRIGGER hotel_users_touch BEFORE UPDATE ON platform.hotel_users FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
-- no-app-access: same as super_admins above.
CREATE TABLE platform.corporate_users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX corporate_users_login_key ON platform.corporate_users (login_id);
CREATE TRIGGER corporate_users_touch BEFORE UPDATE ON platform.corporate_users FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
-- no-app-access: same as super_admins above.
CREATE TABLE platform.guest_users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guest_users_login_key ON platform.guest_users (login_id);
CREATE TRIGGER guest_users_touch BEFORE UPDATE ON platform.guest_users FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
-- The one function that writes a person into the directory: the login row, and the profile row of the right role (and only that one).
-- SECURITY DEFINER: the web app's role signs people in and out of platform.users and must not need rights on the new tables.
CREATE FUNCTION platform.sync_login_directory(u platform.users) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
DECLARE
  t text;
BEGIN
  -- a role with no table (the retired employee_user) has no login row either
  IF u.account_role NOT IN ('super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user') THEN
    DELETE FROM platform.logins WHERE id = u.id;
    RETURN;
  END IF;
  INSERT INTO platform.logins (id, username, role_type, password_hash, status, must_change_password, password_changed_at, failed_attempts, lock_level, locked_until,
                               blocked_at, blocked_kind, code_required, last_login_at, deleted_at, created_at)
  VALUES (u.id, u.username, u.account_role, u.password_hash, u.status, u.must_change_password, u.password_changed_at, u.failed_attempts, u.lock_level, u.locked_until,
          u.blocked_at, u.blocked_kind, u.code_required, u.last_login_at, u.deleted_at, u.created_at)
  ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, role_type = EXCLUDED.role_type, password_hash = EXCLUDED.password_hash, status = EXCLUDED.status,
    must_change_password = EXCLUDED.must_change_password, password_changed_at = EXCLUDED.password_changed_at, failed_attempts = EXCLUDED.failed_attempts,
    lock_level = EXCLUDED.lock_level, locked_until = EXCLUDED.locked_until, blocked_at = EXCLUDED.blocked_at, blocked_kind = EXCLUDED.blocked_kind,
    code_required = EXCLUDED.code_required, last_login_at = EXCLUDED.last_login_at, deleted_at = EXCLUDED.deleted_at;

  t := CASE u.account_role
    WHEN 'super_admin' THEN 'super_admins' WHEN 'platform_admin' THEN 'platform_admins' WHEN 'group_hotel_admin' THEN 'group_hotel_admins'
    WHEN 'hotel_admin' THEN 'hotel_admins' WHEN 'hotel_user' THEN 'hotel_users' WHEN 'corporate_user' THEN 'corporate_users' ELSE 'guest_users' END;
  -- a person whose role changed leaves the old profile table
  DELETE FROM platform.super_admins WHERE login_id = u.id AND t <> 'super_admins';
  DELETE FROM platform.platform_admins WHERE login_id = u.id AND t <> 'platform_admins';
  DELETE FROM platform.group_hotel_admins WHERE login_id = u.id AND t <> 'group_hotel_admins';
  DELETE FROM platform.hotel_admins WHERE login_id = u.id AND t <> 'hotel_admins';
  DELETE FROM platform.hotel_users WHERE login_id = u.id AND t <> 'hotel_users';
  DELETE FROM platform.corporate_users WHERE login_id = u.id AND t <> 'corporate_users';
  DELETE FROM platform.guest_users WHERE login_id = u.id AND t <> 'guest_users';
  EXECUTE format(
    'INSERT INTO platform.%I (login_id, display_name, email, mobile, deleted_at, created_at) VALUES ($1, $2, $3, $4, $5, $6) '
    'ON CONFLICT (login_id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, mobile = EXCLUDED.mobile, deleted_at = EXCLUDED.deleted_at',
    t) USING u.id, u.display_name, u.email, u.mobile, u.deleted_at, u.created_at;
END
$fn$;

CREATE FUNCTION platform.users_login_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  PERFORM platform.sync_login_directory(NEW);
  RETURN NEW;
END
$fn$;
CREATE TRIGGER users_login_directory AFTER INSERT OR UPDATE ON platform.users FOR EACH ROW EXECUTE FUNCTION platform.users_login_directory();
-- a deleted users row takes its login (and so its profile) with it: the foreign keys above cascade
-- (platform.logins.id references platform.users ON DELETE CASCADE)

-- Existing people are copied in once.
DO $copy$
DECLARE
  u platform.users;
BEGIN
  FOR u IN SELECT * FROM platform.users LOOP
    PERFORM platform.sync_login_directory(u);
  END LOOP;
END
$copy$;

REVOKE ALL ON FUNCTION platform.sync_login_directory(platform.users) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.users_login_directory() FROM PUBLIC;
