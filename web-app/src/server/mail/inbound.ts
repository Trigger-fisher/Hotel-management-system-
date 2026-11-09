import "server-only";
import type { InboundEntry } from "../conversations/channel";
import { MESSAGE_ID } from "./imap";
import { parse as parseMime, previewOf } from "./mime";
import { isMailAddress } from "./smtp";

// Mail that reaches HMS through Amazon SES RECEIVING (MJ, 1 Nov 2026): the domain's MX record points at SES, a receipt rule publishes each received message to an SNS topic
// (action "Publish to Amazon SNS topic", UTF-8), and the topic posts it to app/api/v1/public/mail-inbound/[key]. This module reads one such notification (pure: the JSON of the SNS
// "Message" in, a hub entry out). Which hotel it is for, and the signature check, are the route's and the service's.
//   - SES puts the whole raw message in `content` (150 KB at most: SES bounces a larger one before it gets here);
//   - a message SES marked as spam or as a virus is dropped; an answer of a mail server (a delivery report) and mail HMS made itself (X-HMS-Kind) are not conversations.

export interface SesInbound {
  /** SES's own id of the message (mail.messageId): the receipt of this delivery, and the id of a message without a usable Message-ID. */
  sesMessageId: string;
  /** The addresses SES accepted the message for (receipt.recipients), lower case. */
  recipients: string[];
  spamFailed: boolean;
  virusFailed: boolean;
  /** SES's own checks: true when SPF or DKIM passed, false when both failed, null otherwise. */
  verified: boolean | null;
  raw: Buffer;
  /** The time SES received it. */
  at: Date | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const status = (v: unknown): string => String(obj(v).status ?? "").toUpperCase();

/** The SES "Received" notification inside an SNS message, or null when it is anything else (a "SubscriptionConfirmation" test, a bounce report, no content). */
export function sesInboundOf(message: unknown): SesInbound | null {
  const m = obj(message);
  if (m.notificationType !== "Received" && m.eventType !== "Received") return null;
  const mail = obj(m.mail);
  const receipt = obj(m.receipt);
  const content = m.content;
  const sesMessageId = typeof mail.messageId === "string" ? mail.messageId : "";
  if (typeof content !== "string" || content === "" || !/^[A-Za-z0-9._-]{1,200}$/.test(sesMessageId)) return null;
  const recipients = (Array.isArray(receipt.recipients) ? receipt.recipients : Array.isArray(mail.destination) ? mail.destination : []).filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(isMailAddress).slice(0, 50);
  const spf = status(receipt.spfVerdict);
  const dkim = status(receipt.dkimVerdict);
  const at = typeof mail.timestamp === "string" && Number.isFinite(Date.parse(mail.timestamp)) ? new Date(mail.timestamp) : null;
  return {
    sesMessageId,
    recipients,
    spamFailed: status(receipt.spamVerdict) === "FAIL",
    virusFailed: status(receipt.virusVerdict) === "FAIL",
    verified: spf === "PASS" || dkim === "PASS" ? true : spf === "FAIL" && dkim === "FAIL" ? false : null,
    raw: Buffer.from(content, "utf8"),
    at,
  };
}

/** Why a received message is not taken into a conversation. */
export type InboundSkip = "spam" | "virus" | "report" | "hms" | "no_sender" | "unreadable";

const validId = (id: string | undefined | null): id is string => typeof id === "string" && MESSAGE_ID.test(id) && !/[\r\n]/.test(id);

/** The hub entry of one received message, or the reason it is skipped. The preview is the first 200 letters of the text, without the quoted reply. */
export async function entryOfInbound(inb: SesInbound, now: Date): Promise<{ entry: InboundEntry } | { skip: InboundSkip }> {
  if (inb.virusFailed) return { skip: "virus" };
  if (inb.spamFailed) return { skip: "spam" };
  let parsed: Awaited<ReturnType<typeof parseMime>>;
  try {
    parsed = await parseMime(inb.raw, { skipImageLinks: true, skipTextToHtml: true });
  } catch {
    return { skip: "unreadable" };
  }
  const sender = parsed.from?.value[0];
  const from = (sender?.address ?? "").trim().toLowerCase();
  if (!isMailAddress(from)) return { skip: "no_sender" };
  const contentType = String(parsed.headers.get("content-type") && (parsed.headers.get("content-type") as { value?: string }).value || "").toLowerCase();
  // a mail server's own report (a bounce, a delay notice) belongs to the bounce reports, not to a conversation
  if (contentType === "multipart/report" || /^(mailer-daemon|postmaster)@/.test(from)) return { skip: "report" };
  // mail HMS made itself is not a conversation, except an email a person wrote in a mailbox (X-HMS-Kind: conversation, A10): a colleague's own address takes it in
  if (parsed.headers.has("x-hms-kind") && String(parsed.headers.get("x-hms-kind") ?? "").trim().toLowerCase() !== "conversation") return { skip: "hms" };

  const list = (a: unknown): string[] => {
    const items = (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => (x as { value?: { address?: string }[] }).value ?? []);
    return items.map((x) => (x.address ?? "").trim().toLowerCase()).filter(isMailAddress).slice(0, 50);
  };
  const replyTo = list(parsed.replyTo)[0] ?? null;
  const own = `<ses-${inb.sesMessageId}@hms.inbound>`;
  const references = (Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []).filter(validId).slice(-40);
  const at = inb.at && inb.at.getTime() > 0 && inb.at.getTime() <= now.getTime() ? inb.at : now;
  const preview = await previewOf(inb.raw.subarray(0, 64 * 1024));
  return {
    entry: {
      channel: "email",
      direction: "in",
      // the sender's own Message-ID keeps a repeat of the same mail from being taken twice; SES's id is used when it has none
      externalId: validId(parsed.messageId) ? parsed.messageId : own,
      sentAt: at,
      person: from,
      personName: sender?.name ? sender.name.slice(0, 120) : null,
      from,
      replyTo,
      to: list(parsed.to),
      cc: list(parsed.cc),
      subject: (parsed.subject ?? "").slice(0, 500),
      preview,
      hasAttachments: parsed.attachments.some((a) => a.contentDisposition === "attachment"),
      inReplyTo: validId(parsed.inReplyTo) ? parsed.inReplyTo : null,
      references,
      box: "main",
      senderVerified: inb.verified,
      sentFrom: "contact",
      status: "received",
    },
  };
}
