import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { campaignBody } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// A new campaign, as a draft.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  body: campaignBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getMarketing().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
