-- rollback: DROP TABLE IF EXISTS staff_advances; DROP TABLE IF EXISTS shift_handovers; DROP TABLE IF EXISTS expense_lines; DROP TABLE IF EXISTS food_misc_expenses; DROP TABLE IF EXISTS hotel_misc_expenses; DROP TABLE IF EXISTS food_cash_withdrawals; DROP TABLE IF EXISTS hotel_cash_withdrawals; DROP TABLE IF EXISTS food_cash_deposits; DROP TABLE IF EXISTS hotel_cash_deposits; DROP TABLE IF EXISTS expense_items; DROP TABLE IF EXISTS expense_categories;
-- Daily cash books, expenses, handovers and staff advances. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

-- hard-delete: Pallav app/Http/Controllers/ExpenseCatalogController.php:92
CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  business text NOT NULL CHECK (business IN ('hotel', 'food')),
  name varchar(80) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_categories_legacy_id_key ON expense_categories (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX expense_categories_business_name_key ON expense_categories (business, name);
CREATE TRIGGER expense_categories_touch_updated_at BEFORE UPDATE ON expense_categories FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/ExpenseCatalogController.php:155
CREATE TABLE expense_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  expense_category_id uuid NOT NULL REFERENCES expense_categories (id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  price_paise bigint NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_items_legacy_id_key ON expense_items (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX expense_items_expense_category_id_name_key ON expense_items (expense_category_id, name);
CREATE TRIGGER expense_items_touch_updated_at BEFORE UPDATE ON expense_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE hotel_cash_deposits (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  date date NOT NULL,
  time time NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(20),
  depositor varchar(100) NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  amount_in_words varchar(250),
  reason varchar(500),
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX hotel_cash_deposits_user_id_idx ON hotel_cash_deposits (user_id);
CREATE UNIQUE INDEX hotel_cash_deposits_legacy_id_key ON hotel_cash_deposits (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX hotel_cash_deposits_date_time_idx ON hotel_cash_deposits (date, time);
CREATE UNIQUE INDEX hotel_cash_deposits_entry_no_key ON hotel_cash_deposits (entry_no);
CREATE INDEX hotel_cash_deposits_deleted_at_idx ON hotel_cash_deposits (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER hotel_cash_deposits_touch_updated_at BEFORE UPDATE ON hotel_cash_deposits FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER hotel_cash_deposits_version_step BEFORE UPDATE ON hotel_cash_deposits FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE food_cash_deposits (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  date date NOT NULL,
  time time NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(20),
  depositor varchar(100) NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  amount_in_words varchar(250),
  reason varchar(500),
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX food_cash_deposits_user_id_idx ON food_cash_deposits (user_id);
CREATE UNIQUE INDEX food_cash_deposits_legacy_id_key ON food_cash_deposits (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX food_cash_deposits_date_time_idx ON food_cash_deposits (date, time);
CREATE UNIQUE INDEX food_cash_deposits_entry_no_key ON food_cash_deposits (entry_no);
CREATE INDEX food_cash_deposits_deleted_at_idx ON food_cash_deposits (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER food_cash_deposits_touch_updated_at BEFORE UPDATE ON food_cash_deposits FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER food_cash_deposits_version_step BEFORE UPDATE ON food_cash_deposits FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE hotel_cash_withdrawals (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  date date NOT NULL,
  time time NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(20),
  withdrawer varchar(100) NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  amount_in_words varchar(250),
  instruction text,
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX hotel_cash_withdrawals_user_id_idx ON hotel_cash_withdrawals (user_id);
CREATE UNIQUE INDEX hotel_cash_withdrawals_legacy_id_key ON hotel_cash_withdrawals (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX hotel_cash_withdrawals_date_time_idx ON hotel_cash_withdrawals (date, time);
CREATE UNIQUE INDEX hotel_cash_withdrawals_entry_no_key ON hotel_cash_withdrawals (entry_no);
CREATE INDEX hotel_cash_withdrawals_deleted_at_idx ON hotel_cash_withdrawals (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER hotel_cash_withdrawals_touch_updated_at BEFORE UPDATE ON hotel_cash_withdrawals FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER hotel_cash_withdrawals_version_step BEFORE UPDATE ON hotel_cash_withdrawals FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE food_cash_withdrawals (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  date date NOT NULL,
  time time NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(20),
  withdrawer varchar(100) NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  amount_in_words varchar(250),
  instruction text,
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX food_cash_withdrawals_user_id_idx ON food_cash_withdrawals (user_id);
CREATE UNIQUE INDEX food_cash_withdrawals_legacy_id_key ON food_cash_withdrawals (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX food_cash_withdrawals_date_time_idx ON food_cash_withdrawals (date, time);
CREATE UNIQUE INDEX food_cash_withdrawals_entry_no_key ON food_cash_withdrawals (entry_no);
CREATE INDEX food_cash_withdrawals_deleted_at_idx ON food_cash_withdrawals (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER food_cash_withdrawals_touch_updated_at BEFORE UPDATE ON food_cash_withdrawals FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER food_cash_withdrawals_version_step BEFORE UPDATE ON food_cash_withdrawals FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE hotel_misc_expenses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  date date NOT NULL,
  time time NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(20),
  expense_name varchar(100) NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  instruction varchar(500),
  amount_in_words varchar(250),
  expense_head varchar(60),
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX hotel_misc_expenses_user_id_idx ON hotel_misc_expenses (user_id);
CREATE UNIQUE INDEX hotel_misc_expenses_legacy_id_key ON hotel_misc_expenses (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX hotel_misc_expenses_date_time_idx ON hotel_misc_expenses (date, time);
CREATE UNIQUE INDEX hotel_misc_expenses_entry_no_key ON hotel_misc_expenses (entry_no);
CREATE INDEX hotel_misc_expenses_deleted_at_idx ON hotel_misc_expenses (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER hotel_misc_expenses_touch_updated_at BEFORE UPDATE ON hotel_misc_expenses FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER hotel_misc_expenses_version_step BEFORE UPDATE ON hotel_misc_expenses FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE food_misc_expenses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  date date NOT NULL,
  time time NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(20),
  expense_name varchar(100) NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  instruction varchar(500),
  amount_in_words varchar(250),
  expense_head varchar(60),
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX food_misc_expenses_user_id_idx ON food_misc_expenses (user_id);
CREATE UNIQUE INDEX food_misc_expenses_legacy_id_key ON food_misc_expenses (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX food_misc_expenses_date_time_idx ON food_misc_expenses (date, time);
CREATE UNIQUE INDEX food_misc_expenses_entry_no_key ON food_misc_expenses (entry_no);
CREATE INDEX food_misc_expenses_deleted_at_idx ON food_misc_expenses (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER food_misc_expenses_touch_updated_at BEFORE UPDATE ON food_misc_expenses FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER food_misc_expenses_version_step BEFORE UPDATE ON food_misc_expenses FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Http/Controllers/ExpenseController.php:515
CREATE TABLE expense_lines (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  business text NOT NULL CHECK (business IN ('hotel', 'food')),
  expense_id uuid NOT NULL,
  category_id uuid,
  item_id uuid,
  category varchar(80) NOT NULL,
  item varchar(80) NOT NULL,
  quantity numeric(12, 3) NOT NULL CHECK (quantity >= 0),
  price_paise bigint NOT NULL CHECK (price_paise >= 0),
  total_paise bigint NOT NULL CHECK (total_paise >= 0),
  pricing text NOT NULL DEFAULT 'listed' CHECK (pricing IN ('listed', 'custom')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_lines_legacy_id_key ON expense_lines (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX expense_lines_business_expense_id_idx ON expense_lines (business, expense_id);
CREATE TRIGGER expense_lines_touch_updated_at BEFORE UPDATE ON expense_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE shift_handovers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  d500_total_paise bigint NOT NULL DEFAULT 0 CHECK (d500_total_paise >= 0),
  d500_count varchar(10) NOT NULL DEFAULT '0',
  d200_total_paise bigint NOT NULL DEFAULT 0 CHECK (d200_total_paise >= 0),
  d200_count varchar(10) NOT NULL DEFAULT '0',
  d100_total_paise bigint NOT NULL DEFAULT 0 CHECK (d100_total_paise >= 0),
  d100_count varchar(10) NOT NULL DEFAULT '0',
  d50_total_paise bigint NOT NULL DEFAULT 0 CHECK (d50_total_paise >= 0),
  d50_count varchar(10) NOT NULL DEFAULT '0',
  d20_total_paise bigint NOT NULL DEFAULT 0 CHECK (d20_total_paise >= 0),
  d20_count varchar(10) NOT NULL DEFAULT '0',
  d10_total_paise bigint NOT NULL DEFAULT 0 CHECK (d10_total_paise >= 0),
  d10_count varchar(10) NOT NULL DEFAULT '0',
  d5_total_paise bigint NOT NULL DEFAULT 0 CHECK (d5_total_paise >= 0),
  d5_count varchar(10) NOT NULL DEFAULT '0',
  coins_total_paise bigint NOT NULL DEFAULT 0 CHECK (coins_total_paise >= 0),
  coins_count varchar(10) NOT NULL DEFAULT '0',
  date date,
  time time,
  user_id uuid NOT NULL,
  full_name varchar(20),
  shift varchar(20),
  total_paise bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  total_in_words varchar(250),
  notes jsonb,
  instructions jsonb,
  employee_id uuid,
  handover_to_name varchar(150),
  business_unit_id uuid REFERENCES business_units (id) ON DELETE SET NULL,
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX shift_handovers_user_id_idx ON shift_handovers (user_id);
CREATE INDEX shift_handovers_employee_id_idx ON shift_handovers (employee_id);
CREATE INDEX shift_handovers_business_unit_id_idx ON shift_handovers (business_unit_id);
CREATE UNIQUE INDEX shift_handovers_legacy_id_key ON shift_handovers (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX shift_handovers_date_time_idx ON shift_handovers (date, time);
CREATE UNIQUE INDEX shift_handovers_entry_no_key ON shift_handovers (entry_no);
CREATE INDEX shift_handovers_deleted_at_idx ON shift_handovers (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER shift_handovers_touch_updated_at BEFORE UPDATE ON shift_handovers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER shift_handovers_version_step BEFORE UPDATE ON shift_handovers FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

CREATE TABLE staff_advances (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  date date NOT NULL,
  time time NOT NULL,
  user_id uuid NOT NULL,
  full_name varchar(20),
  year_month varchar(7),
  employee_id uuid,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  instruction text,
  amount_in_words varchar(250),
  business text NOT NULL DEFAULT 'hotel' CHECK (business IN ('hotel', 'food')),
  business_unit_id uuid REFERENCES business_units (id) ON DELETE SET NULL,
  created_by uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_advances_user_id_idx ON staff_advances (user_id);
CREATE INDEX staff_advances_employee_id_idx ON staff_advances (employee_id);
CREATE INDEX staff_advances_business_idx ON staff_advances (business);
CREATE INDEX staff_advances_business_unit_id_idx ON staff_advances (business_unit_id);
CREATE UNIQUE INDEX staff_advances_legacy_id_key ON staff_advances (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX staff_advances_date_time_idx ON staff_advances (date, time);
CREATE INDEX staff_advances_business_date_idx ON staff_advances (business, date);
CREATE UNIQUE INDEX staff_advances_entry_no_key ON staff_advances (entry_no);
CREATE TRIGGER staff_advances_touch_updated_at BEFORE UPDATE ON staff_advances FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
