-- rollback: DROP TABLE IF EXISTS platform.vault_items;
-- The vault (MJ, 2 Nov 2026: "a vault to store the important things of each hotel, in the Super Admin's hotel profile"). One row per stored thing: an OTA or bank login, a card, a
-- licence, a secure note. The title, kind, user name and web address are plain (to list and search); the secret itself (password, PIN, account or card number) and the private notes
-- are sealed by the server before they reach this table (AES-256-GCM with the vault key derived from HMS_HASH_KEY, bound to the hotel, the item and the field), so a database copy
-- alone opens nothing and a sealed value moved to another row or hotel does not open. Only the Super Admin reads or writes it; every add, change, reveal and removal is in the
-- platform audit log. A removed item is kept (deleted_at) and can be restored.
--   hotel_id  the hotel the item belongs to; NULL = the Central Vault (the platform's own items)
CREATE TABLE platform.vault_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  hotel_id uuid REFERENCES platform.hotels (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('login', 'bank', 'card', 'licence', 'note', 'other')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  username text CHECK (username IS NULL OR char_length(username) <= 200),
  url text CHECK (url IS NULL OR char_length(url) <= 500),
  -- sealed by the server as "v1.<iv>.<tag>.<ciphertext>" (crypto/secretBox.ts), as hotel_mail.ses_password is (0161); the CHECK refuses a plain value
  secret text CHECK (secret IS NULL OR (secret LIKE 'v1.%' AND char_length(secret) <= 8000)),
  notes text CHECK (notes IS NULL OR (notes LIKE 'v1.%' AND char_length(notes) <= 16000)),
  -- when a licence or card runs out (optional)
  expires_on date,
  created_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  updated_by uuid REFERENCES platform.logins (id) ON DELETE SET NULL,
  -- the name of who last changed it, as shown in the list (kept when that login goes)
  updated_by_name text CHECK (updated_by_name IS NULL OR char_length(updated_by_name) <= 120),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- one hotel's vault (or the Central Vault), newest change first
CREATE INDEX vault_items_hotel_id_idx ON platform.vault_items (hotel_id, updated_at DESC);
CREATE INDEX vault_items_created_by_idx ON platform.vault_items (created_by);
CREATE INDEX vault_items_updated_by_idx ON platform.vault_items (updated_by);
CREATE TRIGGER vault_items_touch_updated_at BEFORE UPDATE ON platform.vault_items FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- removing an item sets deleted_at: the app role never deletes a row
GRANT SELECT, INSERT, UPDATE ON platform.vault_items TO hms_app;
