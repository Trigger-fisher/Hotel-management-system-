-- rollback: DROP TRIGGER IF EXISTS salary_processings_version_step ON salary_processings; CREATE TRIGGER salary_processings_version_step BEFORE UPDATE ON salary_processings FOR EACH ROW EXECUTE FUNCTION enforce_version_step(); DROP FUNCTION IF EXISTS enforce_version_rises();
-- A rule the payroll-pay repositories need from the database (one letter template per company and kind is already a unique index of the template).
--
-- A re-generate of a month replaces the processing rows, and the NEW row carries the old row's number on, one higher (MJ #23: a form opened
--    before the re-generate can never match the new row). So on salary_processings the version may rise by MORE than one, never stay or fall.
--    Every other versioned table keeps the exact-step rule.
CREATE FUNCTION enforce_version_rises() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version IS NULL OR NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'version must rise on every update of %', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER salary_processings_version_step ON salary_processings;
CREATE TRIGGER salary_processings_version_step BEFORE UPDATE ON salary_processings FOR EACH ROW EXECUTE FUNCTION enforce_version_rises();

