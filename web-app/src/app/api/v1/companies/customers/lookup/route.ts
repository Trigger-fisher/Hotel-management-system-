import "server-only";
import { getCustomers } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { lookupQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// The customer picker: name or mobile prefix, at most 50.
export const GET = route({
  permission: { key: "companies", level: "view" },
  cache: "private, no-cache",
  query: lookupQuery,
  handler: async ({ session, query }) => ({ data: await getCustomers().lookup(session, query) }),
});
