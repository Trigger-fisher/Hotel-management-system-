import "server-only";
// What every PostgreSQL repository shares: turning the database's rule violations into the RepoError the in-memory doubles throw, the
// optimistic-lock UPDATE, and the small SQL idioms (case-insensitive word search, "highest typed number").
import type { TxClient } from "../../../db/types";
import { toBigInt } from "../../../db/convert";
import { classifyPgError } from "../../db/pgErrors";
import { RepoError, type VersionedResult } from "../types";

/** A CHECK or UNIQUE rule the table enforces becomes a RepoError; anything else is a bug and stays as it is. */
export async function guard<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const info = classifyPgError(error);
    if (info.kind === "unique" || info.kind === "check") throw new RepoError(info.kind, info.constraint ?? "database rule");
    // a row that another table still points at (or a missing parent) is a rule the database enforces too: the doubles call it "check"
    if (info.kind === "foreign_key") throw new RepoError("check", info.constraint ?? "database rule");
    throw error;
  }
}

/** camelCase field name -> snake_case column name (hotelAmountPaise -> hotel_amount_paise). */
export const snake = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
export const asText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * The optimistic-lock UPDATE every versioned table uses: `set` is the column assignments (the caller numbers their parameters from $3; $1 is
 * the id and $2 the expected version), the version is raised by exactly one (the table's trigger refuses anything else), and a row that does not
 * match says why: gone (or in the wrong state) or a stale version.
 */
export async function versionedUpdate(
  tx: TxClient,
  table: string,
  id: string,
  expected: number,
  set: string,
  setParams: readonly unknown[],
  deleted: boolean,
  options: { softDelete?: boolean } = {},
): Promise<{ ok: true; row: Record<string, unknown> } | Extract<VersionedResult<never>, { ok: false }>> {
  const updated = await guard(
    tx.query(`UPDATE ${table} SET ${set === "" ? "" : `${set}, `}version = version + 1 WHERE id = $1 AND version = $2${options.softDelete === false ? "" : ` AND deleted_at IS ${deleted ? "NOT NULL" : "NULL"}`} RETURNING *`, [id, expected, ...setParams]),
  );
  if (updated.rows[0]) return { ok: true, row: updated.rows[0] };
  const current = await tx.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  const row = current.rows[0];
  if (!row || (options.softDelete !== false && (row.deleted_at !== null) !== deleted)) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "conflict", currentVersion: Number(row.version) };
}

/** SQL for "every word appears (case-insensitively, as a plain substring) in this text expression". Words are already split and lower-cased by the service. */
export function wordsCondition(haystack: string, words: readonly string[] | undefined, params: unknown[]): string {
  if (!words || words.length === 0) return "true";
  return words
    .map((w) => {
      params.push(w.toLowerCase());
      return `position($${params.length}::text in lower(${haystack})) > 0`;
    })
    .join(" AND ");
}

/**
 * A list's total: the COUNT query's number, or -1 without asking when the query said it needs the page only (`countTotal: false`, the global search).
 * The count reads every match, so skipping it halves a search's work on a big table.
 */
export async function countTotal(tx: TxClient, page: { countTotal?: boolean }, sql: string, params: readonly unknown[]): Promise<number> {
  if (page.countTotal === false) return -1;
  return Number((await tx.query(sql, params)).rows[0].n);
}

/**
 * The global search's word rule ("every word appears in the row's text") for a row whose text also holds its company's name (or "walk-in" when it has
 * none) and a figure, written so the database can stop early: per word, the row's own columns, OR the company is one whose name holds the word (the
 * names are looked up once, not joined per row), OR (when "walk-in" holds the word) the row has no company, OR (when the word could be part of a figure:
 * digits, '.', '-', '#') the figure. A word with no space can only match inside one of the parts, never across the ' ' between them, so this finds
 * exactly the rows `wordsCondition` over concat_ws(' ', own..., COALESCE(company name, 'walk-in'), figure) finds; a word that is empty or holds a space
 * (no caller sends one) falls back to that very condition.
 */
export function companyWordsCondition(
  spec: { own: readonly string[]; companyId: string; figure: string; fallback: string },
  words: readonly string[] | undefined,
  params: unknown[],
): string {
  if (!words || words.length === 0) return "true";
  return words
    .map((raw) => {
      const w = raw.toLowerCase();
      params.push(w);
      const p = `$${params.length}::text`;
      if (w === "" || w.includes(" ")) return `position(${p} in lower(${spec.fallback})) > 0`;
      const parts = [`position(${p} in lower(concat_ws(' ', ${spec.own.join(", ")}))) > 0`, `${spec.companyId} = ANY(ARRAY(SELECT n.id FROM company_profiles n WHERE position(${p} in lower(n.name)) > 0))`];
      if ("walk-in".includes(w)) parts.push(`${spec.companyId} IS NULL`);
      if (/^[-0-9.#]+$/.test(w)) parts.push(`position(${p} in ${spec.figure}) > 0`);
      return `(${parts.join(" OR ")})`;
    })
    .join(" AND ");
}

/** Billing::suggest: the highest number typed after `prefix` on any LIVE row of the table, digits only; 0 when none. */
export async function highestTyped(tx: TxClient, table: string, column: string, prefix: string): Promise<number> {
  const r = await tx.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(substr(${column}, length($1::text) + 1), '[^0-9]', '', 'g'), '')::bigint), 0) AS n FROM ${table} WHERE deleted_at IS NULL AND ${column} IS NOT NULL AND left(${column}, length($1::text)) = $1::text`,
    [prefix],
  );
  return Number(r.rows[0].n);
}

/* ---- the column codec: a spec says what kind each record field is, one place reads and writes them ---- */
export type Kind = "text" | "money" | "moneyN" | "date" | "ts" | "int" | "json" | "pct";
export type Row = Record<string, unknown>;

export const moneyOut = (v: unknown): bigint => toBigInt(v ?? 0);
export const moneyIn = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "bigint" ? v.toString() : String(v));
/** "5.00" -> "5", "2.50" -> "2.5": a percent as the service writes it. */
export const pctOut = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""));

/** How a json field converts (billing's stay segments hold bigint paise, which JSON cannot). */
export interface JsonCodec {
  out(raw: unknown): unknown;
  in(value: unknown): string | null;
}
const plainJson: JsonCodec = { out: (raw) => raw ?? null, in: (v) => (v === null || v === undefined ? null : JSON.stringify(v)) };

/** A field whose column is not simply its snake_case name (days0 -> days_0). */
export type ColumnNames = Readonly<Record<string, string>>;

const NO_NAMES: ColumnNames = {};
/** A spec's fields with their column names, worked out once per spec (a list reads the same spec for every row: no regex per field per row). */
const plans = new WeakMap<object, WeakMap<object, readonly (readonly [field: string, column: string, kind: Kind])[]>>();
function planOf(spec: Record<string, Kind>, names: ColumnNames): readonly (readonly [string, string, Kind])[] {
  let byNames = plans.get(spec);
  if (!byNames) plans.set(spec, (byNames = new WeakMap()));
  let plan = byNames.get(names);
  if (!plan) byNames.set(names, (plan = Object.entries(spec).map(([field, kind]) => [field, names[field] ?? snake(field), kind] as const)));
  return plan;
}

export function read(spec: Record<string, Kind>, row: Row, json: JsonCodec = plainJson, names: ColumnNames = NO_NAMES): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, column, kind] of planOf(spec, names)) {
    const v = row[column];
    switch (kind) {
      case "money": out[field] = moneyOut(v); break;
      case "moneyN": out[field] = v === null || v === undefined ? null : toBigInt(v); break;
      case "date": out[field] = asText(v); break;
      case "ts": out[field] = asDate(v); break;
      case "int": out[field] = v === null || v === undefined ? null : Number(v); break;
      case "json": out[field] = json.out(v); break;
      case "pct": out[field] = pctOut(v); break;
      default: out[field] = asText(v);
    }
  }
  return out;
}

/** The columns and values of the fields a record or patch carries (a field that is not in the spec, or is undefined, is left out). */
export function write(spec: Record<string, Kind>, values: object, json: JsonCodec = plainJson, names: ColumnNames = {}): { columns: string[]; params: unknown[] } {
  const columns: string[] = [];
  const params: unknown[] = [];
  for (const [field, value] of Object.entries(values)) {
    const kind = spec[field];
    if (value === undefined || !kind) continue;
    columns.push(names[field] ?? snake(field));
    params.push(kind === "money" || kind === "moneyN" ? moneyIn(value) : kind === "json" ? json.in(value) : kind === "ts" ? (value instanceof Date ? value.toISOString() : value) : value);
  }
  return { columns, params };
}
