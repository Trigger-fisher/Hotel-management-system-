-- rollback: DROP VIEW IF EXISTS platform.ai_map; DROP TABLE IF EXISTS platform.ai_routes; DROP TABLE IF EXISTS platform.ai_databases;
-- The AI map (MJ, 3 Nov 2026: "another table, same as this, to map the AI, which is in another database; one API will use the map table to pinpoint the actual database").
-- It copies the hotel map (0146 shards + hotel_shards, 0158 hotel_map):
--   * platform.ai_databases  one row per AI database server: a key, a label, open / full / retired, a capacity and a region. The connection address is NOT stored here: it is the server
--                            setting DATABASE_URL_AI_<KEY>. No row exists until an AI database is added.
--   * platform.ai_routes     which AI database serves whom: one row per hotel, per group, or one for the platform itself (scope_kind). `enabled` is off until someone switches it on, `features`
--                            lists what may be used (empty means nothing), and the two limits cap use. A hotel without a row has no AI: the AI router refuses it (it never falls back, unlike hotels).
--   * view platform.ai_map   one line per hotel: its group, its AI database and whether AI is on.
-- This is the routing table only: nothing here calls an AI service, and nothing reads an AI database yet.
CREATE TABLE platform.ai_databases (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  key text NOT NULL CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(key) <= 40),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'retired')),
  capacity integer NOT NULL DEFAULT 300 CHECK (capacity BETWEEN 1 AND 5000),
  region text CHECK (region IS NULL OR region ~ '^[a-z0-9-]{2,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_databases_key_key ON platform.ai_databases (key);
CREATE TRIGGER ai_databases_touch BEFORE UPDATE ON platform.ai_databases FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.ai_routes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('hotel', 'group', 'platform')),
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  group_id uuid REFERENCES platform.hotel_groups (id) ON DELETE CASCADE,
  ai_database_id uuid NOT NULL REFERENCES platform.ai_databases (id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  features text[] NOT NULL DEFAULT '{}' CHECK (cardinality(features) <= 20),
  daily_request_limit integer NOT NULL DEFAULT 200 CHECK (daily_request_limit >= 0),
  monthly_budget_paise bigint NOT NULL DEFAULT 0 CHECK (monthly_budget_paise >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_routes_scope_shape CHECK (
    (scope_kind = 'hotel' AND hotel_id IS NOT NULL AND group_id IS NULL)
    OR (scope_kind = 'group' AND group_id IS NOT NULL AND hotel_id IS NULL)
    OR (scope_kind = 'platform' AND hotel_id IS NULL AND group_id IS NULL)
  )
);
-- one route for each hotel, each group, and one for the platform
CREATE UNIQUE INDEX ai_routes_hotel_key ON platform.ai_routes (hotel_id) WHERE scope_kind = 'hotel';
CREATE UNIQUE INDEX ai_routes_group_key ON platform.ai_routes (group_id) WHERE scope_kind = 'group';
CREATE UNIQUE INDEX ai_routes_platform_key ON platform.ai_routes (scope_kind) WHERE scope_kind = 'platform';
CREATE INDEX ai_routes_hotel_id_idx ON platform.ai_routes (hotel_id);
CREATE INDEX ai_routes_group_id_idx ON platform.ai_routes (group_id);
CREATE INDEX ai_routes_ai_database_id_idx ON platform.ai_routes (ai_database_id);
CREATE TRIGGER ai_routes_touch BEFORE UPDATE ON platform.ai_routes FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- the readable map: one line per hotel that has a route (the group is the real group, or "Individual hotels" for a single hotel, as in hotel_map)
CREATE VIEW platform.ai_map AS
SELECT h.id AS hotel_id, h.name AS hotel, g.id AS group_id, g.name AS group_name, d.key AS ai_database, r.enabled AS enabled
  FROM platform.hotels h
  JOIN platform.ai_routes r ON r.scope_kind = 'hotel' AND r.hotel_id = h.id
  JOIN platform.ai_databases d ON d.id = r.ai_database_id
  LEFT JOIN platform.group_members gm ON gm.hotel_id = h.id
  LEFT JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
 WHERE h.deleted_at IS NULL;

-- read only for the app, like the hotel map: routes are changed by the platform owner's own tools, never by a request
GRANT SELECT ON platform.ai_databases, platform.ai_routes, platform.ai_map TO hms_app;
