import "server-only";
import { getCompanies } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";
import { companyBody } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "companies", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getCompanies().get(session, params.id) }),
});

export const PATCH = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  body: companyBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getCompanies().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// To the recycle bin; the SuperAdmin, or an Admin over a company a SuperAdmin did not add.
export const DELETE = route({
  permission: { key: "companies", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getCompanies().remove(session, params.id, requestMeta(request, traceId)) }),
});
