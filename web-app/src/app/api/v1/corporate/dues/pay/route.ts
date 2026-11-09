import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { payDuesBody } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// Pay the open dues of the ticked businesses: checked, then 422 with the sentence while online payment is off (nothing changes).
export const POST = route({
  permission: "session",
  body: payDuesBody,
  idempotency: "optional",
  handler: async ({ session, body }) => ({ data: await getCorporatePortal().payDues(session, body.businesses) }),
});
