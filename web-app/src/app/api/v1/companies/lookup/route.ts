import "server-only";
import { getCompanies } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { lookupQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// The company picker everywhere: prefix search, at most 50 (decided shape).
export const GET = route({
  permission: { key: "companies", level: "view" },
  cache: "private, no-cache",
  query: lookupQuery,
  handler: async ({ session, query }) => ({ data: await getCompanies().lookup(session, query) }),
});
