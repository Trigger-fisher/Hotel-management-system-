import "server-only";
import { getHandovers } from "@/server/compose/handover";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { versionBody } from "@/server/services/cash/schemas";
import { handoverUpdateBody } from "@/server/services/handover/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "handover", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getHandovers().get(session, params.id) }),
});

// Only the newest handover, by the SuperAdmin, an Admin or whoever recorded it (force mode opens any, audited).
export const PATCH = route({
  permission: { key: "handover", level: "edit" },
  params: idParams,
  body: handoverUpdateBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHandovers().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// A soft delete: the handover goes to the recycle bin. An Admin or the SuperAdmin only.
export const DELETE = route({
  permission: { key: "handover", level: "full" },
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHandovers().remove(session, params.id, body.version, requestMeta(request, traceId)) }),
});
