-- rollback: REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM hms_app; REVOKE USAGE ON SCHEMA platform FROM hms_app;
-- What the running app (role hms_app) may do in the platform schema. APPLY ONLY AFTER hms_app EXISTS (task T3 creates the
-- roles first). hms_app owns nothing and runs no DDL; migrations run as hms_owner.
-- Standard R3: audit_log and auth_events are INSERT + SELECT only (and a trigger blocks changes even for the owner);
-- users are never deleted; permissions are read-only (seeded and changed by migrations and seeds); the version table is
-- not the app's business at all.

REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform FROM PUBLIC;

GRANT USAGE ON SCHEMA platform TO hms_app;

GRANT SELECT, INSERT, UPDATE ON platform.hotels TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.hotel_groups TO hms_app;
GRANT SELECT, INSERT, DELETE ON platform.group_members TO hms_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.roles TO hms_app;
GRANT SELECT ON platform.permissions TO hms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.role_permissions TO hms_app;

GRANT SELECT, INSERT, UPDATE ON platform.users TO hms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_hotels TO hms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_permissions TO hms_app;

-- DELETE on sessions, login_attempts and auth_codes is for the scheduled purge of expired rows
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.sessions TO hms_app;
GRANT SELECT, INSERT, DELETE ON platform.login_attempts TO hms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.auth_codes TO hms_app;
-- counters: DELETE is the purge by age of windows that have passed
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.rate_limits TO hms_app;
-- the app queues mail and marks it sent; DELETE is NOT granted: the mail worker's own role gets it when that role exists (until then the owner purges)
GRANT SELECT, INSERT, UPDATE ON platform.outbox TO hms_app;

GRANT SELECT, INSERT ON platform.auth_events TO hms_app;
GRANT SELECT, INSERT ON platform.audit_log TO hms_app;

-- the trigger functions run as the table's writer, so that role needs to execute them
GRANT EXECUTE ON FUNCTION platform.touch_updated_at() TO hms_app;
GRANT EXECUTE ON FUNCTION platform.forbid_change() TO hms_app;
GRANT EXECUTE ON FUNCTION platform.check_user_role(uuid) TO hms_app;
GRANT EXECUTE ON FUNCTION platform.check_user_role_trg() TO hms_app;
