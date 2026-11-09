-- rollback: ALTER TABLE bill_master_advances DROP CONSTRAINT IF EXISTS bill_master_advances_reservation_id_fkey; DROP TABLE IF EXISTS pms_charges; DROP TABLE IF EXISTS pms_stays; DROP TABLE IF EXISTS pms_reservations; DROP TABLE IF EXISTS pms_rooms;
-- Front office: rooms, reservations, stays and charges. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

-- hard-delete: Pallav app/Http/Controllers/Pms/RoomController.php:90
CREATE TABLE pms_rooms (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  number varchar(20) NOT NULL,
  floor varchar(20),
  room_type_id uuid REFERENCES site_rooms (id) ON DELETE SET NULL,
  hk_status text NOT NULL DEFAULT 'clean' CHECK (hk_status IN ('clean', 'dirty')),
  out_of_order boolean NOT NULL DEFAULT false,
  out_of_order_reason varchar(255),
  notes varchar(255),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pms_rooms_number_key ON pms_rooms (number);
CREATE INDEX pms_rooms_room_type_id_idx ON pms_rooms (room_type_id);
CREATE UNIQUE INDEX pms_rooms_legacy_id_key ON pms_rooms (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX pms_rooms_sort_order_number_idx ON pms_rooms (sort_order, number);
CREATE TRIGGER pms_rooms_touch_updated_at BEFORE UPDATE ON pms_rooms FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE pms_reservations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  reference varchar(30),
  guest_name varchar(150) NOT NULL,
  mobile varchar(20),
  email varchar(150),
  company_id uuid REFERENCES company_profiles (id) ON DELETE SET NULL,
  room_type_id uuid REFERENCES site_rooms (id) ON DELETE SET NULL,
  rooms smallint NOT NULL DEFAULT 1 CHECK (rooms BETWEEN 1 AND 50),
  plan varchar(60),
  rate_paise bigint NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  adults smallint NOT NULL DEFAULT 1 CHECK (adults BETWEEN 1 AND 99),
  children smallint NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 99),
  check_in date NOT NULL,
  check_out date NOT NULL,
  source text NOT NULL DEFAULT 'phone' CHECK (source IN ('walk_in', 'phone', 'website', 'company', 'agent', 'other')),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  site_enquiry_id uuid REFERENCES site_enquiries (id) ON DELETE SET NULL,
  notes text,
  cancel_reason varchar(255),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Pallav: Pms/ReservationController.php:189 'check_out' => required|date|after:check_in
  CONSTRAINT pms_reservations_dates_ck CHECK (check_out > check_in)
);
CREATE UNIQUE INDEX pms_reservations_reference_key ON pms_reservations (reference);
CREATE INDEX pms_reservations_company_id_idx ON pms_reservations (company_id);
CREATE UNIQUE INDEX pms_reservations_site_enquiry_id_key ON pms_reservations (site_enquiry_id);
CREATE UNIQUE INDEX pms_reservations_legacy_id_key ON pms_reservations (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX pms_reservations_status_check_in_idx ON pms_reservations (status, check_in);
CREATE INDEX pms_reservations_room_type_id_status_check_in_idx ON pms_reservations (room_type_id, status, check_in);
CREATE INDEX pms_reservations_status_check_out_idx ON pms_reservations (status, check_out);
CREATE TRIGGER pms_reservations_touch_updated_at BEFORE UPDATE ON pms_reservations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER pms_reservations_version_step BEFORE UPDATE ON pms_reservations FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

CREATE TABLE pms_stays (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  reservation_id uuid REFERENCES pms_reservations (id) ON DELETE SET NULL,
  room_id uuid NOT NULL REFERENCES pms_rooms (id) ON DELETE RESTRICT,
  gr_number varchar(50),
  guest_name varchar(150) NOT NULL,
  mobile varchar(20),
  email varchar(150),
  address varchar(255),
  city varchar(100),
  nationality varchar(60) DEFAULT 'Indian',
  id_proof_type varchar(60),
  id_proof_number varchar(60),
  id_proof_path varchar(255),
  company_id uuid REFERENCES company_profiles (id) ON DELETE SET NULL,
  guest_gstin varchar(20),
  adults smallint NOT NULL DEFAULT 1 CHECK (adults BETWEEN 1 AND 20),
  children smallint NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 20),
  plan varchar(60),
  rate_paise bigint NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  check_in_at timestamptz NOT NULL,
  expected_check_out date NOT NULL,
  check_out_at timestamptz,
  status text NOT NULL DEFAULT 'in_house' CHECK (status IN ('in_house', 'checked_out')),
  bill_id uuid REFERENCES bill_master_bills (id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  updated_by uuid,
  hotel_gst_percent numeric(5, 2) CHECK (hotel_gst_percent BETWEEN 0 AND 28),
  food_gst_percent numeric(5, 2) CHECK (food_gst_percent BETWEEN 0 AND 28),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Pallav: Pms/StayController.php:90,204 'expected_check_out' => after:today / after the check-in day (IST)
  CONSTRAINT pms_stays_expected_out_ck CHECK (expected_check_out > (check_in_at AT TIME ZONE 'Asia/Kolkata')::date),
  -- domain rule: Pms/StayController.php:243 sets check_out_at at check-out, which is never before check-in
  CONSTRAINT pms_stays_actual_out_ck CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)
);
CREATE INDEX pms_stays_reservation_id_idx ON pms_stays (reservation_id);
CREATE INDEX pms_stays_room_id_idx ON pms_stays (room_id);
CREATE INDEX pms_stays_company_id_idx ON pms_stays (company_id);
CREATE INDEX pms_stays_bill_id_idx ON pms_stays (bill_id);
CREATE UNIQUE INDEX pms_stays_legacy_id_key ON pms_stays (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX pms_stays_status_expected_check_out_idx ON pms_stays (status, expected_check_out);
CREATE INDEX pms_stays_status_check_out_at_idx ON pms_stays (status, check_out_at);
-- Pallav: Pms/StayController.php:94-98,107 refuses a check-in while the room has an in-house stay (checked in code, racy); this index makes it a database rule
CREATE UNIQUE INDEX pms_stays_one_in_house_per_room_key ON pms_stays (room_id) WHERE status = 'in_house';
CREATE TRIGGER pms_stays_touch_updated_at BEFORE UPDATE ON pms_stays FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER pms_stays_version_step BEFORE UPDATE ON pms_stays FOR EACH ROW EXECUTE FUNCTION enforce_version_step();

-- hard-delete: Pallav app/Http/Controllers/Pms/StayController.php:176
CREATE TABLE pms_charges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  stay_id uuid NOT NULL REFERENCES pms_stays (id) ON DELETE CASCADE,
  charge_date date NOT NULL,
  category text NOT NULL CHECK (category IN ('food', 'room_service', 'laundry', 'extra_bed', 'other')),
  side text NOT NULL DEFAULT 'hotel' CHECK (side IN ('hotel', 'food')),
  description varchar(255) NOT NULL,
  quantity numeric(8, 2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price_paise bigint NOT NULL DEFAULT 0 CHECK (unit_price_paise >= 0),
  amount_paise bigint NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  source_type varchar(40),
  source_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pms_charges_stay_id_idx ON pms_charges (stay_id);
CREATE UNIQUE INDEX pms_charges_legacy_id_key ON pms_charges (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX pms_charges_source_type_source_id_idx ON pms_charges (source_type, source_id);
CREATE TRIGGER pms_charges_touch_updated_at BEFORE UPDATE ON pms_charges FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- foreign keys from earlier tables that point at tables created in this file
ALTER TABLE bill_master_advances ADD CONSTRAINT bill_master_advances_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES pms_reservations (id) ON DELETE SET NULL;
