import "server-only";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { CreateHotelError, provisionHotel } from "../../../../common/db/scripts/create-hotel";
import { createEnvStore } from "../../../../common/db/scripts/env-store";
import { dropHotelSchema, exportHotelData } from "../../../../common/db/scripts/hotel-data";
import { loadMigrationFiles } from "../../../../common/db/scripts/migrate";
import { connectPg } from "../../../../common/db/scripts/pg-db";
import { isHotelSchemaName } from "../../../../common/db/scripts/schema-names";
import { compareMigrations } from "./migrationState";
import { ProvisionError, type HotelInspection, type HotelProvisioner } from "./port";

// The development provisioner (BACKEND.md 14.8): runs the SAME create-hotel logic the CLI uses, through an owner connection whose URL is read from the
// git-ignored db/.env.local. FAIL CLOSED: when NODE_ENV is production, or the URL is missing, it throws "not configured" and never touches the
// database; it never falls back to the app's own login (hms_app cannot create schemas). The URL is never logged, returned or put in an error.
// The same owner connection serves the Super Admin's hotel export (a gzip of every record, kept under db/dumps/exports, which git ignores), the
// permanent drop of a hotel's schema and role, and the health look at each hotel schema.

interface LocalProvisionerOptions {
  nodeEnv: string | undefined;
  /** The folder with db/.env.local, db/migrations and db/seeds. Default: ../db next to the web-app folder the server runs from. */
  dbRoot?: string;
  /** Test hook: how the owner connection is made. */
  connect?: typeof connectPg;
  /** Test hook: the owner URL, instead of db/.env.local (never set by the app; NODE_ENV production still refuses). */
  ownerUrl?: string;
  /** Test hook: where export files are kept. Default: <dbRoot>/dumps/exports (git ignores db/dumps). */
  exportDir?: string;
}

const istDate = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function createLocalProvisioner(options: LocalProvisionerOptions): HotelProvisioner {
  const dbRoot = options.dbRoot ?? path.join(process.cwd(), "..", "common", "db");
  const connect = options.connect ?? connectPg;

  /** Runs `work` on an owner connection, closed afterwards; NOT_CONFIGURED before anything is opened when this server may not do it. */
  async function withOwner<T>(work: (owner: Awaited<ReturnType<typeof connectPg>>) => Promise<T>): Promise<T> {
    if (options.nodeEnv === "production") throw new ProvisionError("NOT_CONFIGURED", "This is not configured on this server.");
    const ownerUrl = options.ownerUrl ?? createEnvStore(path.join(dbRoot, ".env.local")).get("PG_OWNER_URL");
    if (!ownerUrl) throw new ProvisionError("NOT_CONFIGURED", "This is not configured on this server.");
    let owner: Awaited<ReturnType<typeof connectPg>> | undefined;
    try {
      owner = await connect(ownerUrl);
      return await work(owner);
    } finally {
      await owner?.end().catch(() => undefined);
    }
  }

  return {
    async provision({ hotelId }) {
      try {
        return await withOwner(async (owner) => {
          const created = await provisionHotel(
            { owner, hotelMigrations: loadMigrationFiles(path.join(dbRoot, "migrations", "hotel")), hotelSeeds: loadMigrationFiles(path.join(dbRoot, "seeds", "hotel")) },
            hotelId,
          );
          return { hotelId: created.id, schema: created.schema };
        });
      } catch (error) {
        if (error instanceof ProvisionError) {
          if (error.failure === "NOT_CONFIGURED") throw new ProvisionError("NOT_CONFIGURED", "Building a hotel is not configured on this server.");
          throw error;
        }
        if (error instanceof CreateHotelError && error.code === "NOT_PENDING") throw new ProvisionError("NOT_PENDING", "This hotel is not waiting for approval.", { cause: error });
        throw new ProvisionError("FAILED", "Building the hotel failed. Nothing was kept.", { cause: error });
      }
    },

    async inspect({ hotelIds }) {
      const files = loadMigrationFiles(path.join(dbRoot, "migrations", "hotel"));
      const latest = files.length === 0 ? 0 : Number.parseInt(files[files.length - 1].version.slice(0, 4), 10);
      const versions = files.map((f) => f.version);
      return withOwner(async (owner) => {
        const hotels: HotelInspection["hotels"] = {};
        for (const id of hotelIds) {
          const started = process.hrtime.bigint();
          try {
            const schema = (await owner.query("SELECT schema_name FROM platform.hotels WHERE id = $1 AND provisioned_at IS NOT NULL", [id])).rows[0]?.schema_name;
            // a hotel's schema is named for the hotel since platform migration 0172 (hotel_<hex> only before its rename): any safe hotel schema name counts
            if (typeof schema !== "string" || !isHotelSchemaName(schema)) throw new Error("no schema");
            // the SET of files against the SET of applied versions: a gap in the numbering is not pending
            const applied = (await owner.query(`SELECT version FROM "${schema}".schema_migrations`)).rows.map((r) => String(r.version));
            const state = compareMigrations(versions, applied);
            hotels[id] = { migrationsApplied: state.applied, migrationsPending: state.pending.length, unknownMigrations: state.unknown.length, databaseMs: Math.round(Number(process.hrtime.bigint() - started) / 1_000_000) };
          } catch {
            hotels[id] = { migrationsApplied: 0, databaseMs: null };
          }
        }
        return { latestMigration: latest, hotels };
      });
    },

    async exportHotel({ hotelId, slug, at }) {
      try {
        return await withOwner(async (owner) => {
          const data = await exportHotelData(owner, hotelId);
          const bytes = gzipSync(Buffer.from(data.ndjson, "utf8"));
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const fileName = `${slug}-export-${istDate(at)}-${sha256.slice(0, 8)}.ndjson.gz`;
          const dir = options.exportDir ?? path.join(dbRoot, "dumps", "exports");
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, fileName), bytes);
          return { fileName, fileRef: `exports/${fileName}`, byteSize: bytes.length, sha256 };
        });
      } catch (error) {
        if (error instanceof ProvisionError) throw error;
        throw new ProvisionError("FAILED", "The export failed. Nothing was kept.", { cause: error });
      }
    },

    async dropHotel({ schema }) {
      try {
        await withOwner((owner) => dropHotelSchema(owner, schema));
      } catch (error) {
        if (error instanceof ProvisionError) throw error;
        throw new ProvisionError("FAILED", "Removing the hotel's data failed.", { cause: error });
      }
    },
  };
}
