-- rollback: DROP INDEX IF EXISTS company_profiles_name_key; CREATE UNIQUE INDEX company_profiles_name_key ON company_profiles (name) WHERE deleted_at IS NULL;
-- A company name is unique among LIVE companies without regard to case ("acme" and "ACME" are the same company), as MySQL's collation made it for Pallav.
DROP INDEX company_profiles_name_key;
CREATE UNIQUE INDEX company_profiles_name_key ON company_profiles (lower(name)) WHERE deleted_at IS NULL;
