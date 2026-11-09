import "server-only";
import { getVault } from "@/server/compose/vault";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { vaultBody, vaultItemParams } from "@/server/services/vault/schemas";

// One item of a hotel's vault (platform 0168): change it (a secret or notes left out keep what is stored) or remove it. Super Admin only; audited under the hotel.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: vaultItemParams,
  body: vaultBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getVault().change(session, params.id, params.itemId, body, platformMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: vaultItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getVault().remove(session, params.id, params.itemId, platformMeta(request, traceId)) }),
});
