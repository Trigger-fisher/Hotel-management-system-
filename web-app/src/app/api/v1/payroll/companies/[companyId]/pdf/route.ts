import "server-only";
import { getPayrollCompanies } from "@/server/compose/payrollCore";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { companyParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A payroll company's details as a PDF: the same fields and permission as the screen (any payroll part's view, checked by the service); the account number by its last four digits only.
export const GET = route({
  permission: "session",
  params: companyParams,
  handler: async ({ session, params }) => {
    const file = await getPayrollCompanies().document(session, params.companyId);
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
