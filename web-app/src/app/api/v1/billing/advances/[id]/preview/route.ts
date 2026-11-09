import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// The advance receipt as data for the screen and the print view (no PDF library, MJ). Never a stored file path.
export const GET = route({
  permission: { key: "bills.advances", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getBillingAdvances().preview(session, params.id) }),
});
