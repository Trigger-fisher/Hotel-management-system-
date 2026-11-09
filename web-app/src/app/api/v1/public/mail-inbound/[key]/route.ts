import "server-only";
import { z } from "zod";
import { getInboundMail, inboundKeyMatches, inboundTopicArn } from "@/server/compose/mailInbound";
import { AppError } from "@/server/errors";
import { publicRoute } from "@/server/http/route";
import { isSnsUrl, snsEnvelopeOf, verifySns } from "@/server/mail/events";

// Mail received by Amazon SES (MJ, 1 Nov 2026): the domain's MX record points at SES, a receipt rule publishes each message to an SNS topic, and the topic posts it here. No session.
//  - The address carries a secret key as a PATH segment (Platform > Hotel mail shows the whole address): a query string would be written to access logs. A wrong key, or a server with no
//    key or no topic set (HMS_INBOUND_SNS_TOPIC_ARN), is a 404.
//  - Amazon SNS posts its envelope as text/plain JSON. It must be signed by AWS (certificate from an sns.<region>.amazonaws.com address only) and come from THE topic set on the server.
//    A subscription confirmation is confirmed by opening its SubscribeURL (an SNS address only).
//  - A repeat delivery is harmless: the hotel's Email inbox takes a Message-ID once.
export const dynamic = "force-dynamic";

// SES publishes a message of 150 KB at most; SNS adds its envelope
const MAX_BYTES = 1024 * 1024;
const params = z.strictObject({ key: z.string().max(100) });

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

export const POST = publicRoute({
  params,
  idempotency: "off",
  limits: [{ name: "mail-inbound", max: 300, windowSeconds: 60, by: "ip" }],
  handler: async ({ params: p, request }): Promise<{ data: { confirmed: boolean } | { received: boolean; hotels: number; added: number } }> => {
    const topic = inboundTopicArn();
    if (!topic || !inboundKeyMatches(p.key)) throw new AppError("NOT_FOUND");
    const body = await readJson(request);
    const envelope = snsEnvelopeOf(body);
    if (!envelope) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not an Amazon SNS message" } });
    if (!(await verifySns(envelope, fetchText))) throw new AppError("FORBIDDEN", "The message is not signed by Amazon SNS.");
    if (envelope.TopicArn !== topic) throw new AppError("FORBIDDEN", "This Amazon SNS topic is not the one the platform takes mail from.");
    if (envelope.Type === "SubscriptionConfirmation") {
      if (!isSnsUrl(envelope.SubscribeURL, "subscribe")) throw new AppError("VALIDATION_FAILED", undefined, { fields: { _: "Not an Amazon SNS subscribe address" } });
      await fetchText(envelope.SubscribeURL as string);
      return { data: { confirmed: true } };
    }
    if (envelope.Type !== "Notification") return { data: { received: false, hotels: 0, added: 0 } };
    let message: unknown;
    try {
      message = JSON.parse(envelope.Message);
    } catch {
      return { data: { received: false, hotels: 0, added: 0 } };
    }
    const out = await getInboundMail().receive(message);
    return { data: { received: out.recognised, hotels: out.hotels, added: out.added } };
  },
});
