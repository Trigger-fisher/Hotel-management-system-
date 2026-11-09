-- rollback: DROP INDEX IF EXISTS platform.outbox_hotel_updated_idx; ALTER TABLE platform.outbox DROP COLUMN IF EXISTS last_error; ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known; ALTER TABLE platform.outbox ADD CONSTRAINT outbox_kind_known CHECK (kind IN ('login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset', 'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected', 'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new', 'daily_summary', 'campaign')); (only after no 'bill_invoice' or 'advance_receipt' row is left in platform.outbox)
-- Mail routing (MJ, 17 Oct 2026, docs/plans/MAIL-ROUTING-PLAN-2026-10-17.md): system mail goes from the platform email, invoices and every mail that carries a hotel's data go from that
-- hotel's own email. Two things the outbox needs for it:
--   1. two new kinds: 'bill_invoice' (a bill as a PDF) and 'advance_receipt' (an advance receipt as a PDF). The row carries only { name, hotelName, number, billId | advanceId }; the PDF is
--      made when the mail is SENT from the hotel's own data, so no document and no amount is ever stored in the outbox. Both are hotel mail: they must name their hotel (hotel_id).
--   2. last_error: why the last try failed, as a short CODE (AUTH, CONNECT, TLS, RECIPIENT, REFUSED, NO_SENDER, RENDER, UNKNOWN), never the mail server's own words (they can carry the
--      address or the login). A hotel's Settings > Email shows "Last mail failed: ..." from the newest failed row of the hotel. Cleared when the mail is finally sent.
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_kind_known;
ALTER TABLE platform.outbox
  ADD CONSTRAINT outbox_kind_known CHECK (kind IN (
    'login_code', 'reset_code', 'password_changed', 'email_changed', 'account_locked', 'account_blocked', 'new_device', 'temp_password', 'admin_reset',
    'invitation', 'onboarding_waiting', 'onboarding_approved', 'onboarding_rejected',
    'enquiry_confirmed', 'enquiry_declined', 'reset_link', 'enquiry_new', 'daily_summary', 'campaign', 'bill_invoice', 'advance_receipt'
  ));
-- a hotel kind always names its hotel (a platform kind never does): the rule of mail/routes.ts, also held by the database for the kinds that exist today
ALTER TABLE platform.outbox DROP CONSTRAINT IF EXISTS outbox_hotel_kinds_name_hotel;
ALTER TABLE platform.outbox ADD CONSTRAINT outbox_hotel_kinds_name_hotel CHECK (kind NOT IN ('bill_invoice', 'advance_receipt') OR hotel_id IS NOT NULL);
ALTER TABLE platform.outbox ADD COLUMN IF NOT EXISTS last_error varchar(20) CHECK (last_error ~ '^[A-Z_]{2,20}$');
CREATE INDEX IF NOT EXISTS outbox_hotel_updated_idx ON platform.outbox (hotel_id, updated_at DESC) WHERE hotel_id IS NOT NULL;