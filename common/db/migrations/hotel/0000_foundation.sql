-- rollback: forward-only because every later hotel migration records itself in schema_migrations; restore from a backup instead
-- The first file in every hotel schema. The schema itself is created by the create-hotel script (not here), and the migration
-- runner puts that schema first on search_path, so every name below is unqualified and lands in THIS hotel's schema.
-- It holds the two things every hotel table depends on: the updated_at trigger function (a copy of its own, so hotel
-- tables never reach into another schema) and the table that records what has been applied.

-- One method for updated_at everywhere: a BEFORE UPDATE trigger, so no service can forget it.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Optimistic locking (D6) on the booking and money tables that carry a version column: the service updates WHERE id = $1 AND version = $2
-- and sets version = version + 1; this trigger refuses an UPDATE that does not raise it by exactly one, so a forgotten check cannot slip through.
CREATE OR REPLACE FUNCTION enforce_version_step() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'version must rise by exactly one on every update of %', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- append-only: one row per applied file, never edited
-- The runner creates the same table before it reads it (db/scripts/migrate.ts); a test keeps both texts identical.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[0-9]{4}_[a-z0-9_]+$'),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_by text NOT NULL DEFAULT current_user,
  applied_at timestamptz NOT NULL DEFAULT now()
);
