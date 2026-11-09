import "server-only";
import { getCashRevenue } from "@/server/compose/cash";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { depositUpdateBody, versionBody } from "@/server/services/cash/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "revenue", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getCashRevenue().get(session, params.id) }),
});

export const PATCH = route({
  permission: "session",
  params: idParams,
  body: depositUpdateBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getCashRevenue().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// A delete is a soft delete: the deposit goes to the recycle bin.
export const DELETE = route({
  permission: "session",
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getCashRevenue().remove(session, params.id, body.version, requestMeta(request, traceId)) }),
});
