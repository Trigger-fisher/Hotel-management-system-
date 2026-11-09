import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { checkInBody, stayListQuery } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  cache: "private, no-cache",
  query: stayListQuery,
  handler: async ({ session, query }) => ({ data: await getFrontOfficeStays().list(session, query) }),
});

// Check-in: one in-house stay per room (a racing second check-in is refused with Pallav's message).
export const POST = route({
  permission: { key: "pms.stays", level: "create" },
  body: checkInBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getFrontOfficeStays().checkIn(session, body, requestMeta(request, traceId)), status: 201 }),
});
