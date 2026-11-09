-- rollback: DROP TABLE IF EXISTS platform.media_files;
-- Photos in the database (MJ, 19 Oct 2026: no bucket, no S3): the ID photos, menu photos, login photos and website pictures are kept as rows here when MEDIA_DRIVER=db (the default on a
-- hosted server). One row per (owner, bucket, name): `owner_id` is the folder the file stores use (a hotel id; for a login's own photo that person's user id, so there is no foreign
-- key), `bucket` is which store it belongs to, `name` is the stored file name (lower-case, no folder part, an image extension). A picture is made small before it is stored
-- (media/compress.ts: an ID photo is a JPEG of about 400 KB), the CHECKs hold the upper bounds. Read only through the app's authenticated routes (no public route); written and
-- removed only by the app role. Moving the files to a bucket later is a copy.
-- no-standard-columns: a file store keyed by (owner, bucket, name), like an object store; no legacy id
-- hard-delete: a photo that is replaced or removed by its owner is deleted (media/db.ts remove)
CREATE TABLE IF NOT EXISTS platform.media_files (
  owner_id uuid NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('id-photos', 'menu-photos', 'media', 'profile-photos')),
  name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9._-]{0,119}\.(jpg|png|gif|webp|svg|ico)$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon')),
  bytes bytea NOT NULL,
  size integer NOT NULL CHECK (size BETWEEN 1 AND 20971520),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, bucket, name),
  CONSTRAINT media_files_size_matches CHECK (size = octet_length(bytes))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.media_files TO hms_app;
