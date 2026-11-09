-- rollback: ALTER TABLE platform.users DROP COLUMN IF EXISTS ui_theme;
-- The person's own day/night choice for the app (the Admin profile screen). NULL = they have not chosen: the app follows the device.
-- hms_app already holds UPDATE on platform.users (0099_grants.sql), so no new grant is needed.
ALTER TABLE platform.users ADD COLUMN ui_theme text CHECK (ui_theme IN ('light', 'dark'));
