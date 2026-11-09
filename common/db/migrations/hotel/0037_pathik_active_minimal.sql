-- rollback: forward-only because 0037 deletes the kept copy of the active guests (it is refilled by the next worker read) and drops five columns whose values cannot come back
-- Pathik "In Pathik now" keeps ONLY the serial, room, name and check-in (decision 63, MJ, 17 Oct 2026: "no personal details like email, mobile and all: only serial number, room
-- number, name and check-in date"). This narrows decisions 42 and 43: the five detail columns of migration 0027 are dropped from pathik_active:
--   * contact, email, address (sealed text), check_out_date and document_type (plain) are no longer kept, read by the worker or answered by GET /pathik/active;
--   * guest_name stays SEALED as 0027 made it (the vault format, the hotel bound in); serial and room stay plain; check_in_date stays text and now holds
--     "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" when Pathik's list shows the time (the column of 0026, 40 characters, is wide enough);
--   * the rows that exist when this runs hold the detail columns, so they are DELETED first: the next worker read refills the table (it is a 24 hour copy).
-- The guest's details HMS keeps with the stay (pms_stays.guest_details, migration 0023) are NOT touched: they fill the Pathik form, as before.
-- Every other rule of decision 41 is unchanged: own table, replaced as a whole by every worker read, deleted after 24 hours without a refresh (expires_at and its check),
-- cleared when Pathik is switched off, never in a log, an export, the backup's data or a search.
DELETE FROM pathik_active;
ALTER TABLE pathik_active DROP COLUMN IF EXISTS contact;
ALTER TABLE pathik_active DROP COLUMN IF EXISTS email;
ALTER TABLE pathik_active DROP COLUMN IF EXISTS address;
ALTER TABLE pathik_active DROP COLUMN IF EXISTS check_out_date;
ALTER TABLE pathik_active DROP COLUMN IF EXISTS document_type;
