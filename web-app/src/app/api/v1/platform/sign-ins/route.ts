import "server-only";
import { getPlatformAudit } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { signInQuery } from "@/server/services/platform/schemas";

// Sign-in history across the platform (success, failed, locked), newest first. Super Admin only. (docs/BACKEND.md 14.5)
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: signInQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformAudit().listSignIns(session, query) }),
});