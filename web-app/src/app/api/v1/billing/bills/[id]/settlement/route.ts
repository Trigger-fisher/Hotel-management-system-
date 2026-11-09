import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { settleBody, versionBody } from "@/server/services/billing/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Settling a debit (Pallav "Debit Bills"): create on bills.debit-bills. Money received: Idempotency-Key honoured.
export const POST = route({
  permission: { key: "bills.debit-bills", level: "create" },
  params: idParams,
  body: settleBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingBills().settle(session, params.id, body, requestMeta(request, traceId)) }),
});

// Reversing a settlement is a DELETE in Pallav: Full Access on bills.debit-bills.
export const DELETE = route({
  permission: { key: "bills.debit-bills", level: "full" },
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingBills().reverseSettlement(session, params.id, body.version, requestMeta(request, traceId)) }),
});
