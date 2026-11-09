import "server-only";
// Every database column that holds a sealed personal number (decision 74): the plain column (kept until release B), its `<column>_sealed` twin and, for ID numbers, its `<column>_idx`
// search index. ONE list, read by the repositories' helpers (repos/postgres/sealedColumns.ts, sealedNumbers.ts), by `db:cli seal-numbers` and by the tests that keep the SQL lint's
// allowlist equal to it. `field` is the name bound into every sealed value, so a number sealed for one column does not open as another.
export interface SealedColumn {
  table: string;
  column: string;
  field: string;
  /** A search index (`<column>_idx`, 64 hex) is kept beside the sealed value. */
  index: boolean;
  /** The table has a `version` column whose trigger demands +1 on every update (so the backfill raises it). */
  versioned: boolean;
}

export const SEALED_COLUMNS: readonly SealedColumn[] = [
  { table: "customers", column: "id_proof_number", field: "customer.id_proof_number", index: true, versioned: false },
  { table: "pms_stays", column: "id_proof_number", field: "stay.id_proof_number", index: true, versioned: true },
  { table: "employees", column: "id_proof_number", field: "employees.id_proof_number", index: true, versioned: false },
  { table: "employees", column: "account_number", field: "employees.account_number", index: false, versioned: false },
  { table: "employees", column: "ifsc_code", field: "employees.ifsc_code", index: false, versioned: false },
  { table: "payroll_companies", column: "pan_number", field: "payroll_companies.pan_number", index: false, versioned: false },
  { table: "payroll_companies", column: "account_number", field: "payroll_companies.account_number", index: false, versioned: false },
  { table: "payroll_companies", column: "ifsc_code", field: "payroll_companies.ifsc_code", index: false, versioned: false },
  { table: "salary_processings", column: "account_number", field: "salary_processings.account_number", index: false, versioned: true },
  { table: "salary_processings", column: "ifsc_code", field: "salary_processings.ifsc_code", index: false, versioned: true },
];

/** The "table.column" names of every sealed and index column (what the SQL lint's allowlist must hold). */
export function sealedColumnNames(): string[] {
  return SEALED_COLUMNS.flatMap((c) => [`${c.table}.${c.column}_sealed`, ...(c.index ? [`${c.table}.${c.column}_idx`] : [])]);
}
