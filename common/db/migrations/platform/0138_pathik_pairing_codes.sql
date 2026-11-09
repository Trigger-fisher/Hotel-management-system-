-- rollback: DROP TABLE IF EXISTS platform.pathik_pairing_codes;
-- Pairing the Pathik PC program (MJ, 19 Oct 2026; docs/plans/PATHIK-IN-BROWSER-DESIGN-2026-10-18.md): the Hotel Admin presses "Add this PC" and gets a short one-time code (8 characters, valid
-- 10 minutes); the program on the PC sends it once and receives its long-lived token. The program does not know the hotel yet, so the codes are kept here, in the platform schema, as a HASH only:
-- code_hash is the SHA-256 of the code, hotel_id and pc_id say which hotel and which PC row it pairs. A code works once (used_at) and only until expires_at; used and long-expired rows are
-- removed by the pairing calls themselves.
-- no-standard-columns: a short-lived lookup keyed by the code's hash; a row is written once, marked used once, then removed
-- hard-delete: used and expired codes are removed by the pairing calls (pathikPairing)
CREATE TABLE IF NOT EXISTS platform.pathik_pairing_codes (
  code_hash char(64) PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id),
  pc_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pathik_pairing_codes_hotel_idx ON platform.pathik_pairing_codes (hotel_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.pathik_pairing_codes TO hms_app;
