import "server-only";
import { createVerify } from "node:crypto";
// What the mail services tell us after a mail went (MAIL-PROVIDERS-50K plan): a bounce or a complaint (the person marked it as spam), sometimes an unsubscribe. Two sources:
//  - Amazon SES, through an SNS topic subscribed to POST /api/v1/public/mail-events/ses: the SNS envelope is SIGNED by AWS (checked here against AWS's own certificate), and its
//    Message is SES's notification ("notificationType", or "eventType" for configuration-set events);
//  - Brevo's webhook, POST /api/v1/public/mail-events/brevo: one event or a list ("hard_bounce", "spam", "unsubscribed", ...). Brevo signs nothing, so the route's secret key
//    (in the URL the Super Admin copies) is what proves the call; SES calls carry the same key AND the signature.
// Pure parsing and the signature check; nothing here reads or writes the database. Only the address, the kind and a short word from the service are kept, never the mail.

export interface MailEvent {
  kind: "bounce" | "complaint" | "unsubscribe";
  /** lower-case */
  email: string;
  /** A hard bounce (the address does not exist): suppressed for every hotel. A soft one is only counted. */
  permanent: boolean;
  /** A short word from the service ("Permanent/General", "abuse", "hard_bounce"), at most 200 characters. */
  detail: string | null;
  /** The mail's Message-ID header as the service reports it (ours names the outbox row: mail/safety.ts). */
  messageId: string | null;
}

const EMAIL = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,253}$/;
const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
  return EMAIL.test(e) && e.length <= 254 ? e : null;
};
const word = (...parts: unknown[]): string | null => {
  const s = parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join("/").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s === "" ? null : s.slice(0, 200);
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The events in one SES notification (the SNS Message, already parsed from JSON). Deliveries, sends and opens are not events here. */
export function parseSesNotification(message: unknown): MailEvent[] {
  const m = obj(message);
  const type = String(m.notificationType ?? m.eventType ?? "");
  const mail = obj(m.mail);
  const headerId = list(mail.headers).map(obj).find((h) => String(h.name ?? "").toLowerCase() === "message-id")?.value;
  const messageId = typeof obj(mail.commonHeaders).messageId === "string" ? String(obj(mail.commonHeaders).messageId) : typeof headerId === "string" ? headerId : null;
  const out: MailEvent[] = [];
  if (type === "Bounce") {
    const b = obj(m.bounce);
    const permanent = b.bounceType === "Permanent";
    for (const r of list(b.bouncedRecipients).map(obj)) {
      const email = clean(r.emailAddress);
      if (email) out.push({ kind: "bounce", email, permanent, detail: word(b.bounceType, b.bounceSubType), messageId });
    }
  } else if (type === "Complaint") {
    const c = obj(m.complaint);
    for (const r of list(c.complainedRecipients).map(obj)) {
      const email = clean(r.emailAddress);
      if (email) out.push({ kind: "complaint", email, permanent: false, detail: word("complaint", c.complaintFeedbackType), messageId });
    }
  }
  return out;
}

const BREVO_BOUNCE_HARD = new Set(["hard_bounce", "invalid_email", "blocked"]);
const BREVO_BOUNCE_SOFT = new Set(["soft_bounce"]);
const BREVO_COMPLAINT = new Set(["spam", "complaint"]);
const BREVO_UNSUBSCRIBE = new Set(["unsubscribed", "unsubscribe"]);

/** The events in a Brevo webhook body (one event, or a list of them). Other events (delivered, opened, clicked) are left out. */
export function parseBrevoEvents(body: unknown): MailEvent[] {
  const out: MailEvent[] = [];
  for (const e of (Array.isArray(body) ? body : [body]).map(obj)) {
    const name = String(e.event ?? "").toLowerCase();
    const email = clean(e.email);
    if (!email) continue;
    const messageId = typeof e["message-id"] === "string" ? String(e["message-id"]) : typeof e.message_id === "string" ? String(e.message_id) : null;
    if (BREVO_BOUNCE_HARD.has(name)) out.push({ kind: "bounce", email, permanent: true, detail: word(name, e.reason), messageId });
    else if (BREVO_BOUNCE_SOFT.has(name)) out.push({ kind: "bounce", email, permanent: false, detail: word(name, e.reason), messageId });
    else if (BREVO_COMPLAINT.has(name)) out.push({ kind: "complaint", email, permanent: false, detail: word(name), messageId });
    else if (BREVO_UNSUBSCRIBE.has(name)) out.push({ kind: "unsubscribe", email, permanent: false, detail: word(name), messageId });
  }
  return out;
}

/* ------------------------------------------------------------------ the SNS envelope */

export interface SnsEnvelope {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

/** The envelope's fields, or null when it is not an SNS message of a known type. */
export function snsEnvelopeOf(body: unknown): SnsEnvelope | null {
  const b = obj(body);
  const type = b.Type;
  if (type !== "Notification" && type !== "SubscriptionConfirmation" && type !== "UnsubscribeConfirmation") return null;
  for (const k of ["MessageId", "TopicArn", "Message", "Timestamp", "SignatureVersion", "Signature", "SigningCertURL"]) if (typeof b[k] !== "string") return null;
  return b as unknown as SnsEnvelope;
}

/** An AWS SNS address (the certificate, the subscribe link): https, a host of sns.<region>.amazonaws.com (or .com.cn); nothing else is ever fetched. */
export function isSnsUrl(raw: string | undefined, kind: "cert" | "subscribe"): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "") return false;
  if (!/^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname)) return false;
  return kind === "cert" ? u.pathname.endsWith(".pem") : u.searchParams.get("Action") === "ConfirmSubscription";
}

/** The text AWS signed (its documented field order; Subject only when present on a Notification). */
export function snsStringToSign(m: SnsEnvelope): string {
  const keys = m.Type === "Notification" ? ["Message", "MessageId", ...(m.Subject !== undefined ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"] : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.map((k) => `${k}\n${String((m as unknown as Record<string, unknown>)[k] ?? "")}\n`).join("");
}

/** The PEM of a signing certificate, fetched once per address (only SNS addresses: isSnsUrl). */
export type CertFetcher = (url: string) => Promise<string>;
const certCache = new Map<string, string>();

/** True when AWS signed this envelope: an SNS certificate address, version 1 (SHA1) or 2 (SHA256), the signature valid for its certificate, and at most an hour old. */
export async function verifySns(m: SnsEnvelope, fetchCert: CertFetcher, now: Date = new Date()): Promise<boolean> {
  if (!isSnsUrl(m.SigningCertURL, "cert")) return false;
  const algorithm = m.SignatureVersion === "1" ? "RSA-SHA1" : m.SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algorithm) return false;
  const at = Date.parse(m.Timestamp);
  if (!Number.isFinite(at) || Math.abs(now.getTime() - at) > 3_600_000) return false;
  let pem = certCache.get(m.SigningCertURL);
  if (!pem) {
    try {
      pem = await fetchCert(m.SigningCertURL);
    } catch {
      return false;
    }
    if (!/^-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/.test(pem.trim())) return false;
    certCache.set(m.SigningCertURL, pem);
  }
  try {
    return createVerify(algorithm).update(snsStringToSign(m), "utf8").verify(pem, m.Signature, "base64");
  } catch {
    return false;
  }
}

/** Tests: forget the fetched certificates. */
export function clearSnsCertCache(): void {
  certCache.clear();
}
