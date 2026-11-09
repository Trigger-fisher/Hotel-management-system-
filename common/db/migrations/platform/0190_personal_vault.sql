-- rollback: DROP TABLE IF EXISTS platform.personal_vault_items; DROP TABLE IF EXISTS platform.personal_vault_keys;
-- My vault (MJ, 5 Nov 2026: "superadmin have their own vault to save all his details personal"): each Super Admin's own items, readable by that login only. Envelope encryption as
-- in the hotel vault (0168): every owner has a data key of their own (32 random bytes), stored only sealed with the vault key (derived from HMS_HASH_KEY, bound to the owner); each
-- item's secret and notes are sealed with the owner's data key, bound to the owner, the item and the field. A database copy alone opens nothing, and a sealed value moved to another
-- owner or item does not open. Every add, change, Show and removal is in the platform audit log (never the name or the secret). A removed item is kept (deleted_at).
CREATE TABLE IF NOT EXISTS platform.personal_vault_keys (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL UNIQUE REFERENCES platform.logins (id) ON DELETE CASCADE,
  wrapped_key text NOT NULL CHECK (wrapped_key LIKE 'v1.%' AND char_length(wrapped_key) <= 400),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS personal_vault_keys_touch_updated_at ON platform.personal_vault_keys;
CREATE TRIGGER personal_vault_keys_touch_updated_at BEFORE UPDATE ON platform.personal_vault_keys FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE IF NOT EXISTS platform.personal_vault_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES platform.logins (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('password', 'note', 'bank', 'id_document', 'card', 'key')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  username text CHECK (username IS NULL OR char_length(username) <= 200),
  url text CHECK (url IS NULL OR char_length(url) <= 500),
  secret text CHECK (secret IS NULL OR (secret LIKE 'v1.%' AND char_length(secret) <= 8000)),
  notes text CHECK (notes IS NULL OR (notes LIKE 'v1.%' AND char_length(notes) <= 16000)),
  expires_on date,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personal_vault_items_owner_idx ON platform.personal_vault_items (owner_id, updated_at DESC);
DROP TRIGGER IF EXISTS personal_vault_items_touch_updated_at ON platform.personal_vault_items;
CREATE TRIGGER personal_vault_items_touch_updated_at BEFORE UPDATE ON platform.personal_vault_items FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- removing an item sets deleted_at: the app role never deletes a row
GRANT SELECT, INSERT ON platform.personal_vault_keys TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.personal_vault_items TO hms_app;
