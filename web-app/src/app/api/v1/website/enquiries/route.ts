import "server-only";
import { getWebsiteEnquiries } from "@/server/compose/website";
import { route } from "@/server/http/route";
import { enquiryListQuery } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// The tabs and search; the tiles count every enquiry (as Pallav). "new" from an earlier day becomes "pending" first.
export const GET = route({
  permission: { key: "website.enquiries", level: "view" },
  cache: "private, no-cache",
  query: enquiryListQuery,
  handler: async ({ session, query }) => ({ data: await getWebsiteEnquiries().list(session, query) }),
});
