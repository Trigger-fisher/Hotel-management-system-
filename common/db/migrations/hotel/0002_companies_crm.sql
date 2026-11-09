-- rollback: DROP TABLE IF EXISTS crm_activities; DROP TABLE IF EXISTS crm_leads; DROP TABLE IF EXISTS customers; DROP TABLE IF EXISTS company_profiles;
-- Companies, customers and CRM. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

-- hard-delete: Pallav app/Support/RecycleBin.php:118 (purge) and app/Http/Controllers/RecycleBinController.php:32 (permanent delete from the recycle bin)
CREATE TABLE company_profiles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(100) NOT NULL,
  address varchar(100),
  country varchar(100),
  nationality varchar(100),
  email varchar(254),
  pincode varchar(20),
  mobile_number varchar(15),
  phone_number varchar(15),
  discount_percentage numeric(5, 2) CHECK (discount_percentage BETWEEN 0 AND 100),
  gst_percentage numeric(5, 2) CHECK (gst_percentage BETWEEN 0 AND 100),
  tcs_percentage numeric(5, 2) CHECK (tcs_percentage BETWEEN 0 AND 100),
  tds_percentage numeric(5, 2) CHECK (tds_percentage BETWEEN 0 AND 100),
  instruction text,
  gst_number varchar(50),
  created_by uuid,
  updated_by uuid,
  contacts jsonb,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_profiles_name_key ON company_profiles (name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX company_profiles_legacy_id_key ON company_profiles (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX company_profiles_created_at_id_idx ON company_profiles (created_at, id);
CREATE INDEX company_profiles_gst_number_idx ON company_profiles (gst_number) WHERE gst_number IS NOT NULL;
CREATE INDEX company_profiles_deleted_at_idx ON company_profiles (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER company_profiles_touch_updated_at BEFORE UPDATE ON company_profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/CustomerController.php:194
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(100) NOT NULL,
  mobile varchar(15) NOT NULL,
  email varchar(254),
  address varchar(255),
  city varchar(100),
  id_proof_type varchar(60),
  id_proof_number text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'self')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_mobile_key ON customers (mobile);
CREATE INDEX customers_email_idx ON customers (email);
CREATE UNIQUE INDEX customers_legacy_id_key ON customers (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX customers_created_at_id_idx ON customers (created_at, id);
CREATE TRIGGER customers_touch_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/CrmController.php:128
CREATE TABLE crm_leads (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  name varchar(100) NOT NULL,
  mobile varchar(20),
  email varchar(254),
  source varchar(60),
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'quoted', 'booked', 'lost')),
  interest varchar(255),
  check_in date,
  check_out date,
  guests integer CHECK (guests BETWEEN 0 AND 65535),
  value_paise bigint CHECK (value_paise >= 0),
  next_follow_up date,
  lost_reason varchar(255),
  notes text,
  assigned_to uuid,
  customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Pallav: CrmController.php:76 'check_out' => nullable|date|after_or_equal:check_in
  CONSTRAINT crm_leads_dates_ck CHECK (check_in IS NULL OR check_out IS NULL OR check_out >= check_in)
);
CREATE INDEX crm_leads_mobile_idx ON crm_leads (mobile);
CREATE INDEX crm_leads_stage_idx ON crm_leads (stage);
CREATE INDEX crm_leads_next_follow_up_idx ON crm_leads (next_follow_up);
CREATE INDEX crm_leads_assigned_to_idx ON crm_leads (assigned_to);
CREATE INDEX crm_leads_customer_id_idx ON crm_leads (customer_id);
CREATE UNIQUE INDEX crm_leads_legacy_id_key ON crm_leads (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX crm_leads_stage_next_follow_up_idx ON crm_leads (stage, next_follow_up);
CREATE INDEX crm_leads_stage_updated_at_idx ON crm_leads (stage, updated_at);
CREATE TRIGGER crm_leads_touch_updated_at BEFORE UPDATE ON crm_leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE crm_activities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  lead_id uuid NOT NULL REFERENCES crm_leads (id) ON DELETE CASCADE,
  user_id uuid,
  type text NOT NULL CHECK (type IN ('call', 'whatsapp', 'email', 'visit', 'note', 'stage')),
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_activities_lead_id_idx ON crm_activities (lead_id);
CREATE INDEX crm_activities_user_id_idx ON crm_activities (user_id);
CREATE UNIQUE INDEX crm_activities_legacy_id_key ON crm_activities (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER crm_activities_touch_updated_at BEFORE UPDATE ON crm_activities FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
