import "server-only";
import { getPlatformAudit } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { auditQuery } from "@/server/services/platform/schemas";

// The audit log: every platform action, refused attempts included, newest first. Super Admin only. (docs/BACKEND.md 14.5)
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: auditQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformAudit().list(session, query) }),
});