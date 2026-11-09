// Schema lint: reads migration/seed SQL as TEXT (no database) and fails on the mistakes the standard forbids.
//   Run on its own:   npx tsx db/scripts/lint-sql.ts      (from "web-app": npx tsx ../db/scripts/lint-sql.ts)
//   Run on every build: tests/server/sql-lint.test.ts lints db/migrations/{platform,hotel} and db/seeds/{platform,hotel}.
//
// Migration rules (each violation names its rule):
//   rollback           the first line is "-- rollback: <statements>" or "-- rollback: forward-only because <reason>"
//   file-name          NNNN_snake_name.sql, numbers unique and ascending
//   uuid-pk            every table has "id uuid PRIMARY KEY"
//   timestamps         every table has created_at + updated_at (timestamptz NOT NULL), unless the statement is
//                      preceded by a "-- append-only" comment, then it needs an "at" / "*_at" timestamptz NOT NULL column
//   updated-at-trigger a table with updated_at has a touch_updated_at trigger in the same file
//   fk-index           every foreign key column is the first column of a PRIMARY KEY, UNIQUE or full (non-partial) index
//   types              no float/real/double/money/serial, no timestamp without time zone
//   money              a column ending _paise is bigint; a money-looking name (amount, price, total, ...) must end _paise
//   status-check       a text column called status/kind/level/purpose/outcome/event/client has a CHECK
//   qualified-name     platform tables are written platform.<name>; hotel tables are unqualified (search_path decides)
//   drop-if-exists     DROP statements use IF EXISTS (a hotel migration may DROP INDEX / DROP TRIGGER outright to replace what an earlier one made)
//   unverifiable       a foreign key added with ALTER TABLE ... ADD COLUMN ... REFERENCES cannot be checked: use CREATE TABLE
//                      or ALTER TABLE ... ADD [CONSTRAINT x] FOREIGN KEY (col) REFERENCES t, which is checked against every
//                      index declared anywhere in the folder (fk-index)
//   standard-columns   a table that must not carry the standard id/created_at/updated_at/legacy_id (a counter table keyed by
//                      its natural key) says so with a comment directly above it: -- no-standard-columns: <reason>
//   append-only-fk     an "-- append-only" table has no ON DELETE SET NULL / CASCADE / SET DEFAULT foreign key (its trigger
//                      would turn that UPDATE/DELETE into an error); use RESTRICT and soft-delete the parent
//   grants             platform: every table appears in a GRANT in some file, or carries "-- no-app-access"
//   grants-own-file    platform: a table created in a file numbered 0100 or higher is granted in that same file
//   legacy-id          hotel: every table (except the version tables) has legacy_id bigint + a partial UNIQUE index
//                      WHERE legacy_id IS NOT NULL (the Pallav import is idempotent by it)
//   hotel-grants       hotel: no GRANT, REVOKE or ALTER DEFAULT PRIVILEGES at all. Privileges on a hotel schema belong to that hotel's
//                      own role hotel_<hex>_rw and are set by create-hotel; the app role hms_app must hold none (it only SETs ROLE)
//   no-encryption      no column named *_enc, *_index (blind index), *_cipher, *_sealed or *blind*: Pallav keeps its numbers in plain text and HMS does not
//                      encrypt fields (MJ), so nothing may be shaped for ciphertext or a blind index. The one decided exception is the hotel's Pathik
//                      account password, hotel_.pathik_settings.password_encrypted (PLAN-PATHIK decision 2; BACKEND.md section 5), and (decision 74) the sealed ID-number
//                      columns listed in SEALED_NUMBER_COLUMNS below
//   version-trigger    hotel: a table with a version column has a BEFORE UPDATE trigger running enforce_version_step()
//   hard-delete        hotel: `-- hard-delete: Pallav <file>:<line>` or `-- hard-delete: purge job <name>` marks a table the hotel role may DELETE from (every recycle-bin table must carry it)
//   soft-delete        hotel: the tables Pallav soft-deletes have deleted_at timestamptz and deleted_by uuid
// Seed rules (kind "seed"):
//   seed-header        the first line is "-- seed: <what it seeds>"
//   seed-statement     only INSERT ... ON CONFLICT statements (idempotent); no DDL, UPDATE, DELETE, TRUNCATE or GRANT
//   seed-secret        no password hash, private key or token literal
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface SqlFile {
  name: string;
  text: string;
}

export interface Violation {
  file: string;
  rule: string;
  message: string;
}

export type Scope = "platform" | "hotel";
export type Kind = "migration" | "seed";

/** The tables Pallav soft-deletes (its RecycleBin::MODELS), by hotel table name. */
export const HOTEL_SOFT_DELETE_TABLES: readonly string[] = [
  "employees",
  "shift_handovers",
  "bill_master_bills",
  "bill_master_advances",
  "company_profiles",
  "hotel_cash_deposits",
  "food_cash_deposits",
  "hotel_cash_withdrawals",
  "food_cash_withdrawals",
  "hotel_misc_expenses",
  "food_misc_expenses",
  "bonus_incentives",
  "payroll_advances",
  "employee_separations",
  "employee_meal_periods",
];

/** Hotel tables that are not Pallav data (no legacy_id): the version tables and the idempotency keys. */
const HOTEL_VERSION_TABLES = new Set(["schema_migrations", "schema_seeds", "idempotency_keys"]);

interface Statement {
  code: string;
  leadingComments: string[];
}

// ---------- tokenising: comments, quotes and $$ bodies never confuse the rules ----------

function splitStatements(text: string): Statement[] {
  const statements: Statement[] = [];
  let code = "";
  let comments: string[] = [];
  let i = 0;
  const flush = (): void => {
    if (code.trim() !== "") statements.push({ code: code.trim(), leadingComments: comments });
    if (code.trim() !== "" || comments.length > 0) comments = [];
    code = "";
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      if (code.trim() === "") comments.push(text.slice(i + 2, stop).trim());
      code += " ";
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      if (code.trim() === "") comments.push(text.slice(i + 2, Math.max(i + 2, stop - 2)).trim());
      code += " ";
      i = stop;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) j += 2;
          else break;
        } else j++;
      }
      code += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (tag) {
        const end = text.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? text.length : end + tag[0].length;
        code += text.slice(i, stop);
        i = stop;
      } else {
        code += ch;
        i++;
      }
    } else if (ch === ";") {
      flush();
      i++;
    } else {
      code += ch;
      i++;
    }
  }
  flush();
  return statements;
}

/** Contents of the first balanced (...) after `from`, and the index just past it. */
function balanced(text: string, from: number): { inner: string; end: number } | null {
  const open = text.indexOf("(", from);
  if (open === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

const bare = (name: string): string => name.replace(/"/g, "").split(".").pop()?.toLowerCase() ?? "";
const unquote = (name: string): string => name.replace(/"/g, "").toLowerCase();

// ---------- parsing CREATE TABLE, CREATE INDEX and GRANT ----------

export interface Column {
  name: string;
  type: string;
  rest: string;
}

export interface Table {
  fullName: string;
  name: string;
  columns: Column[];
  fkColumns: string[];
  /** ON DELETE action of every foreign key, lower-case; "" when none is written (NO ACTION). */
  fkOnDelete: string[];
  leadingColumns: Set<string>;
  tableChecks: string[];
  appendOnly: boolean;
  noAppAccess: boolean;
  /** `-- no-standard-columns: <reason>` above the table: exempt from uuid-pk, timestamps, trigger, legacy-id and soft-delete rules. */
  noStandardColumns: boolean;
  /** `-- hard-delete: <reason>` above the table: the hotel's role may DELETE from it (create-hotel grants DELETE only on these). */
  hardDelete: boolean;
  /** The marker names its reason: `Pallav <file>:<line>` (Pallav's own code deletes the rows) or `purge job <name>` (HMS purges them). */
  hardDeleteCited: boolean;
  usesIdPk: boolean;
}

const COLUMN_TYPE =
  /^((?:double\s+precision|timestamp(?:tz)?(?:\s*\(\d+\))?(?:\s+(?:with|without)\s+time\s+zone)?|character\s+varying|[\w.]+)(?:\s*\([^)]*\))?(?:\s*\[\])?)/i;
const TABLE_CONSTRAINT = /^(?:constraint\s+\S+\s+)?(primary\s+key|unique|foreign\s+key|check|exclude)\b/i;

function onDeleteOf(text: string): string {
  const match = /\bon\s+delete\s+(set\s+null|set\s+default|cascade|restrict|no\s+action)/i.exec(text);
  return match ? match[1].toLowerCase().replace(/\s+/g, " ") : "";
}

function firstColumn(list: string): string {
  return unquote(list.split(",")[0].trim().split(/\s+/)[0]);
}

/**
 * Tables whose migration was applied (dev and test databases) BEFORE the lint caught that they lack the standard columns. An applied migration is immutable (a changed
 * checksum stops the runner), so the marker `-- no-standard-columns: <reason>` cannot be added in the file; the exemption is recorded here instead, with its reason.
 * Never add to this list for a new migration: write the marker in the file.
 */
const APPLIED_WITHOUT_MARKER = new Map<string, Set<string>>([
  // keyed by hotel (hotel_id is the primary key) and by host name (the domain is the primary key, so the database keeps it unique across hotels); neither is ever soft-deleted
  ["0116_hotel_sites.sql", new Set(["hotel_sites", "hotel_site_domains"])],
  // the whole email of a message (applied on the live database, 2 Nov 2026): never Pallav data, so no legacy_id; one row per message, keyed by message_id, gone with its message
  ["0053_conv_mail_sources.sql", new Set(["conv_mail_sources"])],
]);

/**
 * Applied tables whose `-- hard-delete:` marker does not cite its reason in the required form (a changed checksum stops the runner, so the marker cannot be fixed in the file).
 * The reason, in the form the rule asks for, is recorded here. Never add to this list for a new migration: write the cited marker in the file.
 */
const APPLIED_HARD_DELETE_CITED = new Map<string, Map<string, string>>([
  // removed only with its message (ON DELETE CASCADE): the 12-month purge of Conversations
  ["0053_conv_mail_sources.sql", new Map([["conv_mail_sources", "purge job conversations-retention"]])],
]);

function parseTable(statement: Statement): Table | null {
  const head = /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/i.exec(statement.code);
  if (!head) return null;
  const body = balanced(statement.code, head[0].length - 1);
  if (!body) return null;
  const table: Table = {
    fullName: unquote(head[1]),
    name: bare(head[1]),
    columns: [],
    fkColumns: [],
    fkOnDelete: [],
    leadingColumns: new Set<string>(),
    tableChecks: [],
    appendOnly: statement.leadingComments.some((c) => /^append-only\b/i.test(c)),
    noAppAccess: statement.leadingComments.some((c) => /^no-app-access\b/i.test(c)),
    noStandardColumns: statement.leadingComments.some((c) => /^no-standard-columns:\s*\S/i.test(c)),
    hardDelete: statement.leadingComments.some((c) => /^hard-delete:/i.test(c)),
    hardDeleteCited: statement.leadingComments.some((c) => /^hard-delete:\s*(?:Pallav\s+\S+:\d+|purge job\s+[\w-]+)/i.test(c)),
    usesIdPk: false,
  };
  for (const item of splitTopLevel(body.inner)) {
    const constraint = TABLE_CONSTRAINT.exec(item);
    if (constraint) {
      const kind = constraint[1].toLowerCase().replace(/\s+/g, " ");
      const list = balanced(item, 0)?.inner ?? "";
      if (kind === "primary key") {
        table.leadingColumns.add(firstColumn(list));
        if (unquote(list.trim()) === "id") table.usesIdPk = true;
      } else if (kind === "unique") table.leadingColumns.add(firstColumn(list));
      else if (kind === "foreign key") {
        table.fkColumns.push(firstColumn(list));
        table.fkOnDelete.push(onDeleteOf(item));
      } else if (kind === "check") table.tableChecks.push(item.toLowerCase());
      continue;
    }
    const nameMatch = /^("?\w+"?)\s+([\s\S]*)$/.exec(item);
    if (!nameMatch) continue;
    const typeMatch = COLUMN_TYPE.exec(nameMatch[2]);
    const column: Column = {
      name: unquote(nameMatch[1]),
      type: (typeMatch?.[1] ?? "").toLowerCase().replace(/\s+/g, " "),
      rest: nameMatch[2].toLowerCase(),
    };
    table.columns.push(column);
    if (/\breferences\b/.test(column.rest)) {
      table.fkColumns.push(column.name);
      table.fkOnDelete.push(onDeleteOf(column.rest));
    }
    if (/\bprimary\s+key\b/.test(column.rest)) {
      table.leadingColumns.add(column.name);
      if (column.name === "id" && column.type === "uuid") table.usesIdPk = true;
    }
    if (/\bunique\b/.test(column.rest)) table.leadingColumns.add(column.name);
  }
  return table;
}

export interface Index {
  table: string;
  firstColumn: string;
  partial: boolean;
  unique: boolean;
  where: string;
}

function parseIndex(statement: Statement): Index | null {
  const match = /^create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?\S+\s+on\s+(?:only\s+)?([\w."]+)\s*(?:using\s+\w+\s*)?\(/i.exec(statement.code);
  if (!match) return null;
  const list = balanced(statement.code, match[0].length - 1);
  if (!list) return null;
  const tail = statement.code.slice(match[0].length - 1 + list.inner.length);
  const whereMatch = /\bwhere\b([\s\S]*)$/i.exec(tail);
  const where = whereMatch ? whereMatch[1].trim() : "";
  return { table: bare(match[2]), firstColumn: firstColumn(list.inner), partial: where !== "", unique: match[1] !== undefined, where };
}

/** Bare table names a "GRANT ... ON [TABLE] a, b TO role" statement covers ("ALL TABLES IN SCHEMA" covers none on purpose). */
function grantedTables(statement: Statement): string[] {
  const match = /^grant\b[\s\S]*?\bon\s+(?:table\s+)?([\s\S]+?)\s+to\b/i.exec(statement.code);
  if (!match || /^all\s+/i.test(match[1]) || /^(schema|function|sequence|database)\b/i.test(match[1])) return [];
  return match[1].split(",").map((name) => bare(name.trim()));
}

// ---------- rules ----------

/** Decision 74 (sealed personal numbers): the only columns shaped for ciphertext or a search index. Every other table and column still refuses that shape. */
export const SEALED_NUMBER_COLUMNS: ReadonlySet<string> = new Set([
  "customers.id_proof_number_sealed", "customers.id_proof_number_idx", "pms_stays.id_proof_number_sealed", "pms_stays.id_proof_number_idx",
  "employees.id_proof_number_sealed", "employees.id_proof_number_idx", "employees.account_number_sealed", "employees.ifsc_code_sealed",
  "payroll_companies.pan_number_sealed", "payroll_companies.account_number_sealed", "payroll_companies.ifsc_code_sealed",
  "salary_processings.account_number_sealed", "salary_processings.ifsc_code_sealed",
]);
const ROLLBACK_LINE = /^-- rollback: (forward-only because \S.{9,}|(DROP|ALTER|REVOKE|DELETE|UPDATE|TRUNCATE)\b.+)$/i;
const SEED_LINE = /^-- seed: \S/;
const FILE_NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const FORBIDDEN_TYPE = /\b(float4?|float8|real|double precision|money|serial|bigserial|smallserial|serial[248])\b/;
const MONEY_NAME = /(^|_)(amount|price|total|balance|fee|fees|salary|rate|charge|cost|tax|gst)(_|$)/;
const NOT_MONEY_SUFFIX = /_(percentage|percent|pct|hours|days|count|number|no|key|kind|type|mode|label|text|name|id|at|on|in_month)$/;
const STATUS_NAMES = new Set(["status", "kind", "level", "purpose", "outcome", "event", "client"]);
const FIRST_OWN_GRANT_FILE = 100;

function lintFileName(files: readonly SqlFile[], out: Violation[]): void {
  const seen = new Map<string, string>();
  let previous = "";
  for (const file of files) {
    const match = FILE_NAME.exec(file.name);
    if (!match) {
      out.push({ file: file.name, rule: "file-name", message: "must look like 0001_name_in_snake_case.sql" });
      continue;
    }
    const duplicate = seen.get(match[1]);
    if (duplicate) out.push({ file: file.name, rule: "file-name", message: `number ${match[1]} is already used by ${duplicate}` });
    seen.set(match[1], file.name);
    if (previous !== "" && match[1] <= previous && !duplicate) {
      out.push({ file: file.name, rule: "file-name", message: `numbers must ascend (${match[1]} comes after ${previous})` });
    }
    previous = match[1];
  }
}

interface FileContext {
  /** Every index and every table's leading columns in the whole folder, for foreign keys added by ALTER TABLE. */
  folderIndexes: readonly Index[];
  folderTables: ReadonlyMap<string, Table>;
  file: SqlFile;
  statements: readonly Statement[];
  indexes: readonly Index[];
  scope: Scope;
  granted: ReadonlySet<string>;
  grantedHere: ReadonlySet<string>;
}

function lintTable(ctx: FileContext, table: Table, out: Violation[]): void {
  const { file, statements, indexes, scope } = ctx;
  const fail = (rule: string, message: string): void => {
    out.push({ file: file.name, rule, message: `${table.fullName}: ${message}` });
  };
  const column = (name: string): Column | undefined => table.columns.find((c) => c.name === name);

  // the AI archive (platform 0177, MJ 3 Nov 2026) is the one other schema a platform migration may create tables in
  if (scope === "platform" && !table.fullName.startsWith("platform.") && !table.fullName.startsWith("ai_archive.")) fail("qualified-name", "write the table as platform.<name>");
  if (scope === "hotel" && table.fullName.includes(".")) fail("qualified-name", "hotel tables are unqualified; search_path picks the hotel schema");

  const id = column("id");
  if (!table.noStandardColumns && !(table.usesIdPk || (id && id.type === "uuid" && /\bprimary\s+key\b/.test(id.rest)))) fail("uuid-pk", "needs id uuid PRIMARY KEY");

  const isTimestamptz = (c: Column | undefined): boolean => c !== undefined && /^timestamptz\b|^timestamp with time zone\b/.test(c.type) && /\bnot\s+null\b/.test(c.rest);
  if (table.noStandardColumns) {
    // keyed by its natural key: nothing else to check about id and timestamps
  } else if (table.appendOnly) {
    const hasAt = table.columns.some((c) => (c.name === "at" || c.name.endsWith("_at")) && isTimestamptz(c));
    if (!hasAt) fail("timestamps", 'append-only tables need an "at" or "*_at" timestamptz NOT NULL column');
    table.fkOnDelete.forEach((action) => {
      if (action === "set null" || action === "cascade" || action === "set default") {
        fail("append-only-fk", `an append-only table cannot have a foreign key ON DELETE ${action.toUpperCase()}: its insert-only trigger would turn that into an error; use RESTRICT and soft-delete the parent`);
      }
    });
  } else {
    if (!isTimestamptz(column("created_at"))) fail("timestamps", "needs created_at timestamptz NOT NULL");
    if (!isTimestamptz(column("updated_at"))) fail("timestamps", "needs updated_at timestamptz NOT NULL");
  }

  if (column("updated_at") && !table.noStandardColumns) {
    const hasTrigger = statements.some((s) => new RegExp(`^create\\s+trigger\\s+\\S+\\s+before\\s+update\\s+on\\s+\\S*\\b${table.name}\\b[\\s\\S]*touch_updated_at`, "i").test(s.code));
    if (!hasTrigger) fail("updated-at-trigger", "has updated_at but no BEFORE UPDATE touch_updated_at trigger in this file");
  }

  // (a text column named version is the migration bookkeeping tables' own, not optimistic locking)
  if (column("version") && column("version")?.type.toLowerCase() !== "text" && !table.noStandardColumns) {
    // optimistic locking: the service updates WHERE id = $1 AND version = $2 and sets version = version + 1; this trigger refuses any
    // UPDATE that does not raise it by exactly one, so a forgotten check cannot slip through
    const v = column("version");
    if (!v || !/^integer$/i.test(v.type) || !/\bnot\s+null\b/i.test(v.rest) || !/\bdefault\s+1\b/i.test(v.rest) || !/version\s*>=\s*1/i.test(v.rest)) fail("version-trigger", "version must be integer NOT NULL DEFAULT 1 CHECK (version >= 1)");
    const hasStep = statements.some((s) => new RegExp(`^create\\s+trigger\\s+\\S+\\s+before\\s+update\\s+on\\s+\\S*\\b${table.name}\\b[\\s\\S]*enforce_version_step`, "i").test(s.code));
    if (!hasStep) fail("version-trigger", "has a version column but no BEFORE UPDATE enforce_version_step trigger in this file");
  }

  const covered = new Set(table.leadingColumns);
  for (const index of indexes) if (index.table === table.name && !index.partial) covered.add(index.firstColumn);
  for (const fk of new Set(table.fkColumns)) {
    if (!covered.has(fk)) fail("fk-index", `foreign key column ${fk} needs an index that starts with it (a partial index does not count)`);
  }

  for (const c of table.columns) {
    if (FORBIDDEN_TYPE.test(c.type)) fail("types", `column ${c.name} uses ${c.type}; money is bigint paise, counters are integers, ids are uuid`);
    if (/^timestamp(\s*\(\d+\))?$/.test(c.type) || c.type === "timestamp without time zone") fail("types", `column ${c.name} must be timestamptz`);
    if (c.name.endsWith("_paise")) {
      if (c.type !== "bigint") fail("money", `column ${c.name} must be bigint`);
    } else if (MONEY_NAME.test(c.name) && !NOT_MONEY_SUFFIX.test(c.name) && /^(numeric|decimal|bigint|integer|int|smallint)/.test(c.type) && !(table.fullName.startsWith("ai_archive.") && c.name.endsWith("_usd"))) {
      // (an AI archive table copies the AI database's cost in US dollars exactly as the model provider bills it: the one money column that is not rupees in paise)
      fail("money", `column ${c.name} looks like money: name it <name>_paise and make it bigint`);
    }
    if (STATUS_NAMES.has(c.name) && c.type === "text") {
      const hasCheck = /\bcheck\s*\(/.test(c.rest) || table.tableChecks.some((t) => new RegExp(`\\b${c.name}\\b`).test(t));
      if (!hasCheck) fail("status-check", `text column ${c.name} needs a CHECK listing its allowed values`);
    }
  }

  if (scope === "platform") {
    if (!table.noAppAccess && !ctx.granted.has(table.name)) {
      fail("grants", "no GRANT for this table in any file (add it to the grants file or to the table's own file), or mark it with a comment: -- no-app-access");
    }
    const number = Number(FILE_NAME.exec(file.name)?.[1] ?? "0");
    if (number >= FIRST_OWN_GRANT_FILE && !table.noAppAccess && !ctx.grantedHere.has(table.name)) {
      fail("grants-own-file", `a table created in ${file.name} must be granted in the same file (the grants file runs once; later tables do not get grants automatically)`);
    }
  }

  for (const c of table.columns) {
    if (SEALED_NUMBER_COLUMNS.has(`${table.name}.${c.name}`)) continue; // decision 74: the columns decided for sealed numbers
    if (/(_enc|_cipher|_sealed|_index)$/.test(c.name) || /(^|_)blind(_|$)/.test(c.name)) {
      fail("no-encryption", `column ${c.name} looks like ciphertext or a blind index: values are stored as plain text (no field encryption)`);
    }
  }
  if (scope === "hotel") {
    const recycleBin = HOTEL_SOFT_DELETE_TABLES.includes(table.name);
    if (recycleBin && !table.hardDelete) fail("hard-delete", "Pallav's recycle bin deletes this table's rows for good: mark it with `-- hard-delete: <Pallav source>` above CREATE TABLE");
    if (table.hardDelete && !table.hardDeleteCited) fail("hard-delete", "the marker must cite why rows are deleted: `-- hard-delete: Pallav <file>:<line>` or `-- hard-delete: purge job <name>`");
  }
  if (scope === "hotel" && !HOTEL_VERSION_TABLES.has(table.name) && !table.noStandardColumns) {
    const legacy = column("legacy_id");
    const hasUniqueIndex = indexes.some((i) => i.table === table.name && i.unique && i.firstColumn === "legacy_id" && /legacy_id\s+is\s+not\s+null/i.test(i.where));
    if (!legacy || legacy.type !== "bigint" || /\bnot\s+null\b/.test(legacy.rest)) fail("legacy-id", "needs legacy_id bigint (nullable): the Pallav import is idempotent by it");
    if (!hasUniqueIndex) fail("legacy-id", "needs CREATE UNIQUE INDEX ... (legacy_id) WHERE legacy_id IS NOT NULL");
    if (HOTEL_SOFT_DELETE_TABLES.includes(table.name)) {
      const deletedAt = column("deleted_at");
      const deletedBy = column("deleted_by");
      if (!deletedAt || !/^timestamptz\b/.test(deletedAt.type)) fail("soft-delete", "Pallav soft-deletes this table: needs deleted_at timestamptz");
      if (!deletedBy || deletedBy.type !== "uuid") fail("soft-delete", "Pallav soft-deletes this table: needs deleted_by uuid");
    }
  }
}

function lintSeedFile(file: SqlFile, out: Violation[]): void {
  const firstLine = file.text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  if (!SEED_LINE.test(firstLine.trim())) out.push({ file: file.name, rule: "seed-header", message: 'first line must be "-- seed: <what it seeds>"' });
  const statements = splitStatements(file.text);
  if (statements.length === 0) out.push({ file: file.name, rule: "file-name", message: "file holds no SQL statements" });
  for (const statement of statements) {
    const insertWithConflict = /^insert\s+into\b/i.test(statement.code) && /\bon\s+conflict\b/i.test(statement.code);
    if (!insertWithConflict) {
      out.push({ file: file.name, rule: "seed-statement", message: `only INSERT ... ON CONFLICT is allowed in a seed (so it can run twice): ${statement.code.slice(0, 60)}` });
    }
    if (/\$argon2|BEGIN (?:RSA |EC )?PRIVATE KEY|\bv1:[A-Za-z0-9_-]+:/.test(statement.code)) {
      out.push({ file: file.name, rule: "seed-secret", message: "a seed must not contain a password hash, private key or encrypted value" });
    }
  }
}

export function lintSql(files: readonly SqlFile[], options: { scope: Scope; kind?: Kind }): Violation[] {
  const out: Violation[] = [];
  lintFileName(files, out);
  const kind = options.kind ?? "migration";
  if (kind === "seed") {
    for (const file of files) lintSeedFile(file, out);
    return out;
  }

  const folder = files.flatMap((file) => splitStatements(file.text));
  const folderIndexes = folder.map(parseIndex).filter((i): i is Index => i !== null);
  const folderTables = new Map<string, Table>();
  for (const st of folder) {
    const t = parseTable(st);
    if (t) folderTables.set(t.name, t);
  }
  const parsed = files.map((file) => {
    const statements = splitStatements(file.text);
    const grantedHere = new Set(statements.flatMap(grantedTables));
    return { file, statements, grantedHere };
  });
  const granted = new Set(parsed.flatMap((p) => [...p.grantedHere]));

  for (const { file, statements, grantedHere } of parsed) {
    const firstLine = file.text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
    if (!ROLLBACK_LINE.test(firstLine.trim())) {
      out.push({ file: file.name, rule: "rollback", message: 'first line must be "-- rollback: <statements>" or "-- rollback: forward-only because <reason>"' });
    }
    if (statements.length === 0) out.push({ file: file.name, rule: "file-name", message: "file holds no SQL statements" });
    const indexes = statements.map(parseIndex).filter((i): i is Index => i !== null);
    const ctx: FileContext = { file, statements, indexes, scope: options.scope, granted, grantedHere, folderIndexes, folderTables };
    for (const statement of statements) {
      const table = parseTable(statement);
      if (table && APPLIED_WITHOUT_MARKER.get(file.name)?.has(table.name)) table.noStandardColumns = true;
    if (table && APPLIED_HARD_DELETE_CITED.get(file.name)?.has(table.name)) table.hardDeleteCited = true;
      if (table) lintTable(ctx, table, out);
      if (options.scope === "hotel" && /^(grant|revoke|alter\s+default\s+privileges)\b/i.test(statement.code)) {
        out.push({ file: file.name, rule: "hotel-grants", message: `a hotel migration never changes privileges (create-hotel gives the hotel's own role its rights; hms_app must hold none): ${statement.code.slice(0, 60)}` });
      }
      // A hotel migration that REPLACES an index or trigger an earlier migration made (a case-insensitive unique, a looser version rule) names it
      // outright: every file is one transaction, so a wrong name fails the whole file instead of passing silently.
      const replacesOwnObject = options.scope === "hotel" && /^drop\s+(index|trigger)\b/i.test(statement.code);
      if (/^drop\b/i.test(statement.code) && !/\bif\s+exists\b/i.test(statement.code) && !replacesOwnObject) {
        out.push({ file: file.name, rule: "drop-if-exists", message: `DROP without IF EXISTS: ${statement.code.slice(0, 60)}` });
      }
      if (/^alter\s+table\b/i.test(statement.code)) {
        if (/\bdrop\s+(column|constraint)\s+(?!if\s+exists\b)/i.test(statement.code)) {
          out.push({ file: file.name, rule: "drop-if-exists", message: `ALTER TABLE ... DROP without IF EXISTS: ${statement.code.slice(0, 60)}` });
        }
        const addFk = /^alter\s+table\s+(?:only\s+)?([\w."]+)\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s+references\s+/i.exec(statement.code);
        if (addFk && !/\badd\s+column\b/i.test(statement.code)) {
          const tableName = bare(addFk[1]);
          const column = firstColumn(addFk[2]);
          const target = ctx.folderTables.get(tableName);
          const covered = target?.leadingColumns.has(column) || ctx.folderIndexes.some((i) => i.table === tableName && !i.partial && i.firstColumn === column);
          if (!covered) out.push({ file: file.name, rule: "fk-index", message: `${tableName}: foreign key column ${column} (added by ALTER TABLE) needs an index that starts with it (a partial index does not count)` });
        } else if (addColumnFkCovered(ctx, statement.code)) {
          // ADD COLUMN ... REFERENCES whose column has its own index in this folder: checked like a table's foreign key
        } else if (/\b(references|foreign\s+key)\b/i.test(statement.code)) {
          out.push({ file: file.name, rule: "unverifiable", message: "a foreign key added with ALTER TABLE cannot be checked for its index; declare it in CREATE TABLE" });
        }
      }
    }
  }
  return out;
}

/** Every table and index the files declare (for tests that compare the SQL with another source, such as Pallav's tables). */
export function readSchema(files: readonly SqlFile[]): { tables: Table[]; indexes: Index[] } {
  const statements = files.flatMap((file) => splitStatements(file.text));
  return {
    tables: statements.map(parseTable).filter((t): t is Table => t !== null),
    indexes: statements.map(parseIndex).filter((i): i is Index => i !== null),
  };
}

export function readSqlDirectory(dir: string): SqlFile[] {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));
}

export function lintDirectory(dir: string, scope: Scope, kind: Kind = "migration"): Violation[] {
  return lintSql(readSqlDirectory(dir), { scope, kind });
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file} [${v.rule}] ${v.message}`).join("\n");
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const all = [
    ...lintDirectory(path.join(root, "migrations", "platform"), "platform"),
    ...lintDirectory(path.join(root, "migrations", "hotel"), "hotel"),
    ...lintDirectory(path.join(root, "seeds", "platform"), "platform", "seed"),
    ...lintDirectory(path.join(root, "seeds", "hotel"), "hotel", "seed"),
  ];
  if (all.length > 0) {
    process.stderr.write(`${formatViolations(all)}\n`);
    process.exit(1);
  }
  process.stdout.write("SQL lint: no violations\n");
}

/** `ALTER TABLE t ADD COLUMN c ... REFERENCES ...` where an index starting with c exists in the same migration folder (a partial index does not count). */
function addColumnFkCovered(ctx: FileContext, code: string): boolean {
  const m = /^alter\s+table\s+(?:only\s+)?([\w."]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("?\w+"?)\s[^;]*\breferences\b/i.exec(code);
  if (!m) return false;
  const tableName = bare(m[1]);
  const column = m[2].replace(/"/g, "");
  return ctx.folderIndexes.some((i) => i.table === tableName && !i.partial && i.firstColumn === column);
}
