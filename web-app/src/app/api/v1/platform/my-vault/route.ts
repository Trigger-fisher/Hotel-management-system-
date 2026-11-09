import "server-only";
import { getPersonalVault } from "@/server/compose/personalVault";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { personalVaultBody } from "@/server/services/vault/schemas";

// My vault (platform 0190): the signed-in Super Admin's own list (never a secret) and Add. Anyone else gets 404.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPersonalVault().list(session) }),
});

export const POST = route({
  permission: "session",
  body: personalVaultBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPersonalVault().add(session, body, platformMeta(request, traceId)) }),
});
