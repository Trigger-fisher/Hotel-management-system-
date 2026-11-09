import "server-only";
// Sealed ID numbers at the repository's edge (decision 74, RELEASE A). The services and screens keep working with the plain number; this file is the only place that
// turns it into the three stored values and back:
//   write: the plain column (kept until Release B), the sealed column and the search index, all from the one number the person typed
//   read:  the sealed column opened; a row not sealed yet (before the backfill, or saved while no HMS_DATA_KEY was set) falls back to the plain column
// Without HMS_DATA_KEY nothing is sealed and nothing breaks: only the plain column is written, as before. A sealed value that cannot be opened is an error, never a
// silent fallback to a different number.
import { getConfig } from "../../config/env";
import { getFieldSeal } from "../../crypto";
import { CryptoError } from "../../crypto/errors";
import { isSealed, type FieldSeal } from "../../crypto/fieldSeal";
import type { JsonCodec } from "./shared";

type Row = Record<string, unknown>;

/** The field names bound into each sealed value: a number sealed for one table does not open as another. */
export const SEALED_FIELDS = { customers: "customer.id_proof_number", stays: "stay.id_proof_number" } as const;
export type SealedTable = keyof typeof SEALED_FIELDS;
/** The other guests of a stay keep their ID numbers inside pms_stays.guest_details (JSON): each one is sealed in place under this field name (no plain copy stays). */
export const MEMBER_FIELD = "stay.member.id_number";

export interface NumberSealer {
  /** True when HMS_DATA_KEY is set and values are being sealed. */
  readonly on: boolean;
  /** The columns to write for one ID number (undefined = leave the number alone, null/blank = clear it). Keys are database columns. */
  columns(table: SealedTable, plain: string | null | undefined): Record<string, string | null>;
  /** The plain number of a row: opened from the sealed column, else the plain column. */
  plainOf(table: SealedTable, row: Row): string | null;
  /** The search index of a number (64 hex; spaces, dashes and case ignored), or null when HMS_DATA_KEY is not set or the number is blank. */
  indexOf(table: SealedTable, plain: string): string | null;
  /** The converter of a stay's `guest_details` JSON: on write each member's ID number is sealed, on read it is opened (a number not sealed yet is read as it is). */
  membersCodec(): JsonCodec;
}

const asText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** `seal` is injectable for tests; production takes the configured one (null when HMS_DATA_KEY is not set). */
export function numberSealer(hotelId: string, seal?: FieldSeal | null): NumberSealer {
  const sealer: FieldSeal | null = seal !== undefined ? seal : getConfig().HMS_DATA_KEY !== undefined ? getFieldSeal() : null;
  return {
    on: sealer !== null,
    columns(table, plain) {
      if (plain === undefined) return {};
      const text = plain === null ? null : plain.trim() || null;
      const out: Record<string, string | null> = { id_proof_number: text };
      if (sealer) {
        out.id_proof_number_sealed = sealer.seal(hotelId, SEALED_FIELDS[table], text);
        out.id_proof_number_idx = sealer.blindIndex(hotelId, SEALED_FIELDS[table], text);
      }
      return out;
    },
    plainOf(table, row) {
      const sealed = asText(row.id_proof_number_sealed);
      if (sealer && sealed) return sealer.open(hotelId, SEALED_FIELDS[table], sealed);
      return asText(row.id_proof_number);
    },
    indexOf(table, plain) {
      return sealer ? sealer.blindIndex(hotelId, SEALED_FIELDS[table], plain) : null;
    },
    membersCodec() {
      return {
        in(value) {
          if (value === null || value === undefined) return null;
          return JSON.stringify(mapMembers(value, (n) => (sealer && !isSealed(n) ? (sealer.seal(hotelId, MEMBER_FIELD, n) ?? n) : n)));
        },
        out(raw) {
          if (raw === null || raw === undefined) return null;
          return mapMembers(raw, (n) => {
            if (!isSealed(n)) return n;
            if (!sealer) throw new CryptoError("BAD_KEY", "A saved ID number is sealed but HMS_DATA_KEY is not set");
            return sealer.open(hotelId, MEMBER_FIELD, n) ?? "";
          });
        },
      };
    },
  };
}

/** A copy of a stay's guest details with each member's non-empty ID number passed through `change`; everything else is kept as it is. */
function mapMembers(details: unknown, change: (idNumber: string) => string): unknown {
  if (typeof details !== "object" || details === null || !Array.isArray((details as { members?: unknown }).members)) return details;
  const d = details as { members: unknown[] };
  return {
    ...d,
    members: d.members.map((m) => {
      const id = (m as { idNumber?: unknown } | null)?.idNumber;
      return typeof id === "string" && id !== "" ? { ...(m as object), idNumber: change(id) } : m;
    }),
  };
}

/**
 * A repository's `write(...)` result with the ID number swapped for its stored form: the plain column's entry is replaced by the plain, sealed and index columns
 * (when the patch carries the number at all; a patch without it is returned as it is, so an update of another field never touches the number).
 */
export function sealedWrite(sealer: NumberSealer, table: SealedTable, w: { columns: string[]; params: unknown[] }, plain: string | null | undefined): { columns: string[]; params: unknown[] } {
  if (plain === undefined) return w;
  const columns: string[] = [];
  const params: unknown[] = [];
  w.columns.forEach((c, i) => {
    if (c === "id_proof_number") return;
    columns.push(c);
    params.push(w.params[i]);
  });
  for (const [c, v] of Object.entries(sealer.columns(table, plain))) {
    columns.push(c);
    params.push(v);
  }
  return { columns, params };
}
