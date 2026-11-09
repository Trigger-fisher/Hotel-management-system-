// The migration runner. It talks to the database through a MINIMAL client (anything with query(text, params), which
// node-postgres' Client has), so the logic is tested with a fake and needs no driver here.
//
//   platform first, then every hotel schema, in file order. One transaction per file per schema, the version recorded in
//   the same transaction. Applied files are immutable: a changed checksum stops the run before anything is applied.
//   One run at a time (session advisory lock). A failure stops the whole run and names the schema and file (never SQL
//   values). Run again to resume: files already recorded are skipped.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isHotelSchemaName } from "./schema-names";

export interface QueryResult {
  rows: Record<string, unknown>[];
}

export interface MigrationClient {
  query(text: string, params?: readonly unknown[]): Promise<QueryResult>;
}

export interface MigrationFile {
  /** The file name without .sql, for example 0003_users. */
  version: string;
  /** SHA-256 of the file text with line endings normalised to LF. */
  checksum: string;
  sql: string;
  /** False for a file that must run outside a transaction (CREATE INDEX CONCURRENTLY). */
  transactional: boolean;
}

export type MigrationErrorCode =
  | "LOCKED"
  | "CHECKSUM_MISMATCH"
  | "MISSING_FILE"
  | "OUT_OF_ORDER"
  | "BAD_SCHEMA"
  | "MISSING_ROLLBACK"
  | "BAD_FILE_LIST"
  | "FAILED";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly schema?: string;
  readonly version?: string;

  constructor(code: MigrationErrorCode, message: string, where: { schema?: string; version?: string } = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationError";
    this.code = code;
    this.schema = where.schema;
    this.version = where.version;
  }
}

export type MigrationEvent =
  | { event: "plan"; schema: string; pending: readonly string[]; applied: number }
  | { event: "applied"; schema: string; version: string }
  | { event: "failed"; schema: string; version: string; sqlState: string }
  | { event: "note"; message: string };

export type RunKind = "migrations" | "seeds";

export interface RunOptions {
  client: MigrationClient;
  platformFiles: readonly MigrationFile[];
  hotelFiles: readonly MigrationFile[];
  /** The hotel schemas to migrate, asked for AFTER the platform schema is current (it normally reads platform.hotels). */
  listHotelSchemas: () => Promise<readonly string[]>;
  appliedBy?: string;
  /** Print the plan and change nothing (no table is created, no file is run). */
  dryRun?: boolean;
  /** "seeds" applies idempotent seed files, tracked in schema_seeds (header "-- seed:" instead of "-- rollback:"). Default "migrations". */
  kind?: RunKind;
  /** Only the listed hotel schemas: the platform schema is not read, planned or changed (create-hotel migrates one new hotel). */
  skipPlatform?: boolean;
  /** The caller already opened a transaction (create-hotel: the whole hotel is one transaction): files are applied inside it, with no BEGIN or COMMIT of their own. A file that must run outside a transaction is refused. */
  insideTransaction?: boolean;
  /** Added to the search path of every file (a server older than PostgreSQL 18 finds its uuidv7() shim in "public"; see legacyUuidSearchPath). Default: nothing. */
  searchPathExtra?: string;
  /** The schema the first file list goes into. Default "platform". An AI database passes "ai" (its files are migrations/ai, its version table ai.schema_migrations). */
  platformSchema?: string;
  report?: (event: MigrationEvent) => void;
}

export interface RunResult {
  applied: { schema: string; version: string }[];
  plan: { schema: string; pending: string[] }[];
  dryRun: boolean;
}

/** Any number: held for the whole run so two runs cannot overlap. */
export const MIGRATION_LOCK_KEY = 7238190551;

const PLATFORM = "platform";
export const AI_SCHEMA = "ai";
const FILE_NAME = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SEED_LINE = /^-- seed: \S/;
const ROLLBACK_LINE = /^-- rollback: (forward-only because \S.{9,}|(DROP|ALTER|REVOKE|DELETE|UPDATE|TRUNCATE)\b.+)$/i;

// ---------- files ----------

export function checksumOf(text: string): string {
  const normalised = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

export function toMigrationFile(name: string, text: string): MigrationFile {
  const version = name.replace(/\.sql$/i, "");
  const header = text.split(/\r?\n/).slice(0, 8);
  return {
    version,
    checksum: checksumOf(text),
    sql: text.replace(/^﻿/, ""),
    transactional: !header.some((line) => line.trim() === "-- migrate: no-transaction"),
  };
}

export function loadMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort()
    .map((name) => toMigrationFile(name, readFileSync(path.join(dir, name), "utf8")));
}

function checkFileList(label: string, files: readonly MigrationFile[], kind: RunKind): void {
  const seen = new Set<string>();
  let previous = "";
  for (const file of files) {
    if (!FILE_NAME.test(file.version)) throw new MigrationError("BAD_FILE_LIST", `${label}: "${file.version}" is not a valid migration name`, { version: file.version });
    if (seen.has(file.version) || file.version.slice(0, 4) === previous.slice(0, 4)) {
      throw new MigrationError("BAD_FILE_LIST", `${label}: number ${file.version.slice(0, 4)} is used twice`, { version: file.version });
    }
    if (file.version < previous) throw new MigrationError("BAD_FILE_LIST", `${label}: files are not in order at ${file.version}`, { version: file.version });
    const first = file.sql.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
    if (kind === "seeds") {
      if (!SEED_LINE.test(first.trim())) throw new MigrationError("MISSING_ROLLBACK", `${label}: ${file.version} has no "-- seed:" first line`, { version: file.version });
    } else if (!ROLLBACK_LINE.test(first.trim())) {
      throw new MigrationError("MISSING_ROLLBACK", `${label}: ${file.version} has no "-- rollback:" first line`, { version: file.version });
    }
    seen.add(file.version);
    previous = file.version;
  }
}

// ---------- version table (the same text as platform 0000_foundation.sql) ----------

export function versionTableSql(schema: string, table = "schema_migrations"): string {
  return `CREATE TABLE IF NOT EXISTS "${schema}".${table} (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[0-9]{4}_[a-z0-9_]+$'),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_by text NOT NULL DEFAULT current_user,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;
}

function assertMigratable(schema: string): void {
  if (schema !== PLATFORM && schema !== AI_SCHEMA && !isHotelSchemaName(schema)) {
    throw new MigrationError("BAD_SCHEMA", "A schema name is not platform or a safe hotel schema name; refusing to touch it", { schema: "(invalid)" });
  }
}

// ---------- the run ----------

interface Plan {
  schema: string;
  files: readonly MigrationFile[];
  pending: MigrationFile[];
  applied: number;
}

const sqlStateOf = (error: unknown): string => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown";
};

/** "public" when the server has no built-in uuidv7() (before PostgreSQL 18: the shim made by setup --hosted lives in public), else an empty string. */
export async function legacyUuidSearchPath(client: MigrationClient): Promise<string> {
  const rows = (await client.query("SELECT to_regprocedure('pg_catalog.uuidv7()') IS NULL AS missing")).rows;
  return rows[0]?.missing === true ? "public" : "";
}

export async function runMigrations(options: RunOptions): Promise<RunResult> {
  const { client, dryRun = false } = options;
  const MAIN = options.platformSchema ?? PLATFORM;
  if (MAIN !== PLATFORM && MAIN !== AI_SCHEMA) throw new MigrationError("BAD_SCHEMA", "platformSchema must be platform or ai", { schema: "(invalid)" });
  const report = options.report ?? ((): void => undefined);
  const appliedBy = options.appliedBy ?? "migrate";
  const kind = options.kind ?? "migrations";
  const versionTable = kind === "seeds" ? "schema_seeds" : "schema_migrations";
  checkFileList("platform", options.platformFiles, kind);
  checkFileList("hotel", options.hotelFiles, kind);

  const query = (text: string, params?: readonly unknown[]): Promise<QueryResult> => client.query(text, params);

  // create-hotel (insideTransaction) touches only its own brand-new schema, so two of them may run at once and need no run-wide lock
  if (!options.insideTransaction) {
    const locked = await query("SELECT pg_try_advisory_lock($1) AS locked", [MIGRATION_LOCK_KEY]);
    if (locked.rows[0]?.locked !== true) {
      throw new MigrationError("LOCKED", "Another migration run is in progress; try again when it has finished");
    }
  }

  const result: RunResult = { applied: [], plan: [], dryRun };
  try {
    // 1. platform: check, then apply (unless the caller migrates a single new hotel)
    if (!options.skipPlatform) {
      const platformPlan = await planFor(MAIN, options.platformFiles);
      result.plan.push({ schema: MAIN, pending: platformPlan.pending.map((f) => f.version) });
      report({ event: "plan", schema: MAIN, pending: platformPlan.pending.map((f) => f.version), applied: platformPlan.applied });

      if (dryRun && platformPlan.pending.length > 0) {
        report({ event: "note", message: "Hotel schemas are listed after the platform schema is migrated; they are not planned in a dry run." });
        return result;
      }
      if (!dryRun) await applyPlan(platformPlan);
    }

    // 2. every hotel schema: check them ALL first, so a bad checksum in hotel 7 cannot leave hotels 1-6 migrated
    const schemas = [...new Set(await options.listHotelSchemas())];
    for (const schema of schemas) {
      // the hotel list may hold hotel schemas only: never platform, never anything else
      if (!isHotelSchemaName(schema)) throw new MigrationError("BAD_SCHEMA", "The hotel list holds a name that is not a safe hotel schema name; refusing to touch it", { schema: "(invalid)" });
    }
    const hotelPlans: Plan[] = [];
    for (const schema of schemas) hotelPlans.push(await planFor(schema, options.hotelFiles));
    for (const plan of hotelPlans) {
      result.plan.push({ schema: plan.schema, pending: plan.pending.map((f) => f.version) });
      report({ event: "plan", schema: plan.schema, pending: plan.pending.map((f) => f.version), applied: plan.applied });
    }

    // 3. apply, one hotel at a time, stopping at the first failure
    if (!dryRun) for (const plan of hotelPlans) await applyPlan(plan);
    return result;
  } finally {
    try {
      if (!options.insideTransaction) await query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } catch {
      // the lock is released when the session ends anyway; do not hide the real error
    }
  }

  async function planFor(schema: string, files: readonly MigrationFile[]): Promise<Plan> {
    assertMigratable(schema);
    const exists = await query("SELECT 1 AS present FROM information_schema.schemata WHERE schema_name = $1", [schema]);
    if (exists.rows.length === 0 && schema !== PLATFORM && schema !== AI_SCHEMA) {
      throw new MigrationError("BAD_SCHEMA", `Schema ${schema} does not exist; create-hotel makes it`, { schema });
    }
    let appliedRows: Record<string, unknown>[] = [];
    if (dryRun) {
      const table = await query("SELECT to_regclass($1) AS found", [`"${schema}".${versionTable}`]);
      if (table.rows[0]?.found !== null && table.rows[0]?.found !== undefined) appliedRows = (await query(`SELECT version, checksum FROM "${schema}".${versionTable} ORDER BY version`)).rows;
    } else {
      if (schema === PLATFORM || schema === AI_SCHEMA) await query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await query(versionTableSql(schema, versionTable));
      appliedRows = (await query(`SELECT version, checksum FROM "${schema}".${versionTable} ORDER BY version`)).rows;
    }

    const byVersion = new Map(files.map((f) => [f.version, f]));
    const appliedVersions = new Set<string>();
    for (const row of appliedRows) {
      const version = String(row.version);
      const file = byVersion.get(version);
      if (!file) throw new MigrationError("MISSING_FILE", `${version} is recorded as applied in ${schema} but its file is gone`, { schema, version });
      if (file.checksum !== String(row.checksum)) {
        throw new MigrationError("CHECKSUM_MISMATCH", `${version} was changed after it was applied in ${schema}; applied files are immutable. Add a new migration instead.`, { schema, version });
      }
      appliedVersions.add(version);
    }
    const pending = files.filter((f) => !appliedVersions.has(f.version));
    const newestApplied = [...appliedVersions].sort().pop() ?? "";
    const behind = pending.find((f) => f.version < newestApplied);
    if (behind) {
      throw new MigrationError("OUT_OF_ORDER", `${behind.version} is new but ${newestApplied} is already applied in ${schema}; a migration cannot be inserted behind applied ones`, { schema, version: behind.version });
    }
    return { schema, files, pending, applied: appliedVersions.size };
  }

  async function applyPlan(plan: Plan): Promise<void> {
    for (const file of plan.pending) {
      try {
        await applyFile(plan.schema, file);
      } catch (error) {
        const sqlState = sqlStateOf(error);
        report({ event: "failed", schema: plan.schema, version: file.version, sqlState });
        // The message names where it failed and the SQLSTATE only: a driver message can carry row values.
        throw new MigrationError("FAILED", `Migration ${file.version} failed in ${plan.schema} (SQLSTATE ${sqlState}); nothing from this file was kept`, { schema: plan.schema, version: file.version }, { cause: error });
      }
      result.applied.push({ schema: plan.schema, version: file.version });
      report({ event: "applied", schema: plan.schema, version: file.version });
    }
  }

  async function applyFile(schema: string, file: MigrationFile): Promise<void> {
    const searchPath = options.searchPathExtra ? `${schema}, pg_catalog, ${options.searchPathExtra}` : `${schema}, pg_catalog`;
    const record = `INSERT INTO "${schema}".${versionTable} (version, checksum, applied_by) VALUES ($1, $2, $3)`;
    if (options.insideTransaction) {
      if (!file.transactional) throw new MigrationError("BAD_FILE_LIST", `${file.version} must run outside a transaction and cannot be part of create-hotel`, { schema, version: file.version });
      await query("SELECT set_config('search_path', $1, true)", [searchPath]);
      await query(file.sql);
      await query(record, [file.version, file.checksum, appliedBy]);
      return;
    }
    if (!file.transactional) {
      await query("SELECT set_config('search_path', $1, false)", [searchPath]);
      try {
        await query(file.sql);
        await query(record, [file.version, file.checksum, appliedBy]);
      } finally {
        await query("RESET search_path");
      }
      return;
    }
    await query("BEGIN");
    try {
      await query("SELECT set_config('search_path', $1, true)", [searchPath]);
      await query(file.sql);
      await query(record, [file.version, file.checksum, appliedBy]);
      await query("COMMIT");
    } catch (error) {
      try {
        await query("ROLLBACK");
      } catch {
        // the connection is broken; the original error is the one that matters
      }
      throw error;
    }
  }
}
