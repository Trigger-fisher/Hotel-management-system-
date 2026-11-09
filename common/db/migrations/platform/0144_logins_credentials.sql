-- rollback: DROP TRIGGER IF EXISTS logins_credentials_to_users ON platform.logins; DROP FUNCTION IF EXISTS platform.logins_credentials_to_users(); REVOKE UPDATE ON platform.logins FROM hms_app; (then put the guard line of platform.users_login_directory() back as in 0141)
-- The shared login directory becomes the place sign-in WRITES its credentials (MJ, 1 Nov 2026; step 2 of decision 72).
--   * The web app may now UPDATE only the credential columns of platform.logins: password hash, status, the forced-change flag, failed tries, lock level and time, block, the emailed-code rule and
--     the last sign-in. It cannot touch the username, the role or the deleted flag: those still change through platform.users.
--   * Every other part of the system still reads platform.users, so a change made in platform.logins is copied back to the same person in platform.users by a trigger, and a change made in
--     platform.users (the admin console, a reset) is copied forward by the trigger of 0142. Each copy stops the other from starting again: a trigger fired by another trigger does nothing
--     (pg_trigger_depth() > 1), so the two never loop.

GRANT UPDATE (password_hash, status, must_change_password, password_changed_at, failed_attempts, lock_level, locked_until, blocked_at, blocked_kind, code_required, last_login_at) ON platform.logins TO hms_app;

-- the forward trigger of 0142 stays as it is, but does nothing when it is fired by the trigger below
CREATE OR REPLACE FUNCTION platform.users_login_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  PERFORM platform.sync_login_directory(NEW);
  RETURN NEW;
END
$fn$;

CREATE FUNCTION platform.logins_credentials_to_users() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  UPDATE platform.users u
     SET password_hash = NEW.password_hash, status = NEW.status, must_change_password = NEW.must_change_password, password_changed_at = NEW.password_changed_at,
         failed_attempts = NEW.failed_attempts, lock_level = NEW.lock_level, locked_until = NEW.locked_until, blocked_at = NEW.blocked_at, blocked_kind = NEW.blocked_kind,
         code_required = NEW.code_required, last_login_at = NEW.last_login_at
   WHERE u.id = NEW.id
     AND (u.password_hash, u.status, u.must_change_password, u.password_changed_at, u.failed_attempts, u.lock_level, u.locked_until, u.blocked_at, u.blocked_kind, u.code_required, u.last_login_at)
         IS DISTINCT FROM
         (NEW.password_hash, NEW.status, NEW.must_change_password, NEW.password_changed_at, NEW.failed_attempts, NEW.lock_level, NEW.locked_until, NEW.blocked_at, NEW.blocked_kind, NEW.code_required, NEW.last_login_at);
  RETURN NEW;
END
$fn$;
CREATE TRIGGER logins_credentials_to_users AFTER UPDATE ON platform.logins FOR EACH ROW EXECUTE FUNCTION platform.logins_credentials_to_users();
REVOKE ALL ON FUNCTION platform.logins_credentials_to_users() FROM PUBLIC;
