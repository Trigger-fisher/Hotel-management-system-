import "server-only";
import { getPlatformGroups } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { groupCreateBody, groupListQuery } from "@/server/services/platform/schemas";

// Groups (docs/BACKEND.md 14.3): the list is an unpaged array; a new group may take hotels that are in no group.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: groupListQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformGroups().list(session, query.status, query.search) }),
});

export const POST = route({
  permission: "session",
  body: groupCreateBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformGroups().create(session, body, platformMeta(request, traceId)), status: 201 }),
});