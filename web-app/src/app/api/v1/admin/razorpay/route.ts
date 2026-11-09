import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// The Razorpay screen: what is set up ("...Set" flags only), the webhook addresses, the stored payments (filtered by business, status, method and words) and the totals. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: razorpayQuery,
  handler: async ({ session, query }) => ({ data: await getAdminRazorpay().overview(session, query) }),
});
