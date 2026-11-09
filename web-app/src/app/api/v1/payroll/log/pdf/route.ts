import "server-only";
import { getPayrollAdmin } from "@/server/compose/systemAdmin";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { payrollLogDoc } from "@/server/services/systemAdmin/logDocuments";
import { payrollLogPdfQuery } from "@/server/services/systemAdmin/schemas";

// The printed Payroll Log (PayrollLogController::pdf): the same filters as the page, at most 400 entries, newest first. SuperAdmin only.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PDF_LIMIT = 400;

export const GET = route({
  permission: "session",
  query: payrollLogPdfQuery,
  handler: async ({ session, query }) => {
    const { scope, ...q } = query;
    const res = await getPayrollAdmin().log(session, scope, { ...q, page: 1, pageSize: PDF_LIMIT });
    const rows = res.page.items;
    const company = scope === "all" ? null : (rows[0]?.companyName || null);
    const filters = [
      q.view ? { today: "Today", week: "Last 7 days", emails: "Emails", money: "Money", deletions: "Deletions", problems: "Problems" }[q.view] : "",
      q.search ? `search "${q.search}"` : "",
      q.action ? `action: ${q.action}` : "",
      q.entity ? `what: ${q.entity}` : "",
      q.user ? `who: ${q.user}` : "",
      q.status ? `outcome: ${q.status}` : "",
      q.from ? `from ${q.from}` : "",
      q.to ? `to ${q.to}` : "",
    ].filter(Boolean);
    const doc = await getDocumentRenderer().render("payrollDoc", { doc: payrollLogDoc(company, rows, res.page.total > rows.length, filters), filename: `payroll-log-${new Date().toISOString().slice(0, 10)}` });
    return { data: null, binary: { bytes: doc.bytes, contentType: "application/pdf", filename: doc.filename } };
  },
});