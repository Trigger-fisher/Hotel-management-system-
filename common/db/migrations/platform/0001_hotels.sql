-- rollback: DROP TABLE IF EXISTS platform.group_members; DROP TABLE IF EXISTS platform.hotel_groups; DROP TABLE IF EXISTS platform.hotels;
-- Every hotel (one schema each), the groups that bundle hotels, and which hotels belong to which group.
-- Hotel data itself lives in the hotel's own schema (hotel_<32 hex>), never here.

CREATE TABLE platform.hotels (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 63),
  -- derived from the id so it can never drift; this is the only place a schema name is decided
  schema_name text NOT NULL GENERATED ALWAYS AS ('hotel_' || replace(id::text, '-', '')) STORED,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT hotels_schema_name_format CHECK (schema_name ~ '^hotel_[0-9a-f]{32}$')
);
CREATE UNIQUE INDEX hotels_slug_key ON platform.hotels (slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX hotels_schema_name_key ON platform.hotels (schema_name);
CREATE TRIGGER hotels_touch_updated_at BEFORE UPDATE ON platform.hotels
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.hotel_groups (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 63),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX hotel_groups_slug_key ON platform.hotel_groups (slug) WHERE deleted_at IS NULL;
CREATE TRIGGER hotel_groups_touch_updated_at BEFORE UPDATE ON platform.hotel_groups
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.group_members (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id uuid NOT NULL REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_members_pair_key UNIQUE (group_id, hotel_id)
);
CREATE INDEX group_members_hotel_id_idx ON platform.group_members (hotel_id);
CREATE TRIGGER group_members_touch_updated_at BEFORE UPDATE ON platform.group_members
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
