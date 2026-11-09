-- rollback: ALTER TABLE pathik_settings ADD CHECK (NOT enabled OR (username IS NOT NULL AND password_encrypted IS NOT NULL)) (only when every row has both); ALTER TABLE pathik_start DROP COLUMN IF EXISTS pc_id; ALTER TABLE pathik_start DROP COLUMN IF EXISTS mode; DROP TABLE IF EXISTS pathik_pc;
-- Pathik through a small PC program (MJ, 19 Oct 2026; docs/plans/PATHIK-IN-BROWSER-DESIGN-2026-10-18.md): a program on the front-desk PC polls HMS, claims a waiting run, opens a real Chrome
-- window of its own on the PC, fills Pathik's form, and the user presses Pathik's own Submit; the program reports the serial. HMS keeps the whole state machine.
--
-- pathik_pc: one front-desk PC of this hotel. NO Pathik password and no guest data: only the PC's own bearer (kept as its SHA-256), when it was last seen and its program version.
--   name                 what the Hotel Admin calls it (at most 40 characters, unique among the PCs not removed)
--   token_hash           SHA-256 of the PC's long-lived token (shown to the PC once, at pairing); null until the PC has paired; a re-pair replaces it
--   pairing_expires_at   a pairing code is open until then (the code itself is only a hash in the platform table pathik_pairing_codes); null when none is open
--   connected_at         the first poll after pairing; last_seen_at every poll; agent_version the program's own
--   ping_*               "Test connection": the ping id and when it was asked and answered (not a run: it never counts for one run per row)
--   revoked_at           removed in HMS: the PC's next poll is refused (a row is never deleted)
-- pathik_start.mode: server (the background bot, as before) or pc; pc_id: the PC that took a pc run (a plain id, no foreign key: a PC row is never deleted).
CREATE TABLE pathik_pc (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(40) NOT NULL CHECK (btrim(name) <> ''),
  token_hash char(64) CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  machine_id varchar(100),
  agent_version varchar(20),
  pairing_expires_at timestamptz,
  connected_at timestamptz,
  last_seen_at timestamptz,
  ping_id uuid,
  ping_requested_at timestamptz,
  ping_answered_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pathik_pc_legacy_id_key ON pathik_pc (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX pathik_pc_token_hash_key ON pathik_pc (token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX pathik_pc_name_key ON pathik_pc (lower(name)) WHERE revoked_at IS NULL;
CREATE TRIGGER pathik_pc_touch_updated_at BEFORE UPDATE ON pathik_pc FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE pathik_start ADD COLUMN mode text NOT NULL DEFAULT 'server' CHECK (mode IN ('server', 'pc'));
ALTER TABLE pathik_start ADD COLUMN pc_id uuid;
CREATE INDEX pathik_start_pc_idx ON pathik_start (pc_id) WHERE pc_id IS NOT NULL;
-- The switch may now be on with no Pathik account saved: the PC program never gets the account (the person signs in to Pathik in the PC's own Chrome). The background bot (PATHIK_MODE=server) still needs both
-- halves; the service asks for them in that mode. This drops the table-level CHECK that hotel migration 0021 made (PostgreSQL named it pathik_settings_check).
ALTER TABLE pathik_settings DROP CONSTRAINT IF EXISTS pathik_settings_check;