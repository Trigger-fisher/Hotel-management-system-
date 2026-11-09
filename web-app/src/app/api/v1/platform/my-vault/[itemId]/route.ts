import "server-only";
import { getPersonalVault } from "@/server/compose/personalVault";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { personalVaultBody, personalVaultItemParams } from "@/server/services/vault/schemas";

// One item of My vault (platform 0190): change it (a secret or notes left out keep what is stored) or remove it. Its owner only; anyone else gets 404.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: personalVaultItemParams,
  body: personalVaultBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPersonalVault().change(session, params.itemId, body, platformMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: personalVaultItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPersonalVault().remove(session, params.itemId, platformMeta(request, traceId)) }),
});
