-- rollback: REVOKE SELECT ON platform.logins FROM hms_app;
-- The web app may READ the shared login directory (platform.logins, 0142) to find a person by username: the username is stored once, here, for every role. It never writes it:
-- every change still goes through platform.users, whose trigger keeps the directory in step, until the sign-in code is moved over completely.
GRANT SELECT ON platform.logins TO hms_app;
