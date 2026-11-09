import "server-only";
import { getPayrollDocuments } from "@/server/compose/payrollCore";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The separation record as a PDF.
export const GET = route({
  permission: { key: "payroll.separation", level: "view" },
  params: companyItemParams,
  handler: async ({ session, params }) => {
    const file = await getPayrollDocuments().separationRecord(session, params.companyId, params.id);
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
