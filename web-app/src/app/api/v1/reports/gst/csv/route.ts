import "server-only";
import { getReports } from "@/server/compose/overview";
import { route } from "@/server/http/route";
import { occupancyQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";

// The GST summary of one month as a GSTR-1 shaped CSV download (one line per bill and business, B2B, B2C and grand totals).
export const GET = route({
  permission: { key: "reports", level: "view" },
  query: occupancyQuery,
  handler: async ({ session, query }) => {
    const file = await getReports().gstCsv(session, query.month);
    return { data: null, binary: { bytes: file.bytes, contentType: "text/csv; charset=utf-8", filename: file.filename, disposition: "attachment" as const } };
  },
});
