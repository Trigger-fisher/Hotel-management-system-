import "server-only";
import type { ImapFlow, ImapFlowOptions, MessageAddressObject, MessageStructureObject } from "imapflow";
import { ImapFailure } from "./imapFailure";
import { resolvePublicHost, type HostLookup } from "./safeHost";

// THE IMAP module (Conversations, decision 66): the one place imapflow is loaded (on first use, never when a function starts) and the one shape the rest of the code reads a
// mailbox through (ImapSession; tests use a fake with the same shape). What is guaranteed here:
//  - only public mail servers: the host is resolved once (mail/safeHost.ts) and the connection goes to that address, with the certificate checked against the host name;
//  - encrypted: TLS from the first byte on 993, STARTTLS REQUIRED on 143 (a server that cannot offer it is not used), TLS 1.2 or newer;
//  - short timeouts, and a wall-clock budget around the whole session: past it the connection is closed, whatever it was doing (a serverless function must finish);
//  - folders are opened READ ONLY (EXAMINE): HMS never changes the hotel's mailbox (no \Seen, no moves, no deletes); the one write is APPEND of a reply to Sent;
//  - the session is always closed (logout, else a hard close) by whoever opened it;
//  - nothing of the server's text, the login or the password is logged (logger off).

export interface ImapConfig {
  host: string;
  port: 993 | 143;
  user: string;
  pass: string;
}

/** The parts of one message's header HMS reads at a check (the envelope plus a few header lines). */
export interface HeaderItem {
  uid: number;
  internalDate: Date | null;
  size: number;
  envelope: {
    messageId: string | null;
    subject: string;
    from: string | null;
    fromName: string | null;
    replyTo: string | null;
    to: string[];
    cc: string[];
    inReplyTo: string | null;
    date: Date | null;
  };
  /** The References header's message ids, in order. */
  references: string[];
  headers: {
    hmsKind: string | null;
    hmsConversation: string | null;
    /** The TOPMOST Authentication-Results header only (the one the receiving server added). */
    authResults: string | null;
    listUnsubscribe: boolean;
    listId: boolean;
    precedence: string | null;
    autoSubmitted: string | null;
    autoResponseSuppress: boolean;
    /** The top-level Content-Type without its parameters (lower case): multipart/report is a delivery report. */
    contentType: string | null;
    /** Return-Path is the null sender "<>" (bounces and most automatic replies are sent so). */
    returnPathNull: boolean;
    /** An X-Autoreply or X-Autorespond header with a yes-like value (anything but no, false, off or 0): older auto-responders set these instead of Auto-Submitted. */
    autoReplyHeader: boolean;
  };
  hasAttachments: boolean;
  /** The first 32 KB of the raw message: the short preview is made from it. */
  partial: Buffer;
}

export interface ImapSession {
  /** The Inbox and the Sent folder (\Sent special use, else a folder named like it); sent null when there is none. */
  listSpecial(): Promise<{ inbox: string; sent: string | null }>;
  /** Opens a folder read only. */
  open(folder: string): Promise<{ uidValidity: number; uidNext: number; exists: number }>;
  /** UIDs of the messages that arrived since this day, in the open folder. */
  searchSince(date: Date): Promise<number[]>;
  /** Headers of the messages in this UID range of the open folder, oldest first, at most `max`. */
  fetchHeaders(range: string, max: number): AsyncIterable<HeaderItem>;
  /** The raw message, or only its size when it is larger than `maxBytes`; null when the UID is gone. */
  fetchSource(uid: number, maxBytes: number): Promise<{ size: number; source: Buffer | null } | null>;
  /** The UID of the message with this Message-ID in the open folder, or null. An id not of the shape <...> is refused before any search. */
  findByMessageId(id: string): Promise<number | null>;
  /** Puts a message into a folder (a reply into Sent), marked read. */
  append(folder: string, raw: Buffer, date: Date): Promise<void>;
  close(): Promise<void>;
}

export type ImapClientFactory = (config: ImapConfig, options?: { budgetMs?: number }) => Promise<ImapSession>;

/** A Message-ID HMS will search for or store: one <...> with no spaces and no line breaks. */
export const MESSAGE_ID = /^<[^<>\s]{1,990}>$/;
export const PARTIAL_BYTES = 32 * 1024;
export const DEFAULT_BUDGET_MS = 20_000;

const HEADER_FIELDS = ["references", "x-hms-kind", "x-hms-conversation", "authentication-results", "list-unsubscribe", "list-id", "precedence", "auto-submitted", "x-auto-response-suppress", "content-type", "return-path", "x-autoreply", "x-autorespond"];

/** Is this Return-Path value the null sender "<>"? */
export const isNullReturnPath = (value: string | null): boolean => value !== null && value.replace(/\s+/g, "") === "<>";

/** Does an X-Autoreply / X-Autorespond value say "this is an automatic reply"? Present and not no, false, off or 0 ("yes", "vacation", a program's name all count). */
export const isAutoReplyValue = (value: string | null): boolean => value !== null && !/^\s*(no|false|off|0)?\s*$/i.test(value);

/** The type of a Content-Type value without its parameters, lower case. */
export const mediaTypeOf = (value: string | null | undefined): string | null => {
  const t = (value ?? "").split(";")[0].trim().toLowerCase();
  return t === "" ? null : t;
};

/** The header lines of a header block, unfolded, in order (a name may repeat). */
export function headerLines(raw: Buffer | string): { name: string; value: string }[] {
  const text = (typeof raw === "string" ? raw : raw.toString("latin1")).split(/\r?\n\r?\n/)[0] ?? "";
  const out: { name: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1].value += ` ${line.trim()}`;
    else {
      const i = line.indexOf(":");
      if (i > 0) out.push({ name: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() });
    }
  }
  return out;
}

const addressOf = (list: MessageAddressObject[] | undefined): string | null => {
  const a = list?.[0]?.address?.trim().toLowerCase();
  return a && a.includes("@") ? a : null;
};
const addressesOf = (list: MessageAddressObject[] | undefined): string[] => (list ?? []).map((a) => a.address?.trim().toLowerCase() ?? "").filter((a) => a.includes("@"));
const idsOf = (value: string | null | undefined): string[] => (value ?? "").match(/<[^<>\s]+>/g) ?? [];
const dateOf = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** A part that is a file: marked as an attachment, or anything not text and not multipart that carries a file name. */
export function structureHasAttachment(s: MessageStructureObject | undefined): boolean {
  if (!s) return false;
  const type = (s.type ?? "").toLowerCase();
  const named = Boolean(s.dispositionParameters?.filename ?? s.parameters?.name);
  if (s.disposition === "attachment" || (named && !type.startsWith("text/") && !type.startsWith("multipart/"))) return true;
  return (s.childNodes ?? []).some((c) => structureHasAttachment(c));
}

/** One fetched message as a HeaderItem (pure; tests feed it a fetch result). */
export function headerItemOf(m: { uid: number; internalDate?: Date | string; size?: number; envelope?: { messageId?: string; subject?: string; from?: MessageAddressObject[]; replyTo?: MessageAddressObject[]; to?: MessageAddressObject[]; cc?: MessageAddressObject[]; inReplyTo?: string; date?: Date | string }; headers?: Buffer; bodyStructure?: MessageStructureObject; source?: Buffer }): HeaderItem {
  const lines = m.headers ? headerLines(m.headers) : [];
  const first = (name: string): string | null => lines.find((l) => l.name === name)?.value ?? null;
  const env = m.envelope ?? {};
  const messageId = env.messageId?.trim() ?? null;
  return {
    uid: m.uid,
    internalDate: dateOf(m.internalDate),
    size: m.size ?? 0,
    envelope: {
      messageId: messageId && messageId !== "" ? messageId : null,
      subject: (env.subject ?? "").replace(/[\r\n]+/g, " ").trim(),
      from: addressOf(env.from),
      fromName: env.from?.[0]?.name?.replace(/[\r\n]+/g, " ").trim() || null,
      replyTo: addressOf(env.replyTo),
      to: addressesOf(env.to),
      cc: addressesOf(env.cc),
      inReplyTo: idsOf(env.inReplyTo)[0] ?? null,
      date: dateOf(env.date),
    },
    references: idsOf(first("references")),
    headers: {
      hmsKind: first("x-hms-kind")?.toLowerCase() ?? null,
      hmsConversation: first("x-hms-conversation"),
      authResults: first("authentication-results"),
      listUnsubscribe: first("list-unsubscribe") !== null,
      listId: first("list-id") !== null,
      precedence: first("precedence")?.toLowerCase() ?? null,
      autoSubmitted: first("auto-submitted")?.toLowerCase() ?? null,
      autoResponseSuppress: first("x-auto-response-suppress") !== null,
      contentType: mediaTypeOf(first("content-type")) ?? mediaTypeOf(m.bodyStructure?.type),
      returnPathNull: isNullReturnPath(first("return-path")),
      autoReplyHeader: isAutoReplyValue(first("x-autoreply")) || isAutoReplyValue(first("x-autorespond")),
    },
    hasAttachments: structureHasAttachment(m.bodyStructure),
    partial: m.source ?? Buffer.alloc(0),
  };
}

/** The real session over imapflow. */
function sessionOver(client: ImapFlow, expired: () => boolean, stop: () => void): ImapSession {
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    if (expired()) throw new ImapFailure("TIMEOUT");
    try {
      return await work();
    } catch (error) {
      if (expired()) throw new ImapFailure("TIMEOUT");
      throw error;
    }
  };
  return {
    listSpecial: () =>
      guard(async () => {
        const list = await client.list();
        const inbox = list.find((f) => f.specialUse === "\\Inbox" || f.path.toUpperCase() === "INBOX")?.path ?? "INBOX";
        const sent = list.find((f) => f.specialUse === "\\Sent")?.path ?? list.find((f) => /^(\[gmail\]\/)?sent( (mail|items|messages))?$/i.test(f.path) || /^inbox[./]sent$/i.test(f.path))?.path ?? null;
        return { inbox, sent };
      }),
    open: (folder) =>
      guard(async () => {
        const box = await client.mailboxOpen(folder, { readOnly: true });
        return { uidValidity: Number(box.uidValidity), uidNext: box.uidNext, exists: box.exists };
      }),
    searchSince: (date) =>
      guard(async () => {
        const found = await client.search({ since: date }, { uid: true });
        return Array.isArray(found) ? found : [];
      }),
    async *fetchHeaders(range, max) {
      if (expired()) throw new ImapFailure("TIMEOUT");
      let n = 0;
      try {
        for await (const m of client.fetch(range, { uid: true, envelope: true, internalDate: true, size: true, bodyStructure: true, headers: HEADER_FIELDS, source: { start: 0, maxLength: PARTIAL_BYTES } }, { uid: true })) {
          yield headerItemOf(m as never);
          n += 1;
          if (n >= max) break;
        }
      } catch (error) {
        if (expired()) throw new ImapFailure("TIMEOUT");
        throw error;
      }
    },
    fetchSource: (uid, maxBytes) =>
      guard(async () => {
        const meta = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
        if (!meta) return null;
        const size = meta.size ?? 0;
        if (size > maxBytes) return { size, source: null };
        const full = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
        return full && full.source ? { size, source: full.source } : null;
      }),
    findByMessageId: (id) =>
      guard(async () => {
        if (!MESSAGE_ID.test(id) || /[\r\n]/.test(id)) return null;
        const found = await client.search({ header: { "message-id": id } }, { uid: true });
        return Array.isArray(found) && found.length > 0 ? Math.max(...found) : null;
      }),
    append: (folder, raw, date) =>
      guard(async () => {
        await client.append(folder, raw, ["\\Seen"], date);
      }),
    async close() {
      stop();
      try {
        await Promise.race([client.logout(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      } catch {
        // a dead connection cannot log out: it is closed below
      }
      try {
        client.close();
      } catch {
        // already closed
      }
    },
  };
}

/** The real IMAP client: resolves the host to a public address, connects with TLS and the budget, signs in. */
export function createImapClientFactory(options: { lookup?: HostLookup } = {}): ImapClientFactory {
  return async (config, o = {}) => {
    const { address, servername } = await resolvePublicHost(config.host, { lookup: options.lookup });
    // turbopackIgnore: the build neither bundles nor traces imapflow here, so it is not shipped with every server function; next.config.ts adds it (and what it needs) to
    // the email functions only (MAIL_FUNCTIONS there). Node loads it from node_modules at run time.
    const { ImapFlow: Client } = await import(/* turbopackIgnore: true */ "imapflow");
    const settings: ImapFlowOptions = {
      host: address,
      port: config.port,
      secure: config.port === 993,
      ...(config.port === 143 ? { doSTARTTLS: true } : {}),
      servername,
      auth: { user: config.user, pass: config.pass },
      logger: false,
      emitLogs: false,
      disableAutoIdle: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: "TLSv1.2", servername },
    };
    const client = new Client(settings);
    // an error event on a closing connection must never crash the process; the caller sees the failed call
    client.on("error", () => undefined);
    let over = false;
    const timer = setTimeout(() => {
      over = true;
      try {
        client.close();
      } catch {
        // already closed
      }
    }, o.budgetMs ?? DEFAULT_BUDGET_MS);
    const stop = (): void => clearTimeout(timer);
    try {
      await client.connect();
    } catch (error) {
      stop();
      try {
        client.close();
      } catch {
        // already closed
      }
      if (over) throw new ImapFailure("TIMEOUT");
      throw error;
    }
    return sessionOver(client, () => over, stop);
  };
}
