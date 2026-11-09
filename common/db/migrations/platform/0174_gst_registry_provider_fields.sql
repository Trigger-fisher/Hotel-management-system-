-- rollback: ALTER TABLE platform.gst_registry DROP CONSTRAINT IF EXISTS gst_registry_source_is_a_service; ALTER TABLE platform.gst_registry DROP COLUMN IF EXISTS block_status, DROP COLUMN IF EXISTS state_jurisdiction, DROP COLUMN IF EXISTS street, DROP COLUMN IF EXISTS locality, DROP COLUMN IF EXISTS building_name, DROP COLUMN IF EXISTS building_number, DROP COLUMN IF EXISTS floor, DROP COLUMN IF EXISTS landmark;
-- GST records keep every field the lookup service gives, and nothing it does not (MJ, 3 Nov 2026: "the provider shares more GST fields: add all of them, and in the central save only what is
-- coming"). The service's answer for a GSTIN (gstinapi.in, read from the three saved records on 3 Nov 2026) holds 16 fields: gstin, legal_name, trade_name, status, taxpayer_type,
-- business_constitution, registration_date, cancellation_date, state_code, address, city, pincode, nature_of_business, block_status, state_jurisdiction and address_details (city,
-- state, district, pincode, locality, street, building_name, building_number, floor, landmark). Ten of them already had a column. This adds the rest, each with the same style of
-- rule as the columns before it (a length, or none for a plain word the service may change):
--   block_status        whether the registration is blocked from filing ("Unblocked", "Blocked"); the service's own word
--   state_jurisdiction  the state tax office the taxpayer is under
--   street, locality, building_name, building_number, floor, landmark   the principal place of business in parts (address_details)
-- The central table is written ONLY by the lookup service, and never with a hotel's own edit: a source of "manual" was never written by anything, so it is now refused. Only two values
-- are read from the number itself (state_code and pan, generated columns); times_used, last_used_at, fetched_at and refresh_after are the platform's own record of using the answer.
-- The three records already saved get the new columns from their own saved answer (raw), so no lookup is paid for again; a record whose answer lacks a field keeps NULL.
ALTER TABLE platform.gst_registry
  ADD COLUMN block_status text CHECK (block_status IS NULL OR char_length(block_status) <= 60),
  ADD COLUMN state_jurisdiction text CHECK (state_jurisdiction IS NULL OR char_length(state_jurisdiction) <= 200),
  ADD COLUMN street text CHECK (street IS NULL OR char_length(street) <= 200),
  ADD COLUMN locality text CHECK (locality IS NULL OR char_length(locality) <= 200),
  ADD COLUMN building_name text CHECK (building_name IS NULL OR char_length(building_name) <= 200),
  ADD COLUMN building_number text CHECK (building_number IS NULL OR char_length(building_number) <= 200),
  ADD COLUMN floor text CHECK (floor IS NULL OR char_length(floor) <= 60),
  ADD COLUMN landmark text CHECK (landmark IS NULL OR char_length(landmark) <= 200);

ALTER TABLE platform.gst_registry ADD CONSTRAINT gst_registry_source_is_a_service CHECK (source <> 'manual');

UPDATE platform.gst_registry
   SET block_status = left(nullif(btrim(raw ->> 'block_status'), ''), 60),
       state_jurisdiction = left(nullif(btrim(raw ->> 'state_jurisdiction'), ''), 200),
       street = left(nullif(btrim(raw -> 'address_details' ->> 'street'), ''), 200),
       locality = left(nullif(btrim(raw -> 'address_details' ->> 'locality'), ''), 200),
       building_name = left(nullif(btrim(raw -> 'address_details' ->> 'building_name'), ''), 200),
       building_number = left(nullif(btrim(raw -> 'address_details' ->> 'building_number'), ''), 200),
       floor = left(nullif(btrim(raw -> 'address_details' ->> 'floor'), ''), 60),
       landmark = left(nullif(btrim(raw -> 'address_details' ->> 'landmark'), ''), 200)
 WHERE raw IS NOT NULL AND jsonb_typeof(raw) = 'object';
