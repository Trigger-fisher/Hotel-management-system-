-- rollback: DROP TABLE IF EXISTS site_nearby_places; DROP TABLE IF EXISTS site_policy_cards; DROP TABLE IF EXISTS site_services; DROP TABLE IF EXISTS site_gallery_photos; DROP TABLE IF EXISTS site_enquiries; DROP TABLE IF EXISTS site_reference_counters; DROP TABLE IF EXISTS site_room_date_inventory; DROP TABLE IF EXISTS site_plan_date_rates; DROP TABLE IF EXISTS site_rate_plans; DROP TABLE IF EXISTS site_rooms; DROP TABLE IF EXISTS site_page_content; DROP TABLE IF EXISTS site_settings;
-- Public website: content, rooms, rates, calendar, enquiries. Written from Pallav's final table shapes (columns.md); deviations are listed in docs/DATABASE.md.

-- One row per hotel (the hotel's public website settings). Hotel Pallav's own phone numbers, email and opening year are not baked in as defaults: they come from the import or the hotel's setup.
CREATE TABLE site_settings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  opened_year integer CHECK (opened_year BETWEEN 0 AND 65535),
  gm_phone varchar(20),
  reception_phone varchar(20),
  whatsapp varchar(20),
  reception_whatsapp varchar(20),
  email varchar(150),
  address varchar(255) NOT NULL DEFAULT '',
  checkin_time varchar(20) NOT NULL DEFAULT '12:00 PM',
  checkout_time varchar(20) NOT NULL DEFAULT '11:00 AM',
  meta_title varchar(255),
  meta_description text,
  meta_keywords varchar(255),
  logo_path varchar(255),
  favicon_path varchar(255),
  gbp_link varchar(255),
  facebook_link varchar(255),
  instagram_link varchar(255),
  map_lat numeric(10, 7) CHECK (map_lat BETWEEN -90 AND 90),
  map_lng numeric(10, 7) CHECK (map_lng BETWEEN -180 AND 180),
  google_maps_api_key text,
  google_place_id varchar(150),
  google_min_review_rating smallint NOT NULL DEFAULT 3 CHECK (google_min_review_rating BETWEEN 1 AND 5),
  gbp_oauth_client_id text,
  gbp_oauth_client_secret text,
  gbp_oauth_refresh_token text,
  gbp_oauth_access_token text,
  gbp_oauth_token_expires timestamptz,
  gbp_account_id varchar(150),
  gbp_location_id varchar(150),
  smtp_host varchar(150),
  smtp_port integer CHECK (smtp_port BETWEEN 0 AND 65535),
  smtp_username text,
  smtp_password text,
  smtp_from_email varchar(150),
  smtp_from_name varchar(100),
  notify_recipients jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_settings_legacy_id_key ON site_settings (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX site_settings_singleton_key ON site_settings ((true));
CREATE TRIGGER site_settings_touch_updated_at BEFORE UPDATE ON site_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- One row per hotel (the public website's wording).
CREATE TABLE site_page_content (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  hero_eyebrow varchar(100) NOT NULL DEFAULT 'Of Warm Hospitality',
  hero_title_line1 varchar(100) NOT NULL DEFAULT 'Where every stay',
  hero_title_emphasis varchar(100) NOT NULL DEFAULT 'feels like coming home',
  hero_lead text,
  quick_check_title varchar(100) NOT NULL DEFAULT 'Check availability',
  qc_msg_pick_dates varchar(200) NOT NULL DEFAULT 'Please pick both check-in and check-out dates first.',
  qc_msg_available varchar(200) NOT NULL DEFAULT 'Good news - we have rooms for your dates!',
  qc_msg_unavailable varchar(300) NOT NULL DEFAULT 'Those exact rooms look full, but call us - dates shift often and we may still fit you in.',
  qc_msg_error varchar(200) NOT NULL DEFAULT 'Could not check right now - please call us instead.',
  fm_msg_name varchar(150) NOT NULL DEFAULT 'Please enter your name.',
  fm_msg_phone varchar(150) NOT NULL DEFAULT 'Please enter a valid 10-digit mobile number.',
  fm_msg_email varchar(150) NOT NULL DEFAULT 'That email address does not look right. Leave it blank if you prefer.',
  fm_msg_checkin varchar(150) NOT NULL DEFAULT 'Please pick a check-in date.',
  fm_msg_checkout varchar(150) NOT NULL DEFAULT 'Please pick a check-out date.',
  fm_msg_room varchar(150) NOT NULL DEFAULT 'Please pick a room, or enter "not sure yet".',
  fm_msg_adults varchar(150) NOT NULL DEFAULT 'Please enter the number of adults.',
  fm_msg_children varchar(150) NOT NULL DEFAULT 'Please enter the number of children (0 if none).',
  fm_msg_message varchar(150) NOT NULL DEFAULT 'Please tell us anything we should know (or write "none").',
  fm_msg_terms varchar(150) NOT NULL DEFAULT 'Please accept the Terms & Conditions to continue.',
  fm_msg_success varchar(250) NOT NULL DEFAULT 'Thank you! Your enquiry reference is {{reference}}. We will call you shortly to confirm.',
  about_kicker varchar(50) NOT NULL DEFAULT 'Our Story',
  about_heading varchar(150) NOT NULL DEFAULT 'A family hotel that never stopped caring',
  about_p1 text,
  about_p2 text,
  about_p3 text,
  enquire_heading varchar(150) NOT NULL DEFAULT 'Send us your dates. We will do the rest.',
  enquire_lead text,
  enquire_points jsonb,
  booking_terms_text text,
  policies_footer_note text,
  footer_tagline text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_page_content_legacy_id_key ON site_page_content (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX site_page_content_singleton_key ON site_page_content ((true));
CREATE TRIGGER site_page_content_touch_updated_at BEFORE UPDATE ON site_page_content FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Website/RoomController.php:76
CREATE TABLE site_rooms (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  slug varchar(100) NOT NULL,
  name varchar(100) NOT NULL,
  size varchar(50),
  bed_type varchar(50),
  max_guests smallint NOT NULL DEFAULT 2 CHECK (max_guests BETWEEN 0 AND 255),
  show_price boolean NOT NULL DEFAULT false,
  total_count smallint NOT NULL DEFAULT 1 CHECK (total_count BETWEEN 0 AND 255),
  available boolean NOT NULL DEFAULT true,
  note varchar(255),
  badge_label varchar(40),
  photos jsonb,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_rooms_slug_key ON site_rooms (slug);
CREATE UNIQUE INDEX site_rooms_legacy_id_key ON site_rooms (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX site_rooms_sort_order_id_idx ON site_rooms (sort_order, id);
CREATE TRIGGER site_rooms_touch_updated_at BEFORE UPDATE ON site_rooms FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Website/RateController.php:62
-- Prices were whole rupees in Pallav; here they are paise (the import multiplies by 100). occupancy_prices holds paise too.
CREATE TABLE site_rate_plans (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  room_id uuid NOT NULL REFERENCES site_rooms (id) ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  code varchar(10) NOT NULL DEFAULT 'EP',
  price_double_paise bigint NOT NULL DEFAULT 0 CHECK (price_double_paise >= 0),
  price_single_paise bigint CHECK (price_single_paise >= 0),
  occupancy_prices jsonb,
  extra_person_price_paise bigint CHECK (extra_person_price_paise >= 0),
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 255),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_rate_plans_room_id_idx ON site_rate_plans (room_id);
CREATE UNIQUE INDEX site_rate_plans_legacy_id_key ON site_rate_plans (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER site_rate_plans_touch_updated_at BEFORE UPDATE ON site_rate_plans FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE site_plan_date_rates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  rate_plan_id uuid NOT NULL REFERENCES site_rate_plans (id) ON DELETE CASCADE,
  date date NOT NULL,
  price_double_paise bigint NOT NULL CHECK (price_double_paise >= 0),
  price_single_paise bigint CHECK (price_single_paise >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_plan_date_rates_legacy_id_key ON site_plan_date_rates (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX site_plan_date_rates_rate_plan_id_date_key ON site_plan_date_rates (rate_plan_id, date);
CREATE TRIGGER site_plan_date_rates_touch_updated_at BEFORE UPDATE ON site_plan_date_rates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE site_room_date_inventory (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  room_id uuid NOT NULL REFERENCES site_rooms (id) ON DELETE CASCADE,
  date date NOT NULL,
  rooms_left smallint NOT NULL CHECK (rooms_left BETWEEN 0 AND 255),
  blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_room_date_inventory_legacy_id_key ON site_room_date_inventory (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX site_room_date_inventory_room_id_date_key ON site_room_date_inventory (room_id, date);
CREATE TRIGGER site_room_date_inventory_touch_updated_at BEFORE UPDATE ON site_room_date_inventory FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- no-standard-columns: one row per fiscal year (1 Apr - 31 Mar IST), keyed by the year; numbers come from INSERT ... ON CONFLICT (fiscal_year) DO UPDATE ... RETURNING
CREATE TABLE site_reference_counters (
  fiscal_year smallint PRIMARY KEY CHECK (fiscal_year BETWEEN 2000 AND 2200),
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0)
);

-- hard-delete: Pallav app/Http/Controllers/Website/EnquiryController.php:189
CREATE TABLE site_enquiries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  reference varchar(20) NOT NULL,
  name varchar(100) NOT NULL,
  phone varchar(20),
  email varchar(150),
  message text,
  room_id uuid REFERENCES site_rooms (id) ON DELETE SET NULL,
  check_in date,
  check_out date,
  guests smallint CHECK (guests BETWEEN 0 AND 255),
  children smallint CHECK (children BETWEEN 0 AND 255),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'pending', 'confirmed', 'declined')),
  decision_note varchar(255),
  decided_by uuid,
  decided_by_name varchar(150),
  decided_at timestamptz,
  ip_address varchar(45),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Pallav: Website/EnquiryController.php:80 'check_out' => after_or_equal:check_in
  CONSTRAINT site_enquiries_dates_ck CHECK (check_in IS NULL OR check_out IS NULL OR check_out >= check_in)
);
CREATE UNIQUE INDEX site_enquiries_reference_key ON site_enquiries (reference);
CREATE INDEX site_enquiries_decided_by_idx ON site_enquiries (decided_by);
CREATE UNIQUE INDEX site_enquiries_legacy_id_key ON site_enquiries (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX site_enquiries_status_created_at_idx ON site_enquiries (status, created_at);
CREATE INDEX site_enquiries_room_id_status_check_in_idx ON site_enquiries (room_id, status, check_in);
CREATE TRIGGER site_enquiries_touch_updated_at BEFORE UPDATE ON site_enquiries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Website/GalleryController.php:65
CREATE TABLE site_gallery_photos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  path varchar(255) NOT NULL,
  caption varchar(150),
  alt_text varchar(255),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_gallery_photos_legacy_id_key ON site_gallery_photos (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER site_gallery_photos_touch_updated_at BEFORE UPDATE ON site_gallery_photos FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Website/ServiceController.php:49
CREATE TABLE site_services (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  title varchar(80) NOT NULL,
  description varchar(255),
  icon varchar(30) NOT NULL DEFAULT 'front-desk',
  icon_path varchar(255),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_services_legacy_id_key ON site_services (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER site_services_touch_updated_at BEFORE UPDATE ON site_services FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Website/PolicyController.php:49
CREATE TABLE site_policy_cards (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  title varchar(60) NOT NULL,
  policy_lines jsonb,
  icon_path varchar(255),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_policy_cards_legacy_id_key ON site_policy_cards (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER site_policy_cards_touch_updated_at BEFORE UPDATE ON site_policy_cards FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- hard-delete: Pallav app/Http/Controllers/Website/NearbyPlaceController.php:60
CREATE TABLE site_nearby_places (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  legacy_id bigint,
  title varchar(80) NOT NULL,
  distance_label varchar(40) NOT NULL,
  map_query varchar(255),
  map_url varchar(500),
  origin_lat numeric(10, 7) CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng numeric(10, 7) CHECK (origin_lng BETWEEN -180 AND 180),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 65535),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_nearby_places_legacy_id_key ON site_nearby_places (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER site_nearby_places_touch_updated_at BEFORE UPDATE ON site_nearby_places FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
