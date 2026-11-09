-- rollback: DROP TABLE IF EXISTS platform.profile_kept_apart; DROP TABLE IF EXISTS platform.company_hotels; DROP TABLE IF EXISTS platform.guest_hotels; DROP TABLE IF EXISTS platform.companies; DROP TABLE IF EXISTS platform.guests;
-- ONE common profile per guest and per company across all hotels (MJ, 18 Oct 2026; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md). platform.users stays the one table of
-- logins; platform.guests and platform.companies are the one profile (name, email, address, ... edited once, the same for the person and for every hotel's staff). Each hotel keeps
-- its own customers / company_profiles row for what is the hotel's alone (the mobile its bills are matched by, ID proof, notes, pricing) and for bills, Pathik and search; RLS and
-- user_hotels.subject_id (the hotel record) are unchanged. The LINK between the one profile and a hotel's record lives here (guest_hotels / company_hotels), because a hotel's
-- transaction cannot read the platform schema. A profile is never deleted: a merge by the Super Admin sets merged_into on the row that goes and moves its links, so it can be undone.
-- Sizes follow the hotel tables (name 100, email 254, ...), so every existing record fits; the GSTIN is kept as the hotel typed it (the app checks the shape on a save).
-- No hotel's data is read or changed by this migration: the rows are made by `db:cli central-profiles` (dry run first).

CREATE TABLE platform.guests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  -- a copy of the mobile, +91 and ten digits when it could be read (else NULL): for the duplicates list and to show it. Bills are matched by each hotel's own copy.
  mobile text CHECK (mobile IS NULL OR mobile ~ '^\+91[6-9][0-9]{9}$'),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  address text CHECK (address IS NULL OR char_length(address) <= 255),
  city text CHECK (city IS NULL OR char_length(city) <= 100),
  -- the guest's own login, when there is one (its photo is the profile photo)
  user_id uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  merged_into uuid REFERENCES platform.guests (id) ON DELETE RESTRICT,
  merged_at timestamptz,
  merged_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guests_not_merged_into_self CHECK (merged_into IS NULL OR merged_into <> id),
  CONSTRAINT guests_merge_pair CHECK ((merged_into IS NULL) = (merged_at IS NULL))
);
CREATE UNIQUE INDEX guests_user_key ON platform.guests (user_id) WHERE user_id IS NOT NULL AND merged_into IS NULL;
CREATE INDEX guests_user_idx ON platform.guests (user_id);
CREATE INDEX guests_mobile_idx ON platform.guests (mobile) WHERE mobile IS NOT NULL AND merged_into IS NULL;
CREATE INDEX guests_email_idx ON platform.guests (email) WHERE email IS NOT NULL AND merged_into IS NULL;
CREATE INDEX guests_merged_into_idx ON platform.guests (merged_into);
CREATE INDEX guests_merged_by_idx ON platform.guests (merged_by);
CREATE TRIGGER guests_touch BEFORE UPDATE ON platform.guests FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE ON platform.guests TO hms_app;

CREATE TABLE platform.companies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  main_contact_name text CHECK (main_contact_name IS NULL OR char_length(main_contact_name) <= 100),
  gstin text CHECK (gstin IS NULL OR (gstin = upper(btrim(gstin)) AND char_length(gstin) BETWEEN 1 AND 50)),
  email text CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254)),
  mobile text CHECK (mobile IS NULL OR char_length(mobile) <= 15),
  landline text CHECK (landline IS NULL OR char_length(landline) <= 15),
  address text CHECK (address IS NULL OR char_length(address) <= 100),
  pincode text CHECK (pincode IS NULL OR char_length(pincode) <= 20),
  country text CHECK (country IS NULL OR char_length(country) <= 100),
  contacts jsonb CHECK (contacts IS NULL OR jsonb_typeof(contacts) = 'array'),
  user_id uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  merged_into uuid REFERENCES platform.companies (id) ON DELETE RESTRICT,
  merged_at timestamptz,
  merged_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_not_merged_into_self CHECK (merged_into IS NULL OR merged_into <> id),
  CONSTRAINT companies_merge_pair CHECK ((merged_into IS NULL) = (merged_at IS NULL))
);
CREATE UNIQUE INDEX companies_user_key ON platform.companies (user_id) WHERE user_id IS NOT NULL AND merged_into IS NULL;
CREATE INDEX companies_user_idx ON platform.companies (user_id);
CREATE INDEX companies_gstin_idx ON platform.companies (gstin) WHERE gstin IS NOT NULL AND merged_into IS NULL;
CREATE INDEX companies_email_idx ON platform.companies (email) WHERE email IS NOT NULL AND merged_into IS NULL;
CREATE INDEX companies_merged_into_idx ON platform.companies (merged_into);
CREATE INDEX companies_merged_by_idx ON platform.companies (merged_by);
CREATE TRIGGER companies_touch BEFORE UPDATE ON platform.companies FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE ON platform.companies TO hms_app;

-- The link: one row per hotel record. customer_id / company_profile_id are plain uuids (the record is in the hotel's own schema, no foreign key across schemas).
-- no-standard-columns: a link keyed by the hotel and its own record; a hotel record has exactly one profile
CREATE TABLE platform.guest_hotels (
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  guest_id uuid NOT NULL REFERENCES platform.guests (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, customer_id)
);
CREATE INDEX guest_hotels_guest_idx ON platform.guest_hotels (guest_id);
CREATE TRIGGER guest_hotels_touch BEFORE UPDATE ON platform.guest_hotels FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.guest_hotels TO hms_app;

-- no-standard-columns: a link keyed by the hotel and its own company profile; a hotel record has exactly one profile
CREATE TABLE platform.company_hotels (
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  company_profile_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES platform.companies (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, company_profile_id)
);
CREATE INDEX company_hotels_company_idx ON platform.company_hotels (company_id);
CREATE TRIGGER company_hotels_touch BEFORE UPDATE ON platform.company_hotels FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.company_hotels TO hms_app;

-- Pairs the Super Admin marked "not the same" in the possible-duplicates list (the list itself is computed when asked, never stored). left_id < right_id, so a pair is stored once.
-- no-standard-columns: a decision keyed by the pair it is about; it is only added or taken back, never changed
CREATE TABLE platform.profile_kept_apart (
  kind text NOT NULL CHECK (kind IN ('guest', 'company')),
  left_id uuid NOT NULL,
  right_id uuid NOT NULL,
  decided_by uuid REFERENCES platform.users (id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, left_id, right_id),
  CONSTRAINT profile_kept_apart_order CHECK (left_id < right_id)
);
CREATE INDEX profile_kept_apart_decided_by_idx ON platform.profile_kept_apart (decided_by);
GRANT SELECT, INSERT, DELETE ON platform.profile_kept_apart TO hms_app;
