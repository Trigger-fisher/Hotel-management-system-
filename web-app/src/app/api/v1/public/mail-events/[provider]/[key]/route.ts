import "server-only";
import { z } from "zod";
import { getPlatformMailSafety } from "@/server/compose/platform";
import { AppError } from "@/server/errors";
import { publicRoute } from "@/server/http/route";
import { isSnsUrl, parseBrevoEvents, parseSesNotification, snsEnvelopeOf, verifySns } from "@/server/mail/events";

// The mail services' reports (platform migrations 0130 and 0136; MAIL-PROVIDERS-50K plan; security review round 2, M2): bounces, complaints and unsubscribes, which keep those
// addresses off later campaigns and can put a hotel's campaign mail on hold (services/platform/mailSafetyService.ts). No session.
//  - The address carries a secret key as a PATH segment (Super Admin > Platform settings > Mail shows it; "Replace key" makes a new one, the old one works a day): a query
//    string would be written to access logs. A wrong or missing key is a 404.
//  - ses:   Amazon SNS posts its envelope as text/plain JSON. It must be signed by AWS (certificate from an sns.<region>.amazonaws.com address only) and come from THE pinned
//           topic (the first signed message pins it). A subscription confirmation is confirmed by opening its SubscribeURL (an SNS address only).
//  - brevo: Brevo's webhook posts JSON (one event or a list). Brevo signs nothing and its sending addresses are not a fixed list, so the key is the proof.
//  - Every delivery is remembered by a keyed hash of the service's own id (SNS MessageId; Brevo's event, address, message id and time): a repeat or a replay counts nothing.
export const dynamic = "force-dynamic";

const MAX_BYTES = 256 * 1024;
const params = z.strictObject({ provider: z.enum(["ses", "brevo"]), key: z.string().max(100) });

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Request is too large" } });
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Request is too large" } });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not valid JSON" } });
  }
}

const fetchText = async (url: string): Promise<string> => {
  const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export const POST = publicRoute({
  params,
  idempotency: "off",
  limits: [{ name: "mail-events", max: 600, windowSeconds: 60, by: "ip" }],
  handler: async ({ params: p, request }): Promise<{ data: { recorded: number; held: number; repeated: number } | { confirmed: boolean } }> => {
    const safety = getPlatformMailSafety();
    const via = await safety.checkWebhookKey(p.provider, p.key);
    const body = await readJson(request);
    if (p.provider === "brevo") {
      // each Brevo event on its own: its own receipt, so a list that repeats one event counts it once
      const items = (Array.isArray(body) ? body : [body]).slice(0, 500);
      return {
        data: await safety.receive(
          "brevo",
          items.map((e) => {
            const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
            return { id: [text(o.id), text(o.event), text(o.email).toLowerCase(), text(o["message-id"] ?? o.message_id), text(o.ts_event ?? o.ts ?? o.date)], events: parseBrevoEvents(e) };
          }),
        ),
      };
    }
    const envelope = snsEnvelopeOf(body);
    if (!envelope) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not an Amazon SNS message" } });
    if (!(await verifySns(envelope, fetchText))) throw new AppError("FORBIDDEN", "The message is not signed by Amazon SNS.");
    await safety.checkSnsTopic(envelope.TopicArn, via);
    if (envelope.Type === "SubscriptionConfirmation") {
      if (!isSnsUrl(envelope.SubscribeURL, "subscribe")) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not an Amazon SNS subscribe address" } });
      await fetchText(envelope.SubscribeURL as string);
      return { data: { confirmed: true } };
    }
    if (envelope.Type === "UnsubscribeConfirmation") return { data: { recorded: 0, held: 0, repeated: 0 } };
    let message: unknown;
    try {
      message = JSON.parse(envelope.Message);
    } catch {
      return { data: { recorded: 0, held: 0, repeated: 0 } };
    }
    return { data: await safety.receive("ses", [{ id: [envelope.MessageId], events: parseSesNotification(message) }]) };
  },
});
