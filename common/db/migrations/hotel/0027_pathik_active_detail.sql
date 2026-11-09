-- rollback: forward-only because 0027 deletes the kept copy of the active guests (it is refilled by the next worker read) and seals its text columns
-- Pathik "In Pathik now" drop-down detail (decision 42) ENCRYPTED AT REST (decision 43, MJ, 11 Oct 2026): each row of the list opens to show what Pathik's own LIST page shows
-- for the guest. Five more columns on pathik_active (migration 0026), and the personal text is kept SEALED:
--   * guest_name (now text), contact, email, address hold the app's vault format (AES-256-GCM under HMS_SECRET_KEY with the hotel bound in; the same vault that holds the
--     Pathik password): written sealed by the service, opened only by GET /pathik/active for a user who may see Pathik. Empty stays ''. The database never holds a readable name;
--   * check_out_date and document_type are plain (a date and a type name, not a person);
--   * the rows that exist when this runs were written readable (0026), so they are DELETED here: the next worker read refills the table (it is a 24 hour copy).
-- Same rules as decision 41 otherwise: own table, replaced as a whole by every worker read, deleted after 24 hours without a refresh, cleared when Pathik is switched off, never in
-- a log, an export, the backup's data or a search. NOT kept: the ID number, the ID photo, the other guests of the room, the vehicle.
DELETE FROM pathik_active;
ALTER TABLE pathik_active ALTER COLUMN guest_name TYPE text;
ALTER TABLE pathik_active ADD COLUMN contact text NOT NULL DEFAULT '';
ALTER TABLE pathik_active ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE pathik_active ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE pathik_active ADD COLUMN check_out_date varchar(40) NOT NULL DEFAULT '';
ALTER TABLE pathik_active ADD COLUMN document_type varchar(60) NOT NULL DEFAULT '';
