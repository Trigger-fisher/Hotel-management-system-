import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { billCreateBody, billListQuery } from "@/server/services/billing/schemas";

// Billing, Bills: the list (debit bills included) and a new bill. Rules: docs/specs/billing-bills.md.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "bills.bills", level: "view" },
  cache: "private, no-cache",
  query: billListQuery,
  handler: async ({ session, query }) => ({ data: await getBillingBills().list(session, query) }),
});

// A bill can take money off an advance: a retried request with the same Idempotency-Key creates nothing twice.
export const POST = route({
  permission: { key: "bills.bills", level: "create" },
  body: billCreateBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getBillingBills().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
