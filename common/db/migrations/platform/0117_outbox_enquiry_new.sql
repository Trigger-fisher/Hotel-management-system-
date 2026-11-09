-- rollback: ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known; ALTER TABLE platform.outbox ADD CONSTRAINT outbox_kind_known CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset', 'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected', 'enquiry_confirmed', 'enquiry_declined', 'reset_link')); (only after no 'enquiry_new' row is left in platform.outbox)
-- A new enquiry from a hotel's website is mailed to the hotel's own recipients (Website > Settings > recipients): a new outbox kind 'enquiry_new'. Same rules as every
-- mail: one row per address, the payload (the guest's details, needed for the mail itself) is removed as soon as the mail is sent or has failed for good.
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected',
    'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new'
  ));