-- rollback: DROP INDEX IF EXISTS bill_master_bills_live_bill_date_entry_no_idx; DROP INDEX IF EXISTS bill_master_advances_live_payment_date_entry_no_idx;
-- The global search (and the bill and advance lists in their default order) asks for the newest live rows first: ORDER BY date DESC, entry_no DESC LIMIT n.
-- The date-only indexes give the date order but not the entry number inside a day, so every row of the newest day (thousands on a busy or imported day)
-- was read and sorted before the first n came out. These two indexes hold exactly that order over the live rows, so the scan stops after n matches.
CREATE INDEX bill_master_bills_live_bill_date_entry_no_idx ON bill_master_bills (bill_date DESC, entry_no DESC) WHERE deleted_at IS NULL;
CREATE INDEX bill_master_advances_live_payment_date_entry_no_idx ON bill_master_advances (payment_date DESC, entry_no DESC) WHERE deleted_at IS NULL;
