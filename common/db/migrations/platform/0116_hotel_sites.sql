-- rollback: DROP TABLE IF EXISTS platform.hotel_site_domains; DROP TABLE IF EXISTS platform.hotel_sites;
-- Hotel websites hosted separately and managed from HMS (decision 55, docs/WEBSITE-CONNECT.md section 2.3 and 5).
-- One row per hotel that has a public website: `live` is the "Website live" switch (default off: the public API answers 404 for a hotel that is not live, the same
-- 404 as for a hotel that does not exist) and the registered domains the website runs on. The public API reads these BEFORE it opens the hotel's own schema,
-- so the slug check, the live check and the CORS decision are one cheap platform read.
-- Domains live in their own table so the database itself keeps them unique across hotels (a domain belongs to one hotel) and well formed (lower-case host
-- names, no scheme, no path). At most 5 per hotel: checked by the service and, as a backstop, by a trigger.
CREATE TABLE platform.hotel_sites (
  hotel_id uuid PRIMARY KEY REFERENCES platform.hotels (id) ON DELETE CASCADE,
  live boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES platform.users (id) ON DELETE SET NULL
);
CREATE INDEX hotel_sites_updated_by_idx ON platform.hotel_sites (updated_by);
CREATE TRIGGER hotel_sites_touch BEFORE UPDATE ON platform.hotel_sites FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.hotel_site_domains (
  domain text PRIMARY KEY CHECK (
    char_length(domain) <= 253
    AND domain = lower(domain)
    AND domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hotel_site_domains_hotel_id_idx ON platform.hotel_site_domains (hotel_id);

CREATE FUNCTION platform.check_hotel_site_domain_count() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (SELECT count(*) FROM platform.hotel_site_domains WHERE hotel_id = NEW.hotel_id) >= 5 THEN
    RAISE EXCEPTION 'A hotel website may have at most 5 domains' USING ERRCODE = '23514', CONSTRAINT = 'hotel_site_domains_at_most_five';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER hotel_site_domains_count BEFORE INSERT ON platform.hotel_site_domains FOR EACH ROW EXECUTE FUNCTION platform.check_hotel_site_domain_count();

GRANT SELECT, INSERT, UPDATE ON platform.hotel_sites TO hms_app;
GRANT SELECT, INSERT, DELETE ON platform.hotel_site_domains TO hms_app;
GRANT EXECUTE ON FUNCTION platform.check_hotel_site_domain_count() TO hms_app;
