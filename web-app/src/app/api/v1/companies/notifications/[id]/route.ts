import "server-only";
import { getNotifications } from "@/server/compose/notifications";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// One notification with the companies it went to and when each read it.
export const GET = route({
  permission: { key: "companies", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getNotifications().get(session, params.id) }),
});
