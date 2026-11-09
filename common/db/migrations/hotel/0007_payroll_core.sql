-- rollback: ALTER TABLE staff_advances DROP CONSTRAINT IF EXISTS staff_advances_employee_id_fkey; ALTER TABLE shift_handovers DROP CONSTRAINT IF EXISTS shift_handovers_employee_id_fkey; DROP TABLE IF EXISTS staff_emails; DROP TABLE IF EXISTS payroll_logs; DROP TABLE IF EXISTS payroll_master_items; DROP TABLE IF EXISTS meal_plan_rates; DROP TABLE IF EXISTS food_charge_rates; DROP TABLE IF EXISTS employee_meal_periods; DROP TABLE IF EXISTS employee_separations; DROP TABLE IF EXISTS experience_letters; DROP TABLE IF EXISTS joining_letters; DROP TABLE IF EXISTS employee_deductions; DROP TABLE IF EXISTS deductions; DROP TABLE IF EXISTS attendance_entries; DROP TABLE IF EXISTS attendance_months; DROP TABLE IF EXISTS attendance_statuses; DROP TABLE IF EXISTS employees; DROP TABLE IF EXISTS id_proof_types; DROP TABLE IF EXISTS payroll_companies;
-- Payroll core: companies, staff, attendance, deductions, letters, meals and logs. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

CREATE TABLE payroll_companies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(150) NOT NULL,
  code varchar(50) NOT NULL,
  logo_path varchar(255),
  owner_name varchar(150),
  mobile_number varchar(15),
  email varchar(254),
  address varchar(255),
  city varchar(100),
  state varchar(100),
  pincode varchar(20),
  pan_number varchar(20),
  tan_number varchar(20),
  pf_registration_number varchar(50),
  esic_registration_number varchar(50),
  professional_tax_registration_number varchar(50),
  authorized_person_name varchar(150),
  authorized_designation varchar(100),
  authorized_mobile varchar(15),
  authorized_email varchar(254),
  signature_image_path varchar(255),
  bank_name varchar(150),
  account_number text,
  ifsc_code text,
  branch_name varchar(150),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payroll_companies_code_key ON payroll_companies (code);
CREATE UNIQUE INDEX payroll_companies_legacy_id_key ON payroll_companies (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER payroll_companies_touch_updated_at BEFORE UPDATE ON payroll_companies FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE id_proof_types (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(100) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX id_proof_types_name_key ON id_proof_types (name);
CREATE UNIQUE INDEX id_proof_types_legacy_id_key ON id_proof_types (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER id_proof_types_touch_updated_at BEFORE UPDATE ON id_proof_types FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE RESTRICT,
  employee_code varchar(50) NOT NULL,
  name varchar(150) NOT NULL,
  photo_path varchar(255),
  designation varchar(100),
  department varchar(100),
  responsibilities text,
  joining_date date,
  salary_paise bigint NOT NULL DEFAULT 0 CHECK (salary_paise >= 0),
  daily_working_hours numeric(5, 2) NOT NULL DEFAULT 8 CHECK (daily_working_hours BETWEEN 0.5 AND 24),
  contact_number varchar(15),
  address varchar(255),
  payment_mode varchar(40) NOT NULL DEFAULT 'Cash',
  bank_name varchar(150),
  account_holder_name varchar(150),
  account_number text,
  ifsc_code text,
  branch_name varchar(150),
  id_proof_type_id uuid REFERENCES id_proof_types (id) ON DELETE SET NULL,
  id_proof_number text,
  id_proof_image_path varchar(255),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  email varchar(254),
  date_of_birth date,
  gender varchar(20),
  nationality varchar(100),
  country_and_pincode varchar(100),
  qualification varchar(150),
  qualification_institution varchar(150),
  skills text,
  resume_path varchar(255),
  id_proof_back_image_path varchar(255),
  emergency_contact_name varchar(150),
  emergency_contact_relation varchar(60),
  emergency_contact_number text,
  contact_country varchar(4) NOT NULL DEFAULT '91',
  emergency_contact_country varchar(4) NOT NULL DEFAULT '91',
  id_proof_type varchar(100),
  shift varchar(20),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employees_payroll_company_id_idx ON employees (payroll_company_id);
CREATE INDEX employees_id_proof_type_id_idx ON employees (id_proof_type_id);
CREATE UNIQUE INDEX employees_legacy_id_key ON employees (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX employees_payroll_company_id_email_key ON employees (payroll_company_id, email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX employees_payroll_company_id_employee_code_key ON employees (payroll_company_id, employee_code) WHERE deleted_at IS NULL;
CREATE INDEX employees_payroll_company_id_joining_date_idx ON employees (payroll_company_id, joining_date);
CREATE INDEX employees_payroll_company_id_is_active_idx ON employees (payroll_company_id, is_active);
CREATE INDEX employees_payroll_company_id_is_active_name_idx ON employees (payroll_company_id, is_active, name);
CREATE INDEX employees_deleted_at_idx ON employees (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER employees_touch_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/AttendanceStatusController.php:99
CREATE TABLE attendance_statuses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  shortcut_key varchar(10) NOT NULL,
  color varchar(20) NOT NULL,
  attendance_percentage smallint NOT NULL CHECK (attendance_percentage BETWEEN 0 AND 100),
  status_type text NOT NULL DEFAULT 'Paid' CHECK (status_type IN ('Paid', 'Unpaid')),
  is_active boolean NOT NULL DEFAULT true,
  skips_food boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX attendance_statuses_legacy_id_key ON attendance_statuses (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX attendance_statuses_payroll_company_id_shortcut_key_key ON attendance_statuses (payroll_company_id, shortcut_key);
CREATE UNIQUE INDEX attendance_statuses_payroll_company_id_color_key ON attendance_statuses (payroll_company_id, color);
CREATE TRIGGER attendance_statuses_touch_updated_at BEFORE UPDATE ON attendance_statuses FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE attendance_months (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  salary_generated_at timestamptz,
  salary_generated_by uuid,
  generation_count bigint NOT NULL DEFAULT 0 CHECK (generation_count >= 0),
  unlocked_by uuid,
  unlocked_at timestamptz,
  unlock_session_id varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_months_salary_generated_by_idx ON attendance_months (salary_generated_by);
CREATE INDEX attendance_months_unlocked_by_idx ON attendance_months (unlocked_by);
CREATE UNIQUE INDEX attendance_months_legacy_id_key ON attendance_months (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX attendance_months_payroll_company_id_year_month_key ON attendance_months (payroll_company_id, year, month);
CREATE TRIGGER attendance_months_touch_updated_at BEFORE UPDATE ON attendance_months FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/AttendanceController.php:120
CREATE TABLE attendance_entries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  attendance_month_id uuid NOT NULL REFERENCES attendance_months (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  day smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  attendance_status_id uuid REFERENCES attendance_statuses (id) ON DELETE SET NULL,
  shortcut_key varchar(10),
  attendance_percentage smallint NOT NULL DEFAULT 0 CHECK (attendance_percentage BETWEEN 0 AND 100),
  overtime_hours numeric(6, 2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  skips_food boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_entries_employee_id_idx ON attendance_entries (employee_id);
CREATE INDEX attendance_entries_attendance_status_id_idx ON attendance_entries (attendance_status_id);
CREATE UNIQUE INDEX attendance_entries_legacy_id_key ON attendance_entries (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX attendance_entries_attendance_month_id_employee_id_day_key ON attendance_entries (attendance_month_id, employee_id, day);
CREATE TRIGGER attendance_entries_touch_updated_at BEFORE UPDATE ON attendance_entries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/DeductionController.php:77
CREATE TABLE deductions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  amount_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX deductions_legacy_id_key ON deductions (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX deductions_payroll_company_id_name_key ON deductions (payroll_company_id, name);
CREATE TRIGGER deductions_touch_updated_at BEFORE UPDATE ON deductions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/EmployeeController.php:273
CREATE TABLE employee_deductions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  deduction_id uuid NOT NULL REFERENCES deductions (id) ON DELETE CASCADE,
  deduction_type text NOT NULL DEFAULT 'Monthly' CHECK (deduction_type IN ('One Time', 'Monthly')),
  amount_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  is_settled boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_deductions_employee_id_idx ON employee_deductions (employee_id);
CREATE INDEX employee_deductions_deduction_id_idx ON employee_deductions (deduction_id);
CREATE UNIQUE INDEX employee_deductions_legacy_id_key ON employee_deductions (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER employee_deductions_touch_updated_at BEFORE UPDATE ON employee_deductions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/JoiningLetterController.php:65
CREATE TABLE joining_letters (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE CASCADE,
  subject varchar(255),
  introduction_content text,
  roles_responsibilities text,
  terms_conditions text,
  closing_message text,
  use_company_signatory boolean NOT NULL DEFAULT true,
  authorized_name varchar(150),
  authorized_designation varchar(100),
  signature_image_path varchar(255),
  authorized_closing_text text,
  acceptance_heading varchar(255),
  acceptance_content text,
  acceptance_closing_text text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX joining_letters_payroll_company_id_key ON joining_letters (payroll_company_id);
CREATE UNIQUE INDEX joining_letters_legacy_id_key ON joining_letters (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER joining_letters_touch_updated_at BEFORE UPDATE ON joining_letters FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/ExperienceLetterController.php:60
CREATE TABLE experience_letters (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE CASCADE,
  subject varchar(255),
  body_content text,
  conduct_remarks text,
  closing_message text,
  use_company_signatory boolean NOT NULL DEFAULT true,
  authorized_name varchar(150),
  authorized_designation varchar(100),
  signature_image_path varchar(255),
  authorized_closing_text text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX experience_letters_payroll_company_id_key ON experience_letters (payroll_company_id);
CREATE UNIQUE INDEX experience_letters_legacy_id_key ON experience_letters (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER experience_letters_touch_updated_at BEFORE UPDATE ON experience_letters FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE employee_separations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  separation_type varchar(60) NOT NULL DEFAULT 'Resignation',
  resignation_date date NOT NULL,
  last_working_date date NOT NULL,
  reason text NOT NULL,
  remarks text,
  document_path varchar(255),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Relieved')),
  rejoined_at date,
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Pallav: Payroll/SeparationController.php:41 'last_working_date' => after_or_equal:resignation_date
  CONSTRAINT employee_separations_dates_ck CHECK (last_working_date >= resignation_date)
);
CREATE INDEX employee_separations_payroll_company_id_idx ON employee_separations (payroll_company_id);
CREATE INDEX employee_separations_employee_id_idx ON employee_separations (employee_id);
CREATE UNIQUE INDEX employee_separations_legacy_id_key ON employee_separations (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX employee_separations_payroll_company_id_last_working_date_idx ON employee_separations (payroll_company_id, last_working_date);
CREATE UNIQUE INDEX employee_separations_entry_no_key ON employee_separations (entry_no);
CREATE INDEX employee_separations_deleted_at_idx ON employee_separations (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER employee_separations_touch_updated_at BEFORE UPDATE ON employee_separations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE employee_meal_periods (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  starts_on date NOT NULL,
  ends_on date,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Pallav: Payroll/FoodChargeController.php:82,120 'ends_on' => after_or_equal:starts_on
  CONSTRAINT employee_meal_periods_dates_ck CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX employee_meal_periods_legacy_id_key ON employee_meal_periods (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX employee_meal_periods_employee_id_starts_on_idx ON employee_meal_periods (employee_id, starts_on);
CREATE INDEX employee_meal_periods_payroll_company_id_starts_on_idx ON employee_meal_periods (payroll_company_id, starts_on);
CREATE INDEX employee_meal_periods_deleted_at_idx ON employee_meal_periods (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER employee_meal_periods_touch_updated_at BEFORE UPDATE ON employee_meal_periods FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/FoodPriceController.php:115
CREATE TABLE food_charge_rates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE CASCADE,
  monthly_amount_paise bigint NOT NULL CHECK (monthly_amount_paise >= 0),
  effective_from date NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX food_charge_rates_legacy_id_key ON food_charge_rates (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX food_charge_rates_payroll_company_id_effective_from_idx ON food_charge_rates (payroll_company_id, effective_from);
CREATE TRIGGER food_charge_rates_touch_updated_at BEFORE UPDATE ON food_charge_rates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/MealPlanRateController.php:67
CREATE TABLE meal_plan_rates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  plan varchar(100) NOT NULL,
  rate_per_person_paise bigint NOT NULL CHECK (rate_per_person_paise >= 0),
  effective_from date NOT NULL,
  note varchar(255),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX meal_plan_rates_legacy_id_key ON meal_plan_rates (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX meal_plan_rates_plan_effective_from_key ON meal_plan_rates (plan, effective_from);
CREATE TRIGGER meal_plan_rates_touch_updated_at BEFORE UPDATE ON meal_plan_rates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Payroll/PayrollMasterController.php:115
CREATE TABLE payroll_master_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid REFERENCES payroll_companies (id) ON DELETE CASCADE,
  list varchar(40) NOT NULL,
  label varchar(120) NOT NULL,
  value varchar(190),
  is_active boolean NOT NULL DEFAULT true,
  sort_order bigint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_master_items_payroll_company_id_idx ON payroll_master_items (payroll_company_id);
CREATE UNIQUE INDEX payroll_master_items_legacy_id_key ON payroll_master_items (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX payroll_master_items_shared_key ON payroll_master_items (list, label) WHERE payroll_company_id IS NULL;
CREATE UNIQUE INDEX payroll_master_items_company_key ON payroll_master_items (payroll_company_id, list, label) WHERE payroll_company_id IS NOT NULL;
CREATE INDEX payroll_master_items_list_payroll_company_id_idx ON payroll_master_items (list, payroll_company_id);
CREATE TRIGGER payroll_master_items_touch_updated_at BEFORE UPDATE ON payroll_master_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- append-only: what was done in payroll and who did it, never edited
CREATE TABLE payroll_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid REFERENCES payroll_companies (id) ON DELETE RESTRICT,
  company_name varchar(150),
  user_id uuid,
  user_name varchar(150),
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'emailed', 'error')),
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  entity varchar(60) NOT NULL,
  subject_id uuid,
  subject_label varchar(255),
  summary varchar(500) NOT NULL,
  details jsonb,
  ip_address varchar(45),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_logs_user_id_idx ON payroll_logs (user_id);
CREATE UNIQUE INDEX payroll_logs_legacy_id_key ON payroll_logs (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX payroll_logs_payroll_company_id_created_at_idx ON payroll_logs (payroll_company_id, created_at);
CREATE INDEX payroll_logs_entity_action_idx ON payroll_logs (entity, action);

CREATE TABLE staff_emails (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  payroll_company_id uuid NOT NULL REFERENCES payroll_companies (id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  employee_name varchar(150) NOT NULL,
  employee_code varchar(50),
  designation varchar(100),
  recipient_id uuid REFERENCES payroll_master_items (id) ON DELETE SET NULL,
  recipient_name varchar(150),
  recipient_email varchar(190),
  subject varchar(255),
  attachment varchar(150),
  attachment_bytes bigint CHECK (attachment_bytes >= 0),
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  message varchar(500),
  error text,
  duration_ms bigint CHECK (duration_ms >= 0),
  sent_by uuid,
  sent_by_name varchar(150),
  ip_address varchar(45),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_emails_employee_id_idx ON staff_emails (employee_id);
CREATE INDEX staff_emails_recipient_id_idx ON staff_emails (recipient_id);
CREATE INDEX staff_emails_sent_by_idx ON staff_emails (sent_by);
CREATE UNIQUE INDEX staff_emails_legacy_id_key ON staff_emails (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX staff_emails_payroll_company_id_created_at_idx ON staff_emails (payroll_company_id, created_at);
CREATE INDEX staff_emails_payroll_company_id_status_idx ON staff_emails (payroll_company_id, status);
CREATE TRIGGER staff_emails_touch_updated_at BEFORE UPDATE ON staff_emails FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- foreign keys from earlier tables that point at tables created in this file
ALTER TABLE shift_handovers ADD CONSTRAINT shift_handovers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE staff_advances ADD CONSTRAINT staff_advances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL;
