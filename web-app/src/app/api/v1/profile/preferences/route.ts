import "server-only";
import { getAdminProfile } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { preferencesBody } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// The signed-in person's own display preferences (day or night). Any signed-in person; only their own.
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getAdminProfile().preferences(session) }),
});

// Only the fields sent change; null clears the choice.
export const PATCH = route({
  permission: "session",
  body: preferencesBody,
  handler: async ({ session, body }) => ({ data: await getAdminProfile().updatePreferences(session, body) }),
});
