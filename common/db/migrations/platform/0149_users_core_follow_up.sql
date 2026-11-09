-- rollback: ALTER INDEX platform.users_username_key RENAME TO logins_username_key; REVOKE SELECT, UPDATE ON platform.user_core FROM hms_app;
-- Follow-up of 0148: the username rule keeps the name it always had in error messages, and the web app reads and changes the profile photo on the core table directly (it must lock the row).
ALTER INDEX platform.logins_username_key RENAME TO users_username_key;
GRANT SELECT ON platform.user_core TO hms_app;
GRANT UPDATE (photo_file, ui_theme) ON platform.user_core TO hms_app;
