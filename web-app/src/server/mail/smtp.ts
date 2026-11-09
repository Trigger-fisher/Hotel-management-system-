import "server-only";
import type nodemailer from "nodemailer";
import { open, seal } from "../crypto/secretBox";
import type { MailAttachment, MailMessage, MailSender } from "../services/auth/mail";
import { failureCodeOf, MAIL_FAILURE_TEXT, type MailFailureCode } from "./failure";
import { BLOCKED_EXTENSIONS, MAIL_FILES_MAX_BYTES, mailFileType } from "./files";
import { hintFor } from "./hints";
import { MailHostError, resolvePublicHost, type HostLookup } from "./safeHost";
import { mailAddressOf } from "./sendingDomain";

// THE mail module: the one SMTP configuration, the one transport builder, the one send function, the one test, the one encrypt/decrypt. The platform sender (system mail:
// compose/mail.ts, mail/platformSmtp.ts) and each hotel's own sender (mail/hotelSmtp.ts) are only different places the SAME settings are read from (Platform settings > Mail;
// a hotel's Settings > Email: the fields are the same), so they cannot drift apart. What is guaranteed here, for both:
//  - the connection is encrypted unless "none" was chosen: STARTTLS is REQUIRED on a plain port (a server that cannot offer it is not used), SSL/TLS is TLS from the first byte;
//  - short timeouts, so a dead server fails the attempt (the worker retries later) instead of hanging the queue;
//  - header injection is impossible: the recipient, the subject, the reply-to and the sender name may not hold a line break (refused before anything is sent);
//  - an error thrown out is a fixed sentence with a REASON CODE (mail/failure.ts), never the server's text (it can carry the address, the login or the host's banner); only the
//    "Send test email" button shows the server's own words, with the password and the login cut out;
//  - the password is the one secret: stored ENCRYPTED (AES-256-GCM, a fresh random IV per value, key SMTP_SECRET_KEY, the scope "platform" or the hotel bound in), opened only to
//    build a transport, never returned by an API, never logged.

export type SmtpSecurity = "starttls" | "ssl" | "none";

/** One mail server, however it was set up. */
export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  user?: string;
  pass?: string;
  /** `noreply@hotel.in` or `"Name" <noreply@hotel.in>`. */
  from: string;
  /** An address replies go to. */
  replyTo?: string;
  /** The platform's sending domain (Platform settings > Mail): a hotel mail with a romLocal is sent from <fromLocal>@<this domain>. Only the platform sender has one. */
  sendingDomain?: string;
}

/** What nodemailer takes for a file. */
export interface TransportAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/** What nodemailer needs of a transport (the test double has the same shape). A Conversations reply is sent as a finished message (`raw`) with its own `envelope`. */
export interface SmtpTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; html?: string; replyTo?: string; attachments?: TransportAttachment[]; messageId?: string; headers?: Record<string, string>; envelope?: { from: string; to: string[] }; raw?: Buffer }): Promise<unknown>;
  /** Signs in without sending (Test connection). */
  verify?(): Promise<unknown>;
  close?(): void;
}

/**
 * The mark every mail HMS makes carries (decision 66, A10): `X-HMS-Kind: <kind>` (the outbox kind of mail/routes.ts, "test" for "Send test email", "conversation" for a
 * Conversations reply; "system" when the caller named none). Reading a mailbox, HMS never lists a mail with this mark except its own Conversations replies, so the reset
 * links, codes, invoices and summaries in a Sent folder never reach the hub.
 */
export const HMS_KIND_HEADER = "X-HMS-Kind";
export const kindHeaderValue = (kind: string | undefined): string => (kind && /^[a-z][a-z0-9_]{0,39}$/.test(kind) ? kind : "system");

/** Builds a transport from the options of transportOptions; a test's double answers at once, the real one may answer later. */
export type TransportFactory = (options: Record<string, unknown>) => SmtpTransport | Promise<SmtpTransport>;
// nodemailer is loaded when the first transport is built, not when a route file is (the import above is type-only and erased): a request that sends no mail never loads it
const defaultFactory: TransportFactory = async (o) => ((await import("nodemailer")).default as typeof nodemailer).createTransport(o) as unknown as SmtpTransport;

export class MailSendError extends Error {
  readonly code: "REFUSED_INPUT" | "SMTP_FAILED";
  /** Why, as a short code (mail/failure.ts); never the server's own words. */
  readonly reason: MailFailureCode;
  /** The server's own words with the secrets cut out. Only set for the test button (`keepDetail`); never present on a queued mail. */
  readonly detail?: string;
  constructor(code: "REFUSED_INPUT" | "SMTP_FAILED", cause?: unknown, detail?: string) {
    super(code === "REFUSED_INPUT" ? "The mail was refused before sending: the address or subject is not valid." : "The mail server did not accept the message.");
    this.name = "MailSendError";
    this.code = code;
    this.reason = code === "REFUSED_INPUT" ? "RECIPIENT" : cause === undefined ? "UNKNOWN" : failureCodeOf(cause);
    if (detail !== undefined) this.detail = detail;
  }
}

/** The one mail server HMS sends through (MJ, 17 Oct 2026): Gmail, port 587, STARTTLS. The forms only ask for the Gmail address and its app password; this is fixed. */
export const GMAIL = { host: "smtp.gmail.com", port: 587, security: "starttls" } as const satisfies { host: string; port: number; security: SmtpSecurity };
/** Is this the Gmail server above? A hotel or the platform may still have an older server saved; that one keeps working until the form is saved again. */
export const isGmail = (c: { host: string; port: number; security: SmtpSecurity }): boolean => c.host.toLowerCase() === GMAIL.host && c.port === GMAIL.port && c.security === GMAIL.security;

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const NO_BREAK = /^[^\r\n\u2028\u2029]+$/;
const FILE_NAME = /[^A-Za-z0-9._ -]/g;
const MAX_ATTACHMENT_BYTES = MAIL_FILES_MAX_BYTES;

/** The checks every place that saves a mail setting uses (the Super Admin's form and the hotel's Settings > Email); each answers true when the value is acceptable. */
export const smtpChecks = {
  user: (v: string): boolean => v.length <= 254 && !/[\u0000-\u001f\u007f]/.test(v),
  password: (v: string): boolean => v.length <= 500 && !/[\r\n\u0000]/.test(v),
  /** Empty is "none"; otherwise one address. */
  address: (v: string): boolean => v === "" || (v.length <= 254 && ADDRESS.test(v)),
} as const;

/** Is it an address mail can be sent to? */
export const isMailAddress = (v: string): boolean => v.length <= 254 && ADDRESS.test(v) && NO_BREAK.test(v);

/** The `security` the old stored words mean: a hotel kept "tls" (= STARTTLS), "ssl" and "none" in Settings > Email. */
export const securityOfStored = (v: string | null | undefined): SmtpSecurity => (v === "ssl" || v === "none" ? v : "starttls");

/** The security a server's own SMTP_* variables mean: TLS from the first byte on SMTP_SECURE=true or port 465, otherwise STARTTLS. */
export const securityOfEnv = (port: number, secure: string | undefined): SmtpSecurity => ((secure ?? (port === 465 ? "true" : "false")) === "true" ? "ssl" : "starttls");

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the encrypted password: one place
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A scope binds a sealed value to its owner: "platform", or a hotel's id; a sealed value copied to another owner does not open. */
const contextOf = (scope: string): string => `smtp:${scope}`;
export const sealSmtpSecret = (key: Buffer, plain: string, scope: string): string => seal(key, plain, contextOf(scope));
export const openSmtpSecret = (key: Buffer, sealed: string, scope: string): string => open(key, sealed, contextOf(scope));
/** Is this stored text one of ours ("v1.iv.tag.data")? Anything else is an older plain value, still read, and sealed at the next save. */
export const isSealedSmtpSecret = (v: string): boolean => /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);

/**
 * A stored password as the plain password: a sealed value is opened with the key (null when it cannot be: no key, a changed key, another owner); a stored value that is not
 * sealed is a legacy plain one and is used as it is. null = no password saved.
 */
export function readSmtpPassword(stored: string | null | undefined, key: Buffer | null, scope: string): { pass: string | null; unreadable: boolean } {
  const v = stored ?? "";
  if (v === "") return { pass: null, unreadable: false };
  if (!isSealedSmtpSecret(v)) return { pass: v, unreadable: false };
  if (!key) return { pass: null, unreadable: true };
  try {
    return { pass: openSmtpSecret(key, v, scope), unreadable: false };
  } catch {
    return { pass: null, unreadable: true };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// building a message and a transport
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** `"Name" <a@b.in>` from a display name and an address; the name is quoted so a comma or a quote in it cannot change the address. */
export function fromHeader(name: string | null, email: string): string {
  const n = (name ?? "").replace(/[\r\n"<>\\]/g, " ").replace(/\s+/g, " ").trim();
  return n === "" ? email : `"${n}" <${email}>`;
}

/** The same address with another display name: `"Hotel Sunrise" <noreply@x.in>` from `HMS <noreply@x.in>`. */
export function withFromName(from: string, name: string): string {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  return fromHeader(name, address.trim());
}

/**
 * The reply-to, From name and attachments of a message, checked and ready for a transport: no line break in an address or a name, only PDFs, a plain file name, 10 MB in all.
 * Throws REFUSED_INPUT before anything is sent.
 */
export function messageParts(message: Pick<MailMessage, "replyTo" | "fromName" | "fromLocal" | "fromAddress" | "attachments">): { replyTo?: string; fromName?: string; fromLocal?: string; fromAddress?: string; attachments?: TransportAttachment[] } {
  const replyTo = message.replyTo?.trim();
  if (replyTo && !isMailAddress(replyTo)) throw new MailSendError("REFUSED_INPUT");
  const fromName = message.fromName?.trim();
  if (fromName && !NO_BREAK.test(fromName)) throw new MailSendError("REFUSED_INPUT");
  const fromLocal = message.fromLocal?.trim().toLowerCase();
  if (fromLocal && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(fromLocal)) throw new MailSendError("REFUSED_INPUT");
  const fromAddress = message.fromAddress?.trim().toLowerCase();
  if (fromAddress && !isMailAddress(fromAddress)) throw new MailSendError("REFUSED_INPUT");
  let attachments: TransportAttachment[] | undefined;
  if (message.attachments && message.attachments.length > 0) {
    let total = 0;
    attachments = message.attachments.map((a: MailAttachment) => {
      total += a.content.byteLength;
      // Gmail's rules: 25 MB in all and no program or script file; the content type is the one the file name implies (a made-up type is never trusted)
      const name = a.filename.replace(FILE_NAME, "-").replace(/-+/g, "-").replace(/^[-.]+/, "").slice(0, 100) || "document.pdf";
      const extension = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
      if (total > MAX_ATTACHMENT_BYTES || a.content.byteLength === 0 || BLOCKED_EXTENSIONS.has(extension) || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(a.contentType)) throw new MailSendError("REFUSED_INPUT");
      return { filename: extension === "" ? `${name}.pdf` : name, content: Buffer.from(a.content), contentType: extension === "" || extension === "pdf" ? "application/pdf" : mailFileType(name) };
    });
  }
  return { ...(replyTo ? { replyTo } : {}), ...(fromName ? { fromName } : {}), ...(fromLocal ? { fromLocal } : {}), ...(fromAddress ? { fromAddress } : {}), ...(attachments ? { attachments } : {}) };
}

/** The ONE transport builder: what nodemailer is given for a server. `pool` keeps up to 3 connections open and reuses them (a hotel that sends many mails). */
export function transportOptions(c: SmtpConfig, pool: boolean): Record<string, unknown> {
  return {
    host: c.host,
    port: c.port,
    secure: c.security === "ssl",
    requireTLS: c.security === "starttls",
    ...(c.user !== undefined && c.pass !== undefined ? { auth: { user: c.user, pass: c.pass } } : {}),
    ...(pool ? { pool: true, maxConnections: 3, maxMessages: 200 } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** The reply, one line, cut to 300 characters, with the secrets (the password, the login) replaced; control characters removed. */
export function scrub(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  for (const s of secrets) if (s && s.length >= 3) out = out.split(s).join("***");
  return Array.from(out).slice(0, 300).join("") || "The mail server did not accept the message.";
}

function describe(error: unknown): string {
  const e = error as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown } | null;
  const parts = [typeof e?.code === "string" ? e.code : null, typeof e?.responseCode === "number" ? String(e.responseCode) : null, typeof e?.response === "string" ? e.response : typeof e?.message === "string" ? e.message : null].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(" ") : "The mail server did not accept the message.";
}

export interface SmtpSenderOptions {
  createTransport?: TransportFactory;
  /** Keep the connections open and reuse them (default: one fresh connection per sender, used by the test button and the platform). */
  pool?: boolean;
  /** The platform sender's name/address from Platform settings, read for every mail: they win over `config.from` (only the platform uses this). */
  resolveFrom?: () => Promise<{ name: string | null; email: string | null } | null>;
  /** Put the server's own words (secrets cut out) on a failure. Only for "Send test email". */
  keepDetail?: boolean;
}

/** THE send function: one sender for one mail server. `close()` drops the connections. */
export function createSmtpSender(config: SmtpConfig, options: SmtpSenderOptions = {}): MailSender & { close(): void } {
  const make = options.createTransport ?? defaultFactory;
  // the one transport, built on the first send and kept (as a promise, so two first sends share it; `built` once it is there)
  let transport: Promise<SmtpTransport> | null = null;
  let built: SmtpTransport | null = null;
  const get = (): Promise<SmtpTransport> =>
    (transport ??= Promise.resolve(make(transportOptions(config, options.pool === true))).then(
      (t) => (built = t),
      (e: unknown) => {
        // a transport that could not be built is tried again by the next send, as before
        transport = null;
        throw e;
      },
    ));
  return {
    async send(message) {
      if (!ADDRESS.test(message.to) || !NO_BREAK.test(message.to) || !NO_BREAK.test(message.subject)) throw new MailSendError("REFUSED_INPUT");
      const cc = message.cc ?? [];
      const bcc = message.bcc ?? [];
      if (cc.length > 5 || cc.some((a) => !ADDRESS.test(a) || !NO_BREAK.test(a))) throw new MailSendError("REFUSED_INPUT");
      if (bcc.length > 5 || bcc.some((a) => !ADDRESS.test(a) || !NO_BREAK.test(a))) throw new MailSendError("REFUSED_INPUT");
      const parts = messageParts(message);
      let from = config.from;
      if (!message.useEnvironmentFrom) {
        try {
          const chosen = await options.resolveFrom?.();
          if (chosen && chosen.email && ADDRESS.test(chosen.email)) from = fromHeader(chosen.name, chosen.email);
          else if (chosen && chosen.name && !chosen.email) from = fromHeader(chosen.name, /<([^>]+)>/.exec(config.from)?.[1] ?? config.from);
        } catch {
          // the settings could not be read: the configured sender is used
        }
      }
      // a hotel's mail that goes out through the platform sender (the hotel has no mail server of its own yet) carries the hotel's name and reply-to
      // a hotel on the platform's mail: <hotel slug>@<the platform's sending domain>, with the hotel's name as the sender name
      // (a reserved name such as support or billing never becomes an address: the platform address sends, with the hotel's name)
      const slugAddress = parts.fromLocal ? mailAddressOf(parts.fromLocal, config.sendingDomain) : null;
      if (parts.fromAddress && config.sendingDomain) from = fromHeader(parts.fromName ?? null, parts.fromAddress);
      else if (slugAddress) from = fromHeader(parts.fromName ?? null, slugAddress);
      else if (parts.fromName) from = withFromName(from, parts.fromName);
      const replyTo = parts.replyTo ?? config.replyTo;
      try {
        // our Message-ID (bounces and complaints find their hotel through it) and List-Unsubscribe of campaign mail: only these, only of the safe shape (no line breaks)
        const messageId = message.messageId && NO_BREAK.test(message.messageId) && /^<[^<>\s]+@[^<>\s]+>$/.test(message.messageId) ? message.messageId : undefined;
        const unsubscribe = message.headers?.["List-Unsubscribe"];
        // one-click unsubscribe (RFC 8058): the fixed List-Unsubscribe-Post value, only next to an https List-Unsubscribe (the address answers a POST: app/api/v1/public/unsubscribe)
        const oneClick = message.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click";
        // threading of a Conversations reply: only ids of the safe shape, References at most 20 ids and 900 characters
        const idOk = (id: string | undefined): id is string => typeof id === "string" && NO_BREAK.test(id) && /^<[^<>\s]+@[^<>\s]+>$/.test(id);
        const refs = (message.references ?? []).filter(idOk).slice(-REFERENCES_MAX);
        while (refs.length > 1 && refs.join(" ").length > REFERENCES_CHARS) refs.shift();
        const headers: Record<string, string> = {
          [HMS_KIND_HEADER]: kindHeaderValue(message.kind),
          ...(idOk(message.inReplyTo) ? { "In-Reply-To": message.inReplyTo } : {}),
          ...(refs.length > 0 ? { References: refs.join(" ") } : {}),
          ...(unsubscribe && NO_BREAK.test(unsubscribe) && /^<https:\/\/[^<>\s]+>$/.test(unsubscribe) ? { "List-Unsubscribe": unsubscribe, ...(oneClick ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}) } : {}),
        };
        // the HTML part (mail/layout.ts) goes in nodemailer's own `html` field next to the text: a multipart/alternative mail, the program picks what it can show
        await (await get()).sendMail({ from, to: message.to, ...(cc.length > 0 ? { cc } : {}), ...(bcc.length > 0 ? { bcc } : {}), subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}), ...(replyTo ? { replyTo } : {}), ...(parts.attachments ? { attachments: parts.attachments } : {}), ...(messageId ? { messageId } : {}), headers });
      } catch (error) {
        throw new MailSendError("SMTP_FAILED", error, options.keepDetail ? scrub(describe(error), [config.pass, config.user]) : undefined);
      }
    },
    close() {
      // a transport still being built is closed once it is there; one that failed to build has nothing to close
      if (built) built.close?.();
      else void transport?.then((t) => t.close?.()).catch(() => undefined);
      built = null;
      transport = null;
    },
  };
}

export interface SmtpTestResult {
  ok: boolean;
  /** The exact result: "Sent", or what the mail server (or the network) answered, without the password and the login. */
  message: string;
  /** Plain help for the usual failures of the chosen service (a wrong app password or SMTP key, the sandbox of Amazon SES, an unreachable server; mail/hints.ts). */
  hint?: string;
}

/**
 * "Send test email" (the Super Admin's and the hotel's): one short mail through the SAME sender code a real mail uses, over a fresh connection, to `to`, and the exact result.
 * The server's own words are shown (the person needs them to fix the set-up) but the password and the login are cut out of them.
 */
export async function sendTestMail(config: SmtpConfig, to: string, text: { subject: string; body: string }, createTransport?: TransportFactory): Promise<SmtpTestResult> {
  if (!isMailAddress(to)) return { ok: false, message: "That is not a valid email address." };
  const sender = createSmtpSender(config, { createTransport, keepDetail: true });
  try {
    await sender.send({ to, subject: text.subject, text: text.body, useEnvironmentFrom: true, kind: "test" });
    return { ok: true, message: "Sent" };
  } catch (error) {
    const hint = error instanceof MailSendError ? hintFor(config.host, error.reason) : undefined;
    return { ok: false, message: error instanceof MailSendError ? (error.detail ?? "The mail server did not accept the message.") : scrub(describe(error), [config.pass, config.user]), ...(hint ? { hint } : {}) };
  } finally {
    sender.close();
  }
}
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Conversations (decision 66): a reply composed here, sent through the mailbox's OWN mail server (never the outbox), and the sign-in check of "Test connection"
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A Message-ID HMS writes or refers to: one <...> without spaces or line breaks. */
const MESSAGE_ID_SHAPE = /^<[^<>\s]{1,990}>$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** References keeps the last 20 ids and at most 900 characters (servers refuse very long header lines). */
const REFERENCES_MAX = 20;
const REFERENCES_CHARS = 900;

export interface ReplyDraft {
  to: string;
  cc: readonly string[];
  /** Delivered through the envelope only: never a header of the message. */
  bcc?: readonly string[];
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references: readonly string[];
  /** Our own Message-ID for this reply: <uuid@domain>. */
  messageId: string;
  conversationId: string;
  /** A bill PDF or files added to an email (25 MB in all, none of a type Gmail refuses). */
  attachments?: MailAttachment[];
  bill: boolean;
  /** The Date header (the time the hub records for the reply, so finding it again by its Message-ID can check the date). Default now. */
  date?: Date;
}

/** The References of a reply: the original's References and its own id, the last 20, cut from the front to 900 characters. */
export function referencesOf(previous: readonly string[], inReplyTo: string | null | undefined): string[] {
  const ids = [...previous, ...(inReplyTo ? [inReplyTo] : [])].filter((id) => MESSAGE_ID_SHAPE.test(id));
  const unique = ids.filter((id, i) => ids.lastIndexOf(id) === i).slice(-REFERENCES_MAX);
  while (unique.join(" ").length > REFERENCES_CHARS && unique.length > 1) unique.shift();
  return unique.join(" ").length > REFERENCES_CHARS ? [] : unique;
}

/**
 * The finished reply (headers and body as bytes) and its SMTP envelope. Marked `X-HMS-Kind: conversation` and `X-HMS-Conversation: <id>` (and `X-HMS-Bill: 1` with a bill),
 * so reading the mailbox later knows it as ours. Every address, the subject and every id is checked first: REFUSED_INPUT before anything is built.
 */
export async function composeReply(config: Pick<SmtpConfig, "from" | "user">, reply: ReplyDraft): Promise<{ raw: Buffer; envelope: { from: string; to: string[] } }> {
  const refuse = (): never => {
    throw new MailSendError("REFUSED_INPUT");
  };
  if (!isMailAddress(reply.to) || reply.cc.some((c) => !isMailAddress(c)) || reply.cc.length > 5) refuse();
  if ((reply.bcc ?? []).some((c) => !isMailAddress(c)) || (reply.bcc ?? []).length > 5) refuse();
  if (reply.subject.length > 500 || /[\r\n\u2028\u2029]/.test(reply.subject)) refuse();
  if (!MESSAGE_ID_SHAPE.test(reply.messageId) || (reply.inReplyTo && !MESSAGE_ID_SHAPE.test(reply.inReplyTo)) || !UUID_SHAPE.test(reply.conversationId)) refuse();
  if (reply.text.length === 0 || reply.text.length > 20_000) refuse();
  const parts = messageParts({ attachments: reply.attachments });
  const fromAddress = (/<([^>]+)>/.exec(config.from)?.[1] ?? config.from).trim().toLowerCase();
  if (!isMailAddress(fromAddress)) refuse();
  const references = referencesOf(reply.references, reply.inReplyTo);
  const MailComposer = (await import("nodemailer/lib/mail-composer")).default;
  const composer = new MailComposer({
    from: config.from,
    to: reply.to,
    ...(reply.cc.length > 0 ? { cc: [...reply.cc] } : {}),
    subject: reply.subject,
    text: reply.text,
    messageId: reply.messageId,
    ...(reply.date ? { date: reply.date } : {}),
    ...(reply.inReplyTo ? { inReplyTo: reply.inReplyTo } : {}),
    ...(references.length > 0 ? { references } : {}),
    headers: { [HMS_KIND_HEADER]: "conversation", "X-HMS-Conversation": reply.conversationId, ...(reply.bill ? { "X-HMS-Bill": "1" } : {}) },
    ...(parts.attachments ? { attachments: parts.attachments } : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const raw = await new Promise<Buffer>((resolve, reject) => composer.compile().build((error: Error | null, message: Buffer) => (error ? reject(error) : resolve(message))));
  // a Bcc is in the envelope (it is delivered) and in no header (nobody sees it): the standard way
  return { raw, envelope: { from: fromAddress, to: [reply.to, ...reply.cc, ...(reply.bcc ?? [])] } };
}

/** The transport options for ONE connection to the resolved public address (the certificate is checked against the host name). */
async function safeTransport(config: SmtpConfig, make: TransportFactory, lookup?: HostLookup): Promise<SmtpTransport> {
  const { address, servername } = await resolvePublicHost(config.host, { lookup });
  return make({ ...transportOptions({ ...config, host: address }, false), tls: { servername, minVersion: "TLSv1.2" }, name: undefined });
}

/** Sends a finished message through this mail server, over a fresh connection closed after it. Throws MailSendError (a fixed reason), or MailHostError for a private host. */
export async function sendRaw(config: SmtpConfig, message: { raw: Buffer; envelope: { from: string; to: string[] } }, options: { createTransport?: TransportFactory; lookup?: HostLookup } = {}): Promise<void> {
  const transport = await safeTransport(config, options.createTransport ?? defaultFactory, options.lookup);
  try {
    // `raw` is the whole message as sent; from/to only name the envelope again (nodemailer sends `raw` unchanged)
    await transport.sendMail({ from: message.envelope.from, to: message.envelope.to.join(", "), subject: "", text: "", envelope: message.envelope, raw: message.raw });
  } catch (error) {
    throw new MailSendError("SMTP_FAILED", error);
  } finally {
    transport.close?.();
  }
}

/** The sending side of "Test connection": signs in to the mail server (sends nothing). Fixed sentences only: never the server's words. */
export async function verifySmtp(config: SmtpConfig, createTransport?: TransportFactory, lookup?: HostLookup): Promise<{ ok: boolean; code: string | null; message: string; hint?: string }> {
  let transport: SmtpTransport | null = null;
  try {
    transport = await safeTransport(config, createTransport ?? defaultFactory, lookup);
    if (transport.verify) await transport.verify();
    return { ok: true, code: null, message: "Signed in. Sending works." };
  } catch (error) {
    if (error instanceof MailHostError) return { ok: false, code: "HOST_PRIVATE", message: "This server address is not on the internet.", hint: "Use your mail provider's public IMAP/SMTP server name." };
    const reason = failureCodeOf(error);
    const hint = hintFor(config.host, reason);
    return { ok: false, code: reason, message: MAIL_FAILURE_TEXT[reason], ...(hint ? { hint } : {}) };
  } finally {
    transport?.close?.();
  }
}
