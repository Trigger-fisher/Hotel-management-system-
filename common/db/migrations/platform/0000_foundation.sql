-- rollback: forward-only because every later platform migration records itself in platform.schema_migrations; restore from a backup instead
-- The shared schema, the one function that keeps updated_at honest, and the table that records what has been applied.
-- The migration runner (db/scripts/migrate.ts) creates the same schema_migrations table itself before it reads it;
-- a test keeps that text and this one identical.

CREATE SCHEMA IF NOT EXISTS platform;

-- One method for updated_at everywhere: a BEFORE UPDATE trigger, so no service can forget it.
CREATE OR REPLACE FUNCTION platform.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Rows that must never change or disappear once written (audit_log, auth_events).
CREATE OR REPLACE FUNCTION platform.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is insert-only', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

-- append-only: one row per applied file, never edited
-- no-app-access: only the migration runner (hms_owner) reads and writes this table
CREATE TABLE IF NOT EXISTS platform.schema_migrations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[0-9]{4}_[a-z0-9_]+$'),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_by text NOT NULL DEFAULT current_user,
  applied_at timestamptz NOT NULL DEFAULT now()
);
