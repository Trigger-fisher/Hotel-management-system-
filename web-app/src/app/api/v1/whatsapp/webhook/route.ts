import "server-only";
import { z } from "zod";
import { getWhatsAppIntake } from "@/server/compose/whatsapp";
import { publicRoute } from "@/server/http/route";
import { MAX_WEBHOOK_BYTES } from "@/server/whatsapp/intake";

// Meta's WhatsApp webhook (MJ, 4 Nov 2026; plan part 9). No session: Meta calls it, for every connected number (the shared guest line, the platform line, a hotel's own), and the number in each
// event says whose it is.
//  GET   the address check Meta makes once: hub.verify_token must be WHATSAPP_VERIFY_TOKEN, and the answer is the hub.challenge text as plain text (not JSON).
//  POST  the signature (X-Hub-Signature-256) of the RAW body is checked first with WHATSAPP_APP_SECRET; every message, status and change is SAVED, then 200. Nothing is processed here.
// Not set up = 404. The per-address limits are ceilings, far above any real traffic (the repository's rule is that every public route declares one): Meta sends bursts from a few addresses and a
// tight limit would drop real messages. A wrong signature costs one HMAC.
export const dynamic = "force-dynamic";
// the work after the answer (saving a guest's file) runs in the same function: give it the time the sweep route has
export const maxDuration = 60;

// Loose on purpose: Meta's address check can carry query fields besides the three it documents, and a strict schema answered it 422 so the webhook could never be saved. Extra fields are ignored.
const query = z.looseObject({ "hub.mode": z.string().max(40).optional(), "hub.verify_token": z.string().max(300).optional(), "hub.challenge": z.string().max(300).optional() });

export const GET = publicRoute({
  query,
  idempotency: "off",
  limits: [{ name: "wa-webhook-verify", max: 30, windowSeconds: 60, by: "ip" }],
  handler: async ({ query: q }) => {
    const challenge = getWhatsAppIntake().verifySubscription({ mode: q["hub.mode"] ?? null, token: q["hub.verify_token"] ?? null, challenge: q["hub.challenge"] ?? null });
    return { data: null, binary: { bytes: new TextEncoder().encode(challenge), contentType: "text/plain; charset=utf-8", filename: "challenge.txt" } };
  },
});

export const POST = publicRoute({
  idempotency: "off",
  limits: [{ name: "wa-webhook", max: 3000, windowSeconds: 60, by: "ip" }],
  maxBodyBytes: MAX_WEBHOOK_BYTES,
  handler: async ({ request }) => {
    const rawBody = await request.text();
    const out = await getWhatsAppIntake().receive({ rawBody, signature: request.headers.get("x-hub-signature-256") });
    return { data: { received: true, saved: out.saved } };
  },
});
