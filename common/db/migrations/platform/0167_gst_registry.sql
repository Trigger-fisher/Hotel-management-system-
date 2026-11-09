-- rollback: DROP TABLE IF EXISTS platform.gst_lookups, platform.gst_registry;
-- GST records (MJ, 2 Nov 2026: "save the GST and the company details in our system when a user searches for it the first time, then reuse it"). A GSTIN is looked up from a GST lookup
-- service ONCE; the answer is kept here and every hotel reuses it, free, until it is due for a re-check.
--   gst_registry  one row per GSTIN: the company as the GST record shows it (legal and trade name, status, type, dates, the principal address in parts), the state code and PAN read
--                 from the number itself, where it came from (the service's id, or "manual"), the service's whole answer as it came (raw), when it was fetched and when it is due again,
--                 and how often it was used. Public GST data; one row is shared by all hotels (a hotel's own company profile keeps its own copy of the fields it shows).
--   gst_lookups   one row per call to the lookup service: which GSTIN, which service, what came of it, how long it took, who asked from which hotel. The usage and the cost are counted
--                 from here; never the service's key, never its words.
CREATE TABLE platform.gst_registry (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  gstin text NOT NULL CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  -- read from the number itself: the state (first two digits) and the PAN (the next ten)
  state_code text NOT NULL GENERATED ALWAYS AS (substr(gstin, 1, 2)) STORED,
  pan text NOT NULL GENERATED ALWAYS AS (substr(gstin, 3, 10)) STORED,
  legal_name text CHECK (legal_name IS NULL OR char_length(btrim(legal_name)) BETWEEN 1 AND 200),
  trade_name text CHECK (trade_name IS NULL OR char_length(btrim(trade_name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('active', 'cancelled', 'suspended', 'inactive', 'unknown')),
  taxpayer_type text CHECK (taxpayer_type IS NULL OR char_length(taxpayer_type) <= 60),
  constitution text CHECK (constitution IS NULL OR char_length(constitution) <= 100),
  registered_on date,
  cancelled_on date,
  -- the principal place of business: the whole line, and its parts when the service gives them
  address text CHECK (address IS NULL OR char_length(address) <= 500),
  city text CHECK (city IS NULL OR char_length(city) <= 100),
  district text CHECK (district IS NULL OR char_length(district) <= 100),
  state text CHECK (state IS NULL OR char_length(state) <= 60),
  pincode text CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),
  nature_of_business text[] NOT NULL DEFAULT '{}' CHECK (cardinality(nature_of_business) <= 20),
  source text NOT NULL CHECK (source ~ '^[a-z0-9_-]{1,40}$'),
  raw jsonb CHECK (raw IS NULL OR jsonb_typeof(raw) = 'object'),
  fetched_at timestamptz NOT NULL,
  refresh_after timestamptz NOT NULL,
  times_used integer NOT NULL DEFAULT 0 CHECK (times_used >= 0),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gst_registry_refresh_after_fetch CHECK (refresh_after >= fetched_at),
  CONSTRAINT gst_registry_cancelled_date CHECK (cancelled_on IS NULL OR registered_on IS NULL OR cancelled_on >= registered_on)
);
CREATE UNIQUE INDEX gst_registry_gstin_key ON platform.gst_registry (gstin);
-- the other registrations of the same business (one PAN, several states)
CREATE INDEX gst_registry_pan_idx ON platform.gst_registry (pan);
-- the records due for a re-check
CREATE INDEX gst_registry_refresh_after_idx ON platform.gst_registry (refresh_after);
-- search by name: the start of the legal or trade name, any case
CREATE INDEX gst_registry_legal_name_idx ON platform.gst_registry (lower(legal_name) text_pattern_ops);
CREATE INDEX gst_registry_trade_name_idx ON platform.gst_registry (lower(trade_name) text_pattern_ops);
CREATE TRIGGER gst_registry_touch_updated_at BEFORE UPDATE ON platform.gst_registry FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.gst_lookups (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  gstin text NOT NULL CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9_-]{1,40}$'),
  outcome text NOT NULL CHECK (outcome IN ('found', 'not_found', 'failed')),
  error_code varchar(40) CHECK (error_code IS NULL OR error_code ~ '^[A-Z_]{1,40}$'),
  took_ms integer CHECK (took_ms IS NULL OR took_ms >= 0),
  requested_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gst_lookups_error_only_on_failure CHECK ((outcome = 'failed') = (error_code IS NOT NULL))
);
CREATE INDEX gst_lookups_gstin_idx ON platform.gst_lookups (gstin);
CREATE INDEX gst_lookups_created_at_idx ON platform.gst_lookups (created_at DESC);
CREATE INDEX gst_lookups_requested_by_idx ON platform.gst_lookups (requested_by);
CREATE INDEX gst_lookups_hotel_id_idx ON platform.gst_lookups (hotel_id);
CREATE TRIGGER gst_lookups_touch_updated_at BEFORE UPDATE ON platform.gst_lookups FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON platform.gst_registry TO hms_app;
GRANT SELECT, INSERT ON platform.gst_lookups TO hms_app;
