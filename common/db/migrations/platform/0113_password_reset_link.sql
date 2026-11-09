-- rollback: DROP INDEX IF EXISTS platform.auth_codes_reset_link_hash_key; ALTER TABLE platform.auth_codes DROP CONSTRAINT IF EXISTS auth_codes_purpose_check, ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset')); ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known, ADD CONSTRAINT outbox_kind_known CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset', 'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected', 'enquiry_confirmed', 'enquiry_declined')); (only while no row uses the new purpose or kind)
-- Forgot password by an emailed LINK instead of a code (MJ): a random single-use token, valid 15 minutes, that opens the "choose a new password" screen.
-- The token itself is never stored: auth_codes keeps its keyed hash under the new purpose 'reset_link' (one live link per person, like every code: a new
-- request ends the old one), found by that hash when the link is opened. The mail kind 'reset_link' carries the link in its payload, wiped once sent.
ALTER TABLE platform.auth_codes DROP CONSTRAINT IF EXISTS auth_codes_purpose_check;
ALTER TABLE platform.auth_codes ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset', 'reset_link'));
CREATE UNIQUE INDEX IF NOT EXISTS auth_codes_reset_link_hash_key ON platform.auth_codes (code_hash) WHERE purpose = 'reset_link';

ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected',
    'enquiry_confirmed', 'enquiry_declined', 'reset_link'
  ));
