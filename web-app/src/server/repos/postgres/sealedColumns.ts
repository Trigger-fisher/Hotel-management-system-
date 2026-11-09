import "server-only";
// Sealed staff and payroll numbers at the repository's edge (decision 74, RELEASE A), for the repositories that read and write through a field spec (payrollCore, payrollPay).
// Same rules as sealedNumbers.ts: a write keeps the plain column and adds the sealed twin (and the search index for an ID number); a read opens the sealed twin, else uses the
// plain column; without HMS_DATA_KEY only the plain column is written and read, as before. The services and screens never see the difference.
import { getConfig } from "../../config/env";
import { getFieldSeal } from "../../crypto";
import type { FieldSeal } from "../../crypto/fieldSeal";
import { SEALED_COLUMNS, type SealedColumn } from "../../crypto/sealedColumns";

type Row = Record<string, unknown>;

export interface ColumnSealer {
  readonly on: boolean;
  /** A `write(...)` result with, for every sealed column of the table that it carries, the sealed twin (and the index) added beside the plain value. */
  write(table: string, w: { columns: string[]; params: unknown[] }): { columns: string[]; params: unknown[] };
  /** A row as read: the opened value in place of the plain column for every sealed twin that is filled (the row itself is not changed). */
  row<T extends Row>(table: string, row: T): T;
}

/** `seal` is injectable for tests; production takes the configured one (null when HMS_DATA_KEY is not set). */
export function columnSealer(hotelId: string, seal?: FieldSeal | null): ColumnSealer {
  const sealer: FieldSeal | null = seal !== undefined ? seal : getConfig().HMS_DATA_KEY !== undefined ? getFieldSeal() : null;
  const of = (table: string): SealedColumn[] => SEALED_COLUMNS.filter((c) => c.table === table);
  return {
    on: sealer !== null,
    write(table, w) {
      if (!sealer) return w;
      const columns = [...w.columns];
      const params = [...w.params];
      for (const c of of(table)) {
        const i = w.columns.indexOf(c.column);
        if (i < 0) continue;
        const given = w.params[i];
        const text = typeof given === "string" ? given.trim() || null : null;
        columns.push(`${c.column}_sealed`);
        params.push(sealer.seal(hotelId, c.field, text));
        if (c.index) {
          columns.push(`${c.column}_idx`);
          params.push(sealer.blindIndex(hotelId, c.field, text));
        }
      }
      return { columns, params };
    },
    row(table, row) {
      if (!sealer) return row;
      let copy: Row | null = null;
      for (const c of of(table)) {
        const sealed = row[`${c.column}_sealed`];
        if (typeof sealed !== "string" || sealed === "") continue;
        copy ??= { ...row };
        copy[c.column] = sealer.open(hotelId, c.field, sealed);
      }
      return (copy ?? row) as typeof row;
    },
  };
}
