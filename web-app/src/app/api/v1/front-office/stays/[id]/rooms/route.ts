import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Free rooms to move the guest to.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getFrontOfficeStays().roomsToMove(session, params.id) }),
});
