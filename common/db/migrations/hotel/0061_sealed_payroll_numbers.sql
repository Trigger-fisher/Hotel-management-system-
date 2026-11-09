-- rollback: ALTER TABLE employees DROP COLUMN IF EXISTS id_proof_number_sealed, DROP COLUMN IF EXISTS id_proof_number_idx, DROP COLUMN IF EXISTS account_number_sealed, DROP COLUMN IF EXISTS ifsc_code_sealed; ALTER TABLE payroll_companies DROP COLUMN IF EXISTS pan_number_sealed, DROP COLUMN IF EXISTS account_number_sealed, DROP COLUMN IF EXISTS ifsc_code_sealed; ALTER TABLE salary_processings DROP COLUMN IF EXISTS account_number_sealed, DROP COLUMN IF EXISTS ifsc_code_sealed;
-- Decision 74 (MJ, 4 Nov 2026), RELEASE A for the staff and payroll numbers: each stays plain beside a sealed twin (AES-256-GCM under HMS_DATA_KEY, bound to its table and column;
-- web-app/src/server/crypto/sealedColumns.ts lists them all) and, for the staff ID number, a search index (HMAC, 64 hex). The plain columns stay and are still written until RELEASE B has
-- been verified in every hotel; `db:cli seal-numbers` fills the twins of old rows. All new columns are nullable; NULL = no number, or not sealed yet.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_proof_number_sealed text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_proof_number_idx char(64);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS account_number_sealed text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ifsc_code_sealed text;
ALTER TABLE payroll_companies ADD COLUMN IF NOT EXISTS pan_number_sealed text;
ALTER TABLE payroll_companies ADD COLUMN IF NOT EXISTS account_number_sealed text;
ALTER TABLE payroll_companies ADD COLUMN IF NOT EXISTS ifsc_code_sealed text;
ALTER TABLE salary_processings ADD COLUMN IF NOT EXISTS account_number_sealed text;
ALTER TABLE salary_processings ADD COLUMN IF NOT EXISTS ifsc_code_sealed text;
CREATE INDEX IF NOT EXISTS employees_id_proof_idx ON employees (id_proof_number_idx) WHERE id_proof_number_idx IS NOT NULL;
