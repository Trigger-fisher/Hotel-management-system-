-- rollback: DROP INDEX IF EXISTS platform.outbox_hotel_id_idx; ALTER TABLE platform.outbox DROP COLUMN IF EXISTS hotel_id;
-- Each hotel sends its own mail from its own mail server (Settings > Email): a queued mail that names a hotel goes out through that hotel's SMTP, one with no
-- hotel (sign-in codes, platform invitations) through the platform sender. The worker reads the hotel's settings at send time; nothing of them is copied here.
-- A plain uuid, not a foreign key: a hotel is soft-deleted, and a mail of a hotel that is gone simply falls back to the platform sender.
ALTER TABLE platform.outbox ADD COLUMN hotel_id uuid;
CREATE INDEX outbox_hotel_id_idx ON platform.outbox (hotel_id) WHERE hotel_id IS NOT NULL;
