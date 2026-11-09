-- rollback: ALTER TABLE platform.guests DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason; ALTER TABLE platform.companies DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason; ALTER TABLE platform.gst_registry DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_reason;
-- Central console: delete and restore (MJ, 3 Nov 2026: "full CRUD in all"). A guest profile, a company profile or a saved GST record is never removed from the table: the Super Admin's delete
-- sets deleted_at (and who, and why: deleted_by is the Super Admin's login id, kept as a plain id so a closed account never blocks it) and a restore clears them again. A deleted row is left out of the lists, of matching (a hotel making a guest with the same mobile, a company with the same
-- GSTIN) and of the duplicates review, and a deleted GST record is fetched fresh by the next lookup (which brings the same row back with the provider's newest answer). The hotels' own
-- copies and their bills do not change. The app role keeps no DELETE on these tables: nothing here grants one.
ALTER TABLE platform.guests
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid,
  ADD COLUMN deleted_reason text CHECK (deleted_reason IS NULL OR char_length(deleted_reason) <= 300);
ALTER TABLE platform.companies
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid,
  ADD COLUMN deleted_reason text CHECK (deleted_reason IS NULL OR char_length(deleted_reason) <= 300);
ALTER TABLE platform.gst_registry
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid,
  ADD COLUMN deleted_reason text CHECK (deleted_reason IS NULL OR char_length(deleted_reason) <= 300);
-- a deleted profile cannot keep a portal login (the app refuses that delete; this makes it a rule of the table too)
ALTER TABLE platform.guests ADD CONSTRAINT guests_deleted_has_no_login CHECK (deleted_at IS NULL OR user_id IS NULL);
ALTER TABLE platform.companies ADD CONSTRAINT companies_deleted_has_no_login CHECK (deleted_at IS NULL OR user_id IS NULL);
-- the live lookups
CREATE INDEX guests_live_mobile_idx ON platform.guests (mobile) WHERE mobile IS NOT NULL AND merged_into IS NULL AND deleted_at IS NULL;
CREATE INDEX companies_live_gstin_idx ON platform.companies (gstin) WHERE gstin IS NOT NULL AND merged_into IS NULL AND deleted_at IS NULL;
