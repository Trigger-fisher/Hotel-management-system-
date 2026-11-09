// create-hotel: makes one new hotel. A platform.hotels row, its own schema (named for the hotel: <group>_<hotel>, or <hotel> for an individual one, made by
// platform.hotel_schema_name_for() and saved on the row before the schema is built; platform migration 0172), the privileges for hms_app, every hotel migration and
// every hotel seed. It either completes or leaves nothing behind. The hotel's ROLE is still hotel_<32 hex>_rw, from the hotel's id.
//
//   ONE transaction does everything: INSERT the hotel row, CREATE SCHEMA, CREATE the hotel's own login-less role hotel_<hex>_rw with USAGE on
//   THIS schema only and default privileges for the tables its migrations add, let hms_app (the app role) become a member of it WITHOUT
//   inheriting, then run every hotel migration and seed in that schema, set the DELETE rights and write the audit row. hms_app gets NO
//   privilege on any hotel schema: it can only SET LOCAL ROLE into one hotel's role inside a transaction (withHotel), so another hotel's
//   tables answer "permission denied" even if search_path were wrong or SQL were injected. DDL is transactional in PostgreSQL, so any failure
//   rolls back all of it: no row, no schema, no role is left.
// Runs as hms_owner (the app role cannot create schemas or touch platform.hotels).
import { MigrationError, runMigrations, type MigrationClient, type MigrationFile } from "./migrate";
import { hotelRoleOf, isHotelSchemaName } from "./schema-names";

export interface CreateHotelInput {
  name: string;
  slug: string;
}

export interface CreateHotelDeps {
  /** A connection as hms_owner. */
  owner: MigrationClient;
  hotelMigrations: readonly MigrationFile[];
  /** see RunOptions.searchPathExtra */
  searchPathExtra?: string;
  hotelSeeds: readonly MigrationFile[];
  /** The role the running app uses. Defaults to hms_app. */
  appRole?: string;
  /** The role that owns the objects migrations create, and so the one default privileges are set for. Defaults to hms_owner. */
  ownerRole?: string;
  report?: (message: string) => void;
}

export interface CreatedHotel {
  id: string;
  schema: string;
}

export type CreateHotelErrorCode = "BAD_INPUT" | "SLUG_TAKEN" | "SETUP_FAILED" | "MIGRATION_FAILED" | "NOT_PENDING";

export class CreateHotelError extends Error {
  readonly code: CreateHotelErrorCode;
  readonly schema?: string;

  constructor(code: CreateHotelErrorCode, message: string, options?: { schema?: string; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CreateHotelError";
    this.code = code;
    this.schema = options?.schema;
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ROLE = /^[a-z][a-z0-9_]{0,62}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The hotel's own role: hotel_<32 hex>_rw, from the hotel's ID (the same name web-app/src/db/schemaName.ts hotelRoleName() builds; a test keeps them equal). Never renamed. */
export function hotelRoleFor(hotelId: string): string {
  try {
    return hotelRoleOf(hotelId);
  } catch {
    throw new CreateHotelError("BAD_INPUT", "Not a hotel id");
  }
}

/**
 * The ONE place a new hotel's schema gets its name (MJ, 2 Nov 2026: "set automation that it will create in this format only"): platform.hotel_schema_name_for() makes it from the
 * hotel's name and its group (<group>_<hotel> for a hotel of a real group, <hotel> for an individual one) and it is saved on the hotel's row BEFORE the schema is built. Inside the
 * caller's transaction, so a failed build leaves the old name on the row, and nothing is renamed that has a schema already.
 */
async function nameHotelSchema(owner: MigrationClient, hotelId: string): Promise<string> {
  const named = await owner.query("UPDATE platform.hotels SET schema_name = platform.hotel_schema_name_for(id) WHERE id = $1 RETURNING schema_name", [hotelId]);
  const schema = String(named.rows[0]?.schema_name ?? "");
  if (!isHotelSchemaName(schema)) throw new CreateHotelError("SETUP_FAILED", "The database did not return a valid hotel schema name");
  return schema;
}

export function validateHotelInput(input: CreateHotelInput): CreateHotelInput {
  const name = input.name.normalize("NFKC").trim();
  const slug = input.slug.trim();
  if (name.length < 1 || name.length > 200 || CONTROL.test(name)) throw new CreateHotelError("BAD_INPUT", "The hotel name must be 1 to 200 characters with no control characters");
  if (slug.length < 1 || slug.length > 63 || !SLUG.test(slug)) throw new CreateHotelError("BAD_INPUT", "The hotel slug must be lower-case letters, digits and single dashes, up to 63 characters");
  return { name, slug };
}

const sqlStateOf = (error: unknown): string => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : "";
};

const MARKED_TABLE = /^--\s*hard-delete:\s*\S[^\n]*\n(?:--[^\n]*\n)*\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gim;

/** A later migration can give DELETE on one more table with `-- hard-delete-grant: <table> (<why, with Pallav's source>)` (a table made before it was marked). */
const GRANT_LINE = /^--\s*hard-delete-grant:\s*([a-z_][a-z0-9_]*)\s+\(\S[^\n]*\)\s*$/gm;

/** The tables whose migration carries `-- hard-delete: <Pallav source>` (the recycle-bin tables), plus those a later migration grants with `-- hard-delete-grant:`: the only ones a hotel's role may DELETE from. */
export function hardDeleteTables(files: readonly MigrationFile[]): string[] {
  const tables = new Set<string>();
  for (const file of files) {
    for (const match of file.sql.matchAll(MARKED_TABLE)) tables.add(match[1]);
    for (const match of file.sql.matchAll(GRANT_LINE)) tables.add(match[1]);
  }
  return [...tables].sort();
}

async function syncHotelGrantsInTransaction(owner: MigrationClient, schema: string, hotelMigrations: readonly MigrationFile[]): Promise<void> {
  // the role is named from the hotel's id, not from its schema (readable schemas, migration 0172): the hotel's row holds it
  const named = await owner.query("SELECT role_name FROM platform.hotels WHERE schema_name = $1", [schema]);
  const role = String(named.rows[0]?.role_name ?? "");
  if (role === "") throw new CreateHotelError("BAD_INPUT", "No hotel has this schema name");
  await owner.query(`REVOKE DELETE ON ALL TABLES IN SCHEMA "${schema}" FROM "${role}"`);
  // the runner's own bookkeeping is the owner's business: the hotel's role may not even read it
  await owner.query(`REVOKE ALL ON "${schema}".schema_migrations, "${schema}".schema_seeds FROM "${role}"`);
  for (const table of hardDeleteTables(hotelMigrations)) {
    // a table a later migration dropped (Pathik, hotel 0051) is still named by the earlier migration that marked it: nothing to grant on it
    const there = await owner.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`"${schema}"."${table}"`]);
    if (there.rows[0]?.ok === true) await owner.query(`GRANT DELETE ON "${schema}"."${table}" TO "${role}"`);
  }
}

/**
 * Makes DELETE exactly the marked tables: takes DELETE from every table in the hotel schema, then gives it back on the marked ones.
 * Safe to run again, and run by migrate for the hotels that already exist, so a new marked table gets its right without a new hotel.
 */
export async function syncHotelGrants(owner: MigrationClient, schema: string, hotelMigrations: readonly MigrationFile[]): Promise<void> {
  await owner.query("BEGIN");
  try {
    await syncHotelGrantsInTransaction(owner, schema, hotelMigrations);
    await owner.query("COMMIT");
  } catch (error) {
    try {
      await owner.query("ROLLBACK");
    } catch {
      // the connection is gone; the original error matters
    }
    throw error;
  }
}

/**
 * Inside an open transaction: the hotel's schema, its own login-less role, the privileges, every hotel migration and seed, and the DELETE rights.
 * Shared by createHotel (a brand-new hotel) and provisionHotel (a hotel row that waited for approval), so the two can never drift.
 */
async function buildHotelSchema(deps: CreateHotelDeps, hotelId: string, schema: string, hotelName: string, appRole: string, ownerRole: string): Promise<void> {
  const q = (text: string, params?: readonly unknown[]) => deps.owner.query(text, params);
  const role = hotelRoleFor(hotelId);
  await q(`CREATE SCHEMA "${schema}"`);
  await q(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await q(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
  // what the hotel's migrations create later (as the owner) is readable and writable by this hotel's role, and by nobody else; DELETE is
  // not a default: it is granted afterwards, only on the tables marked "-- hard-delete" (syncHotelGrants)
  await q(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA "${schema}" GRANT SELECT, INSERT, UPDATE ON TABLES TO "${role}"`);
  await q(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA "${schema}" GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`);
  // the app can become this hotel (SET ROLE) but never inherits its privileges: outside a transaction that did SET ROLE it has none
  await q(`GRANT "${role}" TO ${appRole} WITH INHERIT FALSE, SET TRUE`);
  // the seeds name the two payroll companies after the hotel: the name travels as a setting of this transaction, never as SQL text
  await q("SELECT set_config('hms.hotel_name', $1, true)", [hotelName]);
  const only = { client: deps.owner, platformFiles: [] as MigrationFile[], listHotelSchemas: async () => [schema], skipPlatform: true, insideTransaction: true, searchPathExtra: deps.searchPathExtra };
  await runMigrations({ ...only, kind: "migrations", hotelFiles: deps.hotelMigrations, appliedBy: "create-hotel" });
  await runMigrations({ ...only, kind: "seeds", hotelFiles: deps.hotelSeeds, appliedBy: "create-hotel" });
  await syncHotelGrantsInTransaction(deps.owner, schema, deps.hotelMigrations);
}

/**
 * Approval of a hotel that sent the onboarding form (Platform console P3): its platform.hotels row already exists, in pending_approval with no
 * schema. ONE transaction builds the schema exactly as createHotel does and moves the row to 'active' with provisioned_at (the two CHECKs of
 * migration 0102 require both together). The row is locked first, so two admins approving at once cannot build it twice: the second waits, then finds
 * the hotel is not pending any more (NOT_PENDING). Any failure rolls everything back: no schema, no role, the row still pending.
 */
export async function provisionHotel(deps: CreateHotelDeps, hotelId: string): Promise<CreatedHotel> {
  const appRole = deps.appRole ?? "hms_app";
  const ownerRole = deps.ownerRole ?? "hms_owner";
  if (!ROLE.test(appRole) || !ROLE.test(ownerRole)) throw new CreateHotelError("BAD_INPUT", "A role name is not valid");
  const q = (text: string, params?: readonly unknown[]) => deps.owner.query(text, params);
  let hotel: CreatedHotel | undefined;
  await q("BEGIN");
  try {
    const found = await q("SELECT id, name, schema_name, status, provisioned_at FROM platform.hotels WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [hotelId]);
    const row = found.rows[0];
    if (!row) throw new CreateHotelError("BAD_INPUT", "No such hotel");
    if (row.status !== "pending_approval" || row.provisioned_at !== null) throw new CreateHotelError("NOT_PENDING", "This hotel is not waiting for its schema");
    const schema = await nameHotelSchema(deps.owner, hotelId);
    hotel = { id: String(row.id), schema };
    await buildHotelSchema(deps, hotel.id, schema, String(row.name), appRole, ownerRole);
    await q("UPDATE platform.hotels SET status = 'active', provisioned_at = now() WHERE id = $1", [hotelId]);
    await q("COMMIT");
  } catch (error) {
    try {
      await q("ROLLBACK");
    } catch {
      // the connection is gone; the server rolls the transaction back itself
    }
    if (error instanceof CreateHotelError) throw error;
    if (error instanceof MigrationError) throw new CreateHotelError("MIGRATION_FAILED", `Building the hotel failed while applying its schema (${error.version ?? "?"}, ${error.code}); nothing was kept`, { schema: hotel?.schema, cause: error });
    throw new CreateHotelError("SETUP_FAILED", `Could not build the hotel (SQLSTATE ${sqlStateOf(error) || "unknown"}); nothing was kept`, { cause: error });
  }
  deps.report?.(`Hotel ${hotel.schema} built`);
  return hotel;
}

export async function createHotel(deps: CreateHotelDeps, rawInput: CreateHotelInput): Promise<CreatedHotel> {
  const input = validateHotelInput(rawInput);
  const appRole = deps.appRole ?? "hms_app";
  const ownerRole = deps.ownerRole ?? "hms_owner";
  if (!ROLE.test(appRole) || !ROLE.test(ownerRole)) throw new CreateHotelError("BAD_INPUT", "A role name is not valid");
  const say = deps.report ?? ((): void => undefined);
  const q = (text: string, params?: readonly unknown[]) => deps.owner.query(text, params);

  // ONE transaction: the row, the schema, the role, the grants, every migration and every seed. Any failure rolls all of it back, so a failed
  // create-hotel leaves nothing: no row, no schema, no role (DDL is transactional in PostgreSQL).
  let hotel: CreatedHotel | undefined;
  await q("BEGIN");
  try {
    const inserted = await q("INSERT INTO platform.hotels (name, slug) VALUES ($1, $2) RETURNING id", [input.name, input.slug]);
    const id = String(inserted.rows[0]?.id ?? "");
    if (id === "") throw new CreateHotelError("SETUP_FAILED", "The database did not return the new hotel");
    const schema = await nameHotelSchema(deps.owner, id);
    hotel = { id, schema };
    await buildHotelSchema(deps, id, schema, input.name, appRole, ownerRole);
    // the "Set up your hotel" checklist (migration 0110) is for every new hotel, not only those that came through the onboarding approval
    await q("INSERT INTO platform.hotel_setup (hotel_id) VALUES ($1::uuid) ON CONFLICT (hotel_id) DO NOTHING", [id]);
    await q("INSERT INTO platform.audit_log (action, entity, entity_id, hotel_id, after) VALUES ($1, $2, $3, $3, $4::jsonb)", ["hotel.create", "hotel", id, JSON.stringify({ slug: input.slug })]);
    await q("COMMIT");
  } catch (error) {
    try {
      await q("ROLLBACK");
    } catch {
      // the connection is gone; the server rolls the transaction back itself
    }
    if (error instanceof CreateHotelError) throw error;
    if (sqlStateOf(error) === "23505") throw new CreateHotelError("SLUG_TAKEN", "A hotel with that slug already exists", { cause: error });
    if (error instanceof MigrationError) throw new CreateHotelError("MIGRATION_FAILED", `Creating the hotel failed while applying its schema (${error.version ?? "?"}, ${error.code}); nothing was kept`, { schema: hotel?.schema, cause: error });
    throw new CreateHotelError("SETUP_FAILED", `Could not create the hotel (SQLSTATE ${sqlStateOf(error) || "unknown"}); nothing was kept`, { cause: error });
  }
  say(`Hotel ${hotel.schema} created`);
  return hotel;
}
