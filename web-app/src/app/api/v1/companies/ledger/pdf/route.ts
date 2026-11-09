import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { ledgerOverviewQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The company ledger overview as a PDF: every company the filter shows, with the same stats and permission as the screen.
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  query: ledgerOverviewQuery,
  handler: async ({ session, query }) => {
    const file = await getCompanyLedger().summaryDocument(session, { search: query.search, show: query.show });
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
