import "server-only";
import { getWhatsAppRules } from "@/server/compose/whatsappRules";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { killSwitchBody } from "@/server/services/whatsapp/rulesSchemas";

// The kill switches: everything, one line (pause or resume; its token is never touched) or one hotel. on: true stops (needs confirm: true), on: false lets it run again.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: killSwitchBody,
  handler: async ({ session, body, request, traceId }) => {
    const target = body.scope === "global" ? ({ scope: "global" } as const) : ({ scope: body.scope, id: body.id } as const);
    return { data: await getWhatsAppRules().setKillSwitch(session, target, body.on, body.confirm, platformMeta(request, traceId)) };
  },
});
