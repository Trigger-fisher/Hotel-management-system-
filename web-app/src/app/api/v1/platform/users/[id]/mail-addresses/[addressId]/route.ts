import "server-only";
import { getMailAddresses } from "@/server/compose/mailAddresses";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { userMailAddressParams } from "@/server/services/platform/schemas";

// Removes one extra address (the automatic one cannot be removed). Super Admin only; audited.
export const dynamic = "force-dynamic";

export const DELETE = route({
  permission: "session",
  params: userMailAddressParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getMailAddresses().remove(session, params.id, params.addressId, platformMeta(request, traceId)) }),
});