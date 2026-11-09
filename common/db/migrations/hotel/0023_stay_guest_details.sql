-- rollback: ALTER TABLE pms_stays DROP COLUMN IF EXISTS guest_details;
-- The main guest's further details, asked at check-in for the Gujarat Police register (Pathik; MJ: one entry per room, the main guest): date of birth,
-- house/flat, locality, district, zip code, state, country, phone, coming from, going to, vehicle type and registration. All optional (HMS never refuses
-- a check-in for Pathik: an empty one shows as "missing for Pathik"). One object of strings, only the keys that were given.
ALTER TABLE pms_stays ADD COLUMN IF NOT EXISTS guest_details jsonb CHECK (guest_details IS NULL OR jsonb_typeof(guest_details) = 'object');