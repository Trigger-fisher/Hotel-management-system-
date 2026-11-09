import "server-only";
import { getPlatformInvitations } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { invitationBody, invitationListQuery } from "@/server/services/platform/schemas";

// Invitations (docs/BACKEND.md 14.4): the list with status counts, and a new invitation. The link goes by e-mail; no answer carries the token.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: invitationListQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformInvitations().list(session, query) }),
});

export const POST = route({
  permission: "session",
  body: invitationBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformInvitations().send(session, body, platformMeta(request, traceId)), status: 201 }),
});