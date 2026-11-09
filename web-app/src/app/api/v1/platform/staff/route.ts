import "server-only";
import { getPlatformStaff } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { adminBody, staffListQuery } from "@/server/services/platform/schemas";

// Platform Admins, Super Admin only (docs/BACKEND.md 14.6). The role is always platform_admin; the temporary password is emailed and never returned.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: staffListQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformStaff().list(session, query) }),
});

export const POST = route({
  permission: "session",
  body: adminBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformStaff().create(session, body, platformMeta(request, traceId)), status: 201 }),
});