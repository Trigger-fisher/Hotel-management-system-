import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getFrontOfficeStays().get(session, params.id) }),
});
