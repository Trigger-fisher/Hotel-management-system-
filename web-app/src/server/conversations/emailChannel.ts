import "server-only";
import type { EmailBody } from "@shared/dashboards/conversations";
import { conversationsCopy } from "@shared/dashboards/conversations";
import { AppError } from "../errors";
import { classifyInbound, classifySent, parseAuthResults } from "../mail/inboxRules";
import { MESSAGE_ID, type HeaderItem, type ImapClientFactory, type ImapSession } from "../mail/imap";
import { ImapFailure, imapFailureOf } from "../mail/imapFailure";
import type { MailboxConfig } from "../mail/mailbox";
import { EMBEDDED_MESSAGE_TYPES, parseFull, previewOf, splitQuotedText, type ParsedMessage } from "../mail/mime";
import type { HostLookup } from "../mail/safeHost";
import { HTML_OUT_MAX, INLINE_ITEM_MAX, sanitiseMailHtml } from "../mail/sanitize";
import { composeReply, sendRaw, type TransportFactory } from "../mail/smtp";
import type { MailAttachment } from "../services/auth/mail";
import { uuidv7, type ChannelAdapter, type FetchOptions, type FetchResult, type InboundEntry, type MailFolder, type Position } from "./channel";

// The email channel of Conversations (decision 66): reads the mailbox's Inbox and Sent for new mail by IMAP UID, opens one email when someone clicks it, and sends a reply
// through the mailbox's OWN mail server (never the outbox), filing it in Sent. What it guarantees:
//  - C3: a check keeps only a list entry per email (sender, recipients, subject, date, a short preview, the ids, the UID); an opened email is shown and forgotten;
//  - A10/A11: HMS's own mail and account-security mail never become entries and are refused when someone tries to open them; bulk mail goes to Other;
//  - A12: the sender is marked verified only by the receiving server's own Authentication-Results;
//  - positions only move forward to the last UID READ, so a check cut short (time budget, network) loses nothing and lists nothing twice;
//  - the IMAP session is always closed.

const C = conversationsCopy.email;
/** A message larger than this is not opened here. */
export const OPEN_MAX_BYTES = 15 * 1024 * 1024;
/** An attachment larger than this is not served here (Vercel answers carry at most 4.5 MB). */
export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
/** A first check (or a folder whose UIDs were renumbered) brings in at most this many of the newest messages within the first window. */
export const FIRST_WINDOW_MESSAGES = 50;
const DAY_MS = 86_400_000;

/** The types an attachment is served as; anything else is a plain download (application/octet-stream). */
const SAFE_TYPES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "text/csv", "application/zip",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export const safeAttachmentType = (type: string): string => (SAFE_TYPES.has(type.toLowerCase()) ? type.toLowerCase() : "application/octet-stream");
/** A file name safe for a header and a disk: letters, digits, dot, dash, underscore, space; at most 100 characters. */
export const cleanFileName = (name: string): string => name.replace(/[^A-Za-z0-9._ -]/g, "-").replace(/-+/g, "-").trim().slice(0, 100) || "attachment";

/** What the hub knows of one stored email, enough to find it again in the mailbox. */
export interface MailRef {
  mailbox: string | null;
  folder: MailFolder | null;
  uid: number | null;
  uidValidity: number | null;
  /** The stored external id when it is a Message-ID. */
  messageId: string | null;
  from: string | null;
  sentAt: Date;
}

export interface EmailOutgoing {
  conversationId: string;
  to: string;
  cc: string[];
  /** Hidden copy recipients: delivered, in no header. */
  bcc?: string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  attachments?: MailAttachment[];
  bill: boolean;
}

export interface EmailSent {
  messageId: string;
  sentAt: Date;
  /** The reply went out but could not be filed in Sent (it shows in HMS; the mailbox's Sent may miss it). */
  appendFailed: boolean;
}

export interface EmailChannelDeps {
  imap: ImapClientFactory;
  createTransport?: TransportFactory;
  lookup?: HostLookup;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** The platform mailbox: no answer to HMS mail is listed, a person's own neither (inboxRules InboundOptions; it quotes a sign-in code or a reset link). */
  hideHmsAnswers?: boolean;
}

const uidExternal = (folder: MailFolder, uidValidity: number, uid: number): string => `uid:${folder}:${uidValidity}:${uid}`;
const validMessageId = (id: string | null | undefined): id is string => typeof id === "string" && MESSAGE_ID.test(id) && !/[\r\n]/.test(id);
const domainOf = (address: string | null): string => (address ?? "").split("@")[1] ?? "";

/**
 * When a message counts as sent. Inbound: the time the mailbox's own server received it (INTERNALDATE), never the sender's Date header, which can be years off and would
 * pin a thread to the top or have it purged at once. Sent: our own Date header, else INTERNALDATE. Never later than now, never the epoch.
 */
export function sentAtOf(item: Pick<HeaderItem, "envelope" | "internalDate">, out: boolean, now: Date): Date {
  const at = (out ? (item.envelope.date ?? item.internalDate) : (item.internalDate ?? item.envelope.date)) ?? now;
  return at.getTime() > now.getTime() || at.getTime() <= 0 ? now : at;
}

/** One header item as a hub entry (pure; the preview is made by the caller). */
export function entryOf(item: HeaderItem, folder: MailFolder, uidValidity: number, mailbox: string, extra: { box: InboundEntry["box"]; preview: string; imapHost: string; now: Date }): InboundEntry {
  const out = folder === "sent";
  const uidId = uidExternal(folder, uidValidity, item.uid);
  const external = validMessageId(item.envelope.messageId) ? item.envelope.messageId : uidId;
  const person = out ? (item.envelope.to[0] ?? null) : item.envelope.from;
  return {
    channel: "email",
    direction: out ? "out" : "in",
    externalId: external,
    fallbackId: uidId,
    sentAt: sentAtOf(item, out, extra.now),
    person,
    personName: out ? null : item.envelope.fromName,
    from: item.envelope.from,
    replyTo: item.envelope.replyTo,
    to: item.envelope.to,
    cc: item.envelope.cc,
    subject: item.envelope.subject.slice(0, 500),
    preview: extra.preview,
    hasAttachments: item.hasAttachments,
    inReplyTo: validMessageId(item.envelope.inReplyTo) ? item.envelope.inReplyTo : null,
    references: item.references.filter(validMessageId).slice(-40),
    box: extra.box,
    senderVerified: out ? null : parseAuthResults(item.headers.authResults, domainOf(item.envelope.from), extra.imapHost),
    sentFrom: out ? (item.headers.hmsConversation ? "hms" : "mailbox") : "contact",
    status: out ? "sent" : "received",
    hmsConversation: out ? item.headers.hmsConversation : null,
    mail: { folder, uid: item.uid, uidValidity, mailbox },
  };
}

/** One parsed email as the Email page shows it (sanitised HTML, inline pictures, the quoted reply apart, the attachments). Shared by the mailbox and the stored copy (hotel 0053). */
async function bodyOf(parsed: ParsedMessage | null, size: number, ref: MailRef, o: { canSeeBills: boolean; showImages: boolean }): Promise<Omit<EmailBody, "id">> {
  const base = { subject: "", from: ref.from ?? "", to: [] as string[], cc: [] as string[], at: ref.sentAt.toISOString(), html: null, text: "", remoteImages: 0, droppedInline: 0, hasQuoted: false, attachments: [] as EmailBody["attachments"] };
  if (!parsed) return { ...base, tooLarge: { size } };
  const inline = new Map<string, string>();
  for (const a of parsed.attachments) {
    if (a.cid && /^image\/(png|jpeg|gif)$/.test(a.type) && a.size <= INLINE_ITEM_MAX) inline.set(a.cid, `data:${a.type};base64,${a.content.toString("base64")}`);
  }
  let html: string | null = null;
  let remoteImages = 0;
  let droppedInline = 0;
  let hasQuoted = false;
  if (parsed.html) {
    const clean = await sanitiseMailHtml(parsed.html, { showImages: o.showImages, inline });
    if (Buffer.byteLength(clean.html, "utf8") > HTML_OUT_MAX) return { ...base, subject: parsed.subject, tooLarge: { size } };
    ({ html, remoteImages, droppedInline, hasQuoted } = clean);
  }
  const split = splitQuotedText(parsed.text);
  const usedInline = new Set(parsed.html ? [...inline.keys()].filter((cid) => parsed.html?.includes(`cid:${cid}`)) : []);
  return {
    subject: parsed.subject,
    from: parsed.from ?? ref.from ?? "",
    to: parsed.to,
    cc: parsed.cc,
    at: (parsed.date ?? ref.sentAt).toISOString(),
    html,
    text: html ? parsed.text : split.main,
    ...(html === null && split.quoted !== "" ? { quotedText: split.quoted } : {}),
    remoteImages,
    droppedInline,
    hasQuoted: hasQuoted || (html === null && split.quoted !== ""),
    attachments: parsed.attachments
      .map((a, part) => ({ a, part }))
      .filter(({ a }) => !(a.related && a.cid && usedInline.has(a.cid)) && !EMBEDDED_MESSAGE_TYPES.has(a.type))
      .map(({ a, part }) => ({ part, name: cleanFileName(a.name), size: a.size, type: safeAttachmentType(a.type), ...(parsed.hmsBill && a.type === "application/pdf" && !o.canSeeBills ? { billLocked: true } : {}) })),
  };
}

/** One attachment of a parsed email, with the same rules for the mailbox and the stored copy. */
function attachmentOf(parsed: ParsedMessage | null, part: number, o: { canSeeBills: boolean }): { bytes: Uint8Array; type: string; name: string } {
  if (!parsed) throw new AppError("CONFLICT", conversationsCopy.errors.tooLarge);
  const a = parsed.attachments[part];
  // a whole message inside this one (message/rfc822) is never served: it can be a copy of mail HMS sent
  if (!a || EMBEDDED_MESSAGE_TYPES.has(a.type)) throw new AppError("NOT_FOUND");
  if (parsed.hmsBill && a.type === "application/pdf" && !o.canSeeBills) throw new AppError("FORBIDDEN", C.billLocked);
  if (a.size > ATTACHMENT_MAX_BYTES || a.content.byteLength > ATTACHMENT_MAX_BYTES) throw new AppError("CONFLICT", conversationsCopy.errors.tooLarge);
  return { bytes: new Uint8Array(a.content), type: safeAttachmentType(a.type), name: cleanFileName(a.name) };
}

const parsedOf = async (source: Buffer): Promise<ParsedMessage | null> => (source.byteLength > OPEN_MAX_BYTES ? null : parseFull(source));

/** A stored email (hotel 0053) opened the way the mailbox's is: no mail server is asked. */
export async function openStoredBody(source: Buffer, ref: MailRef, o: { canSeeBills: boolean; showImages: boolean }): Promise<Omit<EmailBody, "id">> {
  return bodyOf(await parsedOf(source), source.byteLength, ref, o);
}

/** One attachment of a stored email (hotel 0053). */
export async function storedAttachment(source: Buffer, part: number, o: { canSeeBills: boolean }): Promise<{ bytes: Uint8Array; type: string; name: string }> {
  return attachmentOf(await parsedOf(source), part, o);
}

export function createEmailChannel(deps: EmailChannelDeps): ChannelAdapter<MailboxConfig, EmailOutgoing, EmailSent> & {
  openBody(cfg: MailboxConfig, ref: MailRef, o: { canSeeBills: boolean; showImages: boolean }): Promise<Omit<EmailBody, "id">>;
  attachment(cfg: MailboxConfig, ref: MailRef, part: number, o: { canSeeBills: boolean }): Promise<{ bytes: Uint8Array; type: string; name: string }>;
} {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /** Reads one folder from its position: the first window when there is no position (or the UIDs were renumbered), else everything after the last UID read. */
  async function readFolder(session: ImapSession, path: string, folder: MailFolder, cfg: MailboxConfig, position: Position | undefined, o: FetchOptions, out: InboundEntry[], positions: FetchResult["positions"]): Promise<void> {
    const box = await session.open(path);
    const known = position && position.uidValidity === box.uidValidity && position.mailbox === cfg.address;
    let lastUid = known ? position.lastUid : 0;
    let start: number;
    if (known) start = lastUid + 1;
    else {
      const since = await session.searchSince(new Date(deps.now().getTime() - o.firstWindowDays * DAY_MS));
      const first = since.length > 0 ? Math.min(...since) : box.uidNext;
      start = Math.max(first, box.uidNext - FIRST_WINDOW_MESSAGES, 1);
      lastUid = start - 1;
    }
    // the position this folder reaches even when nothing is read (a skipped or empty folder still moves on)
    const record = (): void => {
      const i = positions.findIndex((p) => p.folder === folder);
      const row = { folder, uidValidity: box.uidValidity, lastUid };
      if (i >= 0) positions[i] = row;
      else positions.push(row);
    };
    record();
    if (box.exists === 0 || start >= box.uidNext) return;
    const items: HeaderItem[] = [];
    // a fetch cut short (the time budget, the network) keeps what it read: those are taken in and the position moves past them; the failure is raised after
    let failure: unknown = null;
    // a bounded window of UIDs, not "n:*": a server runs a FETCH to the end of its range even after the reader stops, so a backlog of thousands would use up the time
    // budget before Sent is reached; what lies past the window comes next time
    const end = Math.min(start + o.max * 2 - 1, box.uidNext - 1);
    try {
      for await (const item of session.fetchHeaders(`${start}:${end}`, o.max)) if (item.uid > lastUid && item.uid <= end) items.push(item);
    } catch (error) {
      failure = error;
    }
    items.sort((a, b) => a.uid - b.uid);
    const take = items.slice(0, o.max);
    let sentKnown = new Set<string>();
    if (folder === "sent") {
      const ids = [...new Set(take.flatMap((i) => [i.envelope.inReplyTo, ...i.references]).filter(validMessageId))];
      // the hub's ids, plus the Inbox messages read a moment ago in this same check (a reply from Gmail to a guest's email that arrived since the last check)
      sentKnown = new Set([...(ids.length > 0 ? await o.knownMessageIds(ids) : []), ...out.filter((e) => e.direction === "in").map((e) => e.externalId)]);
    }
    const now = deps.now();
    for (const item of take) {
      if (folder === "inbox") {
        const verdict = classifyInbound(item, cfg.address, { hideHmsAnswers: deps.hideHmsAnswers === true });
        if (verdict === "main" || verdict === "other") out.push(entryOf(item, folder, box.uidValidity, cfg.address, { box: verdict, preview: await previewOf(item.partial), imapHost: cfg.imap.host, now }));
      } else if (classifySent(item, sentKnown) === "ingest") {
        out.push(entryOf(item, folder, box.uidValidity, cfg.address, { box: "main", preview: await previewOf(item.partial), imapHost: cfg.imap.host, now }));
      }
      // read = the position moves past it, listed or not
      lastUid = Math.max(lastUid, item.uid);
      record();
    }
    if (failure !== null) throw failure;
    // the whole window was read (fewer than the cap): its gaps (deleted messages) are passed too
    if (take.length < o.max) {
      lastUid = Math.max(lastUid, end);
      record();
    }
  }

  /** Finds the stored email in the mailbox again (by UID, or by its Message-ID when the UIDs were renumbered, then From and Date must match) and reads it whole. */
  async function load(session: ImapSession, cfg: MailboxConfig, ref: MailRef): Promise<{ parsed: ParsedMessage | null; size: number }> {
    if (ref.mailbox !== null && ref.mailbox !== cfg.address) throw new AppError("NOT_FOUND", C.earlierMailbox);
    const folders = await session.listSpecial();
    const path = ref.folder === "sent" ? folders.sent : folders.inbox;
    if (!path) throw new AppError("NOT_FOUND", C.gone);
    const box = await session.open(path);
    let uid: number | null = ref.uid !== null && ref.uidValidity === box.uidValidity ? ref.uid : null;
    if (uid === null) {
      if (!validMessageId(ref.messageId)) throw new AppError("NOT_FOUND", C.gone);
      const found = await session.findByMessageId(ref.messageId);
      if (found === null) throw new AppError("NOT_FOUND", C.gone);
      // a different message may carry the same Message-ID: it must also be from the same sender at the same time
      let match: HeaderItem | null = null;
      for await (const item of session.fetchHeaders(String(found), 1)) match = item;
      // the stored time is the server's receipt time (inbound) or our Date header (Sent): either one matching within 2 minutes will do
      const near = (d: Date | null | undefined): boolean => d instanceof Date && Math.abs(d.getTime() - ref.sentAt.getTime()) <= 2 * 60_000;
      if (!match || match.envelope.from !== ref.from || !(near(match.envelope.date) || near(match.internalDate))) throw new AppError("NOT_FOUND", C.gone);
      uid = found;
    }
    const got = await session.fetchSource(uid, OPEN_MAX_BYTES);
    if (!got) throw new AppError("NOT_FOUND", C.gone);
    if (!got.source) return { parsed: null, size: got.size };
    let parsed: ParsedMessage;
    try {
      parsed = await parseFull(got.source);
    } catch {
      // an HTML part over the parser's limit, or a broken message: shown as too large to open here
      return { parsed: null, size: got.size };
    }
    // A10: mail HMS made itself (codes, links, invoices, summaries) is never shown, whoever asks
    if (parsed.hmsKind !== null && parsed.hmsKind !== "conversation") throw new AppError("NOT_FOUND", C.gone);
    // ... nor when it is carried inside another message (a bounce, a forward with the original attached)
    if (parsed.hmsEmbedded) throw new AppError("NOT_FOUND", C.gone);
    return { parsed, size: got.size };
  }

  async function withSession<T>(cfg: MailboxConfig, work: (s: ImapSession) => Promise<T>, budgetMs = 20_000): Promise<T> {
    let session: ImapSession | null = null;
    try {
      session = await deps.imap(cfg.imap, { budgetMs });
      return await work(session);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code = imapFailureOf(error);
      // a fixed sentence and the reason code; never the server's words
      throw new AppError("CONFLICT", code === "TOO_LARGE" ? conversationsCopy.errors.tooLarge : C.loadFailed, { reason: code });
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  return {
    async fetchNew(cfg, positions, o) {
      const entries: InboundEntry[] = [];
      const reached: FetchResult["positions"] = [];
      let sentFolder = false;
      let session: ImapSession | null = null;
      try {
        session = await deps.imap(cfg.imap, { budgetMs: o.budgetMs });
        const folders = await session.listSpecial();
        sentFolder = folders.sent !== null;
        await readFolder(session, folders.inbox, "inbox", cfg, positions.find((p) => p.folder === "inbox"), o, entries, reached);
        if (folders.sent) await readFolder(session, folders.sent, "sent", cfg, positions.find((p) => p.folder === "sent"), o, entries, reached);
        return { entries, positions: reached, error: null, sentFolder };
      } catch (error) {
        return { entries, positions: reached, error: error instanceof ImapFailure ? error.code : imapFailureOf(error), sentFolder };
      } finally {
        await session?.close().catch(() => undefined);
      }
    },

    async openBody(cfg, ref, o) {
      return withSession(cfg, async (session) => {
        const { parsed, size } = await load(session, cfg, ref);
        return bodyOf(parsed, size, ref, o);
      });
    },

    async attachment(cfg, ref, part, o) {
      return withSession(cfg, async (session) => {
        const { parsed } = await load(session, cfg, ref);
        return attachmentOf(parsed, part, o);
      });
    },

    async send(cfg, out) {
      const at = deps.now();
      const messageId = `<${uuidv7(at.getTime())}@${domainOf(cfg.address) || "hms.local"}>`;
      const { raw, envelope } = await composeReply(cfg.smtp, { to: out.to, cc: out.cc, ...(out.bcc && out.bcc.length > 0 ? { bcc: out.bcc } : {}), subject: out.subject, text: out.text, inReplyTo: out.inReplyTo, references: out.references, messageId, conversationId: out.conversationId, attachments: out.attachments, bill: out.bill, date: at });
      await sendRaw(cfg.smtp, { raw, envelope }, { createTransport: deps.createTransport, lookup: deps.lookup });
      // Gmail files what it sends in Sent by itself; another server may or may not: look first, append only when it is not there (never twice)
      let appendFailed = false;
      if (!cfg.gmail) {
        let session: ImapSession | null = null;
        try {
          session = await deps.imap(cfg.imap, { budgetMs: 10_000 });
          const folders = await session.listSpecial();
          if (!folders.sent) appendFailed = true;
          else {
            await sleep(1_500);
            await session.open(folders.sent);
            let found = await session.findByMessageId(messageId);
            if (found === null) {
              await sleep(1_500);
              await session.open(folders.sent);
              found = await session.findByMessageId(messageId);
            }
            if (found === null) await session.append(folders.sent, raw, at);
          }
        } catch {
          appendFailed = true;
        } finally {
          await session?.close().catch(() => undefined);
        }
      }
      return { messageId, sentAt: at, appendFailed };
    },
  };
}
