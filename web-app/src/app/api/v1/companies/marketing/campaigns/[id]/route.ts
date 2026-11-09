import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";
import { campaignBody } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// Drafts only: a sent campaign is the record of what went out.
export const PATCH = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  body: campaignBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getMarketing().update(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getMarketing().remove(session, params.id, requestMeta(request, traceId)) }),
});
