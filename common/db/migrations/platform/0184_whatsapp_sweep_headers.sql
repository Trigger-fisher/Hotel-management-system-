-- rollback: DROP FUNCTION IF EXISTS platform.whatsapp_sweep_headers();
-- The one-minute WhatsApp sweep (MJ, 4 Nov 2026): the pg_cron job runs as the Supabase console role (postgres), the only role that may manage cron jobs there, and asks THIS function for the request headers,
-- so the sweep key (platform.whatsapp_sweep_secret, readable by nobody but the database owner) is never written into the job's text or into any log. The function runs with its owner's rights, only
-- the console role may call it (no PUBLIC, no hms_app), and it returns nothing but the one Authorization header.
CREATE FUNCTION platform.whatsapp_sweep_headers() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT jsonb_build_object('Authorization', 'Bearer ' || (SELECT secret FROM platform.whatsapp_sweep_secret ORDER BY created_at DESC LIMIT 1))
$$;
REVOKE ALL ON FUNCTION platform.whatsapp_sweep_headers() FROM PUBLIC;
DO $do$
BEGIN
  -- a hosted database has the console role; a local one may not
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT USAGE ON SCHEMA platform TO postgres;
    GRANT EXECUTE ON FUNCTION platform.whatsapp_sweep_headers() TO postgres;
  END IF;
END
$do$;
