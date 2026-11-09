import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayListQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// The refunds Razorpay has made for one business, newest first, with the reason and who gave it. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: razorpayListQuery,
  handler: async ({ session, query }) => ({ data: await getAdminRazorpay().refunds(session, query.business, query.page) }),
});
