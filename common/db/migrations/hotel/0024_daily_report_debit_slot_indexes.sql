-- rollback: DROP INDEX IF EXISTS bill_master_bills_debit_bill_date_1_idx; DROP INDEX IF EXISTS bill_master_bills_debit_bill_date_2_idx; DROP INDEX IF EXISTS bill_master_bills_debit_bill_date_3_idx; DROP INDEX IF EXISTS bill_master_bills_debit_bill_date_4_idx;
-- The Daily Report reads every debit recovery slot of a bill (debit_bill_date, _1, _2, _3, _4, for the hotel and the food side). Only the first slot had an
-- index (0004), so the other four were read in full for each side on every report: eight scans of the whole bills table per call. Same shape as the first.
CREATE INDEX bill_master_bills_debit_bill_date_1_idx ON bill_master_bills (debit_bill_date_1) WHERE debit_bill_date_1 IS NOT NULL;
CREATE INDEX bill_master_bills_debit_bill_date_2_idx ON bill_master_bills (debit_bill_date_2) WHERE debit_bill_date_2 IS NOT NULL;
CREATE INDEX bill_master_bills_debit_bill_date_3_idx ON bill_master_bills (debit_bill_date_3) WHERE debit_bill_date_3 IS NOT NULL;
CREATE INDEX bill_master_bills_debit_bill_date_4_idx ON bill_master_bills (debit_bill_date_4) WHERE debit_bill_date_4 IS NOT NULL;
