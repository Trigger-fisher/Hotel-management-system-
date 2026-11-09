-- rollback: ALTER TABLE site_settings DROP COLUMN IF EXISTS google_review_count; ALTER TABLE site_settings DROP COLUMN IF EXISTS google_last_fetched_at;
-- The website's Google reviews integration records when it last fetched the reviews and how many it holds (shown on the settings screen).
ALTER TABLE site_settings
  ADD COLUMN google_last_fetched_at timestamptz,
  ADD COLUMN google_review_count integer NOT NULL DEFAULT 0 CHECK (google_review_count >= 0);
