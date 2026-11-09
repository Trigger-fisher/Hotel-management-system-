import "server-only";
import { getMenuPhotos } from "@/server/compose/menuPhotos";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// The photo of one room-service menu item, for a signed-in guest of that hotel (`?hotel=` names it; a guest linked to several names it). 404 when the item has none.
export const GET = route({
  permission: "session",
  params: idParams,
  query: hotelQuery,
  cache: "private, max-age=300",
  handler: async ({ session, params, query }) => {
    const one = await getGuestPortal().forAction(session, query.hotel);
    const file = await getMenuPhotos().forGuest(one, params.id);
    return { data: null, binary: { bytes: file.bytes, contentType: file.contentType, filename: "menu-photo", disposition: "inline" as const } };
  },
});