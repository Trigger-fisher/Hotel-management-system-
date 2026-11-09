import "server-only";
import { getPlatformGroupMail } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// Group mail, Super Admin only: every live group with which of its own mail accounts (Amazon SES, Google) are set up.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformGroupMail().list(session) }),
});
