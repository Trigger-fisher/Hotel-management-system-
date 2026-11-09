-- rollback: ALTER TABLE platform.logins DROP COLUMN IF EXISTS temp_password_at;
-- A temporary password expires (MJ, 5 Nov 2026): when it was given (a new account's invitation or an administrator's reset). After
-- security.temp_password_minutes (default 30) the sign-in refuses it and the person asks for a new one. NULL = no temporary password given by
-- the app (an account made by the operator's command line keeps working as before); choosing a real password clears it.
ALTER TABLE platform.logins ADD COLUMN IF NOT EXISTS temp_password_at timestamptz;
GRANT UPDATE (temp_password_at) ON platform.logins TO hms_app;
