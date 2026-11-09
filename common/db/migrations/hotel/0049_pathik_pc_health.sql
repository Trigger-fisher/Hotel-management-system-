-- rollback: ALTER TABLE pathik_settings DROP CONSTRAINT IF EXISTS pathik_settings_check; ALTER TABLE pathik_pc DROP COLUMN IF EXISTS agent_note;
-- Pathik PC program, after the first live test (MJ, 19 Oct 2026):
--   pathik_pc.agent_note        the program's own last problem, sent with each poll as ONE fixed code (chrome_missing, sign_in_failed...; never free text); null when all is well. The PCs card
--                               shows its sentence.
--   pathik_settings_check       back: the Pathik switch can be on only with both halves of the hotel's Pathik account saved (hotel 0048 as applied dropped it; the PC program now signs in with
--                               that saved account). A hotel that was switched on without an account in the meantime is switched off first, so the rule holds; it cannot send anything anyway.
ALTER TABLE pathik_pc ADD COLUMN agent_note varchar(40) CHECK (agent_note IS NULL OR agent_note ~ '^[a-z_]{1,40}$');
UPDATE pathik_settings SET enabled = false WHERE enabled AND (username IS NULL OR password_encrypted IS NULL);
ALTER TABLE pathik_settings ADD CONSTRAINT pathik_settings_check CHECK (NOT enabled OR (username IS NOT NULL AND password_encrypted IS NOT NULL));
