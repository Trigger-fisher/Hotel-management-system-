-- rollback: DROP INDEX IF EXISTS bill_master_bills_bill_number_live_key; DROP INDEX IF EXISTS bill_master_advances_receipt_number_live_key;
-- A receipt number and a bill number are unique among LIVE rows (a recycle-binned row frees its number and may not be restored over a live one).
-- Pallav checked this in code only, which is racy; the database makes it a rule (the billing services still check first, to give a friendly message).
CREATE UNIQUE INDEX bill_master_advances_receipt_number_live_key ON bill_master_advances (receipt_number) WHERE deleted_at IS NULL AND receipt_number IS NOT NULL;
CREATE UNIQUE INDEX bill_master_bills_bill_number_live_key ON bill_master_bills (bill_number) WHERE deleted_at IS NULL AND bill_number IS NOT NULL;
