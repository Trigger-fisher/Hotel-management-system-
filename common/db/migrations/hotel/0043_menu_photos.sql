-- rollback: ALTER TABLE menu_items DROP COLUMN IF EXISTS image_file;
-- Menu photos (guest portal round 3 a, the last part; 18 Oct 2026). A room-service menu item may have one photo: the stored file name in the hotel's private menu-photo store
-- (a folder no public address reads; the guest portal and the hotel's Master Data serve it through signed-in routes). Empty = no photo. The file is kept as WebP of at most 1 MB.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_file varchar(160);