import "server-only";
import { getPlatformAnnouncements } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// The platform's announcements this person has not dismissed yet (Hotel Admins also see the admins-only ones). A hotel account with the dashboard asks.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "dashboard", level: "view" },
  touch: false,
  handler: async ({ session }) => ({ data: await getPlatformAnnouncements().unread(session) }),
});
