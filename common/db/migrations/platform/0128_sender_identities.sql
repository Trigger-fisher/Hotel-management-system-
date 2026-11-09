-- rollback: DROP TABLE IF EXISTS platform.sender_identities;
-- Sender identities (MAIL-PROVIDERS-50K plan, 18 Oct 2026): the domain a mail comes from, with what the platform's mail service (Amazon SES) needs to trust it. One row for the PLATFORM's own sending domain
-- (hotel_id NULL; the domain is the platform setting mail.sending_domain) and one per hotel that uses its OWN domain on the platform's mail (hotel_id set; from_address = the address on that domain).
-- The three DKIM names are the ones Amazon SES shows when the domain is added there ("<token>._domainkey.<domain>" CNAME to "<token>.dkim.amazonses.com"); they are public DNS names, not secrets.
-- The DNS check resolves the records and keeps the answer in `result`; a domain is 'verified' when every required record is found AND the Super Admin has confirmed the identity exists in SES.
CREATE TABLE IF NOT EXISTS platform.sender_identities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (char_length(domain) <= 253 AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  from_address text CHECK (from_address IS NULL OR (char_length(from_address) <= 254 AND from_address ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  dkim_tokens text[] NOT NULL DEFAULT '{}' CHECK (cardinality(dkim_tokens) IN (0, 3)),
  ses_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified')),
  checked_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sender_identities_hotel_key ON platform.sender_identities (hotel_id);
CREATE UNIQUE INDEX IF NOT EXISTS sender_identities_platform_key ON platform.sender_identities ((true)) WHERE hotel_id IS NULL;
CREATE TRIGGER sender_identities_touch BEFORE UPDATE ON platform.sender_identities FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.sender_identities TO hms_app;