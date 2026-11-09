// seal-numbers (decision 74, RELEASE A): seals the ID, bank and PAN numbers that are still plain (the list is web-app/src/server/crypto/sealedColumns.ts), in every hotel, and checks the result.
//
//   db:cli seal-numbers --dry-run                 counts only: per hotel and table, the rows still to seal. No key needed, nothing is written.
//   db:cli seal-numbers --backup-done             seals them. Refuses to run without --backup-done: take `db:cli backup` first and keep a copy off this machine.
//   db:cli seal-numbers --verify                  writes nothing: opens every sealed number and compares it with the plain column; counts the rows still plain only.
//   --hotel <schema>                              one hotel only (the first live run on a hosted database: try one hotel, then the rest)
//
// One transaction per hotel: the hotel's rows are sealed in batches, each sealed value is opened again and compared with the plain number before it is kept, and any
// difference rolls the whole hotel back. A rerun skips what is already sealed, so a stopped run is simply run again. The plain column is NOT touched (Release B removes it).
// Updating a row raises its version and its updated_at (the tables' own triggers); an open edit form of that row gets a conflict once and is simply reopened.
// Nothing here prints a number, a key or a sealed value: only counts and schema names.
import { isSealed, type FieldSeal } from "../../../web-app/src/server/crypto/fieldSeal";
import { SEALED_COLUMNS, type SealedColumn } from "../../../web-app/src/server/crypto/sealedColumns";
import type { DbClient } from "./pg-db";
import { isHotelSchemaName } from "./schema-names";

/** The columns that are sealed: one list for the app and the script (web-app/src/server/crypto/sealedColumns.ts). */
export { SEALED_COLUMNS };

export interface HotelRef {
  id: string;
  schema: string;
}
export interface TableSummary {
  schema: string;
  table: string;
  /** Rows with a plain number and no sealed one when the run started. */
  pending: number;
  /** Rows sealed by this run. */
  sealed: number;
  /** Verify only: sealed rows whose opened number differs from the plain column, or that could not be opened. */
  mismatched: number;
  /** Verify only: sealed rows checked. */
  checked: number;
}
export interface SealOptions {
  /** The columns to seal (default: all of them; tests pass a few). */
  entries?: readonly SealedColumn[];
  dryRun?: boolean;
  verify?: boolean;
  batch?: number;
  say?: (message: string) => void;
}

/** The other guests of a stay keep their ID numbers inside pms_stays.guest_details; each is sealed in place under this field name (same as repos/postgres/sealedNumbers.ts MEMBER_FIELD). */
const MEMBER_FIELD = "stay.member.id_number";
const HAS_MEMBERS = "guest_details IS NOT NULL AND jsonb_typeof(guest_details->'members') = 'array'";
const MEMBERS_PENDING = `${HAS_MEMBERS} AND EXISTS (SELECT 1 FROM jsonb_array_elements(guest_details->'members') m WHERE btrim(coalesce(m->>'idNumber', '')) <> '' AND m->>'idNumber' !~ '^v1\\.')`;
const MEMBERS_SEALED = `${HAS_MEMBERS} AND EXISTS (SELECT 1 FROM jsonb_array_elements(guest_details->'members') m WHERE m->>'idNumber' ~ '^v1\\.')`;

/** Rows with a plain value and no sealed twin yet. */
const pendingOf = (column: string): string => `${column} IS NOT NULL AND btrim(${column}) <> '' AND ${column}_sealed IS NULL`;

export async function listHotels(owner: Pick<DbClient, "query">): Promise<HotelRef[]> {
  const present = await owner.query("SELECT to_regclass('platform.hotels') AS found");
  if (present.rows[0]?.found === null) return [];
  const hasColumn = (await owner.query("SELECT 1 AS present FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'hotels' AND column_name = 'provisioned_at'")).rows.length > 0;
  const where = hasColumn ? "deleted_at IS NULL AND provisioned_at IS NOT NULL" : "deleted_at IS NULL";
  return (await owner.query(`SELECT id, schema_name FROM platform.hotels WHERE ${where} ORDER BY created_at`)).rows.map((r) => ({ id: String(r.id), schema: String(r.schema_name) }));
}

/** Opens every sealed value of one column and compares it with the plain column (and the index, when there is one); fills `checked` and `mismatched`. */
async function checkTable(owner: Pick<DbClient, "query">, name: string, hotel: HotelRef, t: SealedColumn, seal: FieldSeal, batch: number, summary: TableSummary): Promise<void> {
  const c = t.column;
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = (await owner.query(`SELECT id, ${c}, ${c}_sealed${t.index ? `, ${c}_idx` : ""} FROM ${name} WHERE ${c}_sealed IS NOT NULL AND id > $1::uuid ORDER BY id LIMIT $2`, [after, batch])).rows;
    if (rows.length === 0) break;
    for (const r of rows) {
      summary.checked += 1;
      try {
        const opened = seal.open(hotel.id, t.field, String(r[`${c}_sealed`]));
        const index = r[`${c}_idx`];
        const same = opened === String(r[c] ?? "").trim() && (!t.index || seal.blindIndex(hotel.id, t.field, opened) === (index === null || index === undefined ? null : String(index)));
        if (!same) summary.mismatched += 1;
      } catch {
        summary.mismatched += 1;
      }
    }
    after = String(rows[rows.length - 1].id);
  }
}

type Member = { idNumber?: unknown } & Record<string, unknown>;
const membersOf = (details: unknown): Member[] => (Array.isArray((details as { members?: unknown } | null)?.members) ? (details as { members: Member[] }).members : []);

/** Opens every sealed member number of the hotel's stays; counts how many were checked and how many could not be opened. */
async function checkMembers(owner: Pick<DbClient, "query">, name: string, hotel: HotelRef, seal: FieldSeal, batch: number, summary: TableSummary): Promise<void> {
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = (await owner.query(`SELECT id, guest_details FROM ${name} WHERE ${MEMBERS_SEALED} AND id > $1::uuid ORDER BY id LIMIT $2`, [after, batch])).rows;
    if (rows.length === 0) break;
    for (const r of rows) {
      for (const m of membersOf(r.guest_details)) {
        if (typeof m.idNumber !== "string" || !isSealed(m.idNumber)) continue;
        summary.checked += 1;
        try {
          if (!seal.open(hotel.id, MEMBER_FIELD, m.idNumber)) summary.mismatched += 1;
        } catch {
          summary.mismatched += 1;
        }
      }
    }
    after = String(rows[rows.length - 1].id);
  }
}

/** The other guests' ID numbers inside pms_stays.guest_details: counted, sealed in place (rows locked while they are changed) and read back. */
async function sealMembers(owner: Pick<DbClient, "query">, hotel: HotelRef, seal: FieldSeal | null, options: SealOptions, batch: number): Promise<TableSummary> {
  const name = `"${hotel.schema}"."pms_stays"`;
  const summary: TableSummary = { schema: hotel.schema, table: "pms_stays.members", pending: 0, sealed: 0, mismatched: 0, checked: 0 };
  summary.pending = Number((await owner.query(`SELECT COUNT(*) AS n FROM ${name} WHERE ${MEMBERS_PENDING}`)).rows[0].n);
  if (options.verify && seal) {
    await checkMembers(owner, name, hotel, seal, batch, summary);
  } else if (!options.dryRun && !options.verify && seal) {
    for (;;) {
      const rows = (await owner.query(`SELECT id, guest_details FROM ${name} WHERE ${MEMBERS_PENDING} ORDER BY id LIMIT $1 FOR UPDATE`, [batch])).rows;
      if (rows.length === 0) break;
      for (const r of rows) {
        const details = r.guest_details as { members: Member[] } & Record<string, unknown>;
        const members = details.members.map((m) => {
          if (typeof m.idNumber !== "string" || m.idNumber.trim() === "" || isSealed(m.idNumber)) return m;
          const plain = m.idNumber.trim();
          const sealed = seal.seal(hotel.id, MEMBER_FIELD, plain);
          if (sealed === null || seal.open(hotel.id, MEMBER_FIELD, sealed) !== plain) throw new Error(`${hotel.schema}.pms_stays: a sealed member number did not open to the same number; this hotel is rolled back`);
          return { ...m, idNumber: sealed };
        });
        const done = await owner.query(`UPDATE ${name} SET guest_details = $2::jsonb, version = version + 1 WHERE id = $1`, [r.id, JSON.stringify({ ...details, members })]);
        summary.sealed += done.affectedRows;
      }
    }
    await checkMembers(owner, name, hotel, seal, batch, summary);
    if (summary.mismatched > 0) throw new Error(`${hotel.schema}.pms_stays: ${summary.mismatched} sealed member number(s) did not read back; this hotel is rolled back`);
  }
  return summary;
}

export async function sealNumbers(owner: Pick<DbClient, "query">, hotels: readonly HotelRef[], seal: FieldSeal | null, options: SealOptions = {}): Promise<TableSummary[]> {
  const say = options.say ?? (() => undefined);
  const batch = options.batch ?? 200;
  if (!options.dryRun && !seal) throw new Error("HMS_DATA_KEY is not set: nothing can be sealed (use --dry-run to only count)");
  const out: TableSummary[] = [];
  for (const hotel of hotels) {
    if (!isHotelSchemaName(hotel.schema)) throw new Error(`not a hotel schema name: ${hotel.schema}`);
    const mine: TableSummary[] = [];
    await owner.query("BEGIN");
    try {
      for (const t of options.entries ?? SEALED_COLUMNS) {
        const name = `"${hotel.schema}"."${t.table}"`;
        const c = t.column;
        const there = (await owner.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3", [hotel.schema, t.table, `${c}_sealed`])).rows;
        if (there.length === 0) throw new Error(`${hotel.schema}.${t.table}: the column ${c}_sealed is not there yet (run db:cli migrate first: hotel migrations 0063 and 0064)`);
        const summary: TableSummary = { schema: hotel.schema, table: `${t.table}.${c}`, pending: 0, sealed: 0, mismatched: 0, checked: 0 };
        summary.pending = Number((await owner.query(`SELECT COUNT(*) AS n FROM ${name} WHERE ${pendingOf(c)}`)).rows[0].n);
        if (options.verify && seal) {
          await checkTable(owner, name, hotel, t, seal, batch, summary);
        } else if (!options.dryRun && !options.verify && seal) {
          for (;;) {
            const rows = (await owner.query(`SELECT id, ${c} FROM ${name} WHERE ${pendingOf(c)} ORDER BY id LIMIT $1`, [batch])).rows;
            if (rows.length === 0) break;
            for (const r of rows) {
              const plain = String(r[c]).trim();
              const sealed = seal.seal(hotel.id, t.field, plain);
              if (sealed === null || seal.open(hotel.id, t.field, sealed) !== plain) throw new Error(`${hotel.schema}.${t.table}.${c}: a sealed value did not open to the same value; this hotel is rolled back`);
              const set = `${c}_sealed = $2${t.index ? `, ${c}_idx = $3` : ""}${t.versioned ? ", version = version + 1" : ""}`;
              const params = t.index ? [r.id, sealed, seal.blindIndex(hotel.id, t.field, plain)] : [r.id, sealed];
              const done = await owner.query(`UPDATE ${name} SET ${set} WHERE id = $1 AND ${c}_sealed IS NULL`, params);
              summary.sealed += done.affectedRows;
            }
          }
          // read every sealed value of the column back from the database before the hotel is kept: a difference rolls the whole hotel back
          await checkTable(owner, name, hotel, t, seal, batch, summary);
          if (summary.mismatched > 0) throw new Error(`${hotel.schema}.${t.table}.${c}: ${summary.mismatched} sealed value(s) did not read back the same; this hotel is rolled back`);
        }
        mine.push(summary);
      }
      mine.push(await sealMembers(owner, hotel, seal, options, batch));
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }
    for (const s of mine) {
      say(`${s.schema}.${s.table}: ${options.verify ? `${s.checked} sealed rows checked, ${s.mismatched} wrong, ${s.pending} still plain only` : options.dryRun ? `${s.pending} to seal` : `${s.sealed} sealed (${s.pending} were waiting)`}`);
      out.push(s);
    }
  }
  return out;
}
