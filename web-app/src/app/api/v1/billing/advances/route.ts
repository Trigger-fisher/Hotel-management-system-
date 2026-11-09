import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { advanceCreateBody, advanceListQuery } from "@/server/services/billing/schemas";

// Billing, Guest Advances: the list and a new advance. Rules: docs/specs/billing-advances.md.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "bills.advances", level: "view" },
  cache: "private, no-cache",
  query: advanceListQuery,
  handler: async ({ session, query }) => ({ data: await getBillingAdvances().list(session, query) }),
});

// Money taken: a retried request with the same Idempotency-Key creates nothing twice.
export const POST = route({
  permission: { key: "bills.advances", level: "create" },
  body: advanceCreateBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getBillingAdvances().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
