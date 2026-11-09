-- rollback: ALTER TABLE customers DROP COLUMN IF EXISTS id_proof_number_sealed, DROP COLUMN IF EXISTS id_proof_number_idx; ALTER TABLE pms_stays DROP COLUMN IF EXISTS id_proof_number_sealed, DROP COLUMN IF EXISTS id_proof_number_idx;
-- Decision 74 (MJ, 3 Nov 2026), RELEASE A: the guest and customer ID number is kept SEALED (AES-256-GCM, HMS_DATA_KEY, web-app/src/server/crypto/fieldSeal.ts) beside the plain column.
--   id_proof_number_sealed   the number sealed for this hotel and this field ("v1.<iv>.<tag>.<text>"); written with every save from now on, filled for old rows by `db:cli seal-numbers`
--   id_proof_number_idx      the search index of the number (HMAC, 64 hex): finds "the same ID again" without opening anything
-- The plain id_proof_number stays and is still written (dual-write) until RELEASE B has been verified in every hotel; then a later migration drops it.
-- Both new columns are nullable: a row with no ID number, or one not sealed yet, has NULL. Nothing is read from them until the app has HMS_DATA_KEY.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS id_proof_number_sealed text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS id_proof_number_idx char(64);
ALTER TABLE pms_stays ADD COLUMN IF NOT EXISTS id_proof_number_sealed text;
ALTER TABLE pms_stays ADD COLUMN IF NOT EXISTS id_proof_number_idx char(64);
CREATE INDEX IF NOT EXISTS customers_id_proof_idx ON customers (id_proof_number_idx) WHERE id_proof_number_idx IS NOT NULL;
CREATE INDEX IF NOT EXISTS pms_stays_id_proof_idx ON pms_stays (id_proof_number_idx) WHERE id_proof_number_idx IS NOT NULL;
