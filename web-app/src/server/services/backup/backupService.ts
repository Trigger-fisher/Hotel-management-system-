import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { CronBackupRun } from "../cron/cronService";
import type { MediaStore } from "../../media/store";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";

interface HotelExport {
  ndjson: string;
  tables: number;
  rows: number;
}

interface BackupDeps {
  unit: PlatformConsoleUnit;
  store: MediaStore | null;
  readHotel: (hotelId: string) => Promise<HotelExport>;
  now?: () => Date;
  budgetMs?: number;
  report?: (message: string, error: unknown, hotelId: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const istDate = (at: Date): Date => new Date(at.getTime() + IST_OFFSET_MS);
const istDayNumber = (at: Date): number => {
  const d = istDate(at);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
};

/** Keep today's and the previous 13 daily copies, then Sunday copies for eight weeks. */
export function keepBackup(finishedAt: Date, now: Date): boolean {
  const age = istDayNumber(now) - istDayNumber(finishedAt);
  if (age < 14) return true;
  return age < 56 && istDate(finishedAt).getUTCDay() === 0;
}

export function createBackupService(deps: BackupDeps) {
  const now = deps.now ?? (() => new Date());
  const budgetMs = deps.budgetMs ?? 270_000;

  const reportFailure = (step: string, error: unknown, hotelId: string): void => {
    try {
      deps.report?.("backup: the " + step + " step failed", error, hotelId);
    } catch {
      // Reporting must not stop the remaining hotels.
    }
  };

  const recordFailure = async (hotelId: string, startedAt: Date, step: string): Promise<void> => {
    try {
      await deps.unit.run((repos) =>
        repos.backups.record({ hotelId, status: "failed", errorCode: step, startedAt, finishedAt: now() }),
      );
    } catch {
      // A failed database write should not prevent the next hotel's copy.
    }
  };

  const failHotel = async (hotelId: string, startedAt: Date, step: string, error: unknown): Promise<void> => {
    reportFailure(step, error, hotelId);
    await recordFailure(hotelId, startedAt, step);
  };

  return {
    async run(): Promise<CronBackupRun> {
      const store = deps.store;
      if (!store) return { configured: false, hotels: 0, done: 0, failed: 0, skipped: 0, pruned: 0 };

      const runStartedAt = now();
      const listed = await deps.unit.run((repos) => repos.hotels.list({ words: [] }, runStartedAt));
      const hotels = listed.filter(
        (hotel) => hotel.provisionedAt !== null && (hotel.status === "active" || hotel.status === "suspended"),
      );
      let done = 0;
      let failed = 0;
      let skipped = 0;
      let pruned = 0;

      for (let i = 0; i < hotels.length; i += 1) {
        if (now().getTime() - runStartedAt.getTime() >= budgetMs) {
          skipped = hotels.length - i;
          break;
        }

        const hotel = hotels[i];
        const startedAt = now();
        let exported: HotelExport;
        try {
          exported = await deps.readHotel(hotel.id);
        } catch (error) {
          await failHotel(hotel.id, startedAt, "read", error);
          failed += 1;
          continue;
        }

        let bytes: Uint8Array;
        let sha256: string;
        let fileName: string;
        try {
          bytes = gzipSync(exported.ndjson);
          sha256 = createHash("sha256").update(bytes).digest("hex");
          const day = istDate(now()).toISOString().slice(0, 10);
          fileName = "backup-" + day + "-" + sha256.slice(0, 8) + ".ndjson.gz";
          await store.put(hotel.id, fileName, bytes);
        } catch (error) {
          await failHotel(hotel.id, startedAt, "write", error);
          failed += 1;
          continue;
        }

        const finishedAt = now();
        try {
          await deps.unit.run((repos) =>
            repos.backups.record({
              hotelId: hotel.id,
              status: "ready",
              fileName,
              fileRef: "backups/" + hotel.id + "/" + fileName,
              byteSize: bytes.byteLength,
              sha256,
              tableCount: exported.tables,
              rowCount: exported.rows,
              startedAt,
              finishedAt,
            }),
          );
          done += 1;
        } catch (error) {
          try {
            await store.remove(hotel.id, fileName);
          } catch {
            // The failed record is still attempted below; a later prune can remove an orphaned file.
          }
          await failHotel(hotel.id, startedAt, "record", error);
          failed += 1;
          continue;
        }

        try {
          const oldCopies = await deps.unit.run((repos) => repos.backups.readyOf(hotel.id));
          for (const copy of oldCopies) {
            if (keepBackup(copy.finishedAt, finishedAt)) continue;
            await store.remove(hotel.id, copy.fileName);
            await deps.unit.run((repos) => repos.backups.remove(copy.id));
            pruned += 1;
          }
        } catch (error) {
          reportFailure("prune", error, hotel.id);
        }
      }

      return { configured: true, hotels: hotels.length, done, failed, skipped, pruned };
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
