-- rollback: ALTER TABLE platform.sessions DROP COLUMN IF EXISTS locked_at;
-- The screen lock belongs to the session (MJ, 5 Nov 2026): a reload or a new tab must not get past it. While locked_at is set, every route except the
-- session check, unlock and sign-out answers 423 SCREEN_LOCKED; the right password clears it.
ALTER TABLE platform.sessions ADD COLUMN IF NOT EXISTS locked_at timestamptz;
