import "server-only";
// The PORT between the Platform console and the owner-side database work that the running app cannot do itself (BACKEND.md 14.8): building a
// hotel's schema, role and tables when its form is approved. The app's own database login (hms_app) cannot create schemas or roles, and the owner
// login (PG_OWNER_URL) is script-only: it lives in db/.env.local and a production app refuses to start if it sees it. So the console asks a
// provisioner. LOCAL development: the adapter in ./local.ts reads the owner URL from db/.env.local. PRODUCTION: a separate worker process is a
// later job; until then provisioning there answers "not configured" (fail closed), it never falls back to the app's login.

interface ProvisionRequest {
  /** platform.hotels.id of a hotel that waits for approval (status pending_approval, no schema yet). */
  hotelId: string;
}

interface ProvisionResult {
  hotelId: string;
  /** hotel_<32 hex>. */
  schema: string;
}

/** Why a provision did not happen, so the console can answer in its own words. */
type ProvisionFailure = "NOT_CONFIGURED" | "NOT_PENDING" | "FAILED";

export class ProvisionError extends Error {
  readonly failure: ProvisionFailure;
  constructor(failure: ProvisionFailure, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProvisionError";
    this.failure = failure;
  }
}

/** What the owner-side check found for each hotel schema (Platform health). A hotel whose schema could not be read has `databaseMs: null` (down). */
export interface HotelInspection {
  /** Number of the newest hotel migration file this server knows. */
  latestMigration: number;
  /**
   * Per hotel: rows in its schema_migrations, and (when the provisioner compares the sets, provisioner/migrationState.ts) how many migration files have no row (pending) and how many
   * rows have no file (unknown). Without migrationsPending the health page falls back to latestMigration - migrationsApplied.
   */
  hotels: Record<string, { migrationsApplied: number; databaseMs: number | null; migrationsPending?: number; unknownMigrations?: number }>;
}

interface ExportRequest {
  hotelId: string;
  slug: string;
  at: Date;
}

/** A finished export: the file is kept in private storage and `fileRef` is its key there (never a public URL). */
interface ExportResult {
  fileName: string;
  fileRef: string;
  byteSize: number;
  sha256: string;
}

export interface HotelProvisioner {
  /**
   * Builds the hotel's schema, role, grants, migrations and seeds in ONE owner transaction and moves the row to 'active' with provisioned_at.
   * All or nothing: a failure leaves no schema, no role and the row still pending. Throws ProvisionError.
   */
  provision(request: ProvisionRequest): Promise<ProvisionResult>;
  /** Migrations applied and database answer time for each of these (live) hotels. ProvisionError NOT_CONFIGURED when this server cannot look. */
  inspect(request: { hotelIds: readonly string[] }): Promise<HotelInspection>;
  /** Packs every record of the hotel into one stored file (any hotel status). ProvisionError NOT_CONFIGURED / FAILED. */
  exportHotel(request: ExportRequest): Promise<ExportResult>;
  /** Drops the hotel's schema and role for good. Safe to repeat. Called only after the console recorded the deletion. ProvisionError NOT_CONFIGURED / FAILED. */
  dropHotel(request: { hotelId: string; schema: string }): Promise<void>;
}
