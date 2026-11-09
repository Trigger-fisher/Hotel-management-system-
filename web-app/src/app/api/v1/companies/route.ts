import "server-only";
import { getCompanies } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyBody, companyListQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "companies", level: "view" },
  cache: "private, no-cache",
  query: companyListQuery,
  handler: async ({ session, query }) => ({ data: await getCompanies().list(session, query) }),
});

export const POST = route({
  permission: { key: "companies", level: "create" },
  body: companyBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getCompanies().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
