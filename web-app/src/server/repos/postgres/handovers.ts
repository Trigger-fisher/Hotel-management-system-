import "server-only";
// Shift Handover on PostgreSQL (table shift_handovers, hotel 0003): the repository interface of repos/handovers.ts, bound to the unit's transaction.
// Entry numbers through nextEntryNo (advisory lock, max + 1 over every row); updates are optimistic (WHERE id AND version, the trigger checks +1).
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import { nextEntryNo } from "../../data/entryNo";
import { DENOMINATION_RUPEES, DENOMINATIONS, type DenominationKey, type HandoverPatch, type HandoverRecord, type HandoverRepo, type HandoverRepos, type NewHandover } from "../handovers";
import type { Unit, VersionedResult } from "../types";
import { asDate, asText, guard, versionedUpdate } from "./shared";
import { pgCashSupport } from "./support";
import { createPgUnit } from "./unit";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const count = (v: unknown): number => {
  const n = Number(String(v ?? "0").trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

function readRow(r: Record<string, unknown>): HandoverRecord {
  const counts = {} as Record<DenominationKey, number>;
  for (const d of DENOMINATIONS) counts[d] = count(r[`${d}_count`]);
  return {
    id: String(r.id),
    entryNo: Number(r.entry_no),
    date: asText(r.date) ?? "",
    time: asText(r.time) ?? "00:00:00",
    userId: String(r.user_id),
    fullName: asText(r.full_name),
    shift: asText(r.shift) ?? "",
    counts,
    totalPaise: toBigInt(r.total_paise ?? 0),
    totalInWords: asText(r.total_in_words),
    notes: list(r.notes),
    instructions: list(r.instructions),
    employeeId: asText(r.employee_id),
    handoverToName: asText(r.handover_to_name),
    createdBy: asText(r.created_by),
    updatedBy: asText(r.updated_by),
    deletedAt: asDate(r.deleted_at),
    deletedBy: asText(r.deleted_by),
    createdAt: asDate(r.created_at) as Date,
    updatedAt: asDate(r.updated_at) as Date,
    version: Number(r.version),
  };
}

/** The column assignments of a patch or new row (fixed column names only; every value is a parameter). */
function columnsOf(v: HandoverPatch): { columns: string[]; params: unknown[] } {
  const columns: string[] = [];
  const params: unknown[] = [];
  const put = (column: string, value: unknown): void => {
    columns.push(column);
    params.push(value);
  };
  if (v.date !== undefined) put("date", v.date);
  if (v.time !== undefined) put("time", v.time);
  if (v.shift !== undefined) put("shift", v.shift);
  if (v.counts !== undefined) {
    for (const d of DENOMINATIONS) {
      put(`${d}_count`, String(v.counts[d]));
      put(`${d}_total_paise`, (BigInt(v.counts[d]) * BigInt(DENOMINATION_RUPEES[d] * 100)).toString());
    }
  }
  if (v.totalPaise !== undefined) put("total_paise", v.totalPaise.toString());
  if (v.totalInWords !== undefined) put("total_in_words", v.totalInWords);
  if (v.notes !== undefined) put("notes", JSON.stringify(v.notes));
  if (v.instructions !== undefined) put("instructions", JSON.stringify(v.instructions));
  if (v.employeeId !== undefined) put("employee_id", v.employeeId);
  if (v.handoverToName !== undefined) put("handover_to_name", v.handoverToName);
  return { columns, params };
}

const JSON_COLUMNS = new Set(["notes", "instructions"]);
const cast = (column: string, n: number): string => (JSON_COLUMNS.has(column) ? `$${n}::jsonb` : `$${n}`);

function pgHandoverRepo(tx: TxClient): HandoverRepo {
  async function versioned(id: string, expected: number, set: string, params: readonly unknown[], deleted: boolean): Promise<VersionedResult<HandoverRecord>> {
    const result = await versionedUpdate(tx, "shift_handovers", id, expected, set, params, deleted);
    return result.ok ? { ok: true, record: readRow(result.row) } : result;
  }

  return {
    async rows(filter) {
      const params: unknown[] = [];
      const where = [filter.deleted === "only" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"];
      if (filter.from) {
        params.push(filter.from);
        where.push(`date >= $${params.length}::date`);
      }
      if (filter.to) {
        params.push(filter.to);
        where.push(`date <= $${params.length}::date`);
      }
      const r = await tx.query(`SELECT * FROM shift_handovers WHERE ${where.join(" AND ")}`, params);
      return r.rows.map(readRow);
    },
    async newestId() {
      const r = await tx.query("SELECT id FROM shift_handovers WHERE deleted_at IS NULL ORDER BY date DESC NULLS LAST, time DESC NULLS LAST, id DESC LIMIT 1");
      return r.rows[0] ? String(r.rows[0].id) : null;
    },
    async get(id, options = {}) {
      const r = await tx.query(`SELECT * FROM shift_handovers WHERE id = $1 AND deleted_at IS ${options.deleted ? "NOT NULL" : "NULL"}`, [id]);
      return r.rows[0] ? readRow(r.rows[0]) : null;
    },
    async create(input: NewHandover) {
      const entryNo = await nextEntryNo(tx, "shift_handovers");
      const { columns, params } = columnsOf(input);
      columns.push("user_id", "full_name", "created_by", "entry_no");
      params.push(input.userId, input.fullName, input.createdBy, entryNo);
      const r = await guard(tx.query(`INSERT INTO shift_handovers (${columns.join(", ")}) VALUES (${columns.map((c, i) => cast(c, i + 1)).join(", ")}) RETURNING *`, params));
      return readRow(r.rows[0]);
    },
    async update(id, expected, patch, actorId) {
      const { columns, params } = columnsOf(patch);
      columns.push("updated_by");
      params.push(actorId);
      // $1 is the id and $2 the version: the assignments are numbered from $3
      return versioned(id, expected, columns.map((c, i) => `${c} = ${cast(c, i + 3)}`).join(", "), params, false);
    },
    async softDelete(id, expected, actorId) {
      return versioned(id, expected, "deleted_at = now(), deleted_by = $3", [actorId], false);
    },
    async restore(id, expected, actorId) {
      return versioned(id, expected, "deleted_at = NULL, deleted_by = NULL, updated_by = $3", [actorId], true);
    },
    async purge(id) {
      const r = await tx.query("DELETE FROM shift_handovers WHERE id = $1 AND deleted_at IS NOT NULL", [id]);
      return r.affectedRows > 0;
    },
    async totals(from, to) {
      const r = await tx.query("SELECT count(*) AS n, COALESCE(sum(total_paise), 0) AS total FROM shift_handovers WHERE deleted_at IS NULL AND date BETWEEN $1::date AND $2::date", [from, to]);
      return { count: Number(r.rows[0].n), totalPaise: toBigInt(r.rows[0].total) };
    },
  };
}

function pgHandoverRepos(tx: TxClient): HandoverRepos {
  const support = pgCashSupport(tx);
  return {
    handovers: pgHandoverRepo(tx),
    handoverStaff: {
      async active() {
        const r = await tx.query(
          `SELECT e.id, e.name, e.employee_code, e.email, e.contact_number, c.code AS company_code
             FROM employees e JOIN payroll_companies c ON c.id = e.payroll_company_id
            WHERE e.is_active AND e.deleted_at IS NULL
            ORDER BY e.name, e.id`,
        );
        return r.rows.map((x) => ({ id: String(x.id), name: String(x.name), code: String(x.employee_code), companyCode: String(x.company_code), email: asText(x.email), mobile: asText(x.contact_number) }));
      },
    },
    masterLists: {
      async activeValues(setKey) {
        const r = await tx.query("SELECT i.value FROM option_items i JOIN option_sets s ON s.id = i.option_set_id WHERE s.key = $1 AND i.is_active ORDER BY i.sort_order, i.label", [setKey]);
        return r.rows.map((x) => String(x.value));
      },
    },
    accountingYears: support.accountingYears,
    systemLogs: support.systemLogs,
    forceLogs: support.forceLogs,
    async hotelName() {
      const s = await tx.query("SELECT value FROM app_settings WHERE key = 'general.site_name'");
      const name = asText(s.rows[0]?.value)?.trim();
      if (name) return name;
      const c = await tx.query("SELECT name FROM payroll_companies WHERE code = 'HP01'");
      return asText(c.rows[0]?.name) ?? "Hotel";
    },
  };
}

/** The handover unit on the real database. */
export function createPgHandoverUnit(withHotel: WithHotel): Unit<HandoverRepos> {
  return createPgUnit(withHotel, pgHandoverRepos);
}
