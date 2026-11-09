import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayListQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// Razorpay's payouts to one business's bank account, newest first. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: razorpayListQuery,
  handler: async ({ session, query }) => ({ data: await getAdminRazorpay().settlements(session, query.business, query.page) }),
});
