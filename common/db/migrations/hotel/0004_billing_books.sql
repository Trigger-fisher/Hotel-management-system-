-- rollback: DROP TABLE IF EXISTS bill_master_bills; DROP TABLE IF EXISTS bill_master_advances; DROP TABLE IF EXISTS accounting_years;
-- Billing and the books. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

CREATE TABLE accounting_years (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  label varchar(20) NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  closed_at timestamptz,
  started_by uuid,
  closed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- domain rule: a year ends on or after the day it starts
  CONSTRAINT accounting_years_dates_ck CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX accounting_years_label_key ON accounting_years (label);
CREATE UNIQUE INDEX accounting_years_starts_on_key ON accounting_years (starts_on);
CREATE UNIQUE INDEX accounting_years_legacy_id_key ON accounting_years (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER accounting_years_touch_updated_at BEFORE UPDATE ON accounting_years FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE bill_master_advances (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  receipt_number varchar(100),
  guest_name varchar(255),
  mobile_number varchar(15),
  company_id uuid REFERENCES company_profiles (id) ON DELETE RESTRICT,
  payment_date date,
  hotel_amount_paise bigint CHECK (hotel_amount_paise >= 0),
  food_amount_paise bigint CHECK (food_amount_paise >= 0),
  hotel_mode varchar(20),
  food_mode varchar(20),
  reference_name varchar(255),
  reference_mobile_number varchar(15),
  instruction varchar(255),
  hotel_balance_paise bigint NOT NULL DEFAULT 0 CHECK (hotel_balance_paise >= 0),
  food_balance_paise bigint NOT NULL DEFAULT 0 CHECK (food_balance_paise >= 0),
  total_paise bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  hotel_refund_amount_paise bigint CHECK (hotel_refund_amount_paise >= 0),
  food_refund_amount_paise bigint CHECK (food_refund_amount_paise >= 0),
  hotel_refund_mode varchar(20),
  food_refund_mode varchar(20),
  refund_payment_date date,
  refund_guest_name varchar(255),
  refund_mobile_number varchar(15),
  refund_instruction varchar(255),
  created_by uuid,
  room_number varchar(20),
  reservation_id uuid,
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE UNIQUE INDEX bill_master_advances_receipt_number_key ON bill_master_advances (receipt_number) WHERE deleted_at IS NULL;
CREATE INDEX bill_master_advances_company_id_idx ON bill_master_advances (company_id);
CREATE INDEX bill_master_advances_reservation_id_idx ON bill_master_advances (reservation_id);
CREATE UNIQUE INDEX bill_master_advances_legacy_id_key ON bill_master_advances (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX bill_master_advances_payment_date_idx ON bill_master_advances (payment_date);
CREATE INDEX bill_master_advances_refund_payment_date_idx ON bill_master_advances (refund_payment_date) WHERE refund_payment_date IS NOT NULL;
CREATE INDEX bill_master_advances_company_id_payment_date_idx ON bill_master_advances (company_id, payment_date);
CREATE UNIQUE INDEX bill_master_advances_entry_no_key ON bill_master_advances (entry_no);
CREATE INDEX bill_master_advances_deleted_at_idx ON bill_master_advances (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER bill_master_advances_touch_updated_at BEFORE UPDATE ON bill_master_advances FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER bill_master_advances_version_step BEFORE UPDATE ON bill_master_advances FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE bill_master_bills (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  debit_bill_date date,
  debit_bill_date_1 date,
  debit_bill_date_2 date,
  debit_bill_date_3 date,
  debit_bill_date_4 date,
  debit_hotel_mode varchar(20),
  debit_hotel_mode_1 varchar(20),
  debit_hotel_mode_2 varchar(20),
  debit_hotel_mode_3 varchar(20),
  debit_hotel_mode_4 varchar(20),
  debit_food_mode varchar(20),
  debit_food_mode_1 varchar(20),
  debit_food_mode_2 varchar(20),
  debit_food_mode_3 varchar(20),
  debit_food_mode_4 varchar(20),
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_hotel_amount_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_hotel_amount_1_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_hotel_amount_2_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_hotel_amount_3_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_hotel_amount_4_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_food_amount_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_food_amount_1_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_food_amount_2_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_food_amount_3_paise bigint,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  debit_food_amount_4_paise bigint,
  advance_id uuid REFERENCES bill_master_advances (id) ON DELETE SET NULL,
  advance_receipt_number varchar(100),
  advance_guest_name varchar(100),
  advance_hotel_amount_snapshot varchar(100),
  advance_date_snapshot varchar(100),
  advance_food_amount_snapshot varchar(100),
  advance_company_snapshot varchar(100),
  bill_number varchar(100),
  company_id uuid REFERENCES company_profiles (id) ON DELETE RESTRICT,
  bill_date date,
  guest_name varchar(255),
  mobile_number varchar(15),
  hotel_plan varchar(100),
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  hotel_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  hotel_plan_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  hotel_laundry_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  hotel_gst_paise bigint NOT NULL DEFAULT 0,
  hotel_mode_of_payment varchar(100),
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  food_plan_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  food_laundry_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  food_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  food_gst_paise bigint NOT NULL DEFAULT 0,
  food_mode_of_payment varchar(100),
  -- may be negative: BillMasterController.php:379 the sum of the lines, and a line may be a negative adjustment
  total_hotel_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:379 the sum of the lines, and a line may be a negative adjustment
  total_food_amount_paise bigint NOT NULL DEFAULT 0,
  reference_name varchar(100),
  reference_mobile_number varchar(15),
  instruction text,
  invoice_pdf_path varchar(255),
  balance_hotel_amount_paise bigint NOT NULL DEFAULT 0 CHECK (balance_hotel_amount_paise >= 0),
  balance_food_amount_paise bigint NOT NULL DEFAULT 0 CHECK (balance_food_amount_paise >= 0),
  advance_hotel_amount_paise bigint NOT NULL DEFAULT 0 CHECK (advance_hotel_amount_paise >= 0),
  advance_food_amount_paise bigint NOT NULL DEFAULT 0 CHECK (advance_food_amount_paise >= 0),
  advance_delete_hotel_amount_paise bigint NOT NULL DEFAULT 0 CHECK (advance_delete_hotel_amount_paise >= 0),
  advance_delete_food_amount_paise bigint NOT NULL DEFAULT 0 CHECK (advance_delete_food_amount_paise >= 0),
  formatted_advance_receipt_number varchar(255),
  debit_hotel_advance varchar(100),
  debit_food_advance varchar(100),
  debit_reference_name varchar(100),
  debit_reference_mobile_number varchar(15),
  debit_instruction text,
  created_by uuid,
  room_number varchar(20),
  gr_number varchar(50),
  guest_address varchar(255),
  guest_gstin varchar(20),
  persons integer CHECK (persons BETWEEN 0 AND 65535),
  arrival_at timestamptz,
  departure_at timestamptz,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  hotel_extra_bed_amount_paise bigint NOT NULL DEFAULT 0,
  -- may be negative: BillMasterController.php:335-359,519-520 'numeric' with no min: a bill line or debit payment may be a negative adjustment
  hotel_other_amount_paise bigint NOT NULL DEFAULT 0,
  food_invoice_pdf_path varchar(255),
  stay_segments jsonb,
  plan_food_amount_paise bigint NOT NULL DEFAULT 0 CHECK (plan_food_amount_paise >= 0),
  updated_by uuid,
  entry_no bigint NOT NULL CHECK (entry_no >= 1),
  hotel_gst_percent numeric(5, 2) CHECK (hotel_gst_percent BETWEEN 0 AND 28),
  food_gst_percent numeric(5, 2) CHECK (food_gst_percent BETWEEN 0 AND 28),
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Pallav: BillMasterController.php:357 'departure_at' => nullable|date|after_or_equal:arrival_at
  CONSTRAINT bill_master_bills_stay_ck CHECK (arrival_at IS NULL OR departure_at IS NULL OR departure_at >= arrival_at)
);
CREATE INDEX bill_master_bills_advance_id_idx ON bill_master_bills (advance_id);
CREATE UNIQUE INDEX bill_master_bills_bill_number_key ON bill_master_bills (bill_number) WHERE deleted_at IS NULL;
CREATE INDEX bill_master_bills_company_id_idx ON bill_master_bills (company_id);
CREATE UNIQUE INDEX bill_master_bills_legacy_id_key ON bill_master_bills (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX bill_master_bills_bill_date_idx ON bill_master_bills (bill_date);
CREATE INDEX bill_master_bills_debit_bill_date_idx ON bill_master_bills (debit_bill_date) WHERE debit_bill_date IS NOT NULL;
CREATE INDEX bill_master_bills_company_id_bill_date_idx ON bill_master_bills (company_id, bill_date);
CREATE UNIQUE INDEX bill_master_bills_entry_no_key ON bill_master_bills (entry_no);
CREATE INDEX bill_master_bills_deleted_at_idx ON bill_master_bills (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER bill_master_bills_touch_updated_at BEFORE UPDATE ON bill_master_bills FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER bill_master_bills_version_step BEFORE UPDATE ON bill_master_bills FOR EACH ROW EXECUTE FUNCTION enforce_version_step();
