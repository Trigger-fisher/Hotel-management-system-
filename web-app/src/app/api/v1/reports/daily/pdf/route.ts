import "server-only";
import { getReports } from "@/server/compose/overview";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { dailyQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Daily Report of a date (default today) as a PDF: the same figures, limits and permission as the screen.
export const GET = route({
  permission: { key: "reports", level: "view" },
  query: dailyQuery,
  handler: async ({ session, query }) => {
    const file = await getReports().dailyDocument(session, query.date);
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
