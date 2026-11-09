import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { getDocumentRenderer } from "@/server/documents";
import { route } from "@/server/http/route";
import { statementQuery } from "@/server/services/companies/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The company statement of a period as a PDF (MJ #22): the same rows, limits and permission as the statement.
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  params: idParams,
  query: statementQuery,
  handler: async ({ session, params, query }) => {
    const file = await getCompanyLedger().statementDocument(session, params.id, query);
    const out = await getDocumentRenderer().render("payrollDoc", file);
    return { data: null, binary: { bytes: out.bytes, contentType: "application/pdf", filename: out.filename } };
  },
});
