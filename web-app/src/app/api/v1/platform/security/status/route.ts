import "server-only";
import { getSecurity } from "@/server/compose/security";
import { route } from "@/server/http/route";
import { resetActor } from "@/server/services/security/access";

// The three layer lights (edge, application, database) and which alert channels are switched on. Never shows a key or an address.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => {
    const actor = resetActor(session);
    const s = getSecurity();
    return { data: { layers: await s.resets.status(actor), alerts: s.alerts.channels() } };
  },
});
