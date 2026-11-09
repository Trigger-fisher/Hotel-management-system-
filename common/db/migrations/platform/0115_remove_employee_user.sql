-- rollback: forward-only because accounts that held the Employee User role are converted to Hotel User and the old role is not kept; to allow the role again, drop the four *_known role checks below and re-create them with 'employee_user' added to the list (the pilot has no use for it).
-- The Employee User role is removed from the pilot (MJ, 12 Oct 2026: "remove the employee user full, I do not want to give it in the pilot").
--   * any account that still holds it becomes a Hotel User (the least-privilege role it was already treated as), audited as ONE audit row with the count;
--   * the role is dropped from the list the database accepts for users.account_role;
--   * the history tables keep their old rows untouched: their actor_role checks are re-created NOT VALID, so rows written before this migration that
--     name 'employee_user' stay readable while no new row can use the role.
-- Payroll "employees" (staff records) are a different thing and are not touched.
WITH moved AS (
  UPDATE platform.users SET account_role = 'hotel_user' WHERE account_role = 'employee_user' RETURNING 1
)
INSERT INTO platform.audit_log (action, entity, scope, actor_name, after)
SELECT 'security.employee_user_removed', 'platform', 'platform', 'System', jsonb_build_object('accountsMovedToHotelUser', count(*)) FROM moved;

ALTER TABLE platform.users DROP CONSTRAINT IF EXISTS users_account_role_known;
ALTER TABLE platform.users ADD CONSTRAINT users_account_role_known CHECK (account_role IN (
  'super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user'
));

ALTER TABLE platform.hotel_status_history DROP CONSTRAINT IF EXISTS hotel_status_history_actor_role_check;
ALTER TABLE platform.hotel_status_history ADD CONSTRAINT hotel_status_history_actor_role_known CHECK (actor_role IN (
  'super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user'
)) NOT VALID;

ALTER TABLE platform.group_history DROP CONSTRAINT IF EXISTS group_history_actor_role_check;
ALTER TABLE platform.group_history ADD CONSTRAINT group_history_actor_role_known CHECK (actor_role IN (
  'super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user'
)) NOT VALID;

ALTER TABLE platform.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_role_check;
ALTER TABLE platform.audit_log ADD CONSTRAINT audit_log_actor_role_known CHECK (actor_role IN (
  'super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin', 'hotel_user', 'corporate_user', 'guest_user'
)) NOT VALID;
