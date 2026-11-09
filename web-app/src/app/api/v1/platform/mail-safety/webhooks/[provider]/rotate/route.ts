import "server-only";
import { z } from "zod";
import { getPlatformMailSafety } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// A new secret key for ONE mail service's report address (Super Admin; security review round 2, L8). The other service keeps its key; the old address of this one works for one
// more day so it can be changed over. Audited (settings_updated). The SNS topic pin stays; the old address cannot set it.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: z.strictObject({ provider: z.enum(["ses", "brevo"]) }),
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformMailSafety().rotateWebhookKey(session, params.provider, platformMeta(request, traceId)) }),
});
