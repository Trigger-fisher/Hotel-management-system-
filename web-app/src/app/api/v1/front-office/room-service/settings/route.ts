import "server-only";
import { getRoomServiceDesk } from "@/server/compose/roomServiceDesk";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { roomServiceSettingsBody } from "@/server/services/roomService/schemas";

export const dynamic = "force-dynamic";

// The guest cancel window for room service: 0 to 60 minutes (0 = guests cannot cancel; default 5). Read: In House view; change: In House full; logged.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  handler: async ({ session }) => ({ data: await getRoomServiceDesk().settings(session) }),
});

export const PUT = route({
  permission: { key: "pms.stays", level: "full" },
  body: roomServiceSettingsBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getRoomServiceDesk().saveSettings(session, body, requestMeta(request, traceId)) }),
});