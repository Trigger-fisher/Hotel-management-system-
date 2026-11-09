-- rollback: DROP TABLE IF EXISTS guest_id_scans;
-- Guest portal "Add member" (decision 52, MJ, 12 Oct 2026): the guest uploads a person's ID image first; the server reads it (the ID scan provider: manual
-- entry today, an OCR engine later) and the guest confirms the details. This table holds the UPLOADED IMAGE between the scan and the confirmation, and the
-- link to the member afterwards. No text read from the ID is kept here (the details go to the stay's members only on confirmation, like the main guest's).
--   * file_name: the stored name in the PRIVATE ID-photo store (never served by a public route); the member's ID photo once confirmed;
--   * a scan not confirmed within expires_at (2 hours) is deleted with its file by the next scan of any guest of the hotel (and every read of the table);
--   * a confirmed scan (used_at set) stays as the member's ID photo until the stay's data is removed with the hotel.
-- hard-delete: purge job guest-id-scan-expiry (an unconfirmed scan and its file are deleted when it expires, on the next scan or confirmation; decision 52)
-- no-standard-columns: a short-lived upload record (and then the member's photo link): no history, no import, no soft delete, no edits
CREATE TABLE guest_id_scans (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  stay_id uuid NOT NULL REFERENCES pms_stays (id) ON DELETE CASCADE,
  file_name varchar(160) NOT NULL,
  provider varchar(30) NOT NULL,
  confidence numeric(5, 2),
  member_name varchar(150),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT guest_id_scans_expiry_ck CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
CREATE INDEX guest_id_scans_stay_idx ON guest_id_scans (stay_id);
CREATE INDEX guest_id_scans_expires_idx ON guest_id_scans (expires_at) WHERE used_at IS NULL;
