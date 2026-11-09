-- rollback: ALTER TABLE platform.hotels DROP COLUMN IF EXISTS id_photo_exact_copy;
-- How a hotel's guest ID pictures are stored (MJ, 5 Nov 2026), set by the Super Admin on the hotel's Integrations tab: false (the default) = a sharp JPEG tried at
-- 150 KB first and never above 500 KB, checked so the key fields still read the same; true = keep an exact copy (WebP lossless, every pixel kept; a copy above
-- 500 KB is flagged, never made smaller). HMS copies it into intake_jobs.lossless when it queues an ID picture (other-features/intake-worker/sql/proposal.sql).
ALTER TABLE platform.hotels ADD COLUMN IF NOT EXISTS id_photo_exact_copy boolean NOT NULL DEFAULT false;
