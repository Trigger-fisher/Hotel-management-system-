import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { guestProfileBody } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// The guest's own details (the customer row their account points at), read only on the screen (decision 52; PUT stays for older callers). `?hotel=` picks the hotel.
export const GET = route({
  permission: "session",
  query: hotelQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().getProfile(await getGuestPortal().forHotel(session, query.hotel)) }),
});

// PUT: the guest edits their own details. With the ONE common profile (platform 0132) name, email, city and address are written once and every hotel shows them; the ID
// proof (each hotel's own) goes to their record in every linked hotel, only when it changed (updatedHotels / unavailable). On a database before 0132: every field into every
// linked hotel's record (round 3 d). The mobile stays reception's to change. 20 changes an hour.
export const PUT = route({
  permission: "session",
  body: guestProfileBody,
  limits: [{ name: "guest-profile", max: 20, windowSeconds: 3600, by: "user", message: "You have changed your details many times in the last hour. Please wait a little and try again." }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getGuestPortal().updateProfile(session, body, requestMeta(request, traceId)) }),
});
