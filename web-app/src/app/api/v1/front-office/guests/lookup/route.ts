import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";
import { guestLookupQuery } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

// A past guest of this hotel by mobile, for the check-in form (HMS). The number is never logged.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  cache: "private, no-cache",
  query: guestLookupQuery,
  handler: async ({ session, query }) => ({ data: await getFrontOfficeStays().lookupGuest(session, query.mobile) }),
});
