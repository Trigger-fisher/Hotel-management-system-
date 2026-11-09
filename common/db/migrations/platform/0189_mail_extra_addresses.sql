-- rollback: DROP TABLE IF EXISTS platform.mail_extra_addresses;
-- Extra email addresses of a staff login (MJ, 5 Nov 2026, rule 4): every staff login keeps its automatic <username>@<sending domain>; the Super Admin may give any staff login one or more
-- EXTRA addresses on the same domain, made from a pattern and checked to be free (services/platform/mailAddressService.ts), and may remove them. Mail to an extra address is delivered into
-- the owner's own mailbox; each address appears in that person's Email switch. A local part is unique on its domain, and never equals a username (the service checks; the automatic
-- addresses are not stored here).
CREATE TABLE IF NOT EXISTS platform.mail_extra_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  local_part text NOT NULL CHECK (local_part ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  domain text NOT NULL CHECK (domain <> '' AND domain = lower(domain)),
  created_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_extra_addresses_unique UNIQUE (local_part, domain)
);
CREATE INDEX IF NOT EXISTS mail_extra_addresses_login ON platform.mail_extra_addresses (login_id);
CREATE INDEX IF NOT EXISTS mail_extra_addresses_created_by ON platform.mail_extra_addresses (created_by);
DROP TRIGGER IF EXISTS mail_extra_addresses_touch_updated_at ON platform.mail_extra_addresses;
CREATE TRIGGER mail_extra_addresses_touch_updated_at BEFORE UPDATE ON platform.mail_extra_addresses FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, DELETE ON platform.mail_extra_addresses TO hms_app;
