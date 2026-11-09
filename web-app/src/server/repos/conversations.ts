import "server-only";
import type { ConvBox, ConvChannel, ConvChannelFilter, ConvLinkKind, ConvMessageStatus, ConvTab, EmailFolder } from "@shared/dashboards/conversations";
import type { InboundEntry, MailFolder, Position, SentFrom } from "../conversations/channel";
import type { SettingRow } from "./admin";
import type { SystemLogRepo } from "./cashSupport";
import type { ListResult, Page } from "./types";

// Conversations (decision 66; hotel migration 0050, platform migration 0139): the hub's records. Plain records, no SQL. The same repository serves a hotel (its own schema)
// and the platform (the platform schema); the PostgreSQL implementation (repos/postgres/conversations.ts) and the in-memory double (repos/memory/conversations.ts) keep the
// same rules:
//  - one contact per address or number (conv_contact_handles is unique by kind and value), one conversation per contact;
//  - a message is unique by (channel, external id); taking in the same message twice changes nothing (the unread count counts only rows really added);
//  - the newest message decides last_message_at, last_channel and last_direction (an older message found later never moves them back);
//  - a new message from the guest reopens a conversation marked done; a muted sender goes to Other; a sender linked to a guest, stay or company stays in the main list;
//  - a missing table (the migration not run yet) is the typed ConversationsNotReady, never a server error.

/** The migration that holds these tables has not been run yet (PostgreSQL 42P01). Thrown out of the unit; the service answers with a plain sentence. */
export class ConversationsNotReady extends Error {
  constructor() {
    super("Conversations need the latest database update (platform 0139 and hotel 0050).");
    this.name = "ConversationsNotReady";
  }
}
export const isConversationsNotReady = (e: unknown): e is ConversationsNotReady => e instanceof ConversationsNotReady || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ConversationsNotReady");

export interface ContactHandle {
  kind: "email" | "phone";
  value: string;
}

/** What a contact is linked to: a hotel's guest, stay, booking or company; the platform's user or hotel. */
export interface ContactLink {
  kind: ConvLinkKind;
  id: string;
  source: "auto" | "manual";
}

export interface ConvContactRecord {
  id: string;
  displayName: string | null;
  link: ContactLink | null;
  linkedBy: string | null;
  linkedAt: Date | null;
  muted: boolean;
  handles: ContactHandle[];
}

export interface ConversationRecord {
  id: string;
  contactId: string;
  status: "open" | "done";
  box: ConvBox;
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt: Date | null;
  lastMessageAt: Date;
  lastChannel: ConvChannel;
  lastDirection: "in" | "out";
  lastInboundAt: Date | null;
  channels: ConvChannel[];
  unreadCount: number;
  waWindowClosesAt: Date | null;
  contact: ConvContactRecord;
  /** The Email page's extras (hotel 0052 / platform 0163): Gmail's star, labels, snooze, Trash and the one draft. */
  starred: boolean;
  labels: string[];
  snoozedUntil: Date | null;
  trashedAt: Date | null;
  draft: ConvDraftRecord | null;
}

/** A Compose draft kept on a conversation: the words of an email not sent yet. */
export interface ConvDraftRecord {
  to: string;
  cc: string[];
  subject: string;
  text: string;
  at: string;
}

/** What the Email page may change on a conversation: a field left out stays. */
export interface ConvExtrasPatch {
  starred?: boolean;
  labels?: string[];
  snoozedUntil?: Date | null;
  trashed?: boolean;
  draft?: ConvDraftRecord | null;
}

/** A list row: the conversation with what its newest message shows. */
export interface ConversationListRecord extends ConversationRecord {
  latestPreview: string | null;
  latestSubject: string | null;
  latestHasAttachments: boolean;
  /** The newest INBOUND email's sender verdict (A12): false = unverified. */
  latestInboundVerified: boolean | null;
}

export interface ConvMessageRecord {
  id: string;
  conversationId: string;
  channel: ConvChannel;
  direction: "in" | "out";
  status: ConvMessageStatus;
  externalId: string;
  sentAt: Date;
  sentBy: string | null;
  sentFrom: SentFrom;
  senderVerified: boolean | null;
  failureCode: string | null;
  preview: string | null;
  mailBox: string | null;
  mailFolder: MailFolder | null;
  mailUid: number | null;
  mailUidValidity: number | null;
  subject: string | null;
  fromAddr: string | null;
  replyToAddr: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  inReplyTo: string | null;
  referenceIds: string[];
  hasAttachments: boolean;
  hasBill: boolean;
  waType: string | null;
  waText: string | null;
  waMedia: Record<string, unknown> | null;
  waContextId: string | null;
  waReactions: { emoji: string; fromContact: boolean }[] | null;
}

export interface ConvNoteRecord {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface QuickReplyRecord {
  id: string;
  title: string;
  body: string;
  channel: "any" | ConvChannel;
  sortOrder: number;
  createdBy: string | null;
}

/** One outgoing message HMS sent (a reply). */
export interface OutgoingMessage {
  channel: ConvChannel;
  externalId: string;
  sentAt: Date;
  sentBy: string;
  status: ConvMessageStatus;
  preview: string;
  mailBox: string | null;
  subject: string | null;
  fromAddr: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  inReplyTo: string | null;
  referenceIds: string[];
  hasAttachments: boolean;
  hasBill: boolean;
}

export interface LinkTarget {
  kind: ConvLinkKind;
  id: string;
  label: string;
}

export interface LinkCandidateRecord extends LinkTarget {
  detail: string | null;
}

/** What the contact panel shows of a link; the service leaves out what the viewer may not see. */
export interface LinkDetailRecord {
  label: string;
  room?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  status?: string | null;
  billId?: string | null;
  billNo?: string | null;
  billTotalPaise?: number | null;
  hotelName?: string | null;
}

/** Finds who an address or a number belongs to (a hotel: its guests, stays, bookings and companies; the platform: its users and hotels). Bound to the same transaction. */
export interface LinkMatcher {
  byEmail(email: string): Promise<LinkTarget | null>;
  byPhone(digits: string): Promise<LinkTarget | null>;
  /** Up to 20 records whose name, address or number has every word, of these kinds only. */
  search(words: readonly string[], kinds: readonly ConvLinkKind[]): Promise<LinkCandidateRecord[]>;
  /** The record behind a link (null when it is gone). */
  details(link: ContactLink): Promise<LinkDetailRecord | null>;
  /** The record exists (for "Link guest"). */
  exists(kind: ConvLinkKind, id: string): Promise<LinkTarget | null>;
}

export interface IngestResult {
  added: number;
  conversationIds: string[];
  /** The conversations that got new messages from the person, with the person's name (the live announcement says the name, never the text). */
  newInbound: { conversationId: string; name: string }[];
}

export interface ListQuery extends Page {
  words?: readonly string[];
  tab: ConvTab;
  channel: ConvChannelFilter;
  /** The viewer (the "Mine" tab). */
  me: string;
  /** The Email page's folder (Gmail's); wins over `tab`. */
  folder?: EmailFolder;
  /** Only conversations carrying this label. */
  label?: string;
  /** Only conversations with an email from, to or copied to this address (lower case). */
  address?: string;
}

export interface ConversationsRepo {
  list(query: ListQuery): Promise<ListResult<ConversationListRecord>>;
  counts(query: { words?: readonly string[]; channel: ConvChannelFilter; me: string }): Promise<Record<ConvTab, number>>;
  /** The size of each Email folder (the left list of the Email page). */
  folderCounts(query: { words?: readonly string[]; channel: ConvChannelFilter; me: string }): Promise<Record<EmailFolder, number>>;
  /** Star, labels, snooze, Trash or the draft; false when there is no such conversation. */
  setExtras(id: string, patch: ConvExtrasPatch): Promise<boolean>;
  /** The conversation of this email address (Compose): the person's own, or a new person and conversation; returns its id. */
  conversationForAddress(address: string, at: Date): Promise<string>;
  /** Conversations in the main list with unread messages (the badge). */
  unreadTotal(): Promise<number>;
  get(id: string): Promise<ConversationRecord | null>;
  /** The newest `limit` messages (sent before `before` when given), oldest first, and whether older ones exist. */
  messages(conversationId: string, query: { before?: Date; limit: number }): Promise<{ rows: ConvMessageRecord[]; hasOlder: boolean }>;
  message(conversationId: string, messageId: string): Promise<ConvMessageRecord | null>;
  messageByExternal(channel: ConvChannel, externalId: string): Promise<ConvMessageRecord | null>;
  /** The whole email kept for this message (hotel 0053: mail received through Amazon SES, a reply sent through the hotel's own mail), or null. Every hub: a hotel's (hotel 0053), a group's (platform 0166) and the platform's (platform 0171). */
  mailSource(messageId: string): Promise<Buffer | null>;
  /** Keeps the whole email of this message; a repeat keeps the first. Every hub (hotel 0053, platform 0166 and 0171). */
  saveMailSource(messageId: string, source: Buffer): Promise<void>;
  /** Which of these email ids the hub holds (as a message's own id). */
  knownMessageIds(ids: readonly string[]): Promise<Set<string>>;
  /** Takes in new messages (the rules at the top of this file). `own` is the mailbox's own address (its own copies are recognised). */
  ingest(entries: readonly InboundEntry[], own: { mailbox: string | null }, matcher: LinkMatcher, at: Date): Promise<IngestResult>;
  recordOutgoing(conversationId: string, message: OutgoingMessage): Promise<ConvMessageRecord>;
  setAssignee(id: string, userId: string | null, by: string, at: Date): Promise<boolean>;
  setStatus(id: string, status: "open" | "done"): Promise<boolean>;
  setBox(id: string, box: ConvBox): Promise<boolean>;
  setMuted(contactId: string, muted: boolean): Promise<boolean>;
  markRead(id: string): Promise<boolean>;
  markUnread(id: string): Promise<boolean>;
  notes(conversationId: string): Promise<ConvNoteRecord[]>;
  addNote(conversationId: string, authorId: string, body: string, at: Date): Promise<ConvNoteRecord>;
  note(conversationId: string, noteId: string): Promise<ConvNoteRecord | null>;
  removeNote(conversationId: string, noteId: string): Promise<boolean>;
  setLink(contactId: string, link: ContactLink, by: string, at: Date): Promise<boolean>;
  clearLink(contactId: string): Promise<boolean>;
  quickReplies(): Promise<QuickReplyRecord[]>;
  /** A title already used (any case) -> RepoError "unique" "conv_quick_replies_title". */
  addQuickReply(input: { title: string; body: string; channel: "any" | ConvChannel; sortOrder: number }, by: string): Promise<QuickReplyRecord>;
  updateQuickReply(id: string, input: { title: string; body: string; channel: "any" | ConvChannel; sortOrder: number }): Promise<QuickReplyRecord | null>;
  removeQuickReply(id: string): Promise<boolean>;
  positions(): Promise<Position[]>;
  /** Takes the check's lease (the folder rows are made first); false when another check holds it. */
  acquireLease(mailbox: string, now: Date, ms: number): Promise<boolean>;
  /** The new positions, when the check ran, whether it worked, and the lease released. `checkedAt` may be set ahead to hold back the next background check (RATE_LIMITED). */
  savePositions(mailbox: string, positions: readonly { folder: MailFolder; uidValidity: number; lastUid: number }[], result: { checkedAt: Date; ok: boolean; error: string | null }): Promise<void>;
  releaseLease(): Promise<void>;
  /** The mailbox address changed: the positions start again (the first window). */
  resetPositions(mailbox: string): Promise<void>;
  /** C5: removes messages sent before `before`, then the conversations and contacts left empty. Answers how many messages went. */
  purge(before: Date): Promise<number>;
}

/** The hotel side of a unit: the hub, its matcher, and what the service reads around it (the mailbox settings, the hotel's name, the system log). */
export interface ConversationsRepos {
  conversations: ConversationsRepo;
  matcher: LinkMatcher;
  adminSettings: { get(keys: readonly string[]): Promise<SettingRow[]> };
  hotelProfile: { header(): Promise<{ name: string }> };
  systemLogs: SystemLogRepo;
}

/** The platform registry (platform.conv_channel_accounts): the platform's own mailbox row and one row per hotel. */
export interface ChannelAccountRecord {
  id: string;
  hotelId: string | null;
  channel: ConvChannel;
  status: "on" | "off";
  imapHost: string | null;
  imapPort: number | null;
  lastCheckedAt: Date | null;
  lastOkAt: Date | null;
  lastPurgedAt: Date | null;
  lastError: string | null;
}

export interface ChannelAccountsRepo {
  platformAccount(channel: ConvChannel): Promise<ChannelAccountRecord | null>;
  savePlatformAccount(input: { status: "on" | "off"; imapHost: string | null; imapPort: number | null }, by: string): Promise<ChannelAccountRecord>;
  /** A hotel's reading switch (the row is made when missing; off keeps the row so the purge goes on). */
  setHotelReading(hotelId: string, on: boolean): Promise<void>;
  /** The last check of an account (best effort). */
  report(hotelId: string | null, result: { at: Date; ok: boolean; error: string | null }): Promise<void>;
  /** Hotels whose mailbox is read and was not checked for 6 hours, the never-checked first. */
  dueSync(now: Date, limit: number): Promise<string[]>;
  /** Every provisioned hotel not purged today (also those reading nothing and those without a row). `today` is the start of the day. */
  duePurge(today: Date, limit: number): Promise<string[]>;
  /** A hotel's purge ran (its row is made when missing, status off); null = the platform's own hub. */
  markPurged(hotelId: string | null, at: Date): Promise<void>;
}

export interface PlatformConversationsRepos {
  conversations: ConversationsRepo;
  matcher: LinkMatcher;
  accounts: ChannelAccountsRepo;
}

export type { InboundEntry, Page };
