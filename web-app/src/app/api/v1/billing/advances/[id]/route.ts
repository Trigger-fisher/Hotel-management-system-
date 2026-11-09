import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { advanceUpdateBody, versionBody } from "@/server/services/billing/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "bills.advances", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getBillingAdvances().get(session, params.id) }),
});

export const PATCH = route({
  permission: { key: "bills.advances", level: "edit" },
  params: idParams,
  body: advanceUpdateBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingAdvances().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// A delete is a soft delete: the advance goes to the recycle bin.
export const DELETE = route({
  permission: { key: "bills.advances", level: "full" },
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingAdvances().remove(session, params.id, body.version, requestMeta(request, traceId)) }),
});
