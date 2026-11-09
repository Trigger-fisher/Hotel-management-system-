-- rollback: DROP TABLE IF EXISTS mail_optouts; DROP TABLE IF EXISTS mail_campaign_recipients; DROP TABLE IF EXISTS mail_campaigns;
-- Email marketing (replaces the CRM in the menu): a hotel writes a campaign (subject, a plain-text message, an audience) and sends it through its OWN mail
-- server (Settings > Email) to its customers, its companies' contacts and its past guests, one outbox row per address. A campaign is a draft until it is
-- sent; the recipients it went to are kept with it (who got what, when). Every mail carries an unsubscribe link; an address that used it is kept in
-- mail_optouts and never written to again by this hotel. The crm_* tables of 0002 stay as they are (no data is dropped); nothing reads them any more.
-- hard-delete: purge job campaign-draft-delete (HMS Email Marketing: a DRAFT is deleted outright by whoever may edit, services/companies/marketingService.ts remove; a sent campaign is never deleted)
-- no-standard-columns: an HMS-only record with no Pallav source (no legacy import, no soft delete)
CREATE TABLE mail_campaigns (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  subject varchar(150) NOT NULL,
  body text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('customers', 'companies', 'guests', 'all')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  recipients integer NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  sent_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_campaigns_sent_pair CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX mail_campaigns_created_at_id_idx ON mail_campaigns (created_at, id);
CREATE TRIGGER mail_campaigns_touch_updated_at BEFORE UPDATE ON mail_campaigns FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- no-standard-columns: who a sent campaign went to, written once with the campaign; no edits, no soft delete, no import
CREATE TABLE mail_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  campaign_id uuid NOT NULL REFERENCES mail_campaigns (id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  name varchar(150),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_campaign_recipients_campaign_idx ON mail_campaign_recipients (campaign_id, created_at);
CREATE TRIGGER mail_campaign_recipients_touch_updated_at BEFORE UPDATE ON mail_campaign_recipients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- no-standard-columns: an address that unsubscribed, written once from the mail's link; no edits, no soft delete, no import
CREATE TABLE mail_optouts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email varchar(254) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mail_optouts_email_key ON mail_optouts (lower(email));
CREATE TRIGGER mail_optouts_touch_updated_at BEFORE UPDATE ON mail_optouts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
