import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { guestBillParams } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// "Email me a copy": the bill must be the guest's own and issued; it is queued as a PDF mail from THIS hotel's own email, to the email on the guest's own record (404 for anyone
// else's bill, 409 while the stay's bill is still running, 422 with no email on the record). `?hotel=` picks the hotel. 10 an hour per person.
export const POST = route({
  permission: "session",
  params: guestBillParams,
  query: hotelQuery,
  idempotency: "off",
  limits: [{ name: "guest-bill-email", max: 10, windowSeconds: 3600, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getGuestPortal().emailBill(await getGuestPortal().forHotel(session, query.hotel), params.id), status: 202 }),
});
