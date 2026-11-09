-- rollback: ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known; ALTER TABLE platform.outbox ADD CONSTRAINT outbox_kind_known CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset', 'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected', 'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new', 'daily_summary')); (only after no 'campaign' row is left in platform.outbox)
-- Email marketing (Companies > Email Marketing; sent through the hotel's own mail server): a new outbox kind 'campaign'. One row per address; the
-- payload (the subject, the message and the unsubscribe link) is removed as soon as the mail is sent or has failed for good. The row's template names
-- its campaign ('campaign-<id>'), so a campaign's sent and failed counts come from the outbox without the payload.
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected',
    'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new', 'daily_summary', 'campaign'
  ));
CREATE INDEX IF NOT EXISTS outbox_campaign_template_idx ON platform.outbox (hotel_id, template) WHERE kind = 'campaign';
