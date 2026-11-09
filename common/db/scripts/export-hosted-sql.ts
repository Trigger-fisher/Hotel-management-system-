// export-hosted-sql: the same database as `setup --hosted` + `migrate` + `seed` + `create-hotel`, but as numbered SQL files a person can paste, one
// after the other, into a hosted SQL editor (for example Supabase's SQL Editor) or run with psql. NOTHING here is hand-written SQL for the schema: every table comes
// from the real migration and seed files (db/migrations, db/seeds), their checksums are the ones `migrate` computes, and the tracking rows are
// written in the same transaction as each file, so a later `db:cli migrate` sees every file as applied and changes nothing.
//
//   part 00   as the console role: the two roles and their settings, grants, the extensions (no passwords: they are set in the host's console)
//   parts     as hms_owner (SET ROLE), each part one transaction: platform migrations, platform seeds, ONE demo hotel (row, schema, its login-less role,
//             grants, every hotel migration, the hotel seed, DELETE rights), each file's tracking row beside it
//   README.md the order, what to see after each part, the expected counts
// No account and no password is in any file: accounts are made with `db:cli create-user` (an Argon2 hash is made on the computer, never in SQL).
// A part never splits a migration file: files are grouped until a part would pass MAX_PART_BYTES (a single file over the limit stops the export).
import { randomBytes } from "node:crypto";
import { hardDeleteTables } from "./create-hotel";
import { versionTableSql, type MigrationFile } from "./migrate";

export const MAX_PART_BYTES = 150_000;
export const APPLIED_BY = "export-hosted-sql";
const OWNER = "hms_owner";
const APP = "hms_app";

export interface HostedSqlInput {
  platformMigrations: readonly MigrationFile[];
  platformSeeds: readonly MigrationFile[];
  hotelMigrations: readonly MigrationFile[];
  hotelSeeds: readonly MigrationFile[];
  hotelName: string;
  hotelSlug: string;
  /** The demo hotel's id (a uuid): its schema is hotel_<the 32 hex>. Default: a fresh time-ordered one. */
  hotelId?: string;
  /** Table counts of a real build, printed in the README as the expected counts (db/hosted-sql-reference.json). */
  reference?: { platformTables: number; hotelTables: number };
  /** For a reproducible file set in tests. */
  now?: Date;
}

export interface HostedSqlFile {
  name: string;
  text: string;
}

/** A time-ordered uuid (version 7, RFC 9562) for the demo hotel's id. */
export function uuidv7(now: Date = new Date(), random: Buffer = randomBytes(10)): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(now.getTime(), 0, 6);
  random.copy(bytes, 6, 0, 10);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const lf = (text: string): string => text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";

interface Unit {
  /** A short label for the header ("platform 0000_foundation"). */
  label: string;
  /** The statements of the unit. */
  sql: string;
}

interface Part {
  title: string;
  does: string[];
  units: Unit[];
  /** SQL run after COMMIT (still as hms_owner), whose last result is what the person looks at. */
  verify: string;
  expect: string;
  /** Statements first inside the transaction: the guard that stops a part that already ran. */
  guard: string;
}

function migrationUnit(schema: string, file: MigrationFile, table: "schema_migrations" | "schema_seeds"): Unit {
  const record = `INSERT INTO "${schema}".${table} (version, checksum, applied_by) VALUES (${lit(file.version)}, ${lit(file.checksum)}, ${lit(APPLIED_BY)});`;
  return {
    label: `${schema === "platform" ? "platform" : "hotel"} ${table === "schema_seeds" ? "seed " : ""}${file.version}`,
    sql: `-- ---- ${schema === "platform" ? "platform" : "hotel"} ${table === "schema_seeds" ? "seed " : ""}${file.version} (checksum ${file.checksum.slice(0, 12)}...) ----\nSELECT set_config('search_path', ${lit(`${schema}, pg_catalog`)}, true);\n${lf(file.sql)}${record}\n`,
  };
}

function guardFor(schema: string, table: string, versions: readonly string[], requires?: string): string {
  return `DO $guard$
DECLARE n integer := 0;
BEGIN
${requires ? `  IF to_regclass(${lit(requires)}) IS NULL THEN
    RAISE EXCEPTION 'An earlier part has not been run yet (${requires} is missing): run the parts in order';
  END IF;\n` : ""}  IF to_regclass(${lit(`"${schema}".${table}`)}) IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "${schema}".${table} WHERE version = ANY ($1)' INTO n USING ARRAY[${versions.map(lit).join(", ")}]::text[];
  END IF;
  IF n > 0 THEN
    RAISE EXCEPTION 'This part (or part of it) is already applied in ${schema}: do not run it again; carry on with the next part';
  END IF;
END $guard$;\n`;
}
/** Whole files grouped in order until the next one would take the part over the limit. */
function groups(units: readonly Unit[], leadBytes: number): Unit[][] {
  const out: Unit[][] = [];
  let current: Unit[] = [];
  let size = leadBytes;
  for (const unit of units) {
    const bytes = Buffer.byteLength(unit.sql, "utf8");
    if (bytes + leadBytes > MAX_PART_BYTES) throw new Error(`${unit.label} alone is over ${MAX_PART_BYTES} bytes: this export cannot split a migration file`);
    if (current.length > 0 && size + bytes > MAX_PART_BYTES) {
      out.push(current);
      current = [];
      size = leadBytes;
    }
    current.push(unit);
    size += bytes;
  }
  if (current.length > 0) out.push(current);
  return out;
}

const countQuery = (schema: string, table: string): string => `SELECT ${lit(`${schema}.${table}`)} AS tracking_table, count(*) AS rows, max(version) AS newest FROM "${schema}".${table}`;

export function buildHostedSql(input: HostedSqlInput): HostedSqlFile[] {
  const hotelId = input.hotelId ?? uuidv7(input.now);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(hotelId)) throw new Error("The hotel id is not a uuid");
  const schema = `hotel_${hotelId.replace(/-/g, "")}`;
  const role = `${schema}_rw`;
  const parts: Part[] = [];
  const table = (schema: string, kind: "schema_migrations" | "schema_seeds") => `"${schema}".${kind}`;

  // ---- platform migrations ----
  const platformUnits = input.platformMigrations.map((f) => migrationUnit("platform", f, "schema_migrations"));
  groups(platformUnits, 2000).forEach((units, i, all) => {
    const versions = units.map((u) => u.label.replace("platform ", ""));
    parts.push({
      title: `Platform migrations ${versions[0].slice(0, 4)}${versions.length > 1 ? ` to ${versions[versions.length - 1].slice(0, 4)}` : ""}`,
      does: [`creates the platform tables, functions and grants (${versions.length} migration file${versions.length === 1 ? "" : "s"}) and records them in platform.schema_migrations`],
      units: [...(i === 0 ? [{ label: "platform bookkeeping", sql: `CREATE SCHEMA IF NOT EXISTS platform;\n${versionTableSql("platform")};\n` }] : []), ...units],
      guard: guardFor("platform", "schema_migrations", versions),
      verify: countQuery("platform", "schema_migrations"),
      expect: `rows = ${input.platformMigrations.findIndex((f) => f.version === versions[versions.length - 1]) + 1}, newest = ${versions[versions.length - 1]}${i === all.length - 1 ? "" : " (more platform parts follow)"}`,
    });
  });

  // ---- platform seeds ----
  const seedUnits = input.platformSeeds.map((f) => migrationUnit("platform", f, "schema_seeds"));
  if (seedUnits.length > 0) {
    const versions = input.platformSeeds.map((f) => f.version);
    parts.push({
      title: "Platform seeds",
      does: ["fills the permission and role lists the app needs, and records them in platform.schema_seeds"],
      units: [{ label: "seed bookkeeping", sql: `${versionTableSql("platform", "schema_seeds")};\n` }, ...seedUnits],
      guard: guardFor("platform", "schema_seeds", versions),
      verify: countQuery("platform", "schema_seeds"),
      expect: `rows = ${versions.length}, newest = ${versions[versions.length - 1]}`,
    });
  }

  // ---- the demo hotel ----
  const hotelUnits = input.hotelMigrations.map((f) => migrationUnit(schema, f, "schema_migrations"));
  const create: Unit = {
    label: "hotel row, schema and role",
    sql: `-- ---- the hotel: its platform row, its schema, its login-less role and the grants (what create-hotel does) ----
INSERT INTO platform.hotels (id, name, slug) VALUES (${lit(hotelId)}, ${lit(input.hotelName)}, ${lit(input.hotelSlug)});
CREATE SCHEMA "${schema}";
CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA "${schema}" TO "${role}";
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA "${schema}" GRANT SELECT, INSERT, UPDATE ON TABLES TO "${role}";
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA "${schema}" GRANT USAGE, SELECT ON SEQUENCES TO "${role}";
GRANT "${role}" TO ${APP} WITH INHERIT FALSE, SET TRUE;
${versionTableSql(schema)};
${versionTableSql(schema, "schema_seeds")};
`,
  };
  const nameSetting: Unit = { label: "hotel name setting", sql: `SELECT set_config('hms.hotel_name', ${lit(input.hotelName)}, true);\n` };
  const hotelGroups = groups(hotelUnits, 2500 + Buffer.byteLength(create.sql, "utf8"));
  hotelGroups.forEach((units, i, all) => {
    const versions = units.map((u) => u.label.replace("hotel ", ""));
    const done = input.hotelMigrations.findIndex((f) => f.version === versions[versions.length - 1]) + 1;
    parts.push({
      title: `Hotel "${input.hotelName}" ${i === 0 ? "(creation and " : "("}migrations ${versions[0].slice(0, 4)}${versions.length > 1 ? ` to ${versions[versions.length - 1].slice(0, 4)}` : ""})`,
      does: [...(i === 0 ? [`creates the hotel row, the schema ${schema} and its role ${role}`] : []), `applies ${versions.length} hotel migration file${versions.length === 1 ? "" : "s"} to ${schema}`],
      units: [...(i === 0 ? [create] : []), nameSetting, ...units],
      guard: i === 0
        ? `DO $guard$
DECLARE n integer := 0;
BEGIN
  IF to_regclass('platform.hotels') IS NULL THEN
    RAISE EXCEPTION 'An earlier part has not been run yet (platform.hotels is missing): run the parts in order';
  END IF;
  EXECUTE 'SELECT count(*) FROM platform.hotels WHERE id = $1 OR slug = $2' INTO n USING ${lit(hotelId)}::uuid, ${lit(input.hotelSlug)};
  IF n > 0 OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${lit(schema)}) THEN
    RAISE EXCEPTION 'The demo hotel already exists: do not run this part again; carry on with the next part';
  END IF;
END $guard$;\n`
        : guardFor(schema, "schema_migrations", versions, `"${schema}".schema_migrations`),
      verify: countQuery(schema, "schema_migrations"),
      expect: `rows = ${done}, newest = ${versions[versions.length - 1]}${i === all.length - 1 ? "" : " (more hotel parts follow)"}`,
    });
  });

  const hotelSeedUnits = input.hotelSeeds.map((f) => migrationUnit(schema, f, "schema_seeds"));
  if (hotelSeedUnits.length > 0) {
    const versions = input.hotelSeeds.map((f) => f.version);
    parts.push({
      title: `Hotel seed`,
      does: ["fills the hotel's default lists (shifts, expense heads and so on) and records the seed"],
      units: [nameSetting, ...hotelSeedUnits],
      guard: guardFor(schema, "schema_seeds", versions, `"${schema}".schema_seeds`),
      verify: countQuery(schema, "schema_seeds"),
      expect: `rows = ${versions.length}, newest = ${versions[versions.length - 1]}`,
    });
  }

  const deleteTables = hardDeleteTables(input.hotelMigrations);
  parts.push({
    title: `Hotel rights and audit row`,
    does: ["takes DELETE away from the hotel's role except on the recycle-bin tables, hides the bookkeeping tables from it, and writes the audit row"],
    units: [
      {
        label: "hotel grants",
        sql: `REVOKE DELETE ON ALL TABLES IN SCHEMA "${schema}" FROM "${role}";
REVOKE ALL ON ${table(schema, "schema_migrations")}, ${table(schema, "schema_seeds")} FROM "${role}";
${deleteTables.map((t) => `GRANT DELETE ON "${schema}"."${t}" TO "${role}";`).join("\n")}
INSERT INTO platform.hotel_setup (hotel_id) VALUES (${lit(hotelId)}::uuid) ON CONFLICT (hotel_id) DO NOTHING;
INSERT INTO platform.audit_log (action, entity, entity_id, hotel_id, after) VALUES ('hotel.create', 'hotel', ${lit(hotelId)}, ${lit(hotelId)}, ${lit(JSON.stringify({ slug: input.hotelSlug }))}::jsonb);
`,
      },
    ],
    guard: `DO $guard$
DECLARE n integer := 0;
BEGIN
  IF to_regclass(${lit(`"${schema}".schema_seeds`)}) IS NULL THEN
    RAISE EXCEPTION 'An earlier part has not been run yet (the hotel schema is missing): run the parts in order';
  END IF;
  EXECUTE 'SELECT count(*) FROM platform.audit_log WHERE action = ''hotel.create'' AND entity_id = $1' INTO n USING ${lit(hotelId)}::uuid;
  IF n > 0 THEN
    RAISE EXCEPTION 'This part is already applied: do not run it again; the export is finished';
  END IF;
END $guard$;\n`,
    verify: `SELECT ${lit(schema)} AS hotel_schema, (SELECT count(*) FROM pg_tables WHERE schemaname = ${lit(schema)}) AS tables, (SELECT count(*) FROM platform.audit_log WHERE action = 'hotel.create' AND entity_id = ${lit(hotelId)}) AS audit_rows`,
    expect: `tables = ${input.reference?.hotelTables ?? "(see README)"}, audit_rows = 1`,
  });

  // ---- files ----
  const total = parts.length + 1;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const files: HostedSqlFile[] = [];
  files.push({ name: "part-00-setup.sql", text: setupPart(total) });
  parts.forEach((part, i) => {
    const n = i + 1;
    const header = `-- HMS hosted SQL, part ${pad(n)} of ${pad(total - 1)}: ${part.title}
-- Run as: ${OWNER} (the first line does SET ROLE; the console role may, part 00 allowed it). Paste the WHOLE file and run it once.
-- What it does: ${part.does.join("; ")}.
-- It is ONE transaction: if anything fails nothing from this part is kept, and you may run it again after fixing the cause.
--   If it says "already applied", it ran before: skip it.
-- How to see it worked: the last result (a small table) must show  ${part.expect}.
-- Generated from the migration files of this commit by  npm run db:cli -- export-hosted-sql  (never edit by hand).
`;
    const body = `SET ROLE ${OWNER};\nBEGIN;\n${part.guard}${part.units.map((u) => u.sql).join("\n")}COMMIT;\n${part.verify};\nRESET ROLE;\n`;
    files.push({ name: `part-${pad(n)}-${slug(part.title)}.sql`, text: header + "\n" + body });
  });
  files.push({ name: "README.md", text: readme(files, parts, schema, input) });
  for (const f of files.filter((x) => x.name.endsWith(".sql"))) {
    const bytes = Buffer.byteLength(f.text, "utf8");
    if (bytes > MAX_PART_BYTES + 6000) throw new Error(`${f.name} is ${bytes} bytes, over the part limit`);
  }
  return files;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function setupPart(total: number): string {
  return `-- HMS hosted SQL, part 00 of ${String(total - 1).padStart(2, "0")}: roles, grants and extensions
-- Run as: the console role (the one the host made with the project, for example the postgres role of a Supabase project), in the database that will hold HMS. No SET ROLE here.
-- What it does: makes the roles ${OWNER} (makes the hotels' roles; owns every table) and ${APP} (the web app: no rights of its own) with ${APP}'s time limits,
--   lets the console role act as ${OWNER}, lets ${OWNER} create schemas in this database, closes the public schema, makes the extensions citext and pg_trgm.
-- NO PASSWORD is set here (a password typed into an editor is kept in its history): give both roles a password in the host's console afterwards
--   (Supabase: Database > Roles, or the project's database password reset) or with  ALTER ROLE ${APP} PASSWORD '...'  in a place that keeps no history.
-- It is safe to run again (it only adds what is missing).
-- How to see it worked: the last result lists the three roles below with rolsuper = false.
-- Generated by  npm run db:cli -- export-hosted-sql  (never edit by hand).

DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER}') THEN
    CREATE ROLE ${OWNER} LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP}') THEN
    CREATE ROLE ${APP} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$setup$;

ALTER ROLE ${APP} SET statement_timeout = '15s';
ALTER ROLE ${APP} SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE ${APP} SET lock_timeout = '5s';
ALTER ROLE ${APP} SET timezone = 'UTC';
ALTER ROLE ${OWNER} SET timezone = 'UTC';

GRANT ${OWNER} TO CURRENT_USER WITH SET TRUE;

DO $db$
BEGIN
  EXECUTE format('GRANT CREATE, CONNECT ON DATABASE %I TO ${OWNER}', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${APP}', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$db$;

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM ${APP};
GRANT USAGE ON SCHEMA public TO ${OWNER}, ${APP};

ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} REVOKE ALL ON TABLES FROM ${APP};
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} REVOKE ALL ON SEQUENCES FROM ${APP};
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} REVOKE ALL ON FUNCTIONS FROM ${APP};

SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin FROM pg_roles WHERE rolname IN ('${OWNER}', '${APP}', current_user) ORDER BY rolname;
`;
}

function readme(files: readonly HostedSqlFile[], parts: readonly Part[], schema: string, input: HostedSqlInput): string {
  const rows = files.filter((f) => f.name.endsWith(".sql"));
  const ref = input.reference;
  return `# HMS hosted SQL parts (generated; do not edit)

Generated by \`npm run db:cli -- export-hosted-sql\` from the migration and seed files of ONE commit of this repository. **It must be generated from the same commit as the app you deploy**: a later commit may add a migration that these parts do not contain (\`npm run db:cli -- migrate\` then adds it).

An alternative to \`setup --hosted\` + \`migrate\` + \`seed\` + \`create-hotel\` (docs/deploy/SUPABASE-MOVE-2026-10-18.md); the result is the same database, and \`db:cli migrate\` afterwards says nothing is pending.

## Order (run each file completely, in this order)

| # | File | What the last result must show |
|---|---|---|
| 00 | ${rows[0].name} | three roles, \`rolsuper\` false |
${parts.map((p, i) => `| ${String(i + 1).padStart(2, "0")} | ${rows[i + 1].name} | ${p.expect} |`).join("\n")}

Part 00 runs as the console role; every other part starts with \`SET ROLE hms_owner;\` and ends with \`RESET ROLE;\`. Each part is one transaction. A part that failed kept nothing: fix the cause and run it again. A part that says "already applied" ran before: skip it.

## After the last part: expected counts

\`\`\`sql
SELECT 'platform.schema_migrations' AS what, count(*)::text AS value FROM platform.schema_migrations
UNION ALL SELECT 'platform.schema_seeds', count(*)::text FROM platform.schema_seeds
UNION ALL SELECT '${schema}.schema_migrations', count(*)::text FROM "${schema}".schema_migrations
UNION ALL SELECT '${schema}.schema_seeds', count(*)::text FROM "${schema}".schema_seeds
UNION ALL SELECT 'tables in platform', count(*)::text FROM pg_tables WHERE schemaname = 'platform'
UNION ALL SELECT 'tables in the hotel schema', count(*)::text FROM pg_tables WHERE schemaname = '${schema}'
UNION ALL SELECT 'hotels', count(*)::text FROM platform.hotels;
\`\`\`

Expected: platform.schema_migrations **${input.platformMigrations.length}**, platform.schema_seeds **${input.platformSeeds.length}**, hotel schema_migrations **${input.hotelMigrations.length}**, hotel schema_seeds **${input.hotelSeeds.length}**, tables in platform **${ref ? ref.platformTables : "(not recorded)"}**, tables in the hotel schema **${ref ? ref.hotelTables : "(not recorded)"}** (the tracking tables are included), hotels **1**.

The demo hotel is "${input.hotelName}" (slug \`${input.hotelSlug}\`), schema \`${schema}\`. There are NO accounts: make them with \`npm run db:cli -- create-user\` (docs/deploy/SUPABASE-MOVE-2026-10-18.md).
`;
}
