-- rollback: forward-only because the one-time Pathik pairing codes are deleted with the table; they are short-lived and are never needed again
-- Pathik is removed from HMS (MJ, 1 Nov 2026); migration 0138 stays as history and this one drops the table it made.
DROP TABLE IF EXISTS platform.pathik_pairing_codes;
