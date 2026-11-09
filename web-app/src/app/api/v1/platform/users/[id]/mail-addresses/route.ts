import "server-only";
import { getMailAddresses } from "@/server/compose/mailAddresses";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, mailAddressBody } from "@/server/services/platform/schemas";

// A staff login's email addresses (MJ, 5 Nov 2026): the automatic one and the extra ones the Super Admin gave. Super Admin only; adding is audited.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getMailAddresses().list(session, params.id) }),
});

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: mailAddressBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getMailAddresses().add(session, params.id, body, platformMeta(request, traceId)), status: 201 }),
});