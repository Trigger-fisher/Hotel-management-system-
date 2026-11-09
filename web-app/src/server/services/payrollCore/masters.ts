import "server-only";
import type { PayrollMasterList, PayrollMasterItemRecord } from "../../repos/payrollCore";
import type { PayrollUnitRepos } from "./context";

// Pallav Support/PayrollMasters.php: the lists the SuperAdmin keeps in Payroll Master (managed by the admin task; read here). A list with
// nothing active falls back to Pallav's built-in defaults (`choices`, :101-112); the share recipients have none.
const DEFAULTS: Record<PayrollMasterList, readonly string[]> = {
  share_emails: [],
  designations: [],
  departments: [],
  gender: ["Male", "Female", "Other"],
  separation_type: ["Resignation", "Termination", "Retirement", "End of Contract"],
  id_proofs: ["Aadhaar Card", "PAN Card", "Passport", "Driving Licence", "Voter ID"],
  salary_payment_mode: ["Cash", "Bank"],
};

/** The mode named exactly this asks for the bank details (EmployeeController `required_if:payment_mode,Bank`). */
export const BANK_MODE = "Bank";

/** labels() then the defaults: unique labels in the master's order (shared first, then the company's, by sort order and label). */
export function choicesFrom(items: readonly PayrollMasterItemRecord[], list: PayrollMasterList): string[] {
  const labels = [...new Set(items.filter((i) => i.list === list).map((i) => i.label))];
  return labels.length > 0 ? labels : [...DEFAULTS[list]];
}

export async function choices(repos: PayrollUnitRepos, list: PayrollMasterList, companyId: string): Promise<string[]> {
  return choicesFrom(await repos.payrollMasters.active(list, companyId), list);
}
