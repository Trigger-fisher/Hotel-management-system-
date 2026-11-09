-- rollback: DROP TABLE IF EXISTS bonus_incentives; DROP TABLE IF EXISTS payroll_advances; DROP TABLE IF EXISTS salary_update_histories; DROP TABLE IF EXISTS salary_processing_lines; DROP TABLE IF EXISTS salary_processings;
-- Payroll pay: salary processing, payments, history, advances and bonuses. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

CREATE TABLE salary_processings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  company_name varchar(150) NOT NULL,
  employee_code varchar(50) NOT NULL,
  employee_name varchar(150) NOT NULL,
  designation varchar(100),
  department varchar(100),
  payment_mode varchar(40),
  monthly_salary_paise bigint NOT NULL DEFAULT 0 CHECK (monthly_salary_paise >= 0),
  daily_working_hours numeric(5, 2) NOT NULL DEFAULT 8 CHECK (daily_working_hours BETWEEN 0.5 AND 24),
  total_days_in_month smallint NOT NULL DEFAULT 0 CHECK (total_days_in_month BETWEEN 0 AND 255),
  daily_salary_paise bigint NOT NULL DEFAULT 0 CHECK (daily_salary_paise >= 0),
  days_0 numeric(6, 2) NOT NULL DEFAULT 0 CHECK (days_0 BETWEEN 0 AND 31),
  days_25 numeric(6, 2) NOT NULL DEFAULT 0 CHECK (days_25 BETWEEN 0 AND 31),
  days_50 numeric(6, 2) NOT NULL DEFAULT 0 CHECK (days_50 BETWEEN 0 AND 31),
  days_75 numeric(6, 2) NOT NULL DEFAULT 0 CHECK (days_75 BETWEEN 0 AND 31),
  days_100 numeric(6, 2) NOT NULL DEFAULT 0 CHECK (days_100 BETWEEN 0 AND 31),
  total_payable_days numeric(6, 2) NOT NULL DEFAULT 0 CHECK (total_payable_days BETWEEN 0 AND 31),
  attendance_salary_paise bigint NOT NULL DEFAULT 0 CHECK (attendance_salary_paise >= 0),
  overtime_hours numeric(8, 2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  hourly_rate_paise bigint NOT NULL DEFAULT 0 CHECK (hourly_rate_paise >= 0),
  overtime_amount_paise bigint NOT NULL DEFAULT 0 CHECK (overtime_amount_paise >= 0),
  bonus_amount_paise bigint NOT NULL DEFAULT 0 CHECK (bonus_amount_paise >= 0),
  incentive_amount_paise bigint NOT NULL DEFAULT 0 CHECK (incentive_amount_paise >= 0),
  deduction_amount_paise bigint NOT NULL DEFAULT 0 CHECK (deduction_amount_paise >= 0),
  advance_deduction_paise bigint NOT NULL DEFAULT 0 CHECK (advance_deduction_paise >= 0),
  pending_advance_amount_paise bigint NOT NULL DEFAULT 0 CHECK (pending_advance_amount_paise >= 0),
  -- may be negative: SalaryProcessor.php:279 net can fall below zero when deductions exceed earnings; SalaryProcessing::outstanding() clamps with max(0, ...)
  net_salary_paise bigint NOT NULL DEFAULT 0,
  payment_status varchar(20) NOT NULL DEFAULT 'Pending',
  generation_count bigint NOT NULL DEFAULT 1 CHECK (generation_count >= 0),
  processed_by uuid,
  processed_at timestamptz NOT NULL,
  paid_amount_paise bigint NOT NULL DEFAULT 0 CHECK (paid_amount_paise >= 0),
  paid_at date,
  payment_reference varchar(100),
  payment_remarks text,
  payment_updated_by uuid,
  payment_updated_at timestamptz,
  bank_name varchar(120),
  account_holder_name varchar(120),
  account_number text,
  ifsc_code text,
  branch_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX salary_processings_processed_by_idx ON salary_processings (processed_by);
CREATE INDEX salary_processings_payment_updated_by_idx ON salary_processings (payment_updated_by);
CREATE UNIQUE INDEX salary_processings_legacy_id_key ON salary_processings (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX salary_processings_payroll_company_id_year_month_idx ON salary_processings (payroll_company_id, year, month);
CREATE INDEX salary_processings_employee_id_idx ON salary_processings (employee_id);
CREATE INDEX salary_processings_payroll_company_id_year_month_employee_name_ ON salary_processings (payroll_company_id, year, month, employee_name);
CREATE INDEX salary_processings_payroll_company_id_employee_id_year_month_id ON salary_processings (payroll_company_id, employee_id, year, month);
CREATE TRIGGER salary_processings_touch_updated_at BEFORE UPDATE ON salary_processings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER salary_processings_version_step BEFORE UPDATE ON salary_processings FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

CREATE TABLE salary_processing_lines (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  salary_processing_id uuid NOT NULL REFERENCES salary_processings (id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('Deduction', 'Advance', 'Bonus', 'Incentive')),
  label varchar(150) NOT NULL,
  deduction_type varchar(20),
  amount_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  pending_amount_paise bigint NOT NULL DEFAULT 0 CHECK (pending_amount_paise >= 0),
  source_type varchar(50),
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salary_processing_lines_salary_processing_id_idx ON salary_processing_lines (salary_processing_id);
CREATE UNIQUE INDEX salary_processing_lines_legacy_id_key ON salary_processing_lines (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER salary_processing_lines_touch_updated_at BEFORE UPDATE ON salary_processing_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE salary_update_histories (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  employee_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  effective_date date NOT NULL,
  field_name varchar(100) NOT NULL,
  previous_value text,
  new_value text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salary_update_histories_employee_id_idx ON salary_update_histories (employee_id);
CREATE INDEX salary_update_histories_changed_by_idx ON salary_update_histories (changed_by);
CREATE UNIQUE INDEX salary_update_histories_legacy_id_key ON salary_update_histories (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX salary_update_histories_employee_id_effective_date_field_name_i ON salary_update_histories (employee_id, effective_date, field_name);
CREATE TRIGGER salary_update_histories_touch_updated_at BEFORE UPDATE ON salary_update_histories FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE payroll_advances (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  advance_date timestamptz NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  deduction_type text NOT NULL DEFAULT 'One Time' CHECK (deduction_type IN ('One Time', 'Monthly')),
  deduction_amount_paise bigint NOT NULL DEFAULT 0 CHECK (deduction_amount_paise >= 0),
  remarks text,
  recovered_amount_paise bigint NOT NULL DEFAULT 0 CHECK (recovered_amount_paise >= 0),
  is_settled boolean NOT NULL DEFAULT false,
  is_carry_forward boolean NOT NULL DEFAULT false,
  parent_advance_id uuid REFERENCES payroll_advances (id) ON DELETE SET NULL,
  created_by uuid,
  source_salary_processing_id uuid REFERENCES salary_processings (id) ON DELETE SET NULL,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_advances_payroll_company_id_idx ON payroll_advances (payroll_company_id);
CREATE INDEX payroll_advances_employee_id_idx ON payroll_advances (employee_id);
CREATE INDEX payroll_advances_parent_advance_id_idx ON payroll_advances (parent_advance_id);
CREATE INDEX payroll_advances_source_salary_processing_id_idx ON payroll_advances (source_salary_processing_id);
CREATE UNIQUE INDEX payroll_advances_legacy_id_key ON payroll_advances (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX payroll_advances_payroll_company_id_advance_date_idx ON payroll_advances (payroll_company_id, advance_date);
CREATE INDEX payroll_advances_employee_id_is_settled_idx ON payroll_advances (employee_id, is_settled);
CREATE INDEX payroll_advances_employee_id_is_settled_advance_date_idx ON payroll_advances (employee_id, is_settled, advance_date);
CREATE UNIQUE INDEX payroll_advances_entry_no_key ON payroll_advances (entry_no);
CREATE INDEX payroll_advances_deleted_at_idx ON payroll_advances (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER payroll_advances_touch_updated_at BEFORE UPDATE ON payroll_advances FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE bonus_incentives (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  entry_date timestamptz NOT NULL,
  type text NOT NULL DEFAULT 'Bonus' CHECK (type IN ('Bonus', 'Incentive')),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  remarks text,
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bonus_incentives_payroll_company_id_idx ON bonus_incentives (payroll_company_id);
CREATE INDEX bonus_incentives_employee_id_idx ON bonus_incentives (employee_id);
CREATE UNIQUE INDEX bonus_incentives_legacy_id_key ON bonus_incentives (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX bonus_incentives_payroll_company_id_entry_date_idx ON bonus_incentives (payroll_company_id, entry_date);
CREATE INDEX bonus_incentives_employee_id_entry_date_idx ON bonus_incentives (employee_id, entry_date);
CREATE UNIQUE INDEX bonus_incentives_entry_no_key ON bonus_incentives (entry_no);
CREATE INDEX bonus_incentives_deleted_at_idx ON bonus_incentives (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER bonus_incentives_touch_updated_at BEFORE UPDATE ON bonus_incentives FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
