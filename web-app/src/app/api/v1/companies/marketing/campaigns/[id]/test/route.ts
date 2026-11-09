import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// One mail of the campaign to the signed-in person's own address, as a guest would get it.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  idempotency: "off",
  handler: async ({ session, params }) => ({ data: await getMarketing().test(session, params.id) }),
});
