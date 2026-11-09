import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { statementQuery } from "@/server/services/companies/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// The company statement of a period as a CSV download: the same rows, limits and permission as the statement.
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  params: idParams,
  query: statementQuery,
  handler: async ({ session, params, query }) => {
    const file = await getCompanyLedger().statementCsv(session, params.id, query);
    return { data: null, binary: { bytes: file.bytes, contentType: "text/csv; charset=utf-8", filename: file.filename, disposition: "attachment" as const } };
  },
});
