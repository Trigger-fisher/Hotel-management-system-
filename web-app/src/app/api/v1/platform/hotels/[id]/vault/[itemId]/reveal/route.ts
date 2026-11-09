import "server-only";
import { getVault } from "@/server/compose/vault";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { vaultItemParams } from "@/server/services/vault/schemas";

// Show: the secret and the private notes of one vault item, opened on the server and recorded in the hotel's Activity. Super Admin only; limited per person.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: vaultItemParams,
  limits: [{ name: "vault-reveal", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getVault().reveal(session, params.id, params.itemId, platformMeta(request, traceId)) }),
});
