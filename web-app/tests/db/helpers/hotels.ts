// Hotels for the database suite: made by the REAL create-hotel on hms_test and removed again at the end. A generic row builder fills every
// required column from the database's own column list, so a test can insert a valid row into any of the 68 tables without knowing its columns.
import path from "node:path";
import { createHotel, type CreatedHotel, type CreateHotelDeps } from "../../../../common/db/scripts/create-hotel";
import { loadMigrationFiles } from "../../../../common/db/scripts/migrate";
import { isHotelSchemaName } from "../../../../common/db/scripts/schema-names";
import type { DbClient } from "../../../../common/db/scripts/pg-db";
import { newId } from "../../../src/server/db/ids";
import { appUrl, connectOwner } from "./realDb";
import { connectPg } from "../../../../common/db/scripts/pg-db";

const root = path.join(__dirname, "..", "..", "..", "..");
export const dbDir = path.join(root, "common", "db");

export const databaseUrl = (): string => appUrl();
export const hotelMigrations = () => loadMigrationFiles(path.join(dbDir, "migrations", "hotel"));
export const hotelSeeds = () => loadMigrationFiles(path.join(dbDir, "seeds", "hotel"));

/** A hotel through the real create-hotel (hms_test). `extra` hooks into the dependencies, for failure injection. */
export async function createTestHotel(owner: DbClient, name = "Test Hotel", extra: Partial<CreateHotelDeps> = {}): Promise<CreatedHotel> {
  const slug = `t-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
  return createHotel({ owner, hotelMigrations: hotelMigrations(), hotelSeeds: hotelSeeds(), ...extra }, { name, slug });
}

/** Removes every hotel of the test platform: schemas, roles, rows (and the insert-only audit rows that point at them: test database only). */
export async function removeAllTestHotels(owner: DbClient): Promise<void> {
  // a hotel's schema is named for the hotel since migration 0172, so the hotels' own list says which schemas and roles are theirs (the old hotel_<hex> pattern still counts)
  const listed = (await owner.query("SELECT schema_name AS s, role_name AS r FROM platform.hotels")).rows;
  const legacy = (await owner.query("SELECT nspname AS s FROM pg_namespace WHERE nspname ~ '^hotel_[0-9a-f]{32}$'")).rows.map((r) => String(r.s));
  const schemas = [...new Set([...legacy, ...listed.map((r) => String(r.s))])].filter((s) => isHotelSchemaName(s));
  // roles belong to the whole server, not to one database: only the roles of THIS database's hotels are dropped (the dev database has its own)
  const roles = [...new Set([...legacy.map((schema) => `${schema}_rw`), ...listed.map((r) => String(r.r))])];
  // the test platform's audit log is insert-only by trigger, so the rows that name test hotels are removed with TRUNCATE (no trigger fires);
  // the platform-console tables (0102-0107) point at hotels with RESTRICT, so they go in the same statement
  await owner.query(
    "TRUNCATE TABLE platform.audit_log, platform.sign_in_removals, platform.auth_events, platform.hotel_deletions, platform.hotel_exports, platform.hotel_status_history, platform.group_history, platform.onboarding_submissions, platform.invitation_links, platform.invitations, platform.hotel_visits, platform.hotel_setup",
  );
  await owner.query("DELETE FROM platform.hotels");
  // groups (0103) outlive their hotels: a test that makes "Group One" must find the name free again on the next run
  await owner.query("DELETE FROM platform.group_members");
  // the one individual hotels group (0157) is a system row: it stays, and is made again when an older run removed it
  await owner.query("DELETE FROM platform.hotel_groups WHERE kind <> 'individual'");
  await owner.query("INSERT INTO platform.hotel_groups (name, slug, status, kind) SELECT 'Individual hotels', 'individual-hotels', 'active', 'individual' WHERE NOT EXISTS (SELECT 1 FROM platform.hotel_groups WHERE kind = 'individual' AND deleted_at IS NULL)");
  for (const schema of schemas) await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  for (const role of roles) {
    await owner.query(`DROP ROLE IF EXISTS "${role}"`);
  }
}

export async function withOwner<T>(fn: (owner: DbClient) => Promise<T>): Promise<T> {
  const owner = await connectOwner();
  try {
    return await fn(owner);
  } finally {
    await owner.end();
  }
}

/** Connects as hms_app (the app's login) and runs `fn`. */
export async function withApp<T>(fn: (app: DbClient) => Promise<T>): Promise<T> {
  const app = await connectPg(appUrl());
  try {
    return await fn(app);
  } finally {
    await app.end();
  }
}

// ---------- a row for any table ----------

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
  generated: boolean;
  length: number | null;
}

interface FkInfo {
  column: string;
  parentTable: string;
}

const tableInfo = new Map<string, { columns: ColumnInfo[]; fks: FkInfo[]; checks: string[] }>();

type Queryable = Pick<DbClient, "query">;

async function infoOf(db: Queryable, schema: string, table: string): Promise<{ columns: ColumnInfo[]; fks: FkInfo[]; checks: string[] }> {
  // the same table has the same shape in every hotel, so what one hotel answered serves all
  const key = table;
  const cached = tableInfo.get(key);
  if (cached) return cached;
  const cols = await db.query(
    "SELECT column_name AS n, data_type AS t, is_nullable AS nl, column_default AS d, is_generated AS g, identity_generation AS i, character_maximum_length AS len FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
    [schema, table],
  );
  const fks = await db.query(
    `SELECT a.attname AS c, cf.relname AS p FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1] JOIN pg_class cf ON cf.oid = c.confrelid
      WHERE c.contype = 'f' AND n.nspname = $1 AND t.relname = $2`,
    [schema, table],
  );
  const checks = await db.query(
    `SELECT pg_get_constraintdef(c.oid) AS c FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'c' AND n.nspname = $1 AND t.relname = $2`,
    [schema, table],
  );
  const info = {
    columns: cols.rows.map((r) => ({
      name: String(r.n),
      type: String(r.t).toLowerCase(),
      nullable: String(r.nl) === "YES",
      hasDefault: r.d !== null && r.d !== undefined,
      generated: String(r.g) === "ALWAYS" || r.i !== null,
      length: r.len === null || r.len === undefined ? null : Number(r.len),
    })),
    fks: fks.rows.map((r) => ({ column: String(r.c), parentTable: String(r.p) })),
    checks: checks.rows.map((r) => String(r.c)),
  };
  tableInfo.set(key, info);
  return info;
}

/** The first allowed value of `col IN ('a', 'b')` in the table's CHECK clauses (PostgreSQL shows it as `= ANY (ARRAY[...])`), when there is one. */
function allowedValue(checks: readonly string[], column: string): string | null {
  for (const clause of checks) {
    const match = new RegExp(`\\(?${column}\\)?(?:::text)? = ANY \\(+ARRAY\\[([^\\]]*)`, "i").exec(clause);
    if (match) {
      const first = /'([^']*)'/.exec(match[1]);
      if (first) return first[1];
    }
  }
  return null;
}

let counter = 0;
const uniq = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Inserts one valid row into `table` of the hotel and returns its column values. Every NOT NULL column without a default gets a value of its
 * type (an allowed one where a CHECK lists the values); a column that references another table gets the id of a row made in that table first.
 * `overrides` wins over everything. The table is named with its schema, so it works as the owner and as the hotel's own role alike.
 */
export async function insertRow(db: Queryable, schema: string, table: string, overrides: Record<string, unknown> = {}, depth = 0): Promise<Record<string, unknown>> {
  if (depth > 6) throw new Error(`too many parents while making a row for ${table}`);
  const info = await infoOf(db, schema, table);
  const row: Record<string, unknown> = {};
  const parentCache = new Map<string, unknown>();
  for (const column of info.columns) {
    if (column.generated) continue;
    if (column.name in overrides) {
      row[column.name] = overrides[column.name];
      continue;
    }
    if (column.name === "id" && column.type === "uuid") {
      row.id = newId();
      continue;
    }
    const fk = info.fks.find((f) => f.column === column.name);
    if (fk && !column.nullable) {
      if (!parentCache.has(fk.parentTable)) {
        const parent = await insertRow(db, schema, fk.parentTable, {}, depth + 1);
        parentCache.set(fk.parentTable, parent.id);
      }
      row[column.name] = parentCache.get(fk.parentTable);
      continue;
    }
    if (column.nullable || column.hasDefault) continue;
    row[column.name] = dummy(column, info.checks);
  }
  const names = Object.keys(row);
  if (names.length === 0) await db.query(`INSERT INTO "${schema}"."${table}" DEFAULT VALUES`);
  else await db.query(`INSERT INTO "${schema}"."${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, names.map((n) => row[n]));
  return row;
}

function dummy(column: ColumnInfo, checks: readonly string[]): unknown {
  const listed = allowedValue(checks, column.name);
  if (listed !== null) return listed;
  switch (column.type) {
    case "uuid":
      return newId();
    case "character varying":
    case "character":
      if (/hash/.test(column.name)) return "a".repeat(64);
      return `${column.name.slice(0, 6)}-${uniq()}`.slice(0, column.length ?? 20);
    case "text":
      return /hash/.test(column.name) ? "a".repeat(64) : "text";
    case "boolean":
      return true;
    case "smallint":
    case "integer":
      return column.name === "entry_no" ? Math.floor(Math.random() * 1e9) + 1 : /^(month|day)$/.test(column.name) ? 1 : /^(year|fiscal_year)$/.test(column.name) ? 2026 : 1;
    case "bigint":
      return column.name === "entry_no" ? Math.floor(Math.random() * 1e9) + 1 : /_paise$/.test(column.name) ? 1000 : 1;
    case "numeric":
      return 1;
    case "date":
      return /^(check_out|ends_on|last_working_date|expected_check_out|effective_to)$/.test(column.name) ? "2026-03-09" : "2026-03-04";
    case "time without time zone":
      return "10:30:00";
    case "timestamp with time zone":
      return /^(departure_at|check_out_at)$/.test(column.name) ? "2026-03-09T10:30:00.000Z" : "2026-03-04T10:30:00.000Z";
    case "jsonb":
      return "{}";
    case "bytea":
      return Buffer.from("x");
    default:
      throw new Error(`no dummy for ${column.type} (${column.name})`);
  }
}
