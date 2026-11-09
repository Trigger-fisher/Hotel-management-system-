import "server-only";
import { getPayrollDocuments } from "@/server/compose/payrollCore";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The joining letter as a PDF.
export const GET = route({
  permission: { key: "payroll.joining-letter", level: "view" },
  params: companyItemParams,
  handler: async ({ session, params }) => {
    const file = await getPayrollDocuments().joiningLetter(session, params.companyId, params.id);
    const out = await getDocumentRenderer().render("payrollDoc", { doc: file.doc, filename: file.filename });
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
