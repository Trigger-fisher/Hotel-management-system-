import "server-only";
import { getCustomers } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";
import { customerBody } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "companies", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getCustomers().get(session, params.id) }),
});

export const PATCH = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  body: customerBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getCustomers().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// A hard delete (Pallav has no recycle bin for customers); an Admin or the SuperAdmin.
export const DELETE = route({
  permission: { key: "companies", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getCustomers().remove(session, params.id, requestMeta(request, traceId)) }),
});
