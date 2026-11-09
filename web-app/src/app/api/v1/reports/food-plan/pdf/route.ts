import "server-only";
import { getReports } from "@/server/compose/overview";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { foodPlanQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Food Plan Report of a month (optionally one plan) as a PDF: the same figures, limits and permission as the screen.
export const GET = route({
  permission: { key: "reports", level: "view" },
  query: foodPlanQuery,
  handler: async ({ session, query }) => {
    const file = await getReports().foodPlanDocument(session, query.month, query.plan);
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
