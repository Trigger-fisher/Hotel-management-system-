import "server-only";
import type { PayrollCompanyRow } from "@shared/dashboards/payrollCore";
import type { DocBlock, PayrollDoc } from "@shared/dashboards/payrollPay";

// A payroll company's details as the document the PDF draws: the SAME fields the screen shows, on the company's own header. The account number is printed in full,
// as Pallav's payroll company PDF does. Spec: docs/specs/documents.md.

const shown = (items: { label: string; value: string | null | undefined }[]) => items.filter((i) => i.value !== null && i.value !== undefined && i.value !== "").map((i) => ({ label: i.label, value: String(i.value) }));

export function payrollCompanyDoc(c: PayrollCompanyRow): PayrollDoc {
  const blocks: DocBlock[] = [
    { kind: "kv", title: "Company", items: shown([{ label: "Name", value: c.name }, { label: "Code", value: c.code }, { label: "Owner", value: c.ownerName }, { label: "Mobile", value: c.mobileNumber }, { label: "Email", value: c.email }, { label: "Address", value: [c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ") }, { label: "Staff", value: `${c.activeStaffCount} active of ${c.staffCount}` }]) },
    { kind: "kv", title: "Registrations", items: shown([{ label: "PAN", value: c.panNumber }, { label: "TAN", value: c.tanNumber }, { label: "PF", value: c.pfRegistrationNumber }, { label: "ESIC", value: c.esicRegistrationNumber }, { label: "Professional tax", value: c.professionalTaxRegistrationNumber }]) },
    { kind: "kv", title: "Authorised person", items: shown([{ label: "Name", value: c.authorizedPersonName }, { label: "Designation", value: c.authorizedDesignation }, { label: "Mobile", value: c.authorizedMobile }, { label: "Email", value: c.authorizedEmail }]) },
    { kind: "kv", title: "Bank", items: shown([{ label: "Bank", value: c.bankName }, { label: "Branch", value: c.branchName }, { label: "Account number", value: c.accountNumber }, { label: "IFSC", value: c.ifscCode }]) },
  ];
  return { companyName: c.name, companyLine: [c.address, c.city].filter(Boolean).join(", "), title: "Company details", subtitle: c.code, blocks: blocks.filter((b) => b.kind !== "kv" || b.items.length > 0) };
}
