import "server-only";
import type { HeaderItem } from "./imap";
import { outboxIdOfMessageId } from "./safety";

// Which mail enters Conversations (decision 66, A10 to A12). Pure rules on a message's header, shared by the hotel and the platform mailbox:
//  - A10: mail HMS itself made (every mail HMS sends carries X-HMS-Kind) is never listed, except a Conversations reply (X-HMS-Kind: conversation). The platform's Sent folder
//    holds password-reset links and sign-in codes, a hotel's holds invoices and the daily summary: none of it may appear in the hub. A Sent message is listed only when it
//    is a Conversations reply, or when it answers a message already in the hub (staff answering a hub thread from Gmail itself).
//  - A11: account-security mail (sign-in and reset codes of Google, Microsoft, Facebook...) is never listed; bulk and automated mail goes to Other, away from guests.
//  - A12: a sender counts as verified only when the receiving server says so in the TOPMOST Authentication-Results header (the one the hotel's own server added), and that
//    header names the mailbox's own server as its authserv-id.
//  - A10 also keeps out bounces and automatic replies to HMS mail (they carry the mail they answer). A person's own reply to a hotel's HMS mail (an invoice, a receipt) is
//    listed; on the platform mailbox no answer to HMS mail is listed (it quotes a code or a link).

/** Known senders of account-security mail (codes, password resets, new sign-ins). */
export const SECURITY_SENDERS: readonly string[] = [
  "no-reply@accounts.google.com",
  "accounts.google.com",
  "account-security-noreply@accountprotection.microsoft.com",
  "accountprotection.microsoft.com",
  "security@facebookmail.com",
  "security@mail.instagram.com",
  "no-reply@appleid.apple.com",
  "appleid.apple.com",
  "verify@twitter.com",
  "info@account.zoho.com",
  "noreply@github.com",
  "security-noreply@linkedin.com",
  "no-reply@amazon.com",
  "account-update@amazon.com",
];

const SECURITY_SUBJECT = /(verification code|security code|sign-?in code|one[- ]time (password|code)|\bOTP\b|reset (your )?password|password reset)/i;
const NOREPLY_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?)([+._-].*)?$/i;

const domainOf = (address: string | null): string => (address ?? "").split("@")[1]?.toLowerCase() ?? "";
const localOf = (address: string | null): string => (address ?? "").split("@")[0]?.toLowerCase() ?? "";

/** Is this sender a known account-security sender (the full address, or its domain or a subdomain of a listed domain)? */
export function isSecuritySender(address: string | null): boolean {
  const a = (address ?? "").toLowerCase();
  if (a === "") return false;
  const domain = domainOf(a);
  return SECURITY_SENDERS.some((s) => (s.includes("@") ? s === a : domain === s || domain.endsWith(`.${s}`)));
}

/** The Auto-Submitted keyword: its first token, lower case ("no (human)" is "no", RFC 3834 allows a comment); null when there is none. */
const autoSubmittedOf = (item: Pick<HeaderItem, "headers">): string | null => {
  const token = (item.headers.autoSubmitted ?? "").trim().toLowerCase().split(/[\s;(]/)[0] ?? "";
  return token === "" ? null : token;
};

/** Automated mail: Auto-Submitted other than "no". */
const isAutomated = (item: Pick<HeaderItem, "headers">): boolean => {
  const auto = autoSubmittedOf(item);
  return auto !== null && auto !== "no";
};

/** Bulk mail: list headers, a bulk precedence, an automated mail, or a no-reply sender. */
export function isBulk(item: Pick<HeaderItem, "headers" | "envelope">): boolean {
  const h = item.headers;
  if (h.listUnsubscribe || h.listId || h.autoResponseSuppress || isAutomated(item)) return true;
  if (h.precedence !== null && /^(bulk|list|junk)$/.test(h.precedence)) return true;
  return NOREPLY_LOCAL.test(localOf(item.envelope.from));
}

export type InboundVerdict = "skip_hms" | "skip_report" | "skip_security" | "skip_self" | "other" | "main";

const REPORT_LOCAL = /^(mailer-daemon|postmaster)([+._-].*)?$/i;

const REPORT_TYPES = new Set(["multipart/report", "message/delivery-status"]);

/**
 * A delivery report (a bounce) or another automatic notice: multipart/report or message/delivery-status, sent by a mailer-daemon or postmaster, or sent with the null
 * Return-Path "<>" (RFC 5321 keeps the null reverse-path for notifications: bounces, delivery and read reports, RFC 3834 automatic replies). Most bounces name nothing in
 * In-Reply-To or References and carry the message they report on, often whole, so none of these is listed, whatever it answers.
 */
export function isDeliveryReport(item: Pick<HeaderItem, "headers" | "envelope">): boolean {
  if (item.headers.returnPathNull) return true;
  return (item.headers.contentType !== null && REPORT_TYPES.has(item.headers.contentType)) || REPORT_LOCAL.test(localOf(item.envelope.from));
}

/** Does this message answer mail HMS sent from the outbox (our <hms.{outbox id}@mail.hms> Message-ID in In-Reply-To or References)? */
export function answersHmsMail(item: Pick<HeaderItem, "envelope" | "references">): boolean {
  return [item.envelope.inReplyTo, ...item.references].some((id) => outboxIdOfMessageId(id) !== null);
}

/** Common out-of-office and automatic-reply subjects (English and a few other languages mail servers use). Never enough on its own: a person may write these words. */
const AUTO_REPLY_SUBJECT = /^\s*(automatic reply|auto(-|\s)?reply|autoreply|auto(-|\s)?response|out of (the )?office:|away from (the )?office:|vacation reply|abwesenheitsnotiz|r[ée]ponse automatique|risposta automatica|respuesta autom[áa]tica)/i;
const AUTO_PRECEDENCE = /^(auto_reply|bulk|junk)$/;

/**
 * Was this message surely written by a machine, not a person? A message that answers HMS mail is hidden only on these STRONG signals (a guest's own reply to an invoice
 * stays listed):
 *  - Auto-Submitted auto-replied or auto-notified (its first token), or an X-Autoreply / X-Autorespond header with a yes-like value (imap.ts autoReplyHeader);
 *  - Precedence auto_reply;
 *  - an out-of-office subject together with an auto header (X-Auto-Response-Suppress, or Precedence auto_reply, bulk or junk), never the subject alone.
 * The weak signals (Precedence bulk or junk, Auto-Submitted auto-generated, which ticket and helpdesk tools set on an agent's own answer) send the message to Other instead
 * (isBulk), where a person can still find it. A null Return-Path is a report (isDeliveryReport), whatever it answers.
 */
export function isMachineAnswer(item: Pick<HeaderItem, "headers" | "envelope">): boolean {
  const h = item.headers;
  const auto = autoSubmittedOf(item);
  if (h.autoReplyHeader || auto === "auto-replied" || auto === "auto-notified") return true;
  if (h.precedence === "auto_reply") return true;
  return AUTO_REPLY_SUBJECT.test(item.envelope.subject) && (h.autoResponseSuppress || (h.precedence !== null && AUTO_PRECEDENCE.test(h.precedence)));
}

export interface InboundOptions {
  /**
   * Hide EVERY answer to HMS mail, a person's own too (the platform mailbox: everything it sends is system mail, MAIL_ROUTE "platform", and sign-in codes, reset links,
   * temporary passwords and invitation links ride in it; an answer quotes them, and none may reach the hub, A10). A hotel's mailbox lists a person's answer to its invoices
   * and receipts.
   */
  hideHmsAnswers?: boolean;
}

/** What happens to a message found in the Inbox. `mailbox` is the mailbox's own address (lower case). */
export function classifyInbound(item: Pick<HeaderItem, "headers" | "envelope" | "references">, mailbox: string, o: InboundOptions = {}): InboundVerdict {
  // A10: anything HMS made, except a Conversations reply (which can arrive in the Inbox as a copy, e.g. a reply sent to the hotel's own address)
  if (item.headers.hmsKind !== null && item.headers.hmsKind !== "conversation") return "skip_hms";
  // A10: a bounce or an automatic reply carries the mail it answers (a reset link, a sign-in code, an invoice), quoted or whole: never listed. On a hotel's mailbox only
  // MACHINE answers to HMS mail are hidden: a guest's own reply to an invoice or receipt ("paid, see attached") is listed like any mail (weak automatic signals: Other).
  // On the platform mailbox every answer to HMS mail is hidden. Conversations replies have their own Message-ID shape, so any answer to one of those is an ordinary message.
  if (isDeliveryReport(item)) return "skip_report";
  if (answersHmsMail(item) && (o.hideHmsAnswers === true || isMachineAnswer(item))) return "skip_hms";
  // A11: account-security mail, by sender, and any automated mail with a code or reset subject
  if (isSecuritySender(item.envelope.from)) return "skip_security";
  if ((isAutomated(item) || NOREPLY_LOCAL.test(localOf(item.envelope.from))) && SECURITY_SUBJECT.test(item.envelope.subject)) return "skip_security";
  // mail the mailbox sent to itself only (a note to self, a Gmail forward loop)
  const self = mailbox.toLowerCase();
  if (item.envelope.from === self && item.envelope.to.length > 0 && item.envelope.to.every((t) => t === self)) return "skip_self";
  // a Conversations reply copied into the Inbox is ours: listed through Sent
  if (item.headers.hmsKind === "conversation") return "skip_hms";
  return isBulk(item) ? "other" : "main";
}

/**
 * What happens to a message found in Sent: listed only when it is a Conversations reply (X-HMS-Conversation), or answers a message already in the hub
 * (`known`: the In-Reply-To and References ids of the batch that the hub holds). Anything else HMS made (X-HMS-Kind) is skipped first.
 */
export function classifySent(item: Pick<HeaderItem, "headers" | "envelope" | "references">, known: ReadonlySet<string>): "ingest" | "skip" {
  if (item.headers.hmsKind !== null && item.headers.hmsKind !== "conversation") return "skip";
  if (item.headers.hmsKind === "conversation" && item.headers.hmsConversation) return "ingest";
  const ids = [item.envelope.inReplyTo, ...item.references].filter((x): x is string => typeof x === "string");
  return ids.some((id) => known.has(id)) ? "ingest" : "skip";
}

/** Two domains are aligned when they are equal or one is a subdomain of the other (relaxed alignment). */
export function alignedDomains(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/\.$/, "");
  const y = b.trim().toLowerCase().replace(/\.$/, "");
  if (x === "" || y === "") return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

const GOOGLE_AUTHSERV = new Set(["mx.google.com", "google.com"]);

/**
 * A12: is this authserv-id (the first token of an Authentication-Results header) the mailbox's own receiving server? A server that stamps no header of its own leaves the
 * sender's forged one on top, so only the expected name counts: mx.google.com for a Gmail or Google Workspace mailbox, else a name in the IMAP server's own domain
 * (imap.hotel.example -> hotel.example or a subdomain of it).
 */
export function isTrustedAuthServ(authservId: string, imapHost: string): boolean {
  const id = authservId.trim().toLowerCase().replace(/\.$/, "");
  const host = imapHost.trim().toLowerCase().replace(/\.$/, "");
  if (id === "" || host === "" || !/^[a-z0-9.-]+$/.test(id)) return false;
  if (host === "imap.gmail.com" || host === "imap.googlemail.com") return GOOGLE_AUTHSERV.has(id);
  const labels = host.split(".");
  const base = labels.length >= 3 ? labels.slice(1).join(".") : host;
  return alignedDomains(id, base);
}

/**
 * A12: did the receiving server verify the From domain? Reads the TOPMOST Authentication-Results header only (lower ones can be written by the sender), and only when its
 * authserv-id is the mailbox's own server (`imapHost`; see isTrustedAuthServ). Verified when dmarc=pass, or when spf=pass with an aligned smtp.mailfrom domain AND
 * dkim=pass with an aligned header.d (or header.i).
 */
export function parseAuthResults(header: string | null, fromDomain: string, imapHost: string): boolean {
  if (!header || fromDomain.trim() === "") return false;
  const text = header.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ");
  const parts = text.split(";");
  // "authserv-id [version]": a first part that is already a result (method=value) has no authserv-id and cannot be told apart from a forged one
  const authserv = (parts[0] ?? "").trim().split(" ")[0] ?? "";
  if (authserv.includes("=") || !isTrustedAuthServ(authserv, imapHost)) return false;
  const results = parts.slice(1).map((r) => r.trim().toLowerCase());
  const of = (method: string): string[] => results.filter((r) => r.startsWith(`${method}=`));
  if (of("dmarc").some((r) => /^dmarc=pass\b/.test(r))) {
    const hf = /header\.from=([^\s;]+)/.exec(of("dmarc").find((r) => /^dmarc=pass\b/.test(r)) ?? "")?.[1];
    return hf === undefined || alignedDomains(hf, fromDomain);
  }
  const spf = of("spf").some((r) => {
    if (!/^spf=pass\b/.test(r)) return false;
    const mailFrom = /smtp\.mailfrom=([^\s;]+)/.exec(r)?.[1] ?? "";
    const domain = mailFrom.includes("@") ? mailFrom.split("@").pop() ?? "" : mailFrom;
    return alignedDomains(domain, fromDomain);
  });
  const dkim = of("dkim").some((r) => {
    if (!/^dkim=pass\b/.test(r)) return false;
    const d = /header\.d=([^\s;]+)/.exec(r)?.[1] ?? /header\.i=@?([^\s;]+)/.exec(r)?.[1]?.split("@").pop() ?? "";
    return alignedDomains(d, fromDomain);
  });
  return spf && dkim;
}
