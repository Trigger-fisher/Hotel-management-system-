-- rollback: ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known, ADD CONSTRAINT outbox_kind_known CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset', 'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected')); (only while no row uses the two new kinds)
-- Website enquiry mail: when the front desk confirms or cancels a guest's website enquiry, the guest is told by email through the same outbox as every other
-- mail (the log driver in development, SMTP when the keys exist). The payload holds the guest's name, the hotel, the reference and the stay; like every payload
-- it is wiped when the mail is sent or has failed for good.
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected',
    'enquiry_confirmed', 'enquiry_declined'
  ));
