import "server-only";
import { getPlatformAnnouncements } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

// Dismisses one announcement for this person: it is not shown to them again.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "dashboard", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getPlatformAnnouncements().dismiss(session, params.id) }),
});
