import "server-only";
import { getMailAddresses } from "@/server/compose/mailAddresses";
import { route } from "@/server/http/route";
import { hotelIdParams, mailAddressBody } from "@/server/services/platform/schemas";

// The address a pattern would give now, checked to be free (nothing saved). Super Admin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: mailAddressBody,
  handler: async ({ session, params, body }) => ({ data: await getMailAddresses().preview(session, params.id, body) }),
});