import "server-only";
import { z } from "zod";
import { getWhatsAppMove } from "@/server/compose/whatsappMove";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// A hotel's move from the shared guest number to its own number: GET where it stands, POST one step (cut over, finish early, undo). Super Admin and Platform Admin only; every step is audited.
export const dynamic = "force-dynamic";
const params = z.strictObject({ hotelId: z.uuid() });

export const GET = route({
  permission: "session",
  params,
  limits: [{ name: "wa-admin-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p }) => ({ data: await getWhatsAppMove().status(session, p.hotelId) }),
});

export const POST = route({
  permission: "session",
  params,
  body: z.strictObject({ step: z.enum(["cut_over", "finish", "undo"]) }),
  idempotency: "off",
  limits: [{ name: "wa-admin-write", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, body, request, traceId }) => {
    const move = getWhatsAppMove();
    const meta = platformMeta(request, traceId);
    const data = body.step === "cut_over" ? await move.cutOver(session, p.hotelId, meta) : body.step === "finish" ? await move.finish(session, p.hotelId, meta) : await move.undo(session, p.hotelId, meta);
    return { data };
  },
});
