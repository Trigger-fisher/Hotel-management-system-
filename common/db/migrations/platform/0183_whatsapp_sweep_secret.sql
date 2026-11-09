-- rollback: DROP TABLE IF EXISTS platform.whatsapp_sweep_secret;
-- The key of the one-minute WhatsApp sweep (MJ, 4 Nov 2026). The database scheduler (pg_cron) calls https://<site>/api/v1/cron/whatsapp every minute with "Authorization: Bearer <this key>"; the
-- same key is the Vercel setting WHATSAPP_SWEEP_KEY and opens THAT route only. Supabase's secret Vault is not open to the owner login, so the key lives here instead, in a table the web app can
-- never read (no grant for hms_app): only the database owner, which the scheduler job runs as, reads it. The key is NOT in this file: it is put in once by hand after the migration.
-- no-app-access: only the database owner (the pg_cron job and the person who sets the key) reads and writes this table; hms_app has no right on it
CREATE TABLE platform.whatsapp_sweep_secret (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  secret text NOT NULL CHECK (char_length(secret) >= 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform.whatsapp_sweep_secret FROM PUBLIC;
CREATE TRIGGER whatsapp_sweep_secret_touch_updated_at BEFORE UPDATE ON platform.whatsapp_sweep_secret FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
