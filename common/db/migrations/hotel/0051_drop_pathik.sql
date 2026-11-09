-- rollback: forward-only because the Pathik tables and every row in them are deleted; a restore needs a backup taken before this migration
-- Pathik is removed from HMS (MJ, 1 Nov 2026): the Gujarat Police register link, its queue, its PC agent and the hotel's stored Pathik account are gone.
-- Migrations 0021 to 0049 stay as history; this one drops what they made. The stay's own guest details (0023) are kept: they belong to the stay.
DROP TABLE IF EXISTS pathik_shot;
DROP TABLE IF EXISTS pathik_start;
DROP TABLE IF EXISTS pathik_pc;
DROP TABLE IF EXISTS pathik_active;
DROP TABLE IF EXISTS pathik_sync;
DROP TABLE IF EXISTS pathik_lists;
DROP TABLE IF EXISTS pathik_settings;
