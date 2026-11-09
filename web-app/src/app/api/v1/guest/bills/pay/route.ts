import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { payBillsBody } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// Pay the ticked bills: each must be the guest's own and still owing; online payment (Razorpay) is not switched on yet, so it answers 422 with the
// sentence and nothing changes.
export const POST = route({
  permission: "session",
  body: payBillsBody,
  idempotency: "optional",
  handler: async ({ session, body }) => ({ data: await getGuestPortal().payBills(session, body.billIds) }),
});
