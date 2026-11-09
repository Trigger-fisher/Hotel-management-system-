-- rollback: ALTER TABLE platform.logins ALTER COLUMN code_required SET DEFAULT true;
-- The emailed sign-in code is off for a new account unless the person switches it on (decision 46); the login table keeps the default the users table had.
ALTER TABLE platform.logins ALTER COLUMN code_required SET DEFAULT false;
