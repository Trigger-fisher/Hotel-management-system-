import "server-only";
import { getRazorpayDisputes } from "@/server/compose/razorpayDisputes";
import { route } from "@/server/http/route";
import { disputeListQuery } from "@/server/services/razorpay/disputeSchemas";

export const dynamic = "force-dynamic";

// Every problem guests and companies raised about their online payments; the open ones by default. Needs Bills (view): the hotel's own staff, not only the Super Admin.
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: disputeListQuery,
  handler: async ({ session, query }) => ({ data: await getRazorpayDisputes().list(session, query) }),
});
