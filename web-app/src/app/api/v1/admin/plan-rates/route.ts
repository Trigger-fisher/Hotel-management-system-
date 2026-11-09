import "server-only";
import { getAdminPlanRates } from "@/server/compose/admin";
import { listSearchQuery, planRateBody } from "@/server/services/admin/schemas";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// What Pallav Food charges the hotel per person per night on each plan, dated: the plans, every rate and what the hotel owes this month.
export const GET = route({
  permission: { key: "masters", level: "view" },
  cache: "private, no-cache",
  query: listSearchQuery,
  handler: async ({ session, query }) => ({ data: await getAdminPlanRates().panel(session, query.search) }),
});

// One price per plan per date: a second one for the same date replaces it.
export const POST = route({
  permission: { key: "masters", level: "edit" },
  body: planRateBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminPlanRates().save(session, body, requestMeta(request, traceId)) }),
});
