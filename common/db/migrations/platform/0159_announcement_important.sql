-- rollback: ALTER TABLE platform.announcements DROP COLUMN IF EXISTS important;
-- An important announcement (MJ, 1 Nov 2026) opens the top notch and stays until the person presses Accept; a normal one opens for a few seconds and tucks away.
ALTER TABLE platform.announcements ADD COLUMN important boolean NOT NULL DEFAULT false;
