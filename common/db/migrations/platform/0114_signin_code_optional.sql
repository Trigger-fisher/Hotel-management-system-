-- rollback: forward-only because the previous per-account values of code_required are not kept (every account was switched to false); the CHECK could be added back only after every administrator account is set to true again: ALTER TABLE platform.users ADD CONSTRAINT users_admin_code_required CHECK (code_required OR account_role NOT IN ('super_admin', 'platform_admin', 'group_hotel_admin', 'hotel_admin')); ALTER TABLE platform.users ALTER COLUMN code_required SET DEFAULT true;
-- The emailed sign-in code becomes the person's OWN choice (decision 46, MJ, 12 Oct 2026):
--   * the database rule that made the code compulsory for administrators (users_admin_code_required, migration 0006) is dropped;
--   * code_required now defaults to false: a new account signs in with its password alone until the person switches the code on for their own account
--     (PUT /auth/profile/sign-in-code; turning it off again needs the current password);
--   * every existing account is set to false in this one statement, audited as ONE audit row with the number of accounts that were switched.
-- Risk, in plain words (docs/SECURITY.md): a stolen password is enough to sign in on an account that has the code off.
ALTER TABLE platform.users DROP CONSTRAINT IF EXISTS users_admin_code_required;
ALTER TABLE platform.users ALTER COLUMN code_required SET DEFAULT false;

WITH switched AS (
  UPDATE platform.users SET code_required = false WHERE code_required RETURNING 1
)
INSERT INTO platform.audit_log (action, entity, after)
SELECT 'security.sign_in_code_optional', 'platform', jsonb_build_object('accountsSwitchedOff', count(*)) FROM switched;
