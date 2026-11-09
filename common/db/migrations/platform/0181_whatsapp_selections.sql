-- rollback: DROP TABLE IF EXISTS platform.whatsapp_selections;
-- The short-lived "this guest chose this hotel" on the shared WhatsApp line (plan part 10/11: after an answered "which hotel?", a hotel code or a "Chat with Hotel X" tap, messages of that guest go to that
-- hotel for a while, 10 minutes after an answer and the routing timeframe after later explicit choices). No message text and no number: the guest is the same keyed hash as in whatsapp_holds.
-- One row per (line, guest); it is replaced by the next choice and deleted when it expires.
CREATE TABLE platform.whatsapp_selections (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  line_id uuid NOT NULL REFERENCES platform.whatsapp_lines (id) ON DELETE CASCADE,
  guest_hash bytea NOT NULL CHECK (octet_length(guest_hash) = 32),
  hotel_id uuid NOT NULL REFERENCES platform.hotels (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_selections_guest_key ON platform.whatsapp_selections (line_id, guest_hash);
CREATE INDEX whatsapp_selections_hotel_idx ON platform.whatsapp_selections (hotel_id);
CREATE INDEX whatsapp_selections_expires_idx ON platform.whatsapp_selections (expires_at);
CREATE TRIGGER whatsapp_selections_touch_updated_at BEFORE UPDATE ON platform.whatsapp_selections FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.whatsapp_selections TO hms_app;
