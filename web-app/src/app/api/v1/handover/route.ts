import "server-only";
import { getHandovers } from "@/server/compose/handover";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { handoverCreateBody, handoverListQuery } from "@/server/services/handover/schemas";

// Shift Handover: the list (with the numbers on top) and a new handover (Pallav ShiftHandoverController::index / store).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "handover", level: "view" },
  cache: "private, no-cache",
  query: handoverListQuery,
  handler: async ({ session, query }) => ({ data: await getHandovers().list(session, query) }),
});

export const POST = route({
  permission: { key: "handover", level: "create" },
  body: handoverCreateBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getHandovers().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
