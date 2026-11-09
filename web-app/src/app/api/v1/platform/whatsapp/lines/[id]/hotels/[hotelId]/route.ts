import "server-only";
import { z } from "zod";
import { getWhatsAppLineHotels } from "@/server/compose/whatsappLineHotels";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// One hotel on the shared guest number: change its code (an empty code clears it) or detach it (its chats stay where they are; the row is closed, not deleted).
export const dynamic = "force-dynamic";

const params = z.strictObject({ id: z.uuid(), hotelId: z.uuid() });
const body = z.strictObject({ hotelCode: z.string().trim().max(24).nullable() });

export const PUT = route({
  permission: "session",
  params,
  body,
  idempotency: "off",
  limits: [{ name: "wa-admin-write", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, body: b, request, traceId }) => ({ data: await getWhatsAppLineHotels().setCode(session, p.id, p.hotelId, b.hotelCode, platformMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params,
  idempotency: "off",
  limits: [{ name: "wa-admin-write", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, request, traceId }) => ({ data: await getWhatsAppLineHotels().detach(session, p.id, p.hotelId, platformMeta(request, traceId)) }),
});
