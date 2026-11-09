import "server-only";
import { getPlatformHotelMail } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// Where Amazon SES receiving hands received mail to HMS (Super Admin only): the address for the SNS subscription, and whether the server knows its SNS topic.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformHotelMail().inbound(session) }),
});
