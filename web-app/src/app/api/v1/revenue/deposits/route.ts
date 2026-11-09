import "server-only";
import { getCashRevenue } from "@/server/compose/cash";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { depositCreateBody, depositListQuery } from "@/server/services/cash/schemas";

// Daily Cash, Revenue: the deposit list and a new deposit. Rules: docs/specs/cash-revenue.md.
export const dynamic = "force-dynamic";

// Reading needs the module `revenue` (the Hotel and Food parts are write-only).
export const GET = route({
  permission: { key: "revenue", level: "view" },
  cache: "private, no-cache",
  query: depositListQuery,
  handler: async ({ session, query }) => ({ data: await getCashRevenue().list(session, query) }),
});

// Recording needs the part `revenue.hotel` / `revenue.food` at create: the service checks it for the book in the body.
export const POST = route({
  permission: "session",
  body: depositCreateBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getCashRevenue().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
