import "server-only";
import { getPlatformAnnouncements } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { announcementBody } from "@/server/services/platform/schemas";

// Announcements to the hotels (P4), Super Admin only: the list (newest first) and publishing one (audited).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformAnnouncements().list(session) }),
});

export const POST = route({
  permission: "session",
  body: announcementBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformAnnouncements().create(session, body, platformMeta(request, traceId)), status: 201 }),
});
