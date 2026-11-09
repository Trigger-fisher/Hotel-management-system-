import "server-only";
import { getCustomers } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { customerBody, customerListQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "companies", level: "view" },
  cache: "private, no-cache",
  query: customerListQuery,
  handler: async ({ session, query }) => ({ data: await getCustomers().list(session, query) }),
});

export const POST = route({
  permission: { key: "companies", level: "create" },
  body: customerBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getCustomers().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
