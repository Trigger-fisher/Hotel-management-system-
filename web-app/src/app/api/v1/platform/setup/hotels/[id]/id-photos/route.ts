import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, idPhotosBody } from "@/server/services/platform/schemas";

// How one hotel's guest ID pictures are stored: a sharp copy under 500 KB, or an exact copy (bigger files). Super Admin only; every change audited.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getHotelSetup().idPhotos(session, params.id) }),
});

export const PUT = route({
  permission: "session",
  params: hotelIdParams,
  body: idPhotosBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHotelSetup().saveIdPhotos(session, params.id, body.exactCopy, platformMeta(request, traceId)) }),
});
