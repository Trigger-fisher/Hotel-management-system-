-- rollback: ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known; ALTER TABLE platform.outbox ADD CONSTRAINT outbox_kind_known CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset', 'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected', 'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new')); (only after no 'daily_summary' row is left in platform.outbox)
-- The owner's daily summary mail (Settings > Email > "Daily summary to"; sent every evening through the hotel's own mail server): a new outbox kind
-- 'daily_summary'. Same rules as every mail: one row per address, the payload (the day's figures) is removed as soon as the mail is sent or has failed for good.
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected',
    'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new', 'daily_summary'
  ));
