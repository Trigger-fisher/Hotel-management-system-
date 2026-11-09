import "server-only";
import { getFrontOfficeRooms } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { roomBody, roomListQuery } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "pms.rooms", level: "view" },
  cache: "private, no-cache",
  query: roomListQuery,
  handler: async ({ session, query }) => ({ data: await getFrontOfficeRooms().list(session, query) }),
});

export const POST = route({
  permission: { key: "pms.rooms", level: "create" },
  body: roomBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getFrontOfficeRooms().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
