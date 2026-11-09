import "server-only";
import { getVault } from "@/server/compose/vault";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";
import { vaultBody } from "@/server/services/vault/schemas";

// A hotel's vault (platform 0168): the list (never a secret) and Add. Super Admin only; Add is audited under the hotel.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getVault().list(session, params.id) }),
});

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: vaultBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getVault().add(session, params.id, body, platformMeta(request, traceId)) }),
});
