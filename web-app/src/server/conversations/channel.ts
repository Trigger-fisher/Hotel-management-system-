import "server-only";
import { randomBytes } from "node:crypto";
import type { ConvBox, ConvChannel, ConvMessageStatus } from "@shared/dashboards/conversations";
import type { WaMessageType, WaSender } from "@shared/dashboards/whatsapp";
import type { ImapFailureCode } from "../mail/imapFailure";

// The hub's channel adapters (decision 66): one shape every channel delivers its new messages in and sends through, so a channel added later (the WhatsApp adapter from Meta,
// then perhaps others) plugs in without the hub or the screens changing. Email is mail/imap.ts + emailChannel.ts; WhatsApp is only the interface for now (whatsapp.ts).

export type MailFolder = "inbox" | "sent";
export type SentFrom = "contact" | "hms" | "mailbox" | "phone" | "auto";

/** One new message as a channel found it: what the hub keeps of it (C3: never the body or the attachments of an email). */
export interface InboundEntry {
  channel: ConvChannel;
  direction: "in" | "out";
  /** Email: the validated Message-ID, else "uid:<folder>:<uidvalidity>:<uid>"; WhatsApp: the wamid. */
  externalId: string;
  /** "uid:<folder>:<uidvalidity>:<uid>": the row's own id when its Message-ID is already taken by a different message (never merged). */
  fallbackId?: string;
  sentAt: Date;
  /** The person on the other side: the sender (in) or the first recipient (out). */
  person: string | null;
  personName: string | null;
  from: string | null;
  replyTo: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  preview: string;
  hasAttachments: boolean;
  inReplyTo: string | null;
  references: string[];
  box: ConvBox;
  senderVerified: boolean | null;
  sentFrom: SentFrom;
  status: ConvMessageStatus;
  /** A Conversations reply found in Sent: the conversation it belongs to (X-HMS-Conversation). */
  hmsConversation?: string | null;
  mail?: { folder: MailFolder; uid: number; uidValidity: number; mailbox: string };
  whatsapp?: { type: WaMessageType; text?: string; media?: Record<string, unknown>; sentFrom: WaSender; status: ConvMessageStatus; contextId?: string; reactions?: { emoji: string; fromContact: boolean }[] };
}

/** Where a folder's last check stopped. */
export interface Position {
  folder: MailFolder;
  mailbox: string;
  uidValidity: number | null;
  lastUid: number;
  checkedAt: Date | null;
  lastOkAt: Date | null;
  leaseUntil: Date | null;
  lastError: string | null;
}

export interface FetchResult {
  entries: InboundEntry[];
  /** The new positions: advanced to the last UID READ (a skipped message advances it too); unchanged for a folder not reached. */
  positions: { folder: MailFolder; uidValidity: number; lastUid: number }[];
  /** Why the check stopped early (the entries before it are kept). */
  error: ImapFailureCode | null;
  /** The mailbox has a Sent folder. */
  sentFolder: boolean;
}

export interface FetchOptions {
  /** At most this many messages per folder per check (oldest first). */
  max: number;
  /** A first check (or a changed folder) brings in this many days. */
  firstWindowDays: number;
  budgetMs: number;
  /** Which of these Message-IDs the hub already holds (one query per check). */
  knownMessageIds(ids: string[]): Promise<Set<string>>;
}

export interface ChannelAdapter<Cfg, Out, Sent> {
  fetchNew(cfg: Cfg, positions: readonly Position[], o: FetchOptions): Promise<FetchResult>;
  send(cfg: Cfg, out: Out): Promise<Sent>;
}

/** A time-ordered id (UUID version 7): the hub's own Message-IDs sort by time. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) b[i] = Number((ms >> BigInt(8 * (5 - i))) & BigInt(0xff));
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
