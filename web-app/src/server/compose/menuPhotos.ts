import "server-only";
import path from "node:path";
import { getDatabase } from "../../db";
import { getConfig, mediaDriverOf, photoStorageUnavailable } from "../config/env";
import { createDbMediaStore } from "../media/db";
import { s3MediaStoreFromConfig } from "../media/s3";
import { createLocalMediaStore, createMemoryMediaStore, createUnavailableMediaStore, type MediaStore } from "../media/store";
import { createMemoryPortalHotel } from "../repos/memory/portal";
import { createPgPortalUnit } from "../repos/postgres/portal";
import { createMenuPhotoService, type MenuPhotoService } from "../services/menu/menuPhotoService";
import { billingDefaults } from "./billing";

// The composition root of the menu photos: the hotel's PRIVATE menu-photo store (S3 prefix `menu-photos/` or a local folder beside the media folder; memory without a database;
// on Vercel without S3 a plain 503, like the ID photos) and the portal unit (the menu items).
let store: MediaStore | null = null;
let service: MenuPhotoService | null = null;

export function getMenuPhotoStore(): MediaStore {
  if (store) return store;
  const config = getConfig();
  const media = config.HMS_MEDIA_DIR ?? path.join(process.cwd(), ".data", "media");
  if (!config.DATABASE_URL) store = createMemoryMediaStore();
  else if (mediaDriverOf(config) === "db") store = createDbMediaStore(getDatabase().pool, "menu-photos");
  else if (photoStorageUnavailable(config)) store = createUnavailableMediaStore();
  else store = config.MEDIA_DRIVER === "s3" ? s3MediaStoreFromConfig(config, "menu-photos/") : createLocalMediaStore(path.join(path.dirname(media), "menu-photos"));
  return store;
}

export function getMenuPhotos(): MenuPhotoService {
  if (service) return service;
  const { people, catalog } = billingDefaults();
  const unit = getConfig().DATABASE_URL ? createPgPortalUnit(getDatabase().withHotel) : createMemoryPortalHotel().unit;
  service = createMenuPhotoService({ unit, people, catalog, photos: getMenuPhotoStore() });
  return service;
}

/** Replaces the store and the service (tests). */
export function configureMenuPhotos(next: { store: MediaStore; service: MenuPhotoService } | null): void {
  store = next?.store ?? null;
  service = next?.service ?? null;
}