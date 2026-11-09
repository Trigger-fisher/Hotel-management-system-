-- rollback: DROP TRIGGER IF EXISTS hotels_assign_shard ON platform.hotels; DROP FUNCTION IF EXISTS platform.assign_hotel_shard(); DROP TABLE IF EXISTS platform.hotel_shards; DROP TABLE IF EXISTS platform.shards;
-- The hotel-to-shard map (MJ, 1 Nov 2026, decision 72: about 10,000 hotels, each hotel's data isolated, spread over several database servers).
--   * platform.shards        one row per database server that holds hotel schemas. Today there is one, 'main': the database this migration runs in. A shard is 'open' (takes new hotels),
--                            'full' (keeps its hotels, takes no new ones) or 'retired'. `capacity` is how many hotels a shard should hold (about 300: PostgreSQL stays fast and a backup stays short).
--   * platform.hotel_shards  which shard holds which hotel. A new hotel is placed by the trigger below on the open shard with room; every existing hotel is placed on 'main'.
-- This is the routing table only: the app still connects to one database. Connecting to another shard is the next step (a pool per shard, chosen by this map); a hotel never changes shard
-- by itself, and the hotels of one group are kept together by the service that adds a hotel to a group.
CREATE TABLE platform.shards (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  key text NOT NULL CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(key) <= 40),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'retired')),
  capacity integer NOT NULL DEFAULT 300 CHECK (capacity BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shards_key_key ON platform.shards (key);
CREATE TRIGGER shards_touch BEFORE UPDATE ON platform.shards FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.hotel_shards (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES platform.shards (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hotel_shards_hotel_key ON platform.hotel_shards (hotel_id);
CREATE INDEX hotel_shards_shard_id_idx ON platform.hotel_shards (shard_id);
CREATE TRIGGER hotel_shards_touch BEFORE UPDATE ON platform.hotel_shards FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT ON platform.shards, platform.hotel_shards TO hms_app;

INSERT INTO platform.shards (key, label, status, capacity) VALUES ('main', 'Main database', 'open', 300);
INSERT INTO platform.hotel_shards (hotel_id, shard_id) SELECT h.id, (SELECT s.id FROM platform.shards s WHERE s.key = 'main') FROM platform.hotels h;

-- A new hotel goes on the open shard that still has room (the one with the fewest hotels among those below capacity, the oldest first); when every open shard is at capacity, the oldest open shard
-- takes it anyway rather than leave the hotel unplaced (the platform owner is told by the shard figures to open another).
CREATE FUNCTION platform.assign_hotel_shard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  INSERT INTO platform.hotel_shards (hotel_id, shard_id)
  SELECT NEW.id, s.id
    FROM platform.shards s
   WHERE s.status = 'open'
   ORDER BY ((SELECT count(*) FROM platform.hotel_shards x WHERE x.shard_id = s.id) >= s.capacity), s.created_at
   LIMIT 1
  ON CONFLICT (hotel_id) DO NOTHING;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.assign_hotel_shard() FROM PUBLIC;
CREATE TRIGGER hotels_assign_shard AFTER INSERT ON platform.hotels FOR EACH ROW EXECUTE FUNCTION platform.assign_hotel_shard();
