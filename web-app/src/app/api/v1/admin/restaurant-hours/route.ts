import "server-only";
import { getAdminRestaurantHours } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { restaurantHoursBody } from "@/server/services/admin/schemas";

// The restaurant's ordering hours and the "accepting orders" switch (decision 52): the hotel admin sets them (Master Data's grant), the guest portal reads them.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "masters", level: "view" },
  handler: async ({ session }) => ({ data: await getAdminRestaurantHours().get(session) }),
});

export const PUT = route({
  permission: { key: "masters", level: "edit" },
  body: restaurantHoursBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminRestaurantHours().save(session, body, requestMeta(request, traceId)) }),
});
