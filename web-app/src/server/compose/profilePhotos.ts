import "server-only";
import path from "node:path";
import { getDatabase } from "../../db";
import { getConfig, mediaDriverOf, photoStorageUnavailable } from "../config/env";
import { createDbMediaStore } from "../media/db";
import { s3MediaStoreFromConfig } from "../media/s3";
import { createLocalMediaStore, createMemoryMediaStore, createUnavailableMediaStore, type MediaStore } from "../media/store";

// The PRIVATE profile-photo store (every login's own photo; platform migration 0131): S3 prefix `profile-photos/` in the same private bucket as the ID and menu photos, or a
// local folder beside the media folder; memory without a database; on Vercel without S3 a plain 503 ("Photo storage is not set up on this server yet"), like the other photos.
// Files sit in a folder of the person's own user id, so one person's photo is never read under another's.
let store: MediaStore | null = null;

export function getProfilePhotoStore(): MediaStore {
  if (store) return store;
  const config = getConfig();
  const media = config.HMS_MEDIA_DIR ?? path.join(process.cwd(), ".data", "media");
  if (!config.DATABASE_URL) store = createMemoryMediaStore();
  else if (mediaDriverOf(config) === "db") store = createDbMediaStore(getDatabase().pool, "profile-photos");
  else if (photoStorageUnavailable(config)) store = createUnavailableMediaStore();
  else store = config.MEDIA_DRIVER === "s3" ? s3MediaStoreFromConfig(config, "profile-photos/") : createLocalMediaStore(path.join(path.dirname(media), "profile-photos"));
  return store;
}

/** Replaces the store (tests). */
export function configureProfilePhotoStore(next: MediaStore | null): void {
  store = next;
}
