import "server-only";
import { getCashExpenses } from "@/server/compose/cash";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { expenseUpdateBody, versionBody } from "@/server/services/cash/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "expense", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getCashExpenses().get(session, params.id) }),
});

export const PATCH = route({
  permission: "session",
  params: idParams,
  body: expenseUpdateBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getCashExpenses().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// A delete is a soft delete: the entry goes to the recycle bin (its lines stay with it).
export const DELETE = route({
  permission: "session",
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getCashExpenses().remove(session, params.id, body.version, requestMeta(request, traceId)) }),
});
