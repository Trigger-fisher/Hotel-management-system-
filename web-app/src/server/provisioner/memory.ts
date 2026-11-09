import "server-only";
import { createHash } from "node:crypto";
import type { AuthData } from "../repos/memory/auth";
import type { PlatformConsoleData } from "../repos/memory/platformConsole";
import { ProvisionError, type HotelInspection, type HotelProvisioner } from "./port";

// The test double of the provisioner: does to the in-memory hotel exactly what provisionHotel does to the database row (status 'active' and
// provisioned_at together), or fails like it. `failNext` proves that a failed build leaves the hotel pending; `failExport` / `failDrop` fail the other
// two calls once; `unconfigured` makes every call answer NOT_CONFIGURED like a production server without an owner worker.
export interface MemoryProvisioner extends HotelProvisioner {
  calls: string[];
  exported: string[];
  dropped: string[];
  failNext: boolean;
  failExport: boolean;
  failDrop: boolean;
  unconfigured: boolean;
  latestMigration: number;
  inspection: HotelInspection["hotels"];
}

export function createMemoryProvisioner(world: { auth: () => AuthData; console: () => PlatformConsoleData; now: () => Date }): MemoryProvisioner {
  const self: MemoryProvisioner = {
    calls: [] as string[],
    exported: [] as string[],
    dropped: [] as string[],
    failNext: false,
    failExport: false,
    failDrop: false,
    unconfigured: false,
    /** What `inspect` answers: newest migration number, and per hotel the applied count and answer time (default: all applied, 12 ms). */
    latestMigration: 20,
    inspection: {} as HotelInspection["hotels"],
    async provision({ hotelId }: { hotelId: string }) {
      self.calls.push(hotelId);
      const hotel = world.auth().hotels.find((h) => h.id === hotelId);
      const meta = world.console().hotels.get(hotelId);
      if (!hotel || !meta || meta.deletedAt !== null) throw new ProvisionError("FAILED", "No such hotel.");
      if (hotel.status !== "pending_approval" || meta.provisionedAt !== null) throw new ProvisionError("NOT_PENDING", "This hotel is not waiting for approval.");
      if (self.failNext) {
        self.failNext = false;
        throw new ProvisionError("FAILED", "Building the hotel failed. Nothing was kept.");
      }
      hotel.status = "active";
      meta.provisionedAt = world.now();
      return { hotelId, schema: `hotel_${hotelId.replace(/-/g, "")}` };
    },
    async inspect({ hotelIds }: { hotelIds: readonly string[] }) {
      if (self.unconfigured) throw new ProvisionError("NOT_CONFIGURED", "This is not configured on this server.");
      const hotels: HotelInspection["hotels"] = {};
      for (const id of hotelIds) hotels[id] = self.inspection[id] ?? { migrationsApplied: self.latestMigration, databaseMs: 12 };
      return { latestMigration: self.latestMigration, hotels };
    },
    async exportHotel({ hotelId, slug, at }: { hotelId: string; slug: string; at: Date }) {
      if (self.unconfigured) throw new ProvisionError("NOT_CONFIGURED", "This is not configured on this server.");
      if (self.failExport) {
        self.failExport = false;
        throw new ProvisionError("FAILED", "The export failed. Nothing was kept.");
      }
      self.exported.push(hotelId);
      const sha256 = createHash("sha256").update(`${hotelId}|${at.toISOString()}`).digest("hex");
      const fileName = `${slug}-export-${new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10)}-${sha256.slice(0, 8)}.ndjson.gz`;
      return { fileName, fileRef: `exports/${fileName}`, byteSize: 1024, sha256 };
    },
    async dropHotel({ hotelId, schema }: { hotelId: string; schema: string }) {
      if (self.unconfigured) throw new ProvisionError("NOT_CONFIGURED", "This is not configured on this server.");
      if (self.failDrop) {
        self.failDrop = false;
        throw new ProvisionError("FAILED", "Removing the hotel's data failed.");
      }
      self.dropped.push(`${hotelId}:${schema}`);
    },
  };
  return self;
}
