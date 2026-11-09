-- rollback: DROP INDEX IF EXISTS platform.outbox_campaign_waiting_idx;
-- The campaign feeder counts each hotel's campaign mail still in the queue (pending or sending) on every round (repos/postgres/auth.ts outbox.bulkWaiting). Without an index
-- that count read the whole outbox (sent rows are kept, so it grows by about 1.5 million rows a month at 50,000 mails a day; docs/plans/MAIL-LOAD-REPORT-2026-10-18.md F2).
-- The feeder keeps at most 200 rows a hotel waiting, so this partial index stays tiny. The predicate is written exactly as the query's.
CREATE INDEX IF NOT EXISTS outbox_campaign_waiting_idx ON platform.outbox (hotel_id) WHERE kind = 'campaign' AND status IN ('pending', 'sending');
