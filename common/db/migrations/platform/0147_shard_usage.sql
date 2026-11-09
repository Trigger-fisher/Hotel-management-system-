-- rollback: DROP VIEW IF EXISTS platform.shard_usage;
-- How full each shard is (decision 72): the figures the platform owner reads to know when to open the next database. One row per shard: its key, status, capacity, how many hotels it holds and how many
-- places are left (never below zero).
CREATE VIEW platform.shard_usage AS
SELECT s.id, s.key, s.label, s.status, s.capacity,
       (SELECT count(*) FROM platform.hotel_shards hs WHERE hs.shard_id = s.id)::integer AS hotels,
       greatest(s.capacity - (SELECT count(*) FROM platform.hotel_shards hs WHERE hs.shard_id = s.id), 0)::integer AS places_left
  FROM platform.shards s;
GRANT SELECT ON platform.shard_usage TO hms_app;