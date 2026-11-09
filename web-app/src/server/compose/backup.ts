import "server-only";
import path from "node:path";
import { exportHotelLines } from "../../../../common/db/scripts/hotel-data";
import { getDatabase } from "../../db";
import { getConfig, mediaDriverOf, photoStorageUnavailable } from "../config/env";
import { getLogger } from "../logger";
import { s3MediaStoreFromConfig } from "../media/s3";
import { createLocalMediaStore, createMemoryMediaStore, type MediaStore } from "../media/store";
import { createBackupService, type BackupService } from "../services/backup/backupService";
import { getPlatformConsoleUnit } from "./platform";

// The composition root of the nightly backup copy (T6): the store the copies go to (the private bucket under "backups/" with MEDIA_DRIVER=s3; a
// "backups" folder beside the media folder on a server with a disk; memory without a database), and the reader that uses the app's own connections:
// the platform rows through the shared pool, the hotel's tables through withHotel as a read-only visit of that hotel.

let backupStore: MediaStore | null | undefined;
function defaultBackupStore(): MediaStore | null {
  if (backupStore !== undefined) return backupStore;
  const config = getConfig();
  if (!config.DATABASE_URL) return (backupStore = createMemoryMediaStore());
  if (config.MEDIA_DRIVER === "s3") return (backupStore = s3MediaStoreFromConfig(config, "backups/"));
  // Vercel keeps no disk between requests: without a bucket there is nowhere to keep a copy (the run answers configured: false)
  // (the database is not the place for its own backup either: MEDIA_DRIVER=db keeps no backup copies here)
  if (photoStorageUnavailable(config) || mediaDriverOf(config) === "db") return (backupStore = null);
  const media = config.HMS_MEDIA_DIR ?? path.join(process.cwd(), ".data", "media");
  return (backupStore = createLocalMediaStore(path.join(path.dirname(media), "backups")));
}

let service: BackupService | null = null;

export function getBackup(): BackupService {
  service ??= createBackupService({
    unit: getPlatformConsoleUnit(),
    store: defaultBackupStore(),
    readHotel: async (hotelId) => {
      if (!getConfig().DATABASE_URL) throw new Error("no database");
      const { pool, withHotel } = getDatabase();
      // the platform rows through one pooled connection (hms_app), the hotel's tables through withHotel as a read-only look at that hotel
      const client = await pool.connect();
      try {
        return await exportHotelLines(
          {
            platform: { query: (text, params) => client.query(text, params) },
            hotel: (_schema, work) => withHotel({ hotelId, readOnly: true }, (tx) => work({ query: (text, params) => tx.query(text, params) }, (name) => `"${name}"`)),
          },
          hotelId,
        );
      } finally {
        client.release();
      }
    },
    now: () => new Date(),
    report: (message, error, hotelId) => getLogger().error(message, { hotelId, error: error instanceof Error ? error.message : String(error) }),
  });
  return service;
}

/** Replaces the service (tests). */
export function configureBackup(next: BackupService | null): void {
  service = next;
}
