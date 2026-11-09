import "server-only";
import { getPlatformInvitations } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// The mock's "copy link (dev)" list. The real server stores only a hash of each token, so it has nothing to show: always an empty list.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformInvitations().devLinks(session) }),
});