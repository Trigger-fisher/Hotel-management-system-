-- rollback: ALTER TABLE platform.hotel_mail DROP COLUMN IF EXISTS pause; ALTER TABLE platform.group_mail DROP COLUMN IF EXISTS pause;
-- Pause a hotel's or a group's mail (MJ, 1 Nov 2026), Super Admin only. `pause` is null while the mail runs, else {"at": ISO time, "by": who paused it, "reason": text, "scope": "all" | "one"}.
-- A paused hotel sends nothing; a group paused with scope "all" stops every hotel in it, with scope "one" only the group's own accounts are skipped (its hotels send through the platform).
-- Mail already queued waits (it does not use up its tries) and goes out after the pause ends. A row may hold only a pause: it has no accounts then.
ALTER TABLE platform.hotel_mail ADD COLUMN pause jsonb CHECK (pause IS NULL OR jsonb_typeof(pause) = 'object');
ALTER TABLE platform.group_mail ADD COLUMN pause jsonb CHECK (pause IS NULL OR jsonb_typeof(pause) = 'object');
