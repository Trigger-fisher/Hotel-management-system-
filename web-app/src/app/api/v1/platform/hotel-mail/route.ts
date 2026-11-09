import "server-only";
import { getPlatformHotelMail } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// Hotel mail, Super Admin only: every live hotel with which of its own mail accounts (Amazon SES, Google) are set up.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformHotelMail().list(session) }),
});
