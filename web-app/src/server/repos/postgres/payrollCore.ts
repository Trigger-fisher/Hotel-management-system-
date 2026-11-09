import "server-only";
// The Payroll core repositories on PostgreSQL: the fixed payroll companies, staff, deduction types and assignments, attendance marks, months and the
// day-by-day grid, the shared master lists, staff e-mails, the payroll log and the dashboard's setup checks. EVERY read and write is scoped to one
// payroll company. The in-memory double (repos/memory/payrollCore.ts) is the reference for every rule.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type {
  AttendanceEntryRecord, AttendanceMonthRecord, AttendanceStatusRecord, DeductionRecord, EmployeeDeductionRecord, EmployeeFields, EmployeeRecord, PayrollCompanyFields, PayrollCompanyRecord, PayrollCompanyRow,
  PayrollCoreRepos, PayrollMasterItemRecord, StaffEmailFilter, StaffEmailRecord,
} from "../payrollCore";
import { RepoError, type Unit } from "../types";
import { asDate, asText, countTotal, guard, moneyIn, read, write, type Kind } from "./shared";
import { columnSealer } from "./sealedColumns";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

const COMPANY_SPEC: Record<string, Kind> = {
  ownerName: "text", mobileNumber: "text", email: "text", address: "text", city: "text", state: "text", pincode: "text", panNumber: "text", tanNumber: "text", pfRegistrationNumber: "text",
  esicRegistrationNumber: "text", professionalTaxRegistrationNumber: "text", authorizedPersonName: "text", authorizedDesignation: "text", authorizedMobile: "text", authorizedEmail: "text",
  bankName: "text", accountNumber: "text", ifscCode: "text", branchName: "text",
};
const EMPLOYEE_SPEC: Record<string, Kind> = {
  employeeCode: "text", name: "text", designation: "text", department: "text", shift: "text", responsibilities: "text", joiningDate: "date", salaryPaise: "money", dailyWorkingHours: "text",
  contactCountry: "text", contactNumber: "text", address: "text", emergencyContactName: "text", emergencyContactRelation: "text", emergencyContactCountry: "text", emergencyContactNumber: "text",
  paymentMode: "text", bankName: "text", accountHolderName: "text", accountNumber: "text", ifscCode: "text", branchName: "text", idProofType: "text", idProofNumber: "text", email: "text",
  dateOfBirth: "date", gender: "text", nationality: "text", countryAndPincode: "text", qualification: "text", qualificationInstitution: "text", skills: "text", photoPath: "text",
  idProofImagePath: "text", idProofBackImagePath: "text", resumePath: "text",
};
/** The columns the double treats as always-present text; an old row with NULL there reads as "". */
const REQUIRED_TEXT = ["employeeCode", "name", "designation", "joiningDate", "dailyWorkingHours", "contactCountry", "contactNumber", "emergencyContactCountry", "paymentMode", "email"] as const;

const companyOf = (r: Row): PayrollCompanyRecord => ({
  id: String(r.id), name: String(r.name), code: String(r.code), isActive: r.is_active === true, logoPath: asText(r.logo_path), signatureImagePath: asText(r.signature_image_path),
  updatedBy: asText(r.updated_by), createdAt: asDate(r.created_at) as Date, updatedAt: asDate(r.updated_at) as Date, ...(read(COMPANY_SPEC, r) as unknown as PayrollCompanyFields),
});
const employeeOf = (r: Row): EmployeeRecord => {
  const fields = read(EMPLOYEE_SPEC, r) as Record<string, unknown>;
  for (const key of REQUIRED_TEXT) fields[key] ??= "";
  return {
    ...(fields as unknown as EmployeeFields), id: String(r.id), payrollCompanyId: String(r.payroll_company_id), isActive: r.is_active === true, createdBy: asText(r.created_by), updatedBy: asText(r.updated_by),
    deletedAt: asDate(r.deleted_at), deletedBy: asText(r.deleted_by), createdAt: asDate(r.created_at) as Date, updatedAt: asDate(r.updated_at) as Date,
  };
};
const empDedOf = (r: Row): EmployeeDeductionRecord => ({ id: String(r.id), employeeId: String(r.employee_id), deductionId: String(r.deduction_id), deductionType: r.deduction_type as EmployeeDeductionRecord["deductionType"], amountPaise: toBigInt(r.amount_paise), isSettled: r.is_settled === true });
const deductionOf = (r: Row): DeductionRecord => ({ id: String(r.id), payrollCompanyId: String(r.payroll_company_id), name: String(r.name), amountPaise: toBigInt(r.amount_paise), isActive: r.is_active === true, createdAt: asDate(r.created_at) as Date });
const statusOf = (r: Row): AttendanceStatusRecord => ({
  id: String(r.id), payrollCompanyId: String(r.payroll_company_id), name: String(r.name), shortcutKey: String(r.shortcut_key), color: String(r.color), attendancePercentage: Number(r.attendance_percentage) as AttendanceStatusRecord["attendancePercentage"],
  statusType: r.status_type as AttendanceStatusRecord["statusType"], skipsFood: r.skips_food === true, isActive: r.is_active === true, createdAt: asDate(r.created_at) as Date,
});
const monthOf = (r: Row): AttendanceMonthRecord => ({
  id: String(r.id), payrollCompanyId: String(r.payroll_company_id), year: Number(r.year), month: Number(r.month), isLocked: r.is_locked === true, lockedAt: asDate(r.locked_at), salaryGeneratedAt: asDate(r.salary_generated_at),
  salaryGeneratedBy: asText(r.salary_generated_by), generationCount: Number(r.generation_count), unlockedBy: asText(r.unlocked_by), unlockedAt: asDate(r.unlocked_at), unlockSessionId: asText(r.unlock_session_id),
});
const entryOf = (r: Row): AttendanceEntryRecord => ({
  employeeId: String(r.employee_id), day: Number(r.day), attendanceStatusId: asText(r.attendance_status_id), shortcutKey: asText(r.shortcut_key), attendancePercentage: Number(r.attendance_percentage),
  overtimeHours: String(r.overtime_hours), skipsFood: r.skips_food === true,
});
const masterOf = (r: Row): PayrollMasterItemRecord => ({
  id: String(r.id), payrollCompanyId: asText(r.payroll_company_id), list: r.list as PayrollMasterItemRecord["list"], label: String(r.label), value: asText(r.value), isActive: r.is_active === true, sortOrder: Number(r.sort_order),
});
const emailOf = (r: Row): StaffEmailRecord => ({
  id: String(r.id), payrollCompanyId: String(r.payroll_company_id), employeeId: asText(r.employee_id), employeeName: String(r.employee_name), employeeCode: asText(r.employee_code), designation: asText(r.designation),
  recipientId: asText(r.recipient_id), recipientName: asText(r.recipient_name), recipientEmail: asText(r.recipient_email), subject: asText(r.subject), attachment: asText(r.attachment),
  attachmentBytes: r.attachment_bytes === null ? null : Number(r.attachment_bytes), status: r.status as StaffEmailRecord["status"], message: asText(r.message), error: asText(r.error),
  durationMs: r.duration_ms === null ? null : Number(r.duration_ms), sentBy: asText(r.sent_by), sentByName: asText(r.sent_by_name), ipAddress: asText(r.ip_address), finishedAt: asDate(r.finished_at), createdAt: asDate(r.created_at) as Date,
});

function words(columns: string[], list: readonly string[] | undefined, params: unknown[]): string {
  if (!list || list.length === 0) return "true";
  return list
    .map((w) => {
      params.push(w.toLowerCase());
      return `position($${params.length}::text in lower(concat_ws(' ', ${columns.join(", ")}))) > 0`;
    })
    .join(" AND ");
}
const startsWith = (column: string, param: string): string => `left(lower(${column}), length(${param}::text)) = lower(${param}::text)`;
/** "Name order" as the double sorts it: ignoring case, ties by the plain text, then the id. */
const NAME_ORDER = 'lower(e.name) COLLATE "C", e.name COLLATE "C", e.id';
const FIXED_ORDER = "CASE c.code WHEN 'HP01' THEN 1 WHEN 'PF01' THEN 2 ELSE 99 END";

export function pgPayrollCoreRepos(tx: TxClient, hotelId: string): PayrollCoreRepos {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  // decision 74: the staff and company numbers are written sealed beside the plain column and read opened (repos/postgres/sealedColumns.ts)
  const sealer = columnSealer(hotelId);
  const company = (r: Row): PayrollCompanyRecord => companyOf(sealer.row("payroll_companies", r));
  const employee = (r: Row): EmployeeRecord => employeeOf(sealer.row("employees", r));

  const companyRows = async (where: string, params: unknown[]): Promise<PayrollCompanyRow[]> => {
    const r = await q(
      `SELECT c.*, COALESCE(n.total, 0) AS staff_count, COALESCE(n.active, 0) AS active_staff_count FROM payroll_companies c
         LEFT JOIN (SELECT payroll_company_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active) AS active FROM employees WHERE deleted_at IS NULL GROUP BY payroll_company_id) n ON n.payroll_company_id = c.id
        WHERE ${where} ORDER BY ${FIXED_ORDER}, lower(c.name) COLLATE "C", c.name COLLATE "C"`,
      params,
    );
    return r.rows.map((x) => ({ ...company(x), staffCount: Number(x.staff_count), activeStaffCount: Number(x.active_staff_count) }));
  };

  /** The StaffEmail filter (status with the stalled rule, the IST day window, the words). `staleBefore` is the service clock minus the stall limit. */
  const emailWhere = (companyId: string, f: StaffEmailFilter & { staleBefore: Date }, params: unknown[]): string => {
    params.push(companyId);
    const parts = [`payroll_company_id = $${params.length}::uuid`, words(["employee_name", "employee_code", "recipient_name", "recipient_email", "sent_by_name"], f.words, params)];
    if (f.status === "sent") parts.push("status = 'sent'");
    if (f.status === "sending" || f.status === "failed") {
      // only the two statuses that care about a stalled send mention the cut-off: an unused parameter would be refused by the server
      params.push(f.staleBefore.toISOString());
      const stale = `(status = 'sending' AND created_at < $${params.length})`;
      parts.push(f.status === "sending" ? `(status = 'sending' AND NOT ${stale})` : `(status = 'failed' OR ${stale})`);
    }
    if (f.from) {
      params.push(f.from);
      parts.push(`(created_at AT TIME ZONE 'Asia/Kolkata')::date >= $${params.length}`);
    }
    if (f.to) {
      params.push(f.to);
      parts.push(`(created_at AT TIME ZONE 'Asia/Kolkata')::date <= $${params.length}`);
    }
    return parts.join(" AND ");
  };

  return {
    payrollCompanies: {
      async get(id, options) {
        const r = await q(`SELECT * FROM payroll_companies WHERE id = $1${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return r.rows[0] ? company(r.rows[0]) : null;
      },
      async list(query) {
        const params: unknown[] = [];
        let where = words(["c.name", "c.code", "c.owner_name"], query.words, params);
        if (query.active !== undefined) {
          params.push(query.active);
          where += ` AND c.is_active = $${params.length}`;
        }
        return companyRows(where, params);
      },
      async row(id) {
        return (await companyRows("c.id = $1", [id]))[0] ?? null;
      },
      async update(id, patch, by) {
        const w = sealer.write("payroll_companies", write(COMPANY_SPEC, patch));
        const set = [...w.columns.map((c, i) => `${c} = $${i + 2}`), `updated_by = $${w.columns.length + 2}`].join(", ");
        const r = await guard(q(`UPDATE payroll_companies SET ${set} WHERE id = $1 RETURNING *`, [id, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "payroll company not found");
        return company(r.rows[0]);
      },
    },

    employees: {
      async get(companyId, id, options) {
        const r = await q(`SELECT * FROM employees WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}${options?.forUpdate ? " FOR UPDATE" : ""}`, [id, companyId]);
        return r.rows[0] ? employee(r.rows[0]) : null;
      },
      async ownIds(companyId, ids) {
        if (ids.length === 0) return [];
        return (await q("SELECT id FROM employees WHERE payroll_company_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])", [companyId, ids])).rows.map((r) => String(r.id));
      },
      async getMany(companyId, ids) {
        if (ids.length === 0) return [];
        return (await q("SELECT * FROM employees WHERE payroll_company_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])", [companyId, ids])).rows.map(employee);
      },
      async list(companyId, query) {
        const params: unknown[] = [companyId];
        let where = `e.payroll_company_id = $1 AND e.deleted_at IS ${query.deleted === "only" ? "NOT NULL" : "NULL"} AND ${words(["e.name", "e.employee_code", "e.designation", "e.department", "e.email", "e.contact_number"], query.words, params)}`;
        if (query.active !== undefined) {
          params.push(query.active);
          where += ` AND e.is_active = $${params.length}`;
        }
        const order =
          query.sort === "name" ? NAME_ORDER : query.sort === "active" ? `e.is_active DESC, ${NAME_ORDER}` : query.sort === "updated" ? "e.updated_at DESC, e.id DESC" : "e.joining_date DESC, e.id DESC";
        const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM employees e WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const r = await q(`SELECT e.* FROM employees e WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(employee), total };
      },
      async lookup(companyId, query) {
        const params: unknown[] = [companyId, query.prefix, query.limit];
        let active = "";
        if (query.active !== undefined) {
          params.push(query.active);
          active = ` AND e.is_active = $${params.length}`;
        }
        const r = await q(
          `SELECT e.* FROM employees e WHERE e.payroll_company_id = $1 AND e.deleted_at IS NULL AND (${startsWith("e.name", "$2")} OR ${startsWith("e.employee_code", "$2")})${active} ORDER BY e.is_active DESC, ${NAME_ORDER} LIMIT $3`,
          params,
        );
        return r.rows.map(employee);
      },
      async codeTaken(companyId, code, except) {
        const r = await q("SELECT 1 AS x FROM employees WHERE payroll_company_id = $1 AND deleted_at IS NULL AND lower(employee_code) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1", [companyId, code, except ?? null]);
        return r.rows.length > 0;
      },
      async emailTaken(companyId, email, except) {
        const r = await q("SELECT 1 AS x FROM employees WHERE payroll_company_id = $1 AND deleted_at IS NULL AND lower(email) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1", [companyId, email, except ?? null]);
        return r.rows.length > 0;
      },
      async counts(companyId) {
        const r = await q("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active) AS active FROM employees WHERE payroll_company_id = $1 AND deleted_at IS NULL", [companyId]);
        return { active: Number(r.rows[0].active), all: Number(r.rows[0].total) };
      },
      async blockingDependency(id, opts) {
        const r = await q(
          `SELECT EXISTS (SELECT 1 FROM attendance_entries WHERE employee_id = $1) AS attendance, EXISTS (SELECT 1 FROM payroll_advances WHERE employee_id = $1) AS advance,
                  EXISTS (SELECT 1 FROM bonus_incentives WHERE employee_id = $1) AS bonus, EXISTS (SELECT 1 FROM salary_processings WHERE employee_id = $1) AS salary,
                  EXISTS (SELECT 1 FROM staff_advances WHERE employee_id = $1) AS staff_advance,
                  EXISTS (SELECT 1 FROM employee_separations WHERE employee_id = $1) AS separation, EXISTS (SELECT 1 FROM employee_meal_periods WHERE employee_id = $1) AS meals`,
          [id],
        );
        const x = r.rows[0];
        if (x.attendance === true) return "Attendance Management";
        if (x.advance === true) return "Advance Management";
        if (x.bonus === true) return "Bonus & Incentive Management";
        if (x.salary === true) return "Salary Processing";
        if (x.staff_advance === true) return "Staff Advance Salaries";
        // removal for good only: these point at the person ON DELETE RESTRICT, deleted rows included
        if (opts?.purge && x.separation === true) return "Separation Management";
        if (opts?.purge && x.meals === true) return "Meals Management";
        return null;
      },
      async create(companyId, fields, by) {
        const w = sealer.write("employees", write(EMPLOYEE_SPEC, fields));
        const columns = [...w.columns, "payroll_company_id", "created_by", "updated_by"];
        const params = [...w.params, companyId, by, by];
        const r = await guard(q(`INSERT INTO employees (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
        return employee(r.rows[0]);
      },
      async update(companyId, id, patch, by) {
        const w = sealer.write("employees", write(EMPLOYEE_SPEC, patch));
        const set = [...w.columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${w.columns.length + 3}`].join(", ");
        const r = await guard(q(`UPDATE employees SET ${set} WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL RETURNING *`, [id, companyId, ...w.params, by]));
        if (!r.rows[0]) throw new RepoError("check", "employee not found");
        return employee(r.rows[0]);
      },
      async setActive(companyId, id, active, by) {
        const r = await q("UPDATE employees SET is_active = $3, updated_by = $4 WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL RETURNING *", [id, companyId, active, by]);
        if (!r.rows[0]) throw new RepoError("check", "employee not found");
        return employee(r.rows[0]);
      },
      async softDelete(companyId, id, by) {
        return (await q("UPDATE employees SET deleted_at = now(), deleted_by = $3 WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NULL", [id, companyId, by])).affectedRows > 0;
      },
      async restore(companyId, id) {
        return (await guard(q("UPDATE employees SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId]))).affectedRows > 0;
      },
      async purge(companyId, id) {
        return (await guard(q("DELETE FROM employees WHERE id = $1 AND payroll_company_id = $2 AND deleted_at IS NOT NULL", [id, companyId]))).affectedRows > 0;
      },
    },

    employeeDeductions: {
      async forEmployees(employeeIds) {
        if (employeeIds.length === 0) return [];
        return (await q("SELECT * FROM employee_deductions WHERE employee_id = ANY($1::uuid[]) ORDER BY created_at, id", [employeeIds])).rows.map(empDedOf);
      },
      async sync(employeeId, rows, by) {
        const keptIds = rows.map((r) => r.id).filter((x): x is string => Boolean(x));
        // delete what is not kept, update the kept ones that are this employee's, insert the rest: one statement per kind, never per row
        await q("DELETE FROM employee_deductions WHERE employee_id = $1 AND NOT (id = ANY($2::uuid[]))", [employeeId, keptIds]);
        const withId = rows.filter((r) => r.id);
        const matched = new Set<string>();
        if (withId.length > 0) {
          const upd = await q(
            `UPDATE employee_deductions d SET deduction_id = v.did, deduction_type = v.t, amount_paise = v.a, updated_by = $1
               FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::bigint[]) AS v(id, did, t, a) WHERE d.id = v.id AND d.employee_id = $6 RETURNING d.id`,
            [by, withId.map((r) => r.id), withId.map((r) => r.deductionId), withId.map((r) => r.deductionType), withId.map((r) => moneyIn(r.amountPaise)), employeeId],
          );
          for (const x of upd.rows) matched.add(String(x.id));
        }
        const fresh = rows.filter((r) => !r.id || !matched.has(r.id));
        if (fresh.length > 0) {
          await guard(
            q(
              `INSERT INTO employee_deductions (employee_id, deduction_id, deduction_type, amount_paise, created_by, updated_by)
               SELECT $1, v.did, v.t, v.a, $2, $2 FROM unnest($3::uuid[], $4::text[], $5::bigint[]) AS v(did, t, a)`,
              [employeeId, by, fresh.map((r) => r.deductionId), fresh.map((r) => r.deductionType), fresh.map((r) => moneyIn(r.amountPaise))],
            ),
          );
        }
      },
    },

    deductions: {
      async get(companyId, id) {
        const r = await q("SELECT * FROM deductions WHERE id = $1 AND payroll_company_id = $2", [id, companyId]);
        return r.rows[0] ? deductionOf(r.rows[0]) : null;
      },
      async list(companyId, query) {
        const r = await q(
          `SELECT d.*, COALESCE(n.assigned, 0) AS assigned_count FROM deductions d LEFT JOIN (SELECT deduction_id, COUNT(*) AS assigned FROM employee_deductions GROUP BY deduction_id) n ON n.deduction_id = d.id
            WHERE d.payroll_company_id = $1${query?.activeOnly ? " AND d.is_active" : ""} ORDER BY d.created_at DESC, d.id DESC`,
          [companyId],
        );
        return r.rows.map((x) => ({ ...deductionOf(x), assignedCount: Number(x.assigned_count) }));
      },
      async ownIds(companyId, ids) {
        if (ids.length === 0) return [];
        return (await q("SELECT id FROM deductions WHERE payroll_company_id = $1 AND id = ANY($2::uuid[])", [companyId, ids])).rows.map((r) => String(r.id));
      },
      async nameTaken(companyId, name, except) {
        const r = await q("SELECT 1 AS x FROM deductions WHERE payroll_company_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1", [companyId, name, except ?? null]);
        return r.rows.length > 0;
      },
      async isAssigned(id) {
        return (await q("SELECT 1 AS x FROM employee_deductions WHERE deduction_id = $1 LIMIT 1", [id])).rows.length > 0;
      },
      async any(companyId) {
        return (await q("SELECT 1 AS x FROM deductions WHERE payroll_company_id = $1 LIMIT 1", [companyId])).rows.length > 0;
      },
      async create(companyId, fields, by) {
        const r = await guard(q("INSERT INTO deductions (payroll_company_id, name, amount_paise, created_by) VALUES ($1, $2, $3, $4) RETURNING *", [companyId, fields.name, moneyIn(fields.amountPaise), by]));
        return deductionOf(r.rows[0]);
      },
      async update(companyId, id, patch, by) {
        const sets: string[] = [];
        const params: unknown[] = [id, companyId];
        if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
        if (patch.amountPaise !== undefined) { params.push(moneyIn(patch.amountPaise)); sets.push(`amount_paise = $${params.length}`); }
        if (patch.isActive !== undefined) { params.push(patch.isActive); sets.push(`is_active = $${params.length}`); }
        params.push(by);
        sets.push(`updated_by = $${params.length}`);
        const r = await guard(q(`UPDATE deductions SET ${sets.join(", ")} WHERE id = $1 AND payroll_company_id = $2 RETURNING *`, params));
        if (!r.rows[0]) throw new RepoError("check", "deduction not found");
        return deductionOf(r.rows[0]);
      },
      async remove(companyId, id) {
        return (await q("DELETE FROM deductions WHERE id = $1 AND payroll_company_id = $2", [id, companyId])).affectedRows > 0;
      },
    },

    attendanceStatuses: {
      async get(companyId, id) {
        const r = await q("SELECT * FROM attendance_statuses WHERE id = $1 AND payroll_company_id = $2", [id, companyId]);
        return r.rows[0] ? statusOf(r.rows[0]) : null;
      },
      async list(companyId, query) {
        const order = query.order === "name" ? 'lower(name) COLLATE "C", name COLLATE "C", id' : "created_at DESC, id DESC";
        return (await q(`SELECT * FROM attendance_statuses WHERE payroll_company_id = $1${query.activeOnly ? " AND is_active" : ""} ORDER BY ${order}`, [companyId])).rows.map(statusOf);
      },
      async usedCounts(companyId) {
        // one count per status from the attendance_status_id index (an index-only scan: about 3x faster than joining every entry on a year of attendance)
        const r = await q("SELECT s.id, (SELECT COUNT(*) FROM attendance_entries e WHERE e.attendance_status_id = s.id) AS n FROM attendance_statuses s WHERE s.payroll_company_id = $1", [companyId]);
        return new Map(r.rows.map((x) => [String(x.id), Number(x.n)]));
      },
      async shortcutTaken(companyId, key, except) {
        const r = await q("SELECT 1 AS x FROM attendance_statuses WHERE payroll_company_id = $1 AND lower(shortcut_key) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1", [companyId, key, except ?? null]);
        return r.rows.length > 0;
      },
      async colorTaken(companyId, color, except) {
        const r = await q("SELECT 1 AS x FROM attendance_statuses WHERE payroll_company_id = $1 AND lower(color) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1", [companyId, color, except ?? null]);
        return r.rows.length > 0;
      },
      async isUsed(id) {
        return (await q("SELECT 1 AS x FROM attendance_entries WHERE attendance_status_id = $1 LIMIT 1", [id])).rows.length > 0;
      },
      async create(companyId, fields) {
        const r = await guard(
          q("INSERT INTO attendance_statuses (payroll_company_id, name, shortcut_key, color, attendance_percentage, status_type, skips_food) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", [
            companyId, fields.name, fields.shortcutKey, fields.color, fields.attendancePercentage, fields.statusType, fields.skipsFood,
          ]),
        );
        return statusOf(r.rows[0]);
      },
      async update(companyId, id, patch) {
        const map: Record<string, string> = { name: "name", shortcutKey: "shortcut_key", color: "color", attendancePercentage: "attendance_percentage", statusType: "status_type", skipsFood: "skips_food", isActive: "is_active" };
        const sets: string[] = [];
        const params: unknown[] = [id, companyId];
        for (const [field, value] of Object.entries(patch)) {
          if (value === undefined || !map[field]) continue;
          params.push(value);
          sets.push(`${map[field]} = $${params.length}`);
        }
        const r = await guard(q(`UPDATE attendance_statuses SET ${sets.length ? sets.join(", ") : "id = id"} WHERE id = $1 AND payroll_company_id = $2 RETURNING *`, params));
        if (!r.rows[0]) throw new RepoError("check", "status not found");
        return statusOf(r.rows[0]);
      },
      async remove(companyId, id) {
        return (await q("DELETE FROM attendance_statuses WHERE id = $1 AND payroll_company_id = $2", [id, companyId])).affectedRows > 0;
      },
    },

    attendance: {
      async month(companyId, year, month, options) {
        // firstOrCreate: INSERT ... ON CONFLICT DO NOTHING, then SELECT (FOR UPDATE when asked), so two first opens make one row
        await guard(q("INSERT INTO attendance_months (payroll_company_id, year, month) VALUES ($1, $2, $3) ON CONFLICT (payroll_company_id, year, month) DO NOTHING", [companyId, year, month]));
        const r = await q(`SELECT * FROM attendance_months WHERE payroll_company_id = $1 AND year = $2 AND month = $3${options?.forUpdate ? " FOR UPDATE" : ""}`, [companyId, year, month]);
        return monthOf(r.rows[0]);
      },
      async findMonth(companyId, year, month) {
        const r = await q("SELECT * FROM attendance_months WHERE payroll_company_id = $1 AND year = $2 AND month = $3", [companyId, year, month]);
        return r.rows[0] ? monthOf(r.rows[0]) : null;
      },
      async updateMonth(id, patch) {
        const map: Record<string, string> = {
          isLocked: "is_locked", lockedAt: "locked_at", salaryGeneratedAt: "salary_generated_at", salaryGeneratedBy: "salary_generated_by", generationCount: "generation_count", unlockedBy: "unlocked_by",
          unlockedAt: "unlocked_at", unlockSessionId: "unlock_session_id",
        };
        const sets: string[] = [];
        const params: unknown[] = [id];
        for (const [field, value] of Object.entries(patch)) {
          if (value === undefined || !map[field]) continue;
          params.push(value instanceof Date ? value.toISOString() : value);
          sets.push(`${map[field]} = $${params.length}`);
        }
        const r = await guard(q(`UPDATE attendance_months SET ${sets.length ? sets.join(", ") : "id = id"} WHERE id = $1 RETURNING *`, params));
        if (!r.rows[0]) throw new RepoError("check", "month not found");
        return monthOf(r.rows[0]);
      },
      async entries(monthId, employeeIds) {
        if (employeeIds.length === 0) return [];
        return (await q("SELECT * FROM attendance_entries WHERE attendance_month_id = $1 AND employee_id = ANY($2::uuid[]) ORDER BY employee_id, day", [monthId, employeeIds])).rows.map(entryOf);
      },
      async filledCount(monthId) {
        return Number((await q("SELECT COUNT(*) AS n FROM attendance_entries WHERE attendance_month_id = $1 AND attendance_status_id IS NOT NULL", [monthId])).rows[0].n);
      },
      async incomplete(companyId, monthId, daysInMonth) {
        const r = await q(
          `SELECT e.name FROM employees e LEFT JOIN (SELECT employee_id, COUNT(*) AS filled FROM attendance_entries WHERE attendance_month_id = $2 AND attendance_status_id IS NOT NULL GROUP BY employee_id) f ON f.employee_id = e.id
            WHERE e.payroll_company_id = $1 AND e.deleted_at IS NULL AND e.is_active AND COALESCE(f.filled, 0) < $3 ORDER BY ${NAME_ORDER}`,
          [companyId, monthId, daysInMonth],
        );
        return r.rows.map((x) => String(x.name));
      },
      async write(monthId, cells) {
        if (cells.clear.length > 0) {
          await q("DELETE FROM attendance_entries WHERE attendance_month_id = $1 AND (employee_id, day) IN (SELECT * FROM unnest($2::uuid[], $3::smallint[]))", [monthId, cells.clear.map((c) => c.employeeId), cells.clear.map((c) => c.day)]);
        }
        if (cells.upsert.length > 0) {
          const u = cells.upsert;
          await guard(
            q(
              `INSERT INTO attendance_entries (attendance_month_id, employee_id, day, attendance_status_id, shortcut_key, attendance_percentage, overtime_hours, skips_food)
               SELECT $1, v.emp, v.day, v.status, v.key, v.pct, v.ot, v.skips FROM unnest($2::uuid[], $3::smallint[], $4::uuid[], $5::text[], $6::smallint[], $7::numeric[], $8::boolean[]) AS v(emp, day, status, key, pct, ot, skips)
               ON CONFLICT (attendance_month_id, employee_id, day) DO UPDATE SET attendance_status_id = EXCLUDED.attendance_status_id, shortcut_key = EXCLUDED.shortcut_key,
                 attendance_percentage = EXCLUDED.attendance_percentage, overtime_hours = EXCLUDED.overtime_hours, skips_food = EXCLUDED.skips_food`,
              [monthId, u.map((c) => c.employeeId), u.map((c) => c.day), u.map((c) => c.attendanceStatusId), u.map((c) => c.shortcutKey), u.map((c) => c.attendancePercentage), u.map((c) => c.overtimeHours), u.map((c) => c.skipsFood)],
            ),
          );
        }
      },
      async followSkipsFood(statusId, skipsFood) {
        const r = await q(
          "UPDATE attendance_entries e SET skips_food = $2 FROM attendance_months m WHERE e.attendance_month_id = m.id AND NOT m.is_locked AND e.attendance_status_id = $1",
          [statusId, skipsFood],
        );
        return r.affectedRows;
      },
    },

    payrollMasters: {
      async active(list, companyId) {
        return this.activeMany([list], companyId);
      },
      async activeMany(lists, companyId) {
        const r = await q(
          "SELECT * FROM payroll_master_items WHERE list = ANY($1::text[]) AND is_active AND (payroll_company_id IS NULL OR payroll_company_id = $2) ORDER BY (payroll_company_id IS NOT NULL), sort_order, label COLLATE \"C\", id",
          [lists, companyId],
        );
        return r.rows.map(masterOf);
      },
    },

    staffEmails: {
      async get(id) {
        const r = await q("SELECT * FROM staff_emails WHERE id = $1", [id]);
        return r.rows[0] ? emailOf(r.rows[0]) : null;
      },
      async list(companyId, query) {
        const params: unknown[] = [];
        const where = emailWhere(companyId, query, params);
        const total = await q(`SELECT COUNT(*) AS n FROM staff_emails WHERE ${where}`, params);
        params.push(query.pageSize, (query.page - 1) * query.pageSize);
        const r = await q(`SELECT * FROM staff_emails WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows.map(emailOf), total: Number(total.rows[0].n) };
      },
      async feed(companyId, query) {
        const params: unknown[] = [];
        let where = emailWhere(companyId, query, params);
        if (query.after !== null) {
          params.push(query.after.toISOString());
          where += ` AND created_at > $${params.length}`;
        }
        const fresh = (await q(`SELECT * FROM staff_emails WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 50`, params)).rows.map(emailOf);
        const watch = query.watch.slice(0, 200);
        const watched = watch.length === 0 ? [] : (await q("SELECT * FROM staff_emails WHERE payroll_company_id = $1 AND id = ANY($2::uuid[])", [companyId, watch])).rows.map(emailOf);
        const all = new Map([...fresh, ...watched].map((r) => [r.id, r]));
        return [...all.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
      },
      async stats(companyId, query) {
        const r = await q(
          `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'sent') AS sent,
                  COUNT(*) FILTER (WHERE status <> 'sent' AND (status = 'failed' OR created_at < $2)) AS failed, COUNT(*) FILTER (WHERE created_at >= $3 AND created_at <= $4) AS today
             FROM staff_emails WHERE payroll_company_id = $1`,
          [companyId, query.staleBefore.toISOString(), query.todayFrom.toISOString(), query.todayTo.toISOString()],
        );
        const x = r.rows[0];
        return { total: Number(x.total), sent: Number(x.sent), failed: Number(x.failed), today: Number(x.today) };
      },
      async open(companyId, row) {
        const r = await guard(
          q(
            `INSERT INTO staff_emails (payroll_company_id, employee_id, employee_name, employee_code, designation, recipient_id, recipient_name, recipient_email, subject, attachment, sent_by, sent_by_name, ip_address, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [companyId, row.employeeId, row.employeeName, row.employeeCode, row.designation, row.recipientId, row.recipientName, row.recipientEmail, row.subject, row.attachment, row.sentBy, row.sentByName, row.ipAddress, row.createdAt.toISOString()],
          ),
        );
        return emailOf(r.rows[0]);
      },
      async finish(id, result) {
        const r = await q(
          "UPDATE staff_emails SET status = $2, message = left($3, 500), error = $4, attachment_bytes = $5, duration_ms = $6, finished_at = now() WHERE id = $1 RETURNING *",
          [id, result.status, result.message, result.error, result.attachmentBytes, result.durationMs],
        );
        if (!r.rows[0]) throw new RepoError("check", "staff email not found");
        return emailOf(r.rows[0]);
      },
    },

    payrollLog: {
      async record(entry) {
        await q(
          "INSERT INTO payroll_logs (payroll_company_id, company_name, user_id, user_name, action, status, entity, subject_id, subject_label, summary, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)",
          [entry.payrollCompanyId, entry.companyName, entry.userId, entry.userName, entry.action, entry.status, entry.entity, entry.subjectId, entry.subjectLabel, entry.summary, entry.details === null ? null : JSON.stringify(entry.details), entry.ipAddress],
        );
      },
    },

    payrollSetup: {
      async setup(companyId) {
        const r = await q(
          `SELECT EXISTS (SELECT 1 FROM attendance_statuses WHERE payroll_company_id = $1 AND is_active) AS status, EXISTS (SELECT 1 FROM employees WHERE payroll_company_id = $1 AND deleted_at IS NULL AND is_active) AS staff,
                  EXISTS (SELECT 1 FROM deductions WHERE payroll_company_id = $1) AS deduction, EXISTS (SELECT 1 FROM joining_letters WHERE payroll_company_id = $1) AS joining,
                  EXISTS (SELECT 1 FROM experience_letters WHERE payroll_company_id = $1) AS experience`,
          [companyId],
        );
        const x = r.rows[0];
        return { hasActiveStatus: x.status === true, hasActiveStaff: x.staff === true, hasDeduction: x.deduction === true, hasJoiningLetter: x.joining === true, hasExperienceLetter: x.experience === true };
      },
      async joiningTemplateActive(companyId) {
        return (await q("SELECT 1 AS x FROM joining_letters WHERE payroll_company_id = $1 AND is_active LIMIT 1", [companyId])).rows.length > 0;
      },
    },
  };
}

export function createPgPayrollCoreUnit(withHotel: WithHotel): Unit<PayrollCoreRepos> {
  return createPgUnit(withHotel, pgPayrollCoreRepos);
}
