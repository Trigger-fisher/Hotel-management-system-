-- rollback: DROP VIEW IF EXISTS platform.hotel_map;
-- MJ, 1 Nov 2026: the one-line-per-hotel map that the flow chart shows (hotel, group, hotel database). It only reads: the hotel-to-shard map (hotel_shards) and the groups stay as they are, so adding a second
-- hotel database later is one new row in platform.shards and nothing here changes. The group is the real group, or "Individual hotels" for a single hotel.
CREATE VIEW platform.hotel_map AS
SELECT h.id AS hotel_id, h.name AS hotel, g.id AS group_id, g.name AS group_name, g.kind AS group_kind, s.key AS hotel_database
  FROM platform.hotels h
  JOIN platform.hotel_shards hs ON hs.hotel_id = h.id
  JOIN platform.shards s ON s.id = hs.shard_id
  LEFT JOIN platform.group_members gm ON gm.hotel_id = h.id
  LEFT JOIN platform.hotel_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
 WHERE h.deleted_at IS NULL;
GRANT SELECT ON platform.hotel_map TO hms_app;
