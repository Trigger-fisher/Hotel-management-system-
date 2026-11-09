-- rollback: DROP TABLE IF EXISTS platform.role_permissions; DROP TABLE IF EXISTS platform.permissions; DROP TABLE IF EXISTS platform.roles;
-- Roles, the list of things a role can be given, and what each role is given.
-- MJ's rule: four access levels per permission, no per-action grid: view, create, edit, full.
--   view   = View Only            create = View & Create
--   edit   = View & Edit          full   = Full Access
-- The permission rows are Pallav's own list (its Permissions::modules() and abilities()): modules, their parts, and
-- the one-off abilities. They are seeded from db/seeds/platform, not invented here.

CREATE TABLE platform.roles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- NULL = a built-in role every hotel shares; set = a custom role that belongs to that one hotel
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text CHECK (char_length(description) <= 500),
  icon text NOT NULL DEFAULT 'bi-person' CHECK (char_length(icon) <= 40),
  accent text NOT NULL DEFAULT '#7C3AED' CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  -- a higher level outranks a lower one (Pallav: Viewer 1, Editor 2, Admin 3, SuperAdmin 4)
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 100),
  -- gains everything the roles below it have
  inherits boolean NOT NULL DEFAULT true,
  -- a system role cannot be deleted or renamed away
  is_system boolean NOT NULL DEFAULT false,
  legacy_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roles_hotel_id_idx ON platform.roles (hotel_id);
CREATE UNIQUE INDEX roles_builtin_key_key ON platform.roles (key) WHERE hotel_id IS NULL;
CREATE UNIQUE INDEX roles_hotel_key_key ON platform.roles (hotel_id, key) WHERE hotel_id IS NOT NULL;
CREATE UNIQUE INDEX roles_legacy_id_key ON platform.roles (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER roles_touch_updated_at BEFORE UPDATE ON platform.roles
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.permissions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- "payroll" (module), "payroll.salary-slip" (part of a module), "users.set-password" (one-off ability)
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$'),
  kind text NOT NULL CHECK (kind IN ('module', 'part', 'ability')),
  parent_id uuid REFERENCES platform.permissions (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  about text CHECK (char_length(about) <= 500),
  group_name text CHECK (char_length(group_name) <= 60),
  section text CHECK (char_length(section) <= 60),
  icon text CHECK (char_length(icon) <= 40),
  sensitive boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_parent_matches_kind CHECK ((kind = 'part') = (parent_id IS NOT NULL))
);
CREATE UNIQUE INDEX permissions_key_key ON platform.permissions (key);
CREATE INDEX permissions_parent_id_idx ON platform.permissions (parent_id);
CREATE TRIGGER permissions_touch_updated_at BEFORE UPDATE ON platform.permissions
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.role_permissions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  role_id uuid NOT NULL REFERENCES platform.roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES platform.permissions (id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('view', 'create', 'edit', 'full')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_pair_key UNIQUE (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_id_idx ON platform.role_permissions (permission_id);
CREATE TRIGGER role_permissions_touch_updated_at BEFORE UPDATE ON platform.role_permissions
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
