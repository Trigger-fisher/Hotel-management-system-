import "server-only";
import { getPlatformMailUsage } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, mailCapBody } from "@/server/services/platform/schemas";

// The Super Admin's daily mail cap for one hotel: the most mails it may send a day, whatever its own mail service allows (0 stops its campaigns; null removes the cap). Audited. Super Admin only.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: hotelIdParams,
  body: mailCapBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformMailUsage().setCap(session, params.id, body.dailyCap, platformMeta(request, traceId)) }),
});