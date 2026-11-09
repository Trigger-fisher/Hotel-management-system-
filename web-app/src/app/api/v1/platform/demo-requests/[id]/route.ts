import "server-only";
import type { DemoRequestStatus } from "@shared/dashboards/demoRequests";
import { getDemoRequests } from "@/server/compose/demoRequests";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { demoRequestParams, demoRequestStatusBody } from "@/server/services/platform/demoRequestSchemas";

// One demo request (platform 0169): its status (new, contacted, closed). Super Admin only; audited.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: demoRequestParams,
  body: demoRequestStatusBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getDemoRequests().setStatus(session, params.id, body.status as DemoRequestStatus, platformMeta(request, traceId)) }),
});
