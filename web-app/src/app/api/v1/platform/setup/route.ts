import "server-only";
import { getSetupCentre } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";

// The Set-up centre: every outside service, platform-wide and per hotel, Not set up / Working / Needs attention with one plain reason and its wizard step. Super Admin only; never a secret.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getSetupCentre().overview(session) }),
});