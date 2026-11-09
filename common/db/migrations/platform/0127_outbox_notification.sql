-- rollback: ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known; ALTER TABLE platform.outbox ADD CONSTRAINT outbox_kind_known CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset', 'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected', 'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new', 'daily_summary', 'campaign', 'bill_invoice', 'advance_receipt')); ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_hotel_kinds_name_hotel; ALTER TABLE platform.outbox ADD CONSTRAINT outbox_hotel_kinds_name_hotel CHECK (kind NOT IN ('bill_invoice', 'advance_receipt') OR hotel_id IS NOT NULL); (only after no 'notification' row is left in platform.outbox)
-- Notifications "also email" (MJ, 18 Oct 2026, docs/plans/NOTIFICATIONS-PLAN-2026-10-18.md): a hotel can also email a notification to its companies. It is a new outbox kind, 'notification': hotel mail
-- (mail/routes.ts MAIL_ROUTE = hotel, so it goes from the hotel's own email and must name its hotel) in the SYSTEM lane (MAIL_LANE = system: a few mails to the people of a few companies, never a campaign blast).
-- The row carries { name, hotelName, subject (the title), message (the text) } and is cleaned like every mail once it is sent or has failed for good.
-- Only the list of kinds changes; the full list is repeated so a constraint written by an earlier migration is replaced, not stacked. A later migration that adds a kind must repeat 'notification' too.
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected',
    'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new', 'daily_summary', 'campaign', 'bill_invoice', 'advance_receipt', 'notification'
  ));
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_hotel_kinds_name_hotel;
ALTER TABLE platform.outbox ADD CONSTRAINT outbox_hotel_kinds_name_hotel CHECK (kind NOT IN ('bill_invoice', 'advance_receipt', 'notification') OR hotel_id IS NOT NULL);
