import "server-only";
import { getAdminBooks } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { removeYearBody } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// Removes the newest accounting year and everything dated in it (the SuperAdmin only; the body types DELETE and the year's label).
export const DELETE = route({
  permission: "session",
  body: removeYearBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminBooks().removeLatest(session, body, requestMeta(request, traceId)) }),
});
