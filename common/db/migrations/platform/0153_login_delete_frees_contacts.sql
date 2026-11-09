-- rollback: DROP TRIGGER IF EXISTS logins_free_contacts ON platform.logins; DROP FUNCTION IF EXISTS platform.logins_free_contacts();
-- A deleted person frees their email and mobile, however the deleted flag was set (the contact guard of 0148 holds living people only).
CREATE FUNCTION platform.logins_free_contacts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = platform, pg_temp AS $fn$
BEGIN
  DELETE FROM platform.login_contacts WHERE login_id = NEW.id;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.logins_free_contacts() FROM PUBLIC;
CREATE TRIGGER logins_free_contacts AFTER UPDATE OF deleted_at ON platform.logins FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) EXECUTE FUNCTION platform.logins_free_contacts();
