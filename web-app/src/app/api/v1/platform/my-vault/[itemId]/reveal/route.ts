import "server-only";
import { getPersonalVault } from "@/server/compose/personalVault";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { personalVaultItemParams } from "@/server/services/vault/schemas";

// Show: the secret and the private notes of one item of My vault, opened for its owner and recorded in the audit log. Limited per person.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: personalVaultItemParams,
  limits: [{ name: "vault-reveal", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getPersonalVault().reveal(session, params.itemId, platformMeta(request, traceId)) }),
});
