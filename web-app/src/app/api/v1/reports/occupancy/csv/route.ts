import "server-only";
import { getReports } from "@/server/compose/overview";
import { route } from "@/server/http/route";
import { occupancyQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";

// The occupancy report of one month as a CSV download (one line per night, a totals line, RevPAR).
export const GET = route({
  permission: { key: "reports", level: "view" },
  query: occupancyQuery,
  handler: async ({ session, query }) => {
    const file = await getReports().occupancyCsv(session, query.month);
    return { data: null, binary: { bytes: file.bytes, contentType: "text/csv; charset=utf-8", filename: file.filename, disposition: "attachment" as const } };
  },
});
