// Test doubles for Conversations (decision 66): a fake IMAP server with an Inbox and a Sent folder (UIDs, UIDVALIDITY, SEARCH, APPEND, a Gmail-like "files what it sends"
// switch, failures on demand), a fake SMTP transport that keeps the finished messages, a MIME message builder, and a hotel world (the in-memory hotel with its Email settings
// and the real Conversations service over the fakes). No network, no database.
import { randomBytes } from "node:crypto";
import type { Person } from "../../../src/server/services/cash/ports";
import { headerItemOf, headerLines, type HeaderItem, type ImapClientFactory, type ImapSession } from "../../../src/server/mail/imap";
import { sealSmtpSecret, type SmtpTransport, type TransportFactory } from "../../../src/server/mail/smtp";
import { createMemoryConversationsHotel } from "../../../src/server/repos/memory/conversations";
import { createConversationsService, type ConversationsDeps } from "../../../src/server/services/conversations/conversationsService";
import { catalog, HOTEL_A } from "./session";

export const PUBLIC_LOOKUP = async (): Promise<{ address: string; family: number }[]> => [{ address: "203.0.113.10", family: 4 }];
export const KEY = randomBytes(32);

// ---------------------------------------------------------------------------------------------- a MIME message

export interface MailSpec {
  messageId?: string | null;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  date: Date;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  attachments?: { name: string; type: string; content: Buffer }[];
}

let mailCounter = 0;
export function rawMail(m: MailSpec): Buffer {
  const lines: string[] = [];
  const id = m.messageId === undefined ? `<m${++mailCounter}.${Date.now()}@sender.example>` : m.messageId;
  if (id) lines.push(`Message-ID: ${id}`);
  lines.push(`From: ${m.fromName ? `"${m.fromName}" ` : ""}<${m.from}>`, `To: ${m.to.join(", ")}`);
  if (m.cc?.length) lines.push(`Cc: ${m.cc.join(", ")}`);
  if (m.replyTo) lines.push(`Reply-To: ${m.replyTo}`);
  lines.push(`Subject: ${m.subject}`, `Date: ${m.date.toUTCString()}`, "MIME-Version: 1.0");
  if (m.inReplyTo) lines.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references?.length) lines.push(`References: ${m.references.join(" ")}`);
  for (const [k, v] of Object.entries(m.headers ?? {})) lines.push(`${k}: ${v}`);
  const text = m.text ?? "Hello";
  const textPart = ["Content-Type: text/plain; charset=utf-8", "", text];
  const body: string[] = [];
  const alt = m.html ? ["Content-Type: multipart/alternative; boundary=\"alt1\"", "", "--alt1", ...textPart, "--alt1", "Content-Type: text/html; charset=utf-8", "", m.html, "--alt1--"] : textPart;
  if (m.attachments?.length) {
    lines.push("Content-Type: multipart/mixed; boundary=\"mix1\"");
    body.push("--mix1", ...alt);
    for (const a of m.attachments) body.push("--mix1", `Content-Type: ${a.type}; name="${a.name}"`, `Content-Disposition: attachment; filename="${a.name}"`, "Content-Transfer-Encoding: base64", "", a.content.toString("base64").replace(/(.{76})/g, "$1\r\n"));
    body.push("--mix1--");
  } else if (m.html) {
    lines.push(alt[0]);
    body.push(...alt.slice(2));
  } else {
    lines.push(textPart[0]);
    body.push(text);
  }
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n${body.join("\r\n")}\r\n`, "utf8");
}

// ---------------------------------------------------------------------------------------------- a fake IMAP server

interface FakeMessage {
  uid: number;
  raw: Buffer;
  date: Date;
}
interface FakeFolder {
  path: string;
  uidValidity: number;
  uidNext: number;
  messages: FakeMessage[];
}

const addressOf = (v: string): string => (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase();

/**
 * The HeaderItem the real client builds for this message: the real headerItemOf (imap.ts) fed what imapflow would hand it, the ENVELOPE (parsed here from the header) and
 * the raw header block (which headerItemOf reads for References, the HMS marks, Return-Path, the auto headers and the Content-Type).
 */
export function itemOfRaw(uid: number, raw: Buffer, date: Date): HeaderItem {
  const lines = headerLines(raw);
  const first = (n: string): string | null => lines.find((l) => l.name === n)?.value ?? null;
  const party = (v: string | null): { address: string; name?: string }[] | undefined => {
    if (!v) return undefined;
    return v.split(",").map((one) => ({ address: addressOf(one), name: /^"?([^"<]+)"?\s*</.exec(one)?.[1]?.trim() })).filter((a) => a.address.includes("@"));
  };
  const head = raw.toString("latin1").split(/\r?\n\r?\n/)[0] ?? "";
  const item = headerItemOf({
    uid,
    internalDate: date,
    size: raw.byteLength,
    envelope: {
      messageId: first("message-id") ?? undefined,
      subject: first("subject") ?? "",
      from: party(first("from")),
      replyTo: party(first("reply-to")),
      to: party(first("to")),
      cc: party(first("cc")),
      inReplyTo: first("in-reply-to") ?? undefined,
      date: first("date") ?? undefined,
    },
    headers: Buffer.from(`${head}\r\n\r\n`, "latin1"),
    source: raw.subarray(0, 32 * 1024),
  });
  // the fake has no BODYSTRUCTURE: an attachment is a part marked so
  return { ...item, hasAttachments: /content-disposition:\s*attachment/i.test(raw.toString("latin1")) };
}

export interface FakeImap {
  factory: ImapClientFactory;
  inbox: FakeFolder;
  sent: FakeFolder;
  stats: { opened: number; closed: number; appended: number; fetched: number; messageIdSearches: string[]; ranges: string[] };
  /** Puts a message in a folder (as the mail server would): its new UID. */
  deliver(folder: "inbox" | "sent", raw: Buffer, date?: Date): number;
  /** Renumbers a folder (a new UIDVALIDITY), as after a mailbox rebuild. */
  renumber(folder: "inbox" | "sent"): void;
  /** The next session fails at connect with this error. */
  failConnect(error: unknown): void;
  /** Reading headers fails after this many items in the next session. */
  failAfter(n: number): void;
  hasSent: boolean;
}

export function createFakeImap(o: { hasSent?: boolean } = {}): FakeImap {
  const inbox: FakeFolder = { path: "INBOX", uidValidity: 7001, uidNext: 1, messages: [] };
  const sent: FakeFolder = { path: "[Gmail]/Sent Mail", uidValidity: 7002, uidNext: 1, messages: [] };
  const stats = { opened: 0, closed: 0, appended: 0, fetched: 0, messageIdSearches: [] as string[], ranges: [] as string[] };
  let connectError: unknown = null;
  let failAfterN: number | null = null;
  const fake: FakeImap = {
    inbox,
    sent,
    stats,
    hasSent: o.hasSent ?? true,
    deliver(folder, raw, date = new Date()) {
      const f = folder === "inbox" ? inbox : sent;
      const uid = f.uidNext++;
      f.messages.push({ uid, raw, date });
      return uid;
    },
    renumber(folder) {
      const f = folder === "inbox" ? inbox : sent;
      f.uidValidity += 100;
      f.uidNext = 1;
      for (const m of f.messages) m.uid = f.uidNext++;
    },
    failConnect(error) {
      connectError = error;
    },
    failAfter(n) {
      failAfterN = n;
    },
    factory: async () => {
      if (connectError) {
        const e = connectError;
        connectError = null;
        throw e;
      }
      stats.opened += 1;
      const failing = failAfterN;
      failAfterN = null;
      let open: FakeFolder | null = null;
      let served = 0;
      const folder = (path: string): FakeFolder => (path === inbox.path ? inbox : path === sent.path ? sent : (() => { throw Object.assign(new Error("no such folder"), { code: "NONEXISTENT" }); })());
      const session: ImapSession = {
        listSpecial: async () => ({ inbox: inbox.path, sent: fake.hasSent ? sent.path : null }),
        open: async (path) => {
          open = folder(path);
          return { uidValidity: open.uidValidity, uidNext: open.uidNext, exists: open.messages.length };
        },
        searchSince: async (date) => (open ? open.messages.filter((m) => m.date.getTime() >= date.getTime()).map((m) => m.uid) : []),
        async *fetchHeaders(range, max) {
          if (!open) return;
          stats.ranges.push(range);
          const [a, b] = range.split(":");
          const from = Number(a);
          let list = [...open.messages].sort((x, y) => x.uid - y.uid);
          if (b === "*") {
            const picked = list.filter((m) => m.uid >= from);
            // IMAP: "n:*" with nothing at or above n still answers the newest message
            list = picked.length > 0 ? picked : list.slice(-1);
          } else if (b !== undefined) list = list.filter((m) => m.uid >= from && m.uid <= Number(b));
          else list = list.filter((m) => m.uid === from);
          let n = 0;
          for (const m of list) {
            if (failing !== null && served >= failing) throw Object.assign(new Error("Connection closed"), { code: "EConnectionClosed" });
            served += 1;
            stats.fetched += 1;
            yield itemOfRaw(m.uid, m.raw, m.date);
            n += 1;
            if (n >= max) break;
          }
        },
        fetchSource: async (uid, maxBytes) => {
          const m = open?.messages.find((x) => x.uid === uid);
          if (!m) return null;
          return { size: m.raw.byteLength, source: m.raw.byteLength > maxBytes ? null : m.raw };
        },
        findByMessageId: async (id) => {
          if (!/^<[^<>\s]{1,990}>$/.test(id)) return null;
          stats.messageIdSearches.push(id);
          const m = open?.messages.find((x) => headerLines(x.raw).find((l) => l.name === "message-id")?.value === id);
          return m ? m.uid : null;
        },
        append: async (path, raw, date) => {
          stats.appended += 1;
          fake.deliver(path === sent.path ? "sent" : "inbox", raw, date);
        },
        close: async () => {
          stats.closed += 1;
        },
      };
      return session;
    },
  };
  return fake;
}

// ---------------------------------------------------------------------------------------------- a fake SMTP transport

export interface FakeSmtp {
  factory: TransportFactory;
  sent: { raw: Buffer; envelope: { from: string; to: string[] } }[];
  options: Record<string, unknown>[];
  /** The next send (or verify) fails with this error. */
  fail(error: unknown): void;
}

/** `fileInto`: the server files what it sends in this mailbox's Sent itself (Gmail does; many others do too). */
export function createFakeSmtp(o: { fileInto?: FakeImap } = {}): FakeSmtp {
  let failure: unknown = null;
  const fake: FakeSmtp = {
    sent: [],
    options: [],
    fail(error) {
      failure = error;
    },
    factory: (options) => {
      fake.options.push(options);
      const t: SmtpTransport = {
        async sendMail(m) {
          if (failure) {
            const e = failure;
            failure = null;
            throw e;
          }
          if (m.raw && m.envelope) {
            fake.sent.push({ raw: m.raw, envelope: m.envelope });
            if (o.fileInto) o.fileInto.deliver("sent", m.raw);
          }
          return { messageId: "ok" };
        },
        async verify() {
          if (failure) {
            const e = failure;
            failure = null;
            throw e;
          }
          return true;
        },
        close() {
          // nothing open
        },
      };
      return t;
    },
  };
  return fake;
}

// ---------------------------------------------------------------------------------------------- a hotel with Conversations

export const STAFF = { admin: "00000000-0000-4000-8000-0000000000a1", neha: "00000000-0000-4000-8000-0000000000a2", viewer: "00000000-0000-4000-8000-0000000000a3" } as const;
export const MAILBOX = "desk@gmail.com";

/** Settings > Email of a hotel: Gmail (desk@gmail.com) or another mail server (desk@hotel.example), reading on. */
export function emailSettings(provider: "gmail" | "smtp" | "ses" | "platform", hotelId = HOTEL_A, reading = true): Record<string, string> {
  const password = sealSmtpSecret(KEY, "abcd efgh ijkl mnop".replace(/\s/g, ""), hotelId);
  if (provider === "platform") return { "email.mode": "platform", "email.imap": reading ? "1" : "0" };
  if (provider === "ses") return { "email.mode": "own", "email.provider": "ses", "email.host": "email-smtp.ap-south-1.amazonaws.com", "email.port": "587", "email.username": "AKIA", "email.password": password, "email.from_address": "desk@hotel.example", "email.imap": reading ? "1" : "0" };
  if (provider === "smtp") return { "email.mode": "own", "email.provider": "smtp", "email.host": "smtp.hotel.example", "email.port": "587", "email.encryption": "tls", "email.username": "desk@hotel.example", "email.password": password, "email.from_address": "desk@hotel.example", "email.imap": reading ? "1" : "0", "email.imap_host": "imap.hotel.example", "email.imap_port": "993" };
  return { "email.mode": "own", "email.provider": "gmail", "email.host": "smtp.gmail.com", "email.port": "587", "email.encryption": "tls", "email.username": MAILBOX, "email.password": password, "email.imap": reading ? "1" : "0" };
}

export function hotelWorld(o: { provider?: "gmail" | "smtp" | "ses" | "platform"; reading?: boolean; fileSent?: boolean; sendHotelMail?: ConversationsDeps["sendHotelMail"]; mailFiles?: ConversationsDeps["mailFiles"]; whatsapp?: ConversationsDeps["whatsapp"]; whatsappSend?: ConversationsDeps["whatsappSend"]; /** Wraps the hub's unit (the live events test). */ wrapUnit?: (unit: ConversationsDeps["unit"]) => ConversationsDeps["unit"] } = {}) {
  const hotel = createMemoryConversationsHotel();
  const imap = createFakeImap();
  const provider = o.provider ?? "gmail";
  const smtp = createFakeSmtp({ fileInto: (o.fileSent ?? provider === "gmail") ? imap : undefined });
  const clock = { now: new Date("2026-10-24T10:00:00Z") };
  const people = new Map<string, Person>([
    [STAFF.admin, { id: STAFF.admin, name: "Hari Admin", roleKey: "super_admin", roleLevel: 4, deleted: false }],
    [STAFF.neha, { id: STAFF.neha, name: "Neha Desk", roleKey: "editor", roleLevel: 2, deleted: false }],
    [STAFF.viewer, { id: STAFF.viewer, name: "Vik Viewer", roleKey: "viewer", roleLevel: 1, deleted: false }],
  ]);
  const logs: { message: string; fields: Record<string, unknown> }[] = [];
  const reports: { hotelId: string | null; ok: boolean; error: string | null }[] = [];
  const settings = (hotelId: string, values: Record<string, string>): void => {
    const d = hotel.store.dataFor(hotelId);
    for (const [key, value] of Object.entries(values)) d.appSettings.set(key, { key, value, secret: key === "email.password" });
  };
  settings(HOTEL_A, emailSettings(provider, HOTEL_A, o.reading ?? true));
  const service = createConversationsService({
    unit: o.wrapUnit ? o.wrapUnit(hotel.unit) : hotel.unit,
    people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) },
    catalog,
    now: () => clock.now,
    smtpKey: () => KEY,
    imap: imap.factory,
    createTransport: smtp.factory,
    lookup: PUBLIC_LOOKUP,
    sleep: async () => undefined,
    staff: async () => [...people.values()].map((p) => ({ id: p.id, name: p.name })),
    billPdf: async () => ({ filename: "Bill-B-1.pdf", bytes: Buffer.from("%PDF-1.4 bill") }),
    registry: { report: async (hotelId, r) => void reports.push({ hotelId, ok: r.ok, error: r.error }) },
    log: (message, fields) => void logs.push({ message, fields }),
    ...(o.sendHotelMail ? { sendHotelMail: o.sendHotelMail } : {}),
    ...(o.mailFiles ? { mailFiles: o.mailFiles } : {}),
    ...(o.whatsapp ? { whatsapp: o.whatsapp } : {}),
    ...(o.whatsappSend ? { whatsappSend: o.whatsappSend } : {}),
  });
  return { hotel, imap, smtp, clock, people, logs, reports, settings, service, data: (h = HOTEL_A) => hotel.store.dataFor(h) };
}

/** An inbound mail the hotel's own server verified (dmarc=pass), unless `verified: false`. */
export function guestMail(o: Partial<MailSpec> & { from: string; verified?: boolean; to?: string[] }): Buffer {
  const domain = o.from.split("@")[1];
  return rawMail({
    subject: "Booking question",
    date: new Date("2026-10-24T09:00:00Z"),
    to: o.to ?? [MAILBOX],
    ...o,
    headers: { ...(o.verified === false ? {} : { "Authentication-Results": `mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=${o.from}; dmarc=pass header.from=${domain}` }), ...(o.headers ?? {}) },
  });
}
