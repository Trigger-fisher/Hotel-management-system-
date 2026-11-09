import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The ageing report as a CSV download: one line per company and a totals line.
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  handler: async ({ session }) => {
    const file = await getCompanyLedger().ageingCsv(session);
    return { data: null, binary: { bytes: file.bytes, contentType: "text/csv; charset=utf-8", filename: file.filename, disposition: "attachment" as const } };
  },
});
