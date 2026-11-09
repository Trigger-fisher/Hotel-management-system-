import "server-only";
// The Payroll pay repositories on PostgreSQL: the salary run's rows (salary_processings and their lines), payments, salary revisions, staff
// advances and bonuses (soft delete, entry numbers), the run's reads of payroll core, staff meals, letters and separations. EVERY read and write is
// scoped to one payroll company. The in-memory double (repos/memory/payrollPay.ts) is the reference for every rule.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import { nextEntryNo } from "../../data/entryNo";
import type {
  BonusRecord, InstantRange, LetterFields, LetterKind, LetterRecord, MealPeriodRecord, MealPriceRecord, PaymentStatus, PayrollAdvanceRecord, PayrollPayRepos, RevisionRecord, SalaryLineRecord, SalaryProcessingFields,
  SalaryProcessingRecord, SeparationFields, SeparationRecord, SeparationStatus, SlipSort,
} from "../payrollPay";
import { PAYMENT_STATUSES } from "../payrollPay";
import { RepoError, type Unit } from "../types";
import { asDate, asText, countTotal, guard, moneyIn, read, write, type ColumnNames, type Kind } from "./shared";
import { columnSealer } from "./sealedColumns";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

const SALARY_SPEC: Record<string, Kind> = {
  payrollCompanyId: "text", employeeId: "text", year: "int", month: "int", companyName: "text", employeeCode: "text", employeeName: "text", designation: "text", department: "text", paymentMode: "text",
  monthlySalaryPaise: "money", dailyWorkingHours: "text", totalDaysInMonth: "int", dailySalaryPaise: "money", days0: "text", days25: "text", days50: "text", days75: "text", days100: "text",
  totalPayableDays: "text", attendanceSalaryPaise: "money", overtimeHours: "text", hourlyRatePaise: "money", overtimeAmountPaise: "money", bonusAmountPaise: "money", incentiveAmountPaise: "money",
  deductionAmountPaise: "money", advanceDeductionPaise: "money", pendingAdvanceAmountPaise: "money", netSalaryPaise: "money", paymentStatus: "text", generationCount: "int", processedBy: "text",
  processedAt: "ts", paidAmountPaise: "money", paidAt: "date", paymentReference: "text", paymentRemarks: "text", paymentUpdatedBy: "text", paymentUpdatedAt: "ts", bankName: "text",
  accountHolderName: "text", accountNumber: "text", ifscCode: "text", branchName: "text",
};
const SALARY_NAMES: ColumnNames = { days0: "days_0", days25: "days_25", days50: "days_50", days75: "days_75", days100: "days_100" };
const PAYMENT_FIELDS = ["paymentStatus", "paidAmountPaise", "paidAt", "paymentReference", "paymentRemarks", "paymentUpdatedBy", "paymentUpdatedAt"] as const;

const salaryOf = (r: Row): SalaryProcessingRecord => ({ ...(read(SALARY_SPEC, r, undefined, SALARY_NAMES) as unknown as SalaryProcessingFields), id: String(r.id), createdAt: asDate(r.created_at) as Date, version: Number(r.version) });
const lineOf = (r: Row): SalaryLineRecord => ({
  id: String(r.id), salaryProcessingId: String(r.salary_processing_id), category: r.category as SalaryLineRecord["category"], label: String(r.label), deductionType: asText(r.deduction_type),
  amountPaise: toBigInt(r.amount_paise), pendingAmountPaise: toBigInt(r.pending_amount_paise), sourceType: asText(r.source_type) as SalaryLineRecord["sourceType"], sourceId: asText(r.source_id),
});
const revisionOf = (r: Row): RevisionRecord => ({
  id: String(r.id), employeeId: String(r.employee_id), batchId: String(r.batch_id), effectiveDate: String(r.effective_date), fieldName: String(r.field_name), previousValue: asText(r.previous_value),
  newValue: asText(r.new_value), changedBy: asText(r.changed_by), createdAt: asDate(r.created_at) as Date,
});
const advanceOf = (r: Row): PayrollAdvanceRecord => ({
  id: String(r.id), payrollCompanyId: String(r.payroll_company_id), employeeId: String(r.employee_id), advanceDate: asDate(r.advance_date) as Date, amountPaise: toBigInt(r.amount_paise),
  deductionType: r.deduction_type as PayrollAdvanceRecord["deductionType"], deductionAmountPaise: toBigInt(r.deduction_amount_paise), remarks: asText(r.remarks), entryNo: Number(r.entry_no),
  recoveredAmountPaise: toBigInt(r.recovered_amount_paise), isSettled: r.is_settled === true, isCarryForward: r.is_carry_forward === true, parentAdvanceId: asText(r.parent_advance_id),
  sourceSalaryProcessingId: asText(r.source_salary_processing_id), createdBy: asText(r.created_by), updatedBy: asText(r.updated_by), deletedAt: asDate(r.deleted_at), deletedBy: asText(r.deleted_by),
  createdAt: asDate(r.created_at) as Date,
});
const bonusOf = (r: Row): BonusRecord => ({
  id: String(r.id), payrollCompanyId: String(r.payroll_company_id), employeeId: String(r.employee_id), entryDate: asDate(r.entry_date) as Date, type: r.type as BonusRecord["type"],
  amountPaise: toBigInt(r.amount_paise), remarks: asText(r.remarks), entryNo: Number(r.entry_no), createdBy: asText(r.created_by), updatedBy: asText(r.updated_by), deletedAt: asDate(r.deleted_at),
  deletedBy: asText(r.deleted_by), createdAt: asDate(r.created_at) as Date,
});
const priceOf = (r: Row): MealPriceRecord => ({ id: String(r.id), payrollCompanyId: String(r.payroll_company_id), monthlyAmountPaise: toBigInt(r.monthly_amount_paise), effectiveFrom: String(r.effective_from), createdBy: asText(r.created_by), createdAt: asDate(r.created_at) as Date });
const periodOf = (r: Row): MealPeriodRecord => ({
  id: String(r.id), payrollCompanyId: String(r.payroll_company_id), employeeId: String(r.employee_id), startsOn: String(r.starts_on), endsOn: asText(r.ends_on), createdBy: asText(r.created_by),
  deletedAt: asDate(r.deleted_at), createdAt: asDate(r.created_at) as Date,
});
const SEPARATION_SPEC: Record<string, Kind> = {
  employeeId: "text", separationType: "text", resignationDate: "date", lastWorkingDate: "date", reason: "text", remarks: "text", status: "text", documentPath: "text", rejoinedAt: "date",
};
const separationOf = (r: Row): SeparationRecord => {
  const f = read(SEPARATION_SPEC, r) as unknown as SeparationFields & { rejoinedAt: string | null };
  return { ...f, id: String(r.id), payrollCompanyId: String(r.payroll_company_id), entryNo: Number(r.entry_no), rejoinedAt: f.rejoinedAt, createdBy: asText(r.created_by), deletedAt: asDate(r.deleted_at), createdAt: asDate(r.created_at) as Date };
};

const LETTER_TABLE: Record<LetterKind, string> = { joining: "joining_letters", experience: "experience_letters" };
const LETTER_SECTIONS: Record<LetterKind, string[]> = { joining: ["introduction_content", "roles_responsibilities", "terms_conditions"], experience: ["body_content", "conduct_remarks"] };
const letterOf = (kind: LetterKind, r: Row): LetterRecord => ({
  id: String(r.id), payrollCompanyId: String(r.payroll_company_id), kind, subject: asText(r.subject), sections: Object.fromEntries(LETTER_SECTIONS[kind].map((s) => [s, asText(r[s])])), closingMessage: asText(r.closing_message),
  useCompanySignatory: r.use_company_signatory === true, authorizedName: asText(r.authorized_name), authorizedDesignation: asText(r.authorized_designation), authorizedClosingText: asText(r.authorized_closing_text),
  acceptanceHeading: asText(r.acceptance_heading), acceptanceContent: asText(r.acceptance_content), acceptanceClosingText: asText(r.acceptance_closing_text), isActive: r.is_active === true,
  signatureImagePath: asText(r.signature_image_path), updatedAt: asDate(r.updated_at) as Date,
});

const NAME_C = (column: string): string => `lower(${column}) COLLATE "C", ${column} COLLATE "C"`;

/** The Salary Slips sort columns (the memory double compares the same way: lower-cased name then code, byte order). */
const SLIP_SORT: Record<SlipSort, (dir: "ASC" | "DESC") => string> = {
  period: (d) => `year ${d}, month ${d}`,
  employee: (d) => `lower(employee_name) COLLATE "C" ${d}, lower(employee_code) COLLATE "C" ${d}`,
  net: (d) => `net_salary_paise ${d}`,
  processed: (d) => `processed_at ${d}`,
  // the natural order Pending, Processing, On Hold, Partially Paid, Paid, Failed (PAYMENT_STATUSES; fixed literals, never input)
  status: (d) => `array_position(ARRAY[${PAYMENT_STATUSES.map((s) => `'${s}'`).join(", ")}]::text[], payment_status::text) ${d}`,
};

function wordsOver(columns: string[], list: readonly string[] | undefined, params: unknown[]): string {
  if (!list || list.length === 0) return "true";
  return list
    .map((w) => {
      params.push(w.toLowerCase());
      return `position($${params.length}::text in lower(concat_ws(' ', ${columns.join(", ")}))) > 0`;
    })
    .join(" AND ");
}

export function pgPayrollPayRepos(tx: TxClient, hotelId: string): PayrollPayRepos {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  // decision 74: the account number and IFSC of a salary row are written sealed beside the plain column and read opened (repos/postgres/sealedColumns.ts)
  const sealer = columnSealer(hotelId);
  const salary = (r: Row): SalaryProcessingRecord => salaryOf(sealer.row("salary_processings", r));
  const lock = (options?: { forUpdate?: boolean }): string => (options?.forUpdate ? " FOR UPDATE" : "");

  /** The advance and bonus screens' filter: the company, live or bin, the accounting-year window, one person, the words. */
  function advanceWhere(companyId: string, f: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange; deleted?: "no" | "only" }, params: unknown[]): string {
    params.push(companyId);
    const parts = [`a.payroll_company_id = $${params.length}::uuid`, `a.deleted_at IS ${f.deleted === "only" ? "NOT NULL" : "NULL"}`];
    if (f.viewFrom !== null) {
      params.push(f.viewFrom.toISOString());
      parts.push(`(a.advance_date >= $${params.length} OR NOT a.is_settled)`);
    }
    if (f.employeeId) {
      params.push(f.employeeId);
      parts.push(`a.employee_id = $${params.length}::uuid`);
    }
    if (f.range) {
      params.push(f.range.from.toISOString(), f.range.to.toISOString());
      parts.push(`a.advance_date >= $${params.length - 1} AND a.advance_date < $${params.length}`);
    }
    parts.push(wordsOver(["e.name", "e.employee_code", "a.remarks", "a.entry_no::text"], f.words, params));
    return parts.join(" AND ");
  }
  function bonusWhere(companyId: string, f: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange; deleted?: "no" | "only" }, params: unknown[]): string {
    params.push(companyId);
    const parts = [`b.payroll_company_id = $${params.length}::uuid`, `b.deleted_at IS ${f.deleted === "only" ? "NOT NULL" : "NULL"}`];
    if (f.viewFrom !== null) {
      params.push(f.viewFrom.toISOString());
      parts.push(`b.entry_date >= $${params.length}`);
    }
    if (f.employeeId) {
      params.push(f.employeeId);
      parts.push(`b.employee_id = $${params.length}::uuid`);
    }
    if (f.range) {
      params.push(f.range.from.toISOString(), f.range.to.toISOString());
      parts.push(`b.entry_date >= $${params.length - 1} AND b.entry_date < $${params.length}`);
    }
    parts.push(wordsOver(["e.name", "e.employee_code", "b.remarks", "b.type", "b.entry_no::text"], f.words, params));
    return parts.join(" AND ");
  }
  const withPerson = <R extends { employeeId: string }>(rows: Row[], map: (r: Row) => R): (R & { employeeName: string | null; employeeCode: string | null })[] =>
    rows.map((r) => ({ ...map(r), employeeName: asText(r.employee_name), employeeCode: (asText(r.employee_code) ?? "") === "" ? null : asText(r.employee_code) }));

  return {
    salaryProcessings: {
      async get(companyId, id, options) {
        const r = await q(`SELECT * FROM salary_processings WHERE id = $1 AND payroll_company_id = $2${lock(options)}`, [id, companyId]);
        return r.rows[0] ? salary(r.rows[0]) : null;
      },
      async getMany(companyId, ids, options) {
        if (ids.length === 0) return [];
        return (await q(`SELECT * FROM salary_processings WHERE payroll_company_id = $1 AND id = ANY($2::uuid[]) ORDER BY id${lock(options)}`, [companyId, ids])).rows.map(salary);
      },
      async month(companyId, year, month, order, options) {
        const params: unknown[] = [companyId, year, month];
        let extra = "";
        if (options?.employeeId) {
          params.push(options.employeeId);
          extra = ` AND employee_id = $${params.length}::uuid`;
        }
        // payments: unpaid first, then paid latest first, then by name; reports: by name
        const sort = order === "name" ? NAME_C("employee_name") : `(paid_at IS NULL) DESC, paid_at DESC NULLS LAST, ${NAME_C("employee_name")}`;
        return (await q(`SELECT * FROM salary_processings WHERE payroll_company_id = $1 AND year = $2 AND month = $3${extra} ORDER BY ${sort}, id${lock(options)}`, params)).rows.map(salary);
      },
      async lines(ids) {
        if (ids.length === 0) return [];
        return (await q("SELECT * FROM salary_processing_lines WHERE salary_processing_id = ANY($1::uuid[]) ORDER BY created_at, id", [ids])).rows.map(lineOf);
      },
      async list(companyId, query) {
        const params: unknown[] = [companyId];
        const parts = ["payroll_company_id = $1"];
        if (query.from) {
          params.push(query.from.year * 100 + query.from.month);
          parts.push(`year * 100 + month >= $${params.length}`);
        }
        if (query.period) {
          params.push(query.period.year, query.period.month);
          parts.push(`year = $${params.length - 1} AND month = $${params.length}`);
        }
        parts.push(wordsOver(["employee_name", "employee_code", "designation"], query.words, params));
        if (query.status) {
          params.push(query.status);
          parts.push(`payment_status = $${params.length}`);
        }
        const where = parts.join(" AND ");
        const total = await q(`SELECT COUNT(*) AS n FROM salary_processings WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const newest = "year DESC, month DESC, processed_at DESC, id DESC";
        const order = query.sort ? `${SLIP_SORT[query.sort.key](query.sort.dir === "desc" ? "DESC" : "ASC")}, ${newest}` : newest;
        const r = await q(`SELECT * FROM salary_processings WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(salary), total: Number(total.rows[0].n) };
      },
      async slipSummary(companyId, period) {
        const params: unknown[] = [companyId];
        let where = "payroll_company_id = $1";
        if (period) {
          params.push(period.year, period.month);
          where += " AND year = $2 AND month = $3";
        }
        const statuses = PAYMENT_STATUSES.map((s) => {
          params.push(s);
          return `COUNT(*) FILTER (WHERE payment_status = $${params.length}) AS s${params.length}`;
        });
        const r = await q(
          `SELECT COUNT(*) AS n, COUNT(DISTINCT employee_id) AS people, COALESCE(SUM(net_salary_paise), 0) AS net, COALESCE(SUM(paid_amount_paise), 0) AS paid,
                  COALESCE(SUM(GREATEST(net_salary_paise - paid_amount_paise, 0)), 0) AS outstanding, MAX(year * 100 + month) AS latest,
                  COUNT(DISTINCT year * 100 + month) AS periods,
                  COALESCE(SUM(net_salary_paise) FILTER (WHERE year * 100 + month = (SELECT MAX(year * 100 + month) FROM salary_processings WHERE ${where})), 0) AS latest_net,
                  ${statuses.join(", ")}
             FROM salary_processings WHERE ${where}`,
          params,
        );
        const x = r.rows[0];
        const first = params.length - PAYMENT_STATUSES.length + 1;
        const byStatus = Object.fromEntries(PAYMENT_STATUSES.map((s, i) => [s, Number(x[`s${first + i}`])])) as Record<PaymentStatus, number>;
        const latest = x.latest === null ? null : Number(x.latest);
        return {
          slips: Number(x.n), people: Number(x.people), netPaise: toBigInt(x.net), paidPaise: toBigInt(x.paid), outstandingPaise: toBigInt(x.outstanding), byStatus,
          latest: latest === null ? null : { year: Math.floor(latest / 100), month: latest % 100 },
          latestNetPaise: toBigInt(x.latest_net),
          periods: Number(x.periods),
        };
      },
      async periods(companyId) {
        const r = await q("SELECT year, month, COUNT(*) AS people FROM salary_processings WHERE payroll_company_id = $1 GROUP BY year, month ORDER BY year DESC, month DESC", [companyId]);
        return r.rows.map((x) => ({ year: Number(x.year), month: Number(x.month), people: Number(x.people) }));
      },
      async latestPeriod(companyId) {
        const r = await q("SELECT year, month FROM salary_processings WHERE payroll_company_id = $1 ORDER BY year DESC, month DESC LIMIT 1", [companyId]);
        return r.rows[0] ? { year: Number(r.rows[0].year), month: Number(r.rows[0].month) } : null;
      },
      async processedFor(companyId, employeeId, year, month) {
        return (await q("SELECT 1 AS x FROM salary_processings WHERE payroll_company_id = $1 AND employee_id = $2 AND year = $3 AND month = $4 LIMIT 1", [companyId, employeeId, year, month])).rows.length > 0;
      },
      async processedKeys(companyId, keys) {
        if (keys.length === 0) return new Set();
        const r = await q(
          `SELECT s.employee_id, s.year, s.month FROM salary_processings s JOIN unnest($2::uuid[], $3::int[], $4::int[]) AS k(emp, y, m) ON s.employee_id = k.emp AND s.year = k.y AND s.month = k.m WHERE s.payroll_company_id = $1`,
          [companyId, keys.map((k) => k.employeeId), keys.map((k) => k.year), keys.map((k) => k.month)],
        );
        return new Set(r.rows.map((x) => `${x.employee_id}|${x.year}|${x.month}`));
      },
      async createMany(rows) {
        const out: SalaryProcessingRecord[] = [];
        for (let start = 0; start < rows.length; start += 100) {
          const chunk = rows.slice(start, start + 100);
          const written = chunk.map((x) => sealer.write("salary_processings", write(SALARY_SPEC, x.fields, undefined, SALARY_NAMES)));
          const columns = written[0].columns;
          const params = written.flatMap((w) => w.params);
          const values = written.map((_, i) => `(${columns.map((__, c) => `$${i * columns.length + c + 1}`).join(", ")})`).join(", ");
          const inserted = await guard(q(`INSERT INTO salary_processings (${columns.join(", ")}) VALUES ${values} RETURNING *`, params));
          // RETURNING keeps the order of the VALUES rows
          const records = inserted.rows.map(salary);
          const lineRows = chunk.flatMap((x, i) => x.lines.map((l) => ({ processing: records[i].id, l })));
          if (lineRows.length > 0) {
            await guard(
              q(
                `INSERT INTO salary_processing_lines (salary_processing_id, category, label, deduction_type, amount_paise, pending_amount_paise, source_type, source_id)
                 SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::text[], $8::uuid[])`,
                [lineRows.map((x) => x.processing), lineRows.map((x) => x.l.category), lineRows.map((x) => x.l.label), lineRows.map((x) => x.l.deductionType), lineRows.map((x) => moneyIn(x.l.amountPaise)),
                  lineRows.map((x) => moneyIn(x.l.pendingAmountPaise)), lineRows.map((x) => x.l.sourceType), lineRows.map((x) => x.l.sourceId)],
              ),
            );
          }
          out.push(...records);
        }
        return out;
      },
      async setTotals(id, totals) {
        const w = write(SALARY_SPEC, totals, undefined, SALARY_NAMES);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), "version = version + 1"].join(", ");
        const r = await guard(q(`UPDATE salary_processings SET ${set} WHERE id = $1`, [id, ...w.params]));
        if (r.affectedRows === 0) throw new RepoError("check", "salary processing not found");
      },
      async updatePayment(id, patch, options) {
        const picked = Object.fromEntries(PAYMENT_FIELDS.filter((f) => patch[f] !== undefined).map((f) => [f, patch[f]]));
        const w = write(SALARY_SPEC, picked, undefined, SALARY_NAMES);
        const params: unknown[] = [id, ...w.params];
        const set = w.columns.map((c, i) => `${c} = $${i + 2}`);
        let versionSql = "version + 1";
        if (options?.version !== undefined) {
          params.push(options.version);
          versionSql = `$${params.length}`;
        }
        set.push(`version = ${versionSql}`);
        let where = "id = $1";
        if (options?.expectedVersion !== undefined) {
          params.push(options.expectedVersion);
          where += ` AND version = $${params.length}`;
        }
        const r = await guard(q(`UPDATE salary_processings SET ${set.join(", ")} WHERE ${where} RETURNING *`, params));
        if (r.rows[0]) return { ok: true, record: salary(r.rows[0]) };
        const current = await q("SELECT version FROM salary_processings WHERE id = $1", [id]);
        if (!current.rows[0]) return { ok: false, reason: "not_found" };
        return { ok: false, reason: "conflict", currentVersion: Number(current.rows[0].version) };
      },
      async removeMonth(companyId, year, month) {
        return (await q("DELETE FROM salary_processings WHERE payroll_company_id = $1 AND year = $2 AND month = $3", [companyId, year, month])).affectedRows;
      },
      async figures(companyId) {
        const latest = await q("SELECT year, month FROM salary_processings WHERE payroll_company_id = $1 ORDER BY year DESC, month DESC LIMIT 1", [companyId]);
        const all = await q(
          `SELECT COUNT(*) FILTER (WHERE payment_status IN ('Pending', 'Processing', 'On Hold', 'Partially Paid')) AS open, COUNT(*) FILTER (WHERE payment_status = 'Failed') AS failed
             FROM salary_processings WHERE payroll_company_id = $1`,
          [companyId],
        );
        let month = { net: BigInt(0), paid: BigInt(0), unpaid: 0, count: 0 };
        if (latest.rows[0]) {
          const m = await q(
            `SELECT COALESCE(SUM(net_salary_paise), 0) AS net, COALESCE(SUM(paid_amount_paise), 0) AS paid, COUNT(*) FILTER (WHERE payment_status <> 'Paid') AS unpaid, COUNT(*) AS n
               FROM salary_processings WHERE payroll_company_id = $1 AND year = $2 AND month = $3`,
            [companyId, latest.rows[0].year, latest.rows[0].month],
          );
          month = { net: toBigInt(m.rows[0].net), paid: toBigInt(m.rows[0].paid), unpaid: Number(m.rows[0].unpaid), count: Number(m.rows[0].n) };
        }
        return {
          latest: latest.rows[0] ? { year: Number(latest.rows[0].year), month: Number(latest.rows[0].month) } : null,
          netPaise: month.net, paidPaise: month.paid, unpaid: month.unpaid, count: month.count, open: Number(all.rows[0].open), failed: Number(all.rows[0].failed),
        };
      },
    },

    revisions: {
      async forEmployee(employeeId) {
        return (await q("SELECT * FROM salary_update_histories WHERE employee_id = $1 ORDER BY effective_date DESC, created_at DESC, id DESC", [employeeId])).rows.map(revisionOf);
      },
      async salaryInMonth(employeeIds, from, to) {
        if (employeeIds.length === 0) return [];
        return (
          await q("SELECT * FROM salary_update_histories WHERE employee_id = ANY($1::uuid[]) AND field_name = 'Salary' AND effective_date >= $2 AND effective_date <= $3 ORDER BY effective_date, created_at, id", [employeeIds, from, to])
        ).rows.map(revisionOf);
      },
      async summary(employeeIds) {
        const out = new Map<string, { count: number; latest: string }>();
        if (employeeIds.length === 0) return out;
        const r = await q("SELECT employee_id, COUNT(*) AS n, MAX(effective_date) AS latest FROM salary_update_histories WHERE employee_id = ANY($1::uuid[]) GROUP BY employee_id", [employeeIds]);
        for (const x of r.rows) out.set(String(x.employee_id), { count: Number(x.n), latest: String(x.latest) });
        return out;
      },
      async createBatch(rows) {
        if (rows.length === 0) return;
        await guard(
          q(
            `INSERT INTO salary_update_histories (employee_id, batch_id, effective_date, field_name, previous_value, new_value, changed_by)
             SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::date[], $4::text[], $5::text[], $6::text[], $7::uuid[])`,
            [rows.map((r) => r.employeeId), rows.map((r) => r.batchId), rows.map((r) => r.effectiveDate), rows.map((r) => r.fieldName), rows.map((r) => r.previousValue), rows.map((r) => r.newValue), rows.map((r) => r.changedBy)],
          ),
        );
      },
    },

    payrollAdvances: {
      async get(companyId, id, options) {
        const r = await q(`SELECT * FROM payroll_advances WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}${lock(options)}`, [id, companyId]);
        return r.rows[0] ? advanceOf(r.rows[0]) : null;
      },
      async getMany(ids, options) {
        if (ids.length === 0) return [];
        return (await q(`SELECT * FROM payroll_advances WHERE id = ANY($1::uuid[]) ORDER BY id${lock(options)}`, [ids])).rows.map(advanceOf);
      },
      async list(companyId, query) {
        const params: unknown[] = [];
        const where = advanceWhere(companyId, query, params);
        const from = "payroll_advances a LEFT JOIN employees e ON e.id = a.employee_id";
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const r = await q(`SELECT a.*, e.name AS employee_name, e.employee_code FROM ${from} WHERE ${where} ORDER BY a.advance_date DESC, a.entry_no DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: withPerson(r.rows, advanceOf), total };
      },
      async summary(companyId, query) {
        const params: unknown[] = [];
        const where = advanceWhere(companyId, query, params);
        const r = await q(
          `WITH f AS (SELECT a.* FROM payroll_advances a LEFT JOIN employees e ON e.id = a.employee_id WHERE ${where})
           SELECT COALESCE(SUM(amount_paise) FILTER (WHERE NOT is_carry_forward), 0) AS issued,
                  COALESCE(SUM(recovered_amount_paise), 0) - COALESCE((SELECT SUM(c.amount_paise) FROM payroll_advances c WHERE c.parent_advance_id IN (SELECT id FROM f)), 0) AS recovered,
                  COALESCE(SUM(GREATEST(amount_paise - recovered_amount_paise, 0)), 0) AS outstanding, COUNT(*) FILTER (WHERE NOT is_settled) AS open FROM f`,
          params,
        );
        const x = r.rows[0];
        return { issuedPaise: toBigInt(x.issued), recoveredPaise: toBigInt(x.recovered), outstandingPaise: toBigInt(x.outstanding), open: Number(x.open) };
      },
      async openFor(employeeIds, options) {
        if (employeeIds.length === 0) return [];
        return (await q(`SELECT * FROM payroll_advances WHERE employee_id = ANY($1::uuid[]) AND deleted_at IS NULL AND NOT is_settled ORDER BY advance_date, entry_no${lock(options)}`, [employeeIds])).rows.map(advanceOf);
      },
      async carriedBy(processingIds) {
        if (processingIds.length === 0) return [];
        return (await q("SELECT * FROM payroll_advances WHERE source_salary_processing_id = ANY($1::uuid[]) ORDER BY entry_no", [processingIds])).rows.map(advanceOf);
      },
      async figures(companyId) {
        const r = await q("SELECT COALESCE(SUM(GREATEST(amount_paise - recovered_amount_paise, 0)), 0) AS outstanding, COUNT(*) FILTER (WHERE NOT is_settled) AS open FROM payroll_advances WHERE payroll_company_id = $1 AND deleted_at IS NULL", [companyId]);
        return { outstandingPaise: toBigInt(r.rows[0].outstanding), open: Number(r.rows[0].open) };
      },
      async create(companyId, fields, by) {
        const entryNo = await nextEntryNo(tx, "payroll_advances");
        const r = await guard(
          q(
            `INSERT INTO payroll_advances (payroll_company_id, employee_id, advance_date, amount_paise, deduction_type, deduction_amount_paise, remarks, is_carry_forward, parent_advance_id, source_salary_processing_id, created_by, updated_by, entry_no)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12) RETURNING *`,
            [companyId, fields.employeeId, fields.advanceDate.toISOString(), moneyIn(fields.amountPaise), fields.deductionType, moneyIn(fields.deductionAmountPaise), fields.remarks, fields.isCarryForward ?? false,
              fields.parentAdvanceId ?? null, fields.sourceSalaryProcessingId ?? null, by, entryNo],
          ),
        );
        return advanceOf(r.rows[0]);
      },
      async update(companyId, id, patch, by) {
        const spec: Record<string, Kind> = { employeeId: "text", advanceDate: "ts", amountPaise: "money", deductionType: "text", deductionAmountPaise: "money", remarks: "text" };
        const w = write(spec, patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${w.columns.length + 3}`].join(", ");
        const r = await guard(q(`UPDATE payroll_advances SET ${set} WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL RETURNING *`, [id, companyId, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "advance not found");
        return advanceOf(r.rows[0]);
      },
      async setRecovery(rows) {
        if (rows.length === 0) return;
        await q(
          `UPDATE payroll_advances a SET recovered_amount_paise = v.rec, is_settled = v.done FROM unnest($1::uuid[], $2::bigint[], $3::boolean[]) AS v(id, rec, done) WHERE a.id = v.id`,
          [rows.map((r) => r.id), rows.map((r) => moneyIn(r.recoveredAmountPaise)), rows.map((r) => r.isSettled)],
        );
      },
      async removeCarried(ids) {
        if (ids.length === 0) return;
        await q("DELETE FROM payroll_advances WHERE id = ANY($1::uuid[])", [ids]);
      },
      async softDelete(companyId, id, by) {
        return (await q("UPDATE payroll_advances SET deleted_at = now(), deleted_by = $3 WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL", [id, companyId, by])).affectedRows > 0;
      },
      async restore(companyId, id) {
        return (await q("UPDATE payroll_advances SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId])).affectedRows > 0;
      },
      async purge(companyId, id) {
        return (await guard(q("DELETE FROM payroll_advances WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId]))).affectedRows > 0;
      },
    },

    bonuses: {
      async get(companyId, id, options) {
        const r = await q(`SELECT * FROM bonus_incentives WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}${lock(options)}`, [id, companyId]);
        return r.rows[0] ? bonusOf(r.rows[0]) : null;
      },
      async list(companyId, query) {
        const params: unknown[] = [];
        const where = bonusWhere(companyId, query, params);
        const from = "bonus_incentives b LEFT JOIN employees e ON e.id = b.employee_id";
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const r = await q(`SELECT b.*, e.name AS employee_name, e.employee_code FROM ${from} WHERE ${where} ORDER BY b.entry_date DESC, b.entry_no DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: withPerson(r.rows, bonusOf), total };
      },
      async summary(companyId, query) {
        const params: unknown[] = [];
        const where = bonusWhere(companyId, query, params);
        const r = await q(
          `SELECT COALESCE(SUM(b.amount_paise) FILTER (WHERE b.type = 'Bonus'), 0) AS bonus, COALESCE(SUM(b.amount_paise) FILTER (WHERE b.type = 'Incentive'), 0) AS incentive, COUNT(DISTINCT b.employee_id) AS people
             FROM bonus_incentives b LEFT JOIN employees e ON e.id = b.employee_id WHERE ${where}`,
          params,
        );
        const x = r.rows[0];
        return { bonusPaise: toBigInt(x.bonus), incentivePaise: toBigInt(x.incentive), people: Number(x.people) };
      },
      async inMonth(employeeIds, from, to) {
        if (employeeIds.length === 0) return [];
        return (await q("SELECT * FROM bonus_incentives WHERE employee_id = ANY($1::uuid[]) AND deleted_at IS NULL AND entry_date >= $2 AND entry_date <= $3 ORDER BY entry_no", [employeeIds, from.toISOString(), to.toISOString()])).rows.map(bonusOf);
      },
      async create(companyId, fields, by) {
        const entryNo = await nextEntryNo(tx, "bonus_incentives");
        const r = await guard(
          q("INSERT INTO bonus_incentives (payroll_company_id, employee_id, entry_date, type, amount_paise, remarks, created_by, updated_by, entry_no) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8) RETURNING *", [
            companyId, fields.employeeId, fields.entryDate.toISOString(), fields.type, moneyIn(fields.amountPaise), fields.remarks, by, entryNo,
          ]),
        );
        return bonusOf(r.rows[0]);
      },
      async update(companyId, id, patch, by) {
        const spec: Record<string, Kind> = { employeeId: "text", entryDate: "ts", type: "text", amountPaise: "money", remarks: "text" };
        const w = write(spec, patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${w.columns.length + 3}`].join(", ");
        const r = await guard(q(`UPDATE bonus_incentives SET ${set} WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL RETURNING *`, [id, companyId, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "bonus not found");
        return bonusOf(r.rows[0]);
      },
      async softDelete(companyId, id, by) {
        return (await q("UPDATE bonus_incentives SET deleted_at = now(), deleted_by = $3 WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL", [id, companyId, by])).affectedRows > 0;
      },
      async restore(companyId, id) {
        return (await q("UPDATE bonus_incentives SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId])).affectedRows > 0;
      },
      async purge(companyId, id) {
        return (await guard(q("DELETE FROM bonus_incentives WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId]))).affectedRows > 0;
      },
    },

    payrollRun: {
      async assignments(employeeIds) {
        if (employeeIds.length === 0) return [];
        const r = await q(
          "SELECT a.id, a.employee_id, d.name AS deduction_name, a.deduction_type, a.amount_paise, a.is_settled FROM employee_deductions a LEFT JOIN deductions d ON d.id = a.deduction_id WHERE a.employee_id = ANY($1::uuid[]) ORDER BY a.created_at, a.id",
          [employeeIds],
        );
        return r.rows.map((x) => ({ id: String(x.id), employeeId: String(x.employee_id), deductionName: asText(x.deduction_name), deductionType: x.deduction_type as "One Time" | "Monthly", amountPaise: toBigInt(x.amount_paise), isSettled: x.is_settled === true }));
      },
      async setSettled(ids, settled) {
        if (ids.length === 0) return;
        await q("UPDATE employee_deductions SET is_settled = $2 WHERE id = ANY($1::uuid[])", [ids, settled]);
      },
    },

    meals: {
      async prices(providerId) {
        return (await q("SELECT * FROM food_charge_rates WHERE payroll_company_id = $1 ORDER BY effective_from, created_at, id", [providerId])).rows.map(priceOf);
      },
      async priceOn(providerId, day) {
        const r = await q("SELECT * FROM food_charge_rates WHERE payroll_company_id = $1 AND effective_from = $2 ORDER BY created_at, id LIMIT 1", [providerId, day]);
        return r.rows[0] ? priceOf(r.rows[0]) : null;
      },
      async getPrice(providerId, id) {
        const r = await q("SELECT * FROM food_charge_rates WHERE payroll_company_id = $1 AND id = $2", [providerId, id]);
        return r.rows[0] ? priceOf(r.rows[0]) : null;
      },
      async createPrice(providerId, row, by) {
        const r = await guard(q("INSERT INTO food_charge_rates (payroll_company_id, monthly_amount_paise, effective_from, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING *", [providerId, moneyIn(row.monthlyAmountPaise), row.effectiveFrom, by]));
        return priceOf(r.rows[0]);
      },
      async setPrice(id, amount, by) {
        const r = await guard(q("UPDATE food_charge_rates SET monthly_amount_paise = $2, updated_by = $3 WHERE id = $1 RETURNING *", [id, moneyIn(amount), by]));
        if (!r.rows[0]) throw new RepoError("check", "price not found");
        return priceOf(r.rows[0]);
      },
      async removePrice(id) {
        await q("DELETE FROM food_charge_rates WHERE id = $1", [id]);
      },
      async periodsOf(employeeIds) {
        if (employeeIds.length === 0) return [];
        return (await q("SELECT * FROM employee_meal_periods WHERE employee_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY starts_on, id", [employeeIds])).rows.map(periodOf);
      },
      async periodsIn(companyId, from, to) {
        return (await q("SELECT * FROM employee_meal_periods WHERE payroll_company_id = $1 AND deleted_at IS NULL AND starts_on <= $3 AND (ends_on IS NULL OR ends_on >= $2) ORDER BY starts_on, id", [companyId, from, to])).rows.map(periodOf);
      },
      async getPeriod(companyId, id, options) {
        const r = await q(`SELECT * FROM employee_meal_periods WHERE payroll_company_id = $1 AND id = $2 AND deleted_at IS NULL${lock(options)}`, [companyId, id]);
        return r.rows[0] ? periodOf(r.rows[0]) : null;
      },
      async overlapping(employeeId, starts, ends, except) {
        const r = await q(
          "SELECT * FROM employee_meal_periods WHERE employee_id = $1 AND deleted_at IS NULL AND ($4::uuid IS NULL OR id <> $4::uuid) AND starts_on <= COALESCE($3::date, '9999-12-31'::date) AND (ends_on IS NULL OR ends_on >= $2) ORDER BY starts_on, id LIMIT 1",
          [employeeId, starts, ends, except ?? null],
        );
        return r.rows[0] ? periodOf(r.rows[0]) : null;
      },
      async createPeriod(companyId, row, by) {
        const r = await guard(q("INSERT INTO employee_meal_periods (payroll_company_id, employee_id, starts_on, ends_on, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *", [companyId, row.employeeId, row.startsOn, row.endsOn, by]));
        return periodOf(r.rows[0]);
      },
      async setEnd(id, endsOn, by) {
        const r = await guard(q("UPDATE employee_meal_periods SET ends_on = $2, updated_by = $3 WHERE id = $1 RETURNING *", [id, endsOn, by]));
        if (!r.rows[0]) throw new RepoError("check", "meal period not found");
        return periodOf(r.rows[0]);
      },
      async softDeletePeriod(companyId, id, by) {
        return (await q("UPDATE employee_meal_periods SET deleted_at = now(), deleted_by = $3 WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL", [id, companyId, by])).affectedRows > 0;
      },
      async deletedPeriods(companyId) {
        return (await q("SELECT * FROM employee_meal_periods WHERE payroll_company_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id", [companyId])).rows.map(periodOf);
      },
      async restorePeriod(companyId, id) {
        return (await q("UPDATE employee_meal_periods SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId])).affectedRows > 0;
      },
      async purgePeriod(companyId, id) {
        return (await q("DELETE FROM employee_meal_periods WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId])).affectedRows > 0;
      },
      async skippedDays(companyId, year, month) {
        const r = await q(
          `SELECT e.employee_id, array_agg(e.day ORDER BY e.day) AS days FROM attendance_entries e JOIN attendance_months m ON m.id = e.attendance_month_id
            WHERE m.payroll_company_id = $1 AND m.year = $2 AND m.month = $3 AND e.skips_food GROUP BY e.employee_id`,
          [companyId, year, month],
        );
        return new Map(r.rows.map((x) => [String(x.employee_id), (x.days as number[]).map(Number)]));
      },
      async lockedThrough() {
        const r = await q("SELECT year, month FROM salary_processings ORDER BY year DESC, month DESC LIMIT 1");
        return r.rows[0] ? { year: Number(r.rows[0].year), month: Number(r.rows[0].month) } : null;
      },
    },

    letters: {
      async get(companyId, kind) {
        const r = await q(`SELECT * FROM ${LETTER_TABLE[kind]} WHERE payroll_company_id = $1`, [companyId]);
        return r.rows[0] ? letterOf(kind, r.rows[0]) : null;
      },
      async save(companyId, kind, fields: LetterFields, by) {
        const columns: [string, unknown][] = [
          ["subject", fields.subject], ["closing_message", fields.closingMessage], ["use_company_signatory", fields.useCompanySignatory], ["authorized_name", fields.authorizedName],
          ["authorized_designation", fields.authorizedDesignation], ["authorized_closing_text", fields.authorizedClosingText],
          ...LETTER_SECTIONS[kind].map((s): [string, unknown] => [s, fields.sections[s] ?? null]),
          ...(kind === "joining" ? ([["acceptance_heading", fields.acceptanceHeading], ["acceptance_content", fields.acceptanceContent], ["acceptance_closing_text", fields.acceptanceClosingText]] as [string, unknown][]) : []),
        ];
        const params = [companyId, by, ...columns.map(([, v]) => v)];
        const names = columns.map(([c]) => c);
        const r = await guard(
          q(
            `INSERT INTO ${LETTER_TABLE[kind]} (payroll_company_id, created_by, updated_by, ${names.join(", ")}) VALUES ($1, $2, $2, ${names.map((_, i) => `$${i + 3}`).join(", ")})
             ON CONFLICT (payroll_company_id) DO UPDATE SET updated_by = $2, ${names.map((c) => `${c} = EXCLUDED.${c}`).join(", ")} RETURNING *`,
            params,
          ),
        );
        return letterOf(kind, r.rows[0]);
      },
      async setActive(companyId, kind, active, by) {
        const r = await q(`UPDATE ${LETTER_TABLE[kind]} SET is_active = $2, updated_by = $3 WHERE payroll_company_id = $1 RETURNING *`, [companyId, active, by]);
        if (!r.rows[0]) throw new RepoError("check", "letter not found");
        return letterOf(kind, r.rows[0]);
      },
      async remove(companyId, kind) {
        return (await q(`DELETE FROM ${LETTER_TABLE[kind]} WHERE payroll_company_id = $1`, [companyId])).affectedRows > 0;
      },
    },

    separations: {
      async get(companyId, id, options) {
        const r = await q(`SELECT * FROM employee_separations WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}${lock(options)}`, [id, companyId]);
        return r.rows[0] ? separationOf(r.rows[0]) : null;
      },
      async list(companyId, query) {
        const params: unknown[] = [companyId];
        let where = `s.payroll_company_id = $1 AND s.deleted_at IS ${query.deleted === "only" ? "NOT NULL" : "NULL"} AND ${wordsOver(["e.name", "e.employee_code", "s.reason", "s.separation_type", "s.entry_no::text"], query.words, params)}`;
        if (query.lastDay) {
          params.push(query.lastDay.from, query.lastDay.to);
          where += ` AND s.last_working_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`;
        }
        const from = "employee_separations s LEFT JOIN employees e ON e.id = s.employee_id";
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const r = await q(`SELECT s.*, e.name AS employee_name, e.designation FROM ${from} WHERE ${where} ORDER BY s.last_working_date DESC, s.entry_no DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map((x) => ({ ...separationOf(x), employeeName: asText(x.employee_name), designation: asText(x.designation) })), total };
      },
      async counts(companyId, lastDay) {
        const params: unknown[] = [companyId];
        let where = "payroll_company_id = $1 AND deleted_at IS NULL";
        if (lastDay) {
          params.push(lastDay.from, lastDay.to);
          where += " AND last_working_date BETWEEN $2::date AND $3::date";
        }
        const r = await q(
          `SELECT COUNT(*) FILTER (WHERE status <> 'Relieved' AND rejoined_at IS NULL) AS in_notice, COUNT(*) FILTER (WHERE status = 'Relieved' AND rejoined_at IS NULL) AS relieved,
                  COUNT(*) FILTER (WHERE rejoined_at IS NOT NULL) AS rejoined, COUNT(*) AS n,
                  COUNT(*) FILTER (WHERE status = 'Pending') AS pending, COUNT(*) FILTER (WHERE status = 'Accepted') AS accepted, COUNT(*) FILTER (WHERE status = 'Relieved') AS relieved_any
             FROM employee_separations WHERE ${where}`,
          params,
        );
        const x = r.rows[0];
        const byStatus: Record<SeparationStatus, number> = { Pending: Number(x.pending), Accepted: Number(x.accepted), Relieved: Number(x.relieved_any) };
        return { inNotice: Number(x.in_notice), relieved: Number(x.relieved), rejoined: Number(x.rejoined), all: Number(x.n), byStatus };
      },
      async openFor(employeeId, except) {
        const r = await q("SELECT * FROM employee_separations WHERE employee_id = $1 AND deleted_at IS NULL AND rejoined_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid) ORDER BY entry_no LIMIT 1", [employeeId, except ?? null]);
        return r.rows[0] ? separationOf(r.rows[0]) : null;
      },
      async lastDays(employeeIds) {
        if (employeeIds.length === 0) return new Map();
        const r = await q("SELECT employee_id, last_working_date FROM employee_separations WHERE employee_id = ANY($1::uuid[]) AND deleted_at IS NULL AND rejoined_at IS NULL AND status = 'Relieved'", [employeeIds]);
        return new Map(r.rows.map((x) => [String(x.employee_id), String(x.last_working_date)]));
      },
      async create(companyId, fields, by) {
        const entryNo = await nextEntryNo(tx, "employee_separations");
        const w = write(SEPARATION_SPEC, fields);
        const columns = [...w.columns, "payroll_company_id", "created_by", "updated_by", "entry_no"];
        const params = [...w.params, companyId, by, by, entryNo];
        const r = await guard(q(`INSERT INTO employee_separations (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return separationOf(r.rows[0]);
      },
      async update(companyId, id, patch, by) {
        const w = write(SEPARATION_SPEC, patch);
        const set = [...w.columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${w.columns.length + 3}`].join(", ");
        const r = await guard(q(`UPDATE employee_separations SET ${set} WHERE id = $1 AND payroll_company_id = $2 RETURNING *`, [id, companyId, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "separation not found");
        return separationOf(r.rows[0]);
      },
      async softDelete(companyId, id, by) {
        return (await q("UPDATE employee_separations SET deleted_at = now(), deleted_by = $3 WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL", [id, companyId, by])).affectedRows > 0;
      },
      async restore(companyId, id) {
        return (await q("UPDATE employee_separations SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId])).affectedRows > 0;
      },
      async purge(companyId, id) {
        return (await guard(q("DELETE FROM employee_separations WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId]))).affectedRows > 0;
      },
    },
  };
}

export function createPgPayrollPayUnit(withHotel: WithHotel): Unit<PayrollPayRepos> {
  return createPgUnit(withHotel, pgPayrollPayRepos);
}
