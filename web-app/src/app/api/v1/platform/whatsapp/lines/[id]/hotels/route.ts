import "server-only";
import { z } from "zod";
import { getWhatsAppLineHotels } from "@/server/compose/whatsappLineHotels";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// The hotels on the shared guest number (Console > WhatsApp numbers): the list with each hotel's code and the hotels that can still be added; attach a hotel (a code is made from its name when none is given).
export const dynamic = "force-dynamic";

const params = z.strictObject({ id: z.uuid() });
const body = z.strictObject({ hotelId: z.uuid(), hotelCode: z.string().trim().max(24).nullable().optional() });

export const GET = route({
  permission: "session",
  params,
  limits: [{ name: "wa-admin-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p }) => ({ data: await getWhatsAppLineHotels().list(session, p.id) }),
});

export const POST = route({
  permission: "session",
  params,
  body,
  idempotency: "off",
  limits: [{ name: "wa-admin-write", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, body: b, request, traceId }) => ({ data: await getWhatsAppLineHotels().attach(session, p.id, b, platformMeta(request, traceId)), status: 201 }),
});
