-- rollback: DROP INDEX IF EXISTS employees_payroll_company_id_employee_code_key; CREATE UNIQUE INDEX employees_payroll_company_id_employee_code_key ON employees (payroll_company_id, employee_code) WHERE deleted_at IS NULL; DROP INDEX IF EXISTS deductions_payroll_company_id_name_key; CREATE UNIQUE INDEX deductions_payroll_company_id_name_key ON deductions (payroll_company_id, name); DROP INDEX IF EXISTS attendance_statuses_payroll_company_id_shortcut_key_key; CREATE UNIQUE INDEX attendance_statuses_payroll_company_id_shortcut_key_key ON attendance_statuses (payroll_company_id, shortcut_key); DROP INDEX IF EXISTS attendance_statuses_payroll_company_id_color_key; CREATE UNIQUE INDEX attendance_statuses_payroll_company_id_color_key ON attendance_statuses (payroll_company_id, color);
-- Payroll names and codes are unique per company without regard to case, as MySQL's collation made them for Pallav: an employee code among live
-- staff, a deduction name, an attendance mark's shortcut key and its colour.
DROP INDEX employees_payroll_company_id_employee_code_key;
CREATE UNIQUE INDEX employees_payroll_company_id_employee_code_key ON employees (payroll_company_id, lower(employee_code)) WHERE deleted_at IS NULL;
DROP INDEX deductions_payroll_company_id_name_key;
CREATE UNIQUE INDEX deductions_payroll_company_id_name_key ON deductions (payroll_company_id, lower(name));
DROP INDEX attendance_statuses_payroll_company_id_shortcut_key_key;
CREATE UNIQUE INDEX attendance_statuses_payroll_company_id_shortcut_key_key ON attendance_statuses (payroll_company_id, lower(shortcut_key));
DROP INDEX attendance_statuses_payroll_company_id_color_key;
CREATE UNIQUE INDEX attendance_statuses_payroll_company_id_color_key ON attendance_statuses (payroll_company_id, lower(color));
