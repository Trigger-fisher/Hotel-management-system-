import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { orderBody } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// Order to the room: only during a stay (409 with a sentence otherwise), only inside the restaurant's hours unless `scheduledFor` names a time inside them and
// inside the stay. Every line is checked against the hotel's menu; "room bill" adds stay charges (billed at check-out), "pay now" waits for online payment
// (422 with the sentence). An Idempotency-Key makes a double tap one order. `?hotel=` names the hotel (a guest linked to several).
// The guest's room-service orders with their status, newest first, over the hotels asked for; each says until when the guest may still cancel it (`cancellableUntil`).
export const GET = route({
  permission: "session",
  query: hotelQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().roomOrders(session, query) }),
});

export const POST = route({
  permission: "session",
  query: hotelQuery,
  body: orderBody,
  idempotency: "optional",
  // `?hotel=` is required for a guest linked to several hotels (422 on `hotel`; never "all"); the room is never an input. 10 orders in 10 minutes per person.
  limits: [{ name: "guest-order", max: 10, windowSeconds: 600, by: "user", message: "You have placed 10 orders in the last few minutes. Please wait a little, or call reception." }],
  handler: async ({ session, query, body, request, traceId }) => ({ data: await getGuestPortal().placeOrder(await getGuestPortal().forAction(session, query.hotel), body, requestMeta(request, traceId)), status: 201 }),
});