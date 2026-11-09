-- rollback: DROP FUNCTION IF EXISTS platform.check_user_role_trg() CASCADE; DROP FUNCTION IF EXISTS platform.check_user_role(uuid); DROP TABLE IF EXISTS platform.user_permissions; DROP TABLE IF EXISTS platform.user_hotels; DROP TABLE IF EXISTS platform.users;
-- Everyone who can sign in, the hotels each person works in, and per-person permission changes.
-- Usernames are stored lower-case. Passwords are Argon2id hashes only. A user is never hard-deleted: Pallav keeps a
-- closed account's name on everything they recorded, so deleting sets deleted_at (and the unique rules below ignore it).

CREATE TABLE platform.users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  username text NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  email text CHECK (email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- always stored as +91 followed by ten digits starting 6 to 9
  mobile text CHECK (mobile ~ '^\+91[6-9][0-9]{9}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  -- the Argon2id encoded string; never logged or returned
  password_hash text NOT NULL CHECK (password_hash ~ '^\$argon2id\$'),
  -- the person's usual role; user_hotels.role_id overrides it for one hotel
  role_id uuid NOT NULL REFERENCES platform.roles (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  must_change_password boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  -- the 5-wrong-tries rule (Pallav AuthController.php, PasswordPolicy::MAX_ATTEMPTS): the service counts here and sets locked_until
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  -- how long the next lock lasts: 0 none yet, then 1..6 = 15 min, 30 min, 1 h, 3 h, 8 h, 24 h (Pallav otp_cooldown_level); the service resets it on a good sign-in
  lock_level smallint NOT NULL DEFAULT 0 CHECK (lock_level BETWEEN 0 AND 6),
  locked_until timestamptz,
  -- a block, unlike a lock, lasts until someone lifts it: 'admin' by a person, 'auto' by the system. Blocking by an ADMIN revokes the
  -- person's sessions; a stranger's failed attempts only ever lock (service rule, docs/SECURITY.md)
  blocked_at timestamptz,
  blocked_kind text CHECK (blocked_kind IN ('admin', 'auto')),
  -- every sign-in needs the emailed 6-digit code (Pallav). The service reads this flag; administrators cannot switch it off (users_admin_code_required, added with account_role)
  code_required boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  legacy_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  CONSTRAINT users_blocked_pair CHECK ((blocked_at IS NULL) = (blocked_kind IS NULL))
);
CREATE UNIQUE INDEX users_username_key ON platform.users (username) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_email_key ON platform.users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_mobile_key ON platform.users (mobile) WHERE mobile IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_legacy_id_key ON platform.users (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX users_role_id_idx ON platform.users (role_id);
CREATE INDEX users_deleted_by_idx ON platform.users (deleted_by);
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON platform.users
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.user_hotels (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  -- NULL = use the user's own role_id in this hotel
  role_id uuid REFERENCES platform.roles (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- the hotel a person lands in after signing in
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_hotels_pair_key UNIQUE (user_id, hotel_id)
);
CREATE UNIQUE INDEX user_hotels_one_default_key ON platform.user_hotels (user_id) WHERE is_default;
CREATE INDEX user_hotels_hotel_id_idx ON platform.user_hotels (hotel_id);
CREATE INDEX user_hotels_role_id_idx ON platform.user_hotels (role_id);
CREATE TRIGGER user_hotels_touch_updated_at BEFORE UPDATE ON platform.user_hotels
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- One person given something extra, or having something taken away (Pallav: granted = false). Same four levels.
CREATE TABLE platform.user_permissions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES platform.users (id) ON DELETE CASCADE,
  -- a person's extra or removed permission applies in one hotel only
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES platform.permissions (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('view', 'create', 'edit', 'full')),
  granted boolean NOT NULL DEFAULT true,
  reason text CHECK (char_length(reason) <= 255),
  granted_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_permissions_key UNIQUE (user_id, hotel_id, permission_id)
);
CREATE INDEX user_permissions_hotel_id_idx ON platform.user_permissions (hotel_id);
CREATE INDEX user_permissions_permission_id_idx ON platform.user_permissions (permission_id);
CREATE INDEX user_permissions_granted_by_idx ON platform.user_permissions (granted_by);
CREATE TRIGGER user_permissions_touch_updated_at BEFORE UPDATE ON platform.user_permissions
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- A role must be a built-in one (roles.hotel_id IS NULL) or belong to a hotel the person is attached to; a hotel's custom
-- role must never reach someone in another hotel. Checked at commit so a user and their first attachment can be added together.
CREATE FUNCTION platform.check_user_role(p_user_id uuid) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform.users u JOIN platform.roles r ON r.id = u.role_id
    WHERE u.id = p_user_id AND r.hotel_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM platform.user_hotels uh WHERE uh.user_id = u.id AND uh.hotel_id = r.hotel_id)
  ) OR EXISTS (
    SELECT 1 FROM platform.user_hotels uh JOIN platform.roles r ON r.id = uh.role_id
    WHERE uh.user_id = p_user_id AND r.hotel_id IS NOT NULL AND r.hotel_id <> uh.hotel_id
  ) THEN
    RAISE EXCEPTION 'a custom role of one hotel was given to a person outside that hotel' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION platform.check_user_role_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- plpgsql looks a record's field up when the expression runs, so each table gets its own branch (users has no user_id)
  IF TG_TABLE_NAME = 'users' THEN
    PERFORM platform.check_user_role(COALESCE(NEW.id, OLD.id));
  ELSE
    PERFORM platform.check_user_role(COALESCE(NEW.user_id, OLD.user_id));
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER users_role_scope AFTER INSERT OR UPDATE OF role_id ON platform.users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION platform.check_user_role_trg();
CREATE CONSTRAINT TRIGGER user_hotels_role_scope AFTER INSERT OR UPDATE OF role_id, hotel_id OR DELETE ON platform.user_hotels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION platform.check_user_role_trg();
