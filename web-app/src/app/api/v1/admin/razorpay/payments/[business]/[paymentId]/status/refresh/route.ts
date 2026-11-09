import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayStatusParams } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// Check one payment with Razorpay now and keep what it says (a payment whose webhook never arrived shows up this way). 409 until the business's keys are saved. Bills edit.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: razorpayStatusParams,
  handler: async ({ session, params }) => ({ data: await getAdminRazorpay().paymentStatus(session, params.business, params.paymentId) }),
});
