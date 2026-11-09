import "server-only";
import { z } from "zod";
import { getPlatformMailSafety } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { mailSuppressBody } from "@/server/services/platform/mailSafetyService";

// Deliverability (Super Admin > Platform settings > Mail > Bounces and holds; platform migration 0130). GET: the hotels on hold, a page of the suppression list (search, cursor) and
// the webhook addresses. POST: suppress an address by hand, for every hotel or one. Super Admin only; each change is an audit row.
export const dynamic = "force-dynamic";

const viewQuery = z.strictObject({ search: z.string().trim().max(254).optional(), cursor: z.string().max(200).optional() });

export const GET = route({
  permission: "session",
  query: viewQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformMailSafety().view(session, { ...(query.search ? { search: query.search } : {}), ...(query.cursor ? { cursor: query.cursor } : {}) }) }),
});

export const POST = route({
  permission: "session",
  body: mailSuppressBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformMailSafety().suppress(session, body, platformMeta(request, traceId)), status: 201 }),
});
