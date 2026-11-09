import "server-only";
import { getPayrollDocuments } from "@/server/compose/payrollCore";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { companyParams, periodQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The monthly salary report as a PDF.
export const GET = route({
  permission: { key: "payroll.monthly-report", level: "view" },
  params: companyParams,
  query: periodQuery,
  handler: async ({ session, params, query }) => {
    const file = await getPayrollDocuments().monthlyReport(session, params.companyId, query.period);
    const out = await getDocumentRenderer().render("payrollDoc", { doc: file.doc, filename: file.filename });
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
