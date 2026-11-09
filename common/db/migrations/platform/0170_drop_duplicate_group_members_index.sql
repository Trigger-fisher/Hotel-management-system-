-- rollback: forward-only because the dropped index duplicates group_members_one_group_per_hotel_key (to rebuild: CREATE INDEX group_members_hotel_id_idx ON platform.group_members (hotel_id))
-- Index audit (MJ, 2 Nov 2026): group_members had two indexes on (hotel_id), the plain one from 0001 and the unique one from 0103 (one group per hotel). The unique
-- index answers every lookup the plain one did, so the plain one only cost a second write on each link. No data is touched.
DROP INDEX IF EXISTS platform.group_members_hotel_id_idx;
