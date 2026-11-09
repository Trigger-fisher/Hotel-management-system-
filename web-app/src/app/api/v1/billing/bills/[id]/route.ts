import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { billUpdateBody, versionBody } from "@/server/services/billing/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "bills.bills", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getBillingBills().get(session, params.id) }),
});

export const PATCH = route({
  permission: { key: "bills.bills", level: "edit" },
  params: idParams,
  body: billUpdateBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingBills().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// A delete gives the advance back and puts the bill in the recycle bin.
export const DELETE = route({
  permission: { key: "bills.bills", level: "full" },
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingBills().remove(session, params.id, body.version, requestMeta(request, traceId)) }),
});
