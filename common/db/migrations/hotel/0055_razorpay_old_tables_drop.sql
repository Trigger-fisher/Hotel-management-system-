-- rollback: forward-only because the rows live on in razorpay_records (0054 copied them and this file checks the copy first); to get the two tables back, run the CREATE TABLEs of 0009_payments.sql and copy the rows from razorpay_records (kind event / payment)
-- The two tables 0009 made (razorpay_events, razorpay_payments) are gone (MJ, 2 Nov 2026): everything Razorpay keeps is in the one table razorpay_records (0054), which copied their rows.
-- This file refuses to drop them unless every payment and every webhook call they hold is already in razorpay_records: if one is missing the whole file is rolled back and the tables stay.
DO $$
DECLARE missing_payments bigint; missing_events bigint; old_null_events bigint; new_null_events bigint;
BEGIN
  SELECT count(*) INTO missing_payments FROM razorpay_payments o
   WHERE NOT EXISTS (SELECT 1 FROM razorpay_records r WHERE r.kind = 'payment' AND r.business = o.business AND r.ref = o.payment_id);
  SELECT count(*) INTO missing_events FROM razorpay_events o
   WHERE o.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM razorpay_records r WHERE r.kind = 'event' AND r.business = o.business AND r.ref = o.event_id);
  SELECT count(*) INTO old_null_events FROM razorpay_events WHERE event_id IS NULL;
  SELECT count(*) INTO new_null_events FROM razorpay_records WHERE kind = 'event' AND ref IS NULL;
  IF missing_payments > 0 THEN RAISE EXCEPTION 'razorpay_payments has % payment(s) that razorpay_records does not hold; not dropping', missing_payments; END IF;
  IF missing_events > 0 THEN RAISE EXCEPTION 'razorpay_events has % event(s) that razorpay_records does not hold; not dropping', missing_events; END IF;
  IF old_null_events > new_null_events THEN RAISE EXCEPTION 'razorpay_events has % call(s) with no event id that razorpay_records does not hold; not dropping', old_null_events - new_null_events; END IF;
END $$;

DROP TABLE IF EXISTS razorpay_payments;
DROP TABLE IF EXISTS razorpay_events;