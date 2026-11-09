import "server-only";
import {
  conversationsCopy,
  type ConvAccess,
  type ConversationRow,
  type ConversationThread,
  type ConvLink,
  type ConvLinkKind,
  type ConvMessage,
  type ConvNote,
  type ConvPerson,
  type EmailEntry,
  type MailboxState,
  type ReplyChannel,
  type WhatsAppChannelState,
} from "@shared/dashboards/conversations";
import { windowOf, type WaMessageType, type WhatsAppMessage, type WhatsAppSettings } from "@shared/dashboards/whatsapp";
import type { Catalog } from "../../auth/catalog";
import { can } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { displayPhone } from "../../conversations/match";
import { IMAP_FAILURE_TEXT, isImapFailureCode } from "../../mail/imapFailure";
import { MESSAGE_ID } from "../../mail/imap";
import type { MailboxRead } from "../../mail/mailbox";
import type { Position } from "../../conversations/channel";
import type { ContactHandle, ConversationListRecord, ConversationRecord, ConvMessageRecord, ConvNoteRecord, LinkDetailRecord } from "../../repos/conversations";
import { displayName, type Person } from "../cash/ports";

// The hub's views (decision 66): the records of repos/conversations.ts turned into the contract's shapes, the same for the hotel's hub and the platform's. Pure. Who may see
// what is worked out ONCE here (ConvAccess, A14): the room and dates of a linked stay need the Front Office right, the bill needs Bills, linking needs the source module's
// view; the screens never guess.

const C = conversationsCopy;

/** What the viewer may see and do, with the two Front Office rights kept apart (a stay's room and dates; a booking's dates). */
export interface HubAccess extends ConvAccess {
  canSeeReservations: boolean;
}

/** The kinds a hotel conversation may link to, and the right each needs (view on the source). */
const HOTEL_LINK_SOURCES: Partial<Record<ConvLinkKind, string>> = { stay: "pms.stays", reservation: "pms.reservations", customer: "companies", company: "companies" };

/**
 * ConvAccess for a hotel session: `canEdit` and `readOnlyReason` from the Conversations right (the service decided it); the detail rights from the other modules
 * (the Hotel Admin sees everything).
 */
export function hotelAccess(session: VerifiedSession, catalog: Catalog, edit: { canEdit: boolean; readOnlyReason: ConvAccess["readOnlyReason"] }): HubAccess {
  const admin = session.accountRole === "hotel_admin" && session.visit === undefined;
  const sees = (key: string): boolean => admin || can(session, catalog, key, "view");
  const canLink = edit.canEdit ? (Object.entries(HOTEL_LINK_SOURCES) as [ConvLinkKind, string][]).filter(([, key]) => sees(key)).map(([kind]) => kind) : [];
  return { ...edit, canSeeStay: sees("pms.stays"), canSeeReservations: sees("pms.reservations"), canSeeBills: sees("bills.bills"), canLink };
}

/** ConvAccess for platform staff: the platform's links are its users and hotels; there are no stays or bills. */
export function platformAccess(): HubAccess {
  return { canEdit: true, readOnlyReason: null, canSeeStay: false, canSeeReservations: false, canSeeBills: false, canLink: ["user", "hotel"] };
}

/** May this viewer link to this kind (edit, and the source's view)? */
export const mayLink = (access: HubAccess, kind: ConvLinkKind): boolean => access.canLink.includes(kind);

/** An address as shown, or a number as +91 98250 12345. */
export const handleText = (h: ContactHandle | undefined): string => (h ? (h.kind === "phone" ? displayPhone(h.value) : h.value) : "");

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** The names behind these user ids (assignees, senders, note authors), as ConvPerson. */
export function personOf(people: ReadonlyMap<string, Person>, id: string | null): ConvPerson | null {
  if (!id) return null;
  const p = people.get(id);
  return { id, name: p ? displayName(p) : "Former staff" };
}

/** Every user id a page of the hub names (one directory lookup, no N+1). */
export function peopleIdsOf(rows: readonly (ConversationRecord | ConvMessageRecord | ConvNoteRecord)[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if ("assignedTo" in r && r.assignedTo) ids.add(r.assignedTo);
    if ("sentBy" in r && r.sentBy) ids.add(r.sentBy);
    if ("authorId" in r) ids.add(r.authorId);
  }
  return [...ids];
}

export function rowOf(r: ConversationListRecord, people: ReadonlyMap<string, Person>): ConversationRow {
  const handle = handleText(r.contact.handles[0]);
  return {
    id: r.id,
    name: r.contact.displayName?.trim() || handle || C.unknown,
    handle,
    channels: r.channels,
    lastChannel: r.lastChannel,
    lastAt: r.lastMessageAt.toISOString(),
    lastDirection: r.lastDirection,
    preview: r.latestPreview ?? "",
    ...(r.latestSubject ? { subject: r.latestSubject } : {}),
    unread: r.unreadCount,
    hasAttachments: r.latestHasAttachments,
    waiting: r.status === "open" && r.lastDirection === "in",
    status: r.status,
    box: r.box,
    assignedTo: personOf(people, r.assignedTo),
    linked: r.contact.link !== null,
    unverified: r.latestInboundVerified === false,
    // the Email page's extras (hotel 0052): Gmail's star, labels, a saved draft, and a snooze that has not run out
    starred: r.starred,
    labels: [...r.labels],
    draft: r.draft !== null,
    ...(r.snoozedUntil && r.snoozedUntil.getTime() > Date.now() ? { snoozedUntil: r.snoozedUntil.toISOString() } : {}),
    ...(r.channels.includes("whatsapp") ? { windowMinutes: windowOfConversation(r, new Date())?.minutesLeft ?? null } : {}),
  };
}

export function emailEntryOf(m: ConvMessageRecord, people: ReadonlyMap<string, Person>): EmailEntry {
  return {
    kind: "email",
    id: m.id,
    direction: m.direction,
    status: m.status,
    at: m.sentAt.toISOString(),
    from: m.fromAddr ?? "",
    replyTo: m.replyToAddr,
    to: m.toAddrs,
    cc: m.ccAddrs,
    subject: m.subject ?? "",
    preview: m.preview ?? "",
    hasAttachments: m.hasAttachments,
    sentBy: personOf(people, m.sentBy),
    sentFrom: m.sentFrom === "hms" ? "hms" : m.sentFrom === "mailbox" ? "mailbox" : "contact",
    verified: m.direction === "in" ? m.senderVerified : null,
  };
}

/** A stored WhatsApp message (the columns exist for the design; they stay empty until the Meta integration). */
export function whatsappOf(m: ConvMessageRecord, people: ReadonlyMap<string, Person>): WhatsAppMessage {
  const media = m.waMedia as { name?: unknown; size?: unknown; mime?: unknown; caption?: unknown; duration?: unknown; stored?: unknown; pending?: unknown } | null;
  return {
    kind: "whatsapp",
    id: m.id,
    direction: m.direction,
    status: m.status,
    at: m.sentAt.toISOString(),
    sentBy: personOf(people, m.sentBy),
    sentFrom: m.sentFrom === "hms" || m.sentFrom === "phone" || m.sentFrom === "auto" ? m.sentFrom : "contact",
    type: (m.waType ?? "unsupported") as WaMessageType,
    ...(m.waText ? { text: m.waText } : {}),
    // a file shows whether or not the guest named it; `kept` says whether it can be opened (the sweep removes old files, a refused type is never kept)
    ...(media && (typeof media.name === "string" || typeof media.stored === "boolean" || media.pending === true)
      ? { media: { name: typeof media.name === "string" ? media.name : "", size: Number(media.size ?? 0), mime: String(media.mime ?? "application/octet-stream"), ...(typeof media.caption === "string" ? { caption: media.caption } : {}), ...(typeof media.duration === "number" ? { duration: media.duration } : {}), kept: media.stored === true ? ("yes" as const) : media.pending === true ? ("waiting" as const) : ("no" as const) } }
      : {}),
    ...(m.waContextId ? { replyTo: { id: m.waContextId, preview: "" } } : {}),
    ...(m.waReactions ? { reactions: m.waReactions } : {}),
    ...(m.status === "failed" && m.failureCode ? { failure: m.failureCode } : {}),
  };
}

export const messageOf = (m: ConvMessageRecord, people: ReadonlyMap<string, Person>): ConvMessage => (m.channel === "whatsapp" ? whatsappOf(m, people) : emailEntryOf(m, people));

export const noteOf = (n: ConvNoteRecord, people: ReadonlyMap<string, Person>, me: string): ConvNote => ({ id: n.id, text: n.body, author: personOf(people, n.authorId) ?? { id: n.authorId, name: "Former staff" }, at: n.createdAt.toISOString(), mine: n.authorId === me });

/** The link as the contact panel shows it, with only the details this viewer may see (A14). */
export function linkOf(link: NonNullable<ConversationRecord["contact"]["link"]>, detail: LinkDetailRecord | null, access: HubAccess): ConvLink {
  const d: NonNullable<ConvLink["detail"]> = {};
  if (detail) {
    const dates = link.kind === "stay" ? access.canSeeStay : link.kind === "reservation" ? access.canSeeReservations : false;
    if (dates) {
      if (detail.room) d.room = detail.room;
      if (detail.checkIn) d.checkIn = detail.checkIn;
      if (detail.checkOut) d.checkOut = detail.checkOut;
      if (detail.status) d.status = detail.status;
    }
    if (access.canSeeBills && detail.billId) {
      d.billId = detail.billId;
      if (detail.billNo) d.billNo = detail.billNo;
      if (detail.billTotalPaise !== null && detail.billTotalPaise !== undefined) d.billTotal = detail.billTotalPaise;
    }
    if (detail.hotelName) d.hotelName = detail.hotelName;
  }
  return { kind: link.kind, id: link.id, label: detail?.label ?? C.contact.linkKinds[link.kind], source: link.source, ...(Object.keys(d).length > 0 ? { detail: d } : {}) };
}

/** The address an email reply goes to: the newest email's From (its first To when it was ours), and a different Reply-To it asked for (chosen only on purpose, A12). */
export function replyTargetOf(messages: readonly ConvMessageRecord[], handles: readonly ContactHandle[]): ConversationThread["replyTo"] {
  const newest = [...messages].reverse().find((m) => m.channel === "email");
  if (newest) {
    if (newest.direction === "in" && newest.fromAddr) {
      const differs = newest.replyToAddr && newest.replyToAddr !== newest.fromAddr ? newest.replyToAddr : null;
      return { address: newest.fromAddr, differsFrom: differs };
    }
    if (newest.direction === "out" && newest.toAddrs[0]) return { address: newest.toAddrs[0], differsFrom: null };
  }
  const email = handles.find((h) => h.kind === "email");
  return email ? { address: email.value, differsFrom: null } : null;
}

/** Where the mailbox stands, from how it is set up and where its last check stopped. `message` is always a fixed sentence. */
export function mailboxStateOf(read: Pick<MailboxRead, "config" | "reason">, positions: readonly Position[]): MailboxState {
  if (!read.config) {
    const reason = read.reason ?? "not_set";
    if (reason === "off") return { state: "off", reason, checkedAt: null, address: null, message: C.mailbox.off };
    const message = reason === "platform_mail" ? C.mailbox.platformMail : reason === "send_only" ? C.mailbox.sendOnly : reason === "password_unreadable" ? C.mailbox.passwordUnreadable : C.mailbox.notSet;
    return { state: "not_available", reason, checkedAt: null, address: null, message };
  }
  const inbox = positions.find((p) => p.folder === "inbox");
  const checkedAt = iso(inbox?.checkedAt ?? null);
  const error = inbox?.lastError ?? null;
  if (error && isImapFailureCode(error) && error !== "NO_SENT_FOLDER") return { state: "error", checkedAt, address: read.config.address, message: C.mailbox.error.replace("{reason}", IMAP_FAILURE_TEXT[error]) };
  return { state: "ok", checkedAt, address: read.config.address };
}

export const NEEDS_UPDATE_STATE: MailboxState = { state: "not_available", reason: "needs_update", checkedAt: null, address: null, message: C.mailbox.needsUpdate };

export const whatsappChannelOf = (s: WhatsAppSettings): WhatsAppChannelState => ({ connected: s.connected, available: s.available, ...(s.number ? { number: s.number } : {}), ...(s.displayName ? { displayName: s.displayName } : {}) });

/** The channels a reply can go on now, and the one the box opens with. `sendsWithoutMailbox`: email can go out with no mailbox read (the platform's own mail, for its desks). */
export function replyChannelsOf(c: ConversationRecord, mailbox: Pick<MailboxRead, "config">, whatsapp: WhatsAppSettings, sendsWithoutMailbox = false): { replyChannels: ReplyChannel[]; defaultChannel: "email" | "whatsapp" } {
  const hasEmail = c.contact.handles.some((h) => h.kind === "email");
  const hasPhone = c.contact.handles.some((h) => h.kind === "phone");
  const email: ReplyChannel = (mailbox.config || sendsWithoutMailbox) && hasEmail ? { channel: "email", available: true } : { channel: "email", available: false, reason: hasEmail ? C.reply.emailNotAvailable : C.reply.noEmail };
  const wa: ReplyChannel = whatsapp.connected && hasPhone ? { channel: "whatsapp", available: true } : { channel: "whatsapp", available: false, reason: C.reply.whatsappNotConnected };
  const replyChannels = [email, wa];
  const preferred = replyChannels.find((r) => r.channel === c.lastChannel && r.available);
  return { replyChannels, defaultChannel: preferred?.channel ?? (email.available ? "email" : wa.available ? "whatsapp" : "email") };
}

/** The 24-hour window of a conversation that has WhatsApp (the time it closes is kept on the conversation). */
export function windowOfConversation(c: ConversationRecord, now: Date): ConversationThread["window"] {
  if (!c.channels.includes("whatsapp")) return null;
  const last = c.waWindowClosesAt ? new Date(c.waWindowClosesAt.getTime() - 24 * 3_600_000) : null;
  return windowOf(last, now);
}

/** "Re: <subject>" unless it already starts with Re: (any case); never a line break. */
export function replySubject(original: string | null | undefined): string {
  const s = (original ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim();
  if (s === "") return "Re:";
  return /^re\s*:/i.test(s) ? s.slice(0, 500) : `Re: ${s}`.slice(0, 500);
}

/** The In-Reply-To and References of a reply to this message (only well-formed Message-IDs). */
export function threadingOf(original: ConvMessageRecord | null): { inReplyTo: string | null; references: string[] } {
  if (!original) return { inReplyTo: null, references: [] };
  const own = MESSAGE_ID.test(original.externalId) ? original.externalId : null;
  return { inReplyTo: own, references: original.referenceIds.filter((id) => MESSAGE_ID.test(id)) };
}

/** The short preview of an outgoing reply: white space collapsed, at most 200 characters. */
export const previewOfText = (text: string): string => Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 200).join("");
