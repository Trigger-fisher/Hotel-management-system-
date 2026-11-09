-- rollback: DROP TABLE IF EXISTS pathik_active;
-- Pathik "In Pathik now" (decision 41, MJ, 11 Oct 2026): the guests Pathik shows as currently active (not checked out), kept for the "In Pathik now" page.
-- The only exception to "no Pathik guest data is stored", with these rules:
--   * one dedicated table (not pathik_sync); only the serial, the name, the check-in date and the room, as text, exactly as Pathik shows them;
--   * every worker read REPLACES the hotel's whole set in one transaction: a guest no longer in the latest read (checked out in Pathik) is deleted at once;
--   * a set not refreshed for 24 hours (expires_at = read_at + 24 hours) is hidden and deleted (stale); the rows are also deleted when Pathik is switched
--     off or its login is deleted, and with the hotel (the schema goes);
--   * never written to a log, the audit trail, an error text, a search, a hotel export or the backup's data (audit holds the count only).
-- hard-delete: purge job pathik-active-expiry (replaced, stale and switched-off rows are deleted on every read, write and settings change, decision 41)
-- no-standard-columns: a short-lived copy of what Pathik shows (decision 41), replaced as a whole on every read; no history, no import, no soft delete, no edits
CREATE TABLE pathik_active (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  serial varchar(40) NOT NULL,
  guest_name varchar(120) NOT NULL,
  room varchar(40) NOT NULL DEFAULT '',
  check_in_date varchar(40) NOT NULL DEFAULT '',
  read_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT pathik_active_expiry_ck CHECK (expires_at > read_at AND expires_at <= read_at + interval '24 hours')
);
CREATE INDEX pathik_active_expires_idx ON pathik_active (expires_at);
