-- rollback: ALTER TABLE platform.users DROP COLUMN IF EXISTS photo_file;
-- A profile photo for every login: guest, company and staff (MJ, 18 Oct 2026, docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md). The photo itself is kept as WebP of at
-- most 1 MB in the PRIVATE media store (prefix profile-photos/, the same store as menu photos and ID scans); only its random file name is kept here. NULL = no photo.
-- The person adds, replaces or removes their own photo (My profile); a new photo always gets a new name, so a cached old one is never shown for the new.
ALTER TABLE platform.users ADD COLUMN IF NOT EXISTS photo_file text CHECK (photo_file IS NULL OR photo_file ~ '^[a-z0-9-]{8,120}\.webp$');
