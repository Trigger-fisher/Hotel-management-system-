-- rollback: DROP INDEX IF EXISTS system_logs_subject_id_idx; DROP INDEX IF EXISTS payroll_logs_subject_id_idx;
-- History on a record (MJ's plan, N9, 13 Oct 2026): a bill, advance, company, customer, reservation, stay or employee card reads the log lines whose
-- subject_id is that record. Neither log table had an index on subject_id, so every opened History scanned the whole table; at a few hundred thousand
-- lines per hotel that is a visible wait and a full read of the table on Neon. Partial indexes (most lines of the older modules have no subject) newest first.
CREATE INDEX IF NOT EXISTS system_logs_subject_id_idx ON system_logs (subject_id, created_at DESC) WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payroll_logs_subject_id_idx ON payroll_logs (subject_id, created_at DESC) WHERE subject_id IS NOT NULL;
