import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { groupInvitationListQuery, groupInviteBody } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// My group's invitations (member_hotel only), and a new one: type and group are fixed by the server.
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: groupInvitationListQuery,
  handler: async ({ session, query }) => ({ data: await getGroupConsole().myInvitations(session, query) }),
});

export const POST = route({
  permission: "session",
  body: groupInviteBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getGroupConsole().invite(session, body, platformMeta(request, traceId)), status: 201 }),
});
