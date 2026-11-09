import "server-only";
import { randomUUID } from "node:crypto";
import { CONV_TABS, EMAIL_FOLDERS, inTab, type ConvBox, type ConvChannel, type ConvLinkKind, type ConvTab, type EmailFolder } from "@shared/dashboards/conversations";
import type { InboundEntry, Position } from "../../conversations/channel";
import { last10, normaliseEmail, normalisePhone } from "../../conversations/match";
import type { ChannelAccountRecord, ChannelAccountsRepo, ContactHandle, ConversationListRecord, ConversationRecord, ConversationsRepo, ConversationsRepos, ConvContactRecord, ConvMessageRecord, ConvNoteRecord, IngestResult, LinkCandidateRecord, LinkDetailRecord, LinkMatcher, LinkTarget, PlatformConversationsRepos, QuickReplyRecord } from "../conversations";
import { RepoError, type ListResult, type Unit } from "../types";
import { bindHotelRepos, emptyHotelData, type HotelData } from "./frontOffice";
import { createMemoryUnit, MemoryStore } from "./store";

// The in-memory double of the Conversations repositories (repos/conversations.ts), the reference for every rule the PostgreSQL one keeps: the uniques (one handle per kind
// and value, one conversation per contact, one message per channel and external id, one quick reply per title in any case, one position per folder), the ingest rules
// (in-batch duplicates, the bind of our own Sent copy, a reused Message-ID stored apart, unread counting only rows really added, the newest message deciding last_*, a
// guest's message reopening a done conversation, muted to Other, linked to the main list), the tabs and the purge.

export interface ConversationsData {
  convContacts: (Omit<ConvContactRecord, "handles"> & { createdAt: Date })[];
  convHandles: (ContactHandle & { id: string; contactId: string })[];
  /** The Email page's extras (star, labels, snooze, Trash, draft) are optional here: a row without them has the database's defaults. */
  convConversations: (Omit<ConversationRecord, "contact" | ExtraKeys> & Partial<Pick<ConversationRecord, ExtraKeys>> & { createdAt: Date })[];
  convMessages: (ConvMessageRecord & { createdAt: Date })[];
  convNotes: ConvNoteRecord[];
  convQuickReplies: QuickReplyRecord[];
  convPositions: (Position & { id: string })[];
  /** The whole email of a message (hotel 0053); optional so older test data still fits. */
  convMailSources?: { messageId: string; source: Buffer }[];
}
type ExtraKeys = "starred" | "labels" | "snoozedUntil" | "trashedAt" | "draft";

/** The Email page's folder rule (the same as postgres/conversations.ts folderSql). */
function inFolder(folder: EmailFolder, c: ConversationsData["convConversations"][number], me: string, hasOut: boolean, at: number): boolean {
  const snoozed = c.snoozedUntil != null && c.snoozedUntil.getTime() > at;
  const draft = c.draft != null;
  switch (folder) {
    case "inbox":
      return c.box === "main" && c.status === "open" && !draft && !snoozed;
    case "snoozed":
      return snoozed;
    case "starred":
      return c.starred === true;
    case "unread":
      return c.unreadCount > 0 && c.box === "main";
    case "sent":
      return !draft && (c.lastDirection === "out" || hasOut);
    case "drafts":
      return draft;
    case "mine":
      return c.assignedTo === me && c.status === "open";
    case "waiting":
      return c.box === "main" && c.status === "open" && c.lastDirection === "in";
    case "unassigned":
      return c.box === "main" && c.status === "open" && c.assignedTo === null;
    case "archive":
      return c.status === "done";
    case "other":
      return c.box === "other" && c.status === "open";
  }
}

export const emptyConversationsData = (): ConversationsData => ({ convContacts: [], convHandles: [], convConversations: [], convMessages: [], convNotes: [], convQuickReplies: [], convPositions: [], convMailSources: [] });

const copy = <T>(r: T): T => structuredClone(r);
const newestFirst = (a: { lastMessageAt: Date; id: string }, b: { lastMessageAt: Date; id: string }): number => b.lastMessageAt.getTime() - a.lastMessageAt.getTime() || (a.id < b.id ? 1 : -1);

/** The handle an entry belongs to (an address for email, a number for WhatsApp). */
export function handleOfEntry(e: Pick<InboundEntry, "channel" | "person">): ContactHandle | null {
  if (e.channel === "email") {
    const v = normaliseEmail(e.person);
    return v ? { kind: "email", value: v } : null;
  }
  const v = normalisePhone(e.person);
  return v ? { kind: "phone", value: v } : null;
}

/**
 * Rule 1: one entry per (channel, external id) in a batch; the Sent copy wins over the Inbox copy of the same message. Two entries that only SHARE an id (a different
 * sender: a reused or forged Message-ID) are not the same message: the one not from Sent is kept apart under its own "uid:..." id, never merged.
 */
export function dedupeBatch(entries: readonly InboundEntry[]): InboundEntry[] {
  const by = new Map<string, InboundEntry>();
  const apart: InboundEntry[] = [];
  for (const e of entries) {
    const key = `${e.channel}\n${e.externalId}`;
    const had = by.get(key);
    if (!had) {
      by.set(key, e);
      continue;
    }
    if ((had.from ?? "") !== (e.from ?? "")) {
      const [keep, other] = e.mail?.folder === "sent" && had.mail?.folder !== "sent" ? [e, had] : [had, e];
      by.set(key, keep);
      if (other.fallbackId && other.fallbackId !== other.externalId) apart.push({ ...other, externalId: other.fallbackId });
      continue;
    }
    if (had.mail?.folder !== "sent" && e.mail?.folder === "sent") by.set(key, e);
  }
  return [...by.values(), ...apart].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}

export function bindConversations(data: ConversationsData): ConversationsRepo {
  const handlesOf = (contactId: string): ContactHandle[] => data.convHandles.filter((h) => h.contactId === contactId).map((h) => ({ kind: h.kind, value: h.value }));
  const contactOf = (id: string): ConvContactRecord => {
    const c = data.convContacts.find((x) => x.id === id);
    if (!c) throw new Error("contact missing");
    const { createdAt: _c, ...rest } = c;
    void _c;
    return { ...copy(rest), handles: handlesOf(id) };
  };
  const recordOf = (c: ConversationsData["convConversations"][number]): ConversationRecord => {
    const { createdAt: _c, ...rest } = c;
    void _c;
    return { starred: false, labels: [], snoozedUntil: null, trashedAt: null, draft: null, ...copy(rest), contact: contactOf(c.contactId) };
  };
  const hasOut = (id: string): boolean => data.convMessages.some((m) => m.conversationId === id && m.direction === "out");
  const live = (c: ConversationsData["convConversations"][number]): boolean => c.trashedAt == null;
  const viaAddress = (id: string, address: string): boolean =>
    data.convMessages.some((m) => m.conversationId === id && m.channel === "email" && [m.fromAddr, ...(m.toAddrs ?? []), ...(m.ccAddrs ?? [])].some((a) => typeof a === "string" && a.toLowerCase() === address));
  const messagesOf = (conversationId: string) => data.convMessages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || (a.id < b.id ? -1 : 1));
  const listRecordOf = (c: ConversationsData["convConversations"][number]): ConversationListRecord => {
    const msgs = messagesOf(c.id);
    const latest = msgs[msgs.length - 1];
    const inbound = [...msgs].reverse().find((m) => m.direction === "in" && m.channel === "email");
    return { ...recordOf(c), latestPreview: latest?.preview ?? null, latestSubject: latest?.subject ?? null, latestHasAttachments: latest?.hasAttachments ?? false, latestInboundVerified: inbound ? inbound.senderVerified : null };
  };
  const matches = (c: ConversationsData["convConversations"][number], words: readonly string[] | undefined, channel: "all" | ConvChannel): boolean => {
    if (channel !== "all" && !c.channels.includes(channel)) return false;
    if (!words || words.length === 0) return true;
    const contact = data.convContacts.find((x) => x.id === c.contactId);
    const hay = [contact?.displayName ?? "", ...handlesOf(c.contactId).map((h) => h.value), ...messagesOf(c.id).map((m) => m.subject ?? "")].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w.toLowerCase()));
  };
  const tabOf = (c: ConversationsData["convConversations"][number], tab: ConvTab, me: string, channel: "all" | ConvChannel): boolean => inTab(tab, { box: c.box, status: c.status, unread: c.unreadCount, assignedTo: c.assignedTo, lastDirection: c.lastDirection }, me, channel);
  const conv = (id: string) => data.convConversations.find((c) => c.id === id);
  const messageRow = (r: Omit<ConvMessageRecord, "id">, at: Date): ConversationsData["convMessages"][number] => ({ ...r, id: randomUUID(), createdAt: at });
  /** The newest message decides last_*; an older one never moves them back (rule 4). */
  const touch = (c: ConversationsData["convConversations"][number], m: { sentAt: Date; channel: ConvChannel; direction: "in" | "out" }): void => {
    if (m.sentAt.getTime() >= c.lastMessageAt.getTime()) {
      c.lastChannel = m.channel;
      c.lastDirection = m.direction;
    }
    if (m.sentAt.getTime() > c.lastMessageAt.getTime()) c.lastMessageAt = m.sentAt;
    if (m.direction === "in" && (c.lastInboundAt === null || m.sentAt.getTime() > c.lastInboundAt.getTime())) c.lastInboundAt = m.sentAt;
    if (!c.channels.includes(m.channel)) c.channels = [...c.channels, m.channel].sort();
  };

  const repo: ConversationsRepo = {
    async list(q) {
      const at = Date.now();
      const rows = data.convConversations
        .filter((c) => live(c) && matches(c, q.words, q.channel) && (!q.label || (c.labels ?? []).includes(q.label)) && (!q.address || viaAddress(c.id, q.address)) && (q.folder ? inFolder(q.folder, c, q.me, hasOut(c.id), at) : tabOf(c, q.tab, q.me, q.channel)))
        .sort(newestFirst);
      return { rows: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(listRecordOf), total: rows.length } satisfies ListResult<ConversationListRecord>;
    },
    async counts(q) {
      const base = data.convConversations.filter((c) => live(c) && matches(c, q.words, q.channel));
      return Object.fromEntries(CONV_TABS.map((t) => [t, base.filter((c) => tabOf(c, t, q.me, q.channel)).length])) as Record<ConvTab, number>;
    },
    async folderCounts(q) {
      const at = Date.now();
      const base = data.convConversations.filter((c) => live(c) && matches(c, q.words, q.channel));
      return Object.fromEntries(EMAIL_FOLDERS.map((f) => [f, base.filter((c) => inFolder(f, c, q.me, hasOut(c.id), at)).length])) as Record<EmailFolder, number>;
    },
    async setExtras(id, patch) {
      const c = conv(id);
      if (!c) return false;
      if (patch.starred !== undefined) c.starred = patch.starred;
      if (patch.labels !== undefined) c.labels = [...patch.labels];
      if (patch.snoozedUntil !== undefined) c.snoozedUntil = patch.snoozedUntil;
      if (patch.trashed !== undefined) c.trashedAt = patch.trashed ? new Date() : null;
      if (patch.draft !== undefined) c.draft = patch.draft ? copy(patch.draft) : null;
      return true;
    },
    async conversationForAddress(address, at) {
      const value = address.trim().toLowerCase();
      let contactId = data.convHandles.find((h) => h.kind === "email" && h.value === value)?.contactId;
      if (!contactId) {
        contactId = randomUUID();
        data.convContacts.push({ id: contactId, displayName: null, link: null, linkedBy: null, linkedAt: null, muted: false, createdAt: at });
        data.convHandles.push({ id: randomUUID(), contactId, kind: "email", value });
      }
      let c = data.convConversations.find((x) => x.contactId === contactId);
      if (!c) {
        c = { id: randomUUID(), contactId, status: "open", box: "main", assignedTo: null, assignedBy: null, assignedAt: null, lastMessageAt: at, lastChannel: "email", lastDirection: "out", lastInboundAt: null, channels: ["email"], unreadCount: 0, waWindowClosesAt: null, createdAt: at };
        data.convConversations.push(c);
      }
      // writing to the person again brings the conversation back from the Trash
      c.trashedAt = null;
      return c.id;
    },
    async unreadTotal() {
      return data.convConversations.filter((c) => live(c) && c.box === "main" && c.unreadCount > 0).length;
    },
    async get(id) {
      const c = conv(id);
      return c ? recordOf(c) : null;
    },
    async messages(conversationId, q) {
      const all = messagesOf(conversationId).filter((m) => !q.before || m.sentAt.getTime() < q.before.getTime());
      const rows = all.slice(Math.max(0, all.length - q.limit));
      return { rows: rows.map(({ createdAt: _c, ...m }) => (void _c, copy(m))), hasOlder: all.length > rows.length };
    },
    async message(conversationId, messageId) {
      const m = data.convMessages.find((x) => x.id === messageId && x.conversationId === conversationId);
      if (!m) return null;
      const { createdAt: _c, ...rest } = m;
      void _c;
      return copy(rest);
    },
    async mailSource(messageId) {
      const s = (data.convMailSources ?? []).find((x) => x.messageId === messageId);
      return s ? Buffer.from(s.source) : null;
    },
    async saveMailSource(messageId, source) {
      if (!data.convMessages.some((m) => m.id === messageId)) throw new Error("conv_mail_sources_message_id_fkey");
      if (source.byteLength < 1 || source.byteLength > 1_048_576) throw new Error("conv_mail_sources_source_check");
      const list = (data.convMailSources ??= []);
      if (!list.some((x) => x.messageId === messageId)) list.push({ messageId, source: Buffer.from(source) });
    },
    async messageByExternal(channel, externalId) {
      const m = data.convMessages.find((x) => x.channel === channel && x.externalId === externalId);
      if (!m) return null;
      const { createdAt: _c, ...rest } = m;
      void _c;
      return copy(rest);
    },
    async knownMessageIds(ids) {
      const want = new Set(ids);
      return new Set(data.convMessages.filter((m) => m.channel === "email" && want.has(m.externalId)).map((m) => m.externalId));
    },
    async ingest(entries, own, matcher, at) {
      const result: IngestResult = { added: 0, conversationIds: [], newInbound: [] };
      const mailbox = own.mailbox?.toLowerCase() ?? null;
      for (const e of dedupeBatch(entries)) {
        // rule 3: a message we already hold
        let externalId = e.externalId;
        const existing = data.convMessages.find((m) => m.channel === e.channel && m.externalId === externalId);
        if (existing) {
          const ourCopy = mailbox !== null && e.from === mailbox;
          if (e.mail?.folder === "sent" && ourCopy && existing.direction === "out" && existing.sentFrom === "hms" && existing.mailUid === null) {
            existing.mailUid = e.mail.uid;
            existing.mailFolder = "sent";
            existing.mailUidValidity = e.mail.uidValidity;
            existing.mailBox = e.mail.mailbox;
            continue;
          }
          // the same message read again (a renumbered folder, an overlapping first window): nothing new; where it now sits in the mailbox is kept
          if ((existing.fromAddr ?? "") === (e.from ?? "")) {
            if (e.mail && existing.mailFolder === e.mail.folder) Object.assign(existing, { mailUid: e.mail.uid, mailUidValidity: e.mail.uidValidity, mailBox: e.mail.mailbox });
            continue;
          }
          if (ourCopy || !e.fallbackId || e.fallbackId === externalId) continue;
          // a different message reusing the id: kept apart under its UID, never merged
          externalId = e.fallbackId;
          if (data.convMessages.some((m) => m.channel === e.channel && m.externalId === externalId)) continue;
        }
        // the conversation: an HMS reply names its own; otherwise the person's handle
        let c = e.hmsConversation ? data.convConversations.find((x) => x.id === e.hmsConversation) : undefined;
        if (!c) {
          const handle = handleOfEntry(e);
          if (!handle) continue;
          let contactId = data.convHandles.find((h) => h.kind === handle.kind && h.value === handle.value)?.contactId;
          if (!contactId) {
            const target = e.senderVerified === true || e.direction === "out" ? await (handle.kind === "email" ? matcher.byEmail(handle.value) : matcher.byPhone(handle.value)) : null;
            contactId = randomUUID();
            data.convContacts.push({ id: contactId, displayName: e.direction === "in" ? e.personName : null, link: target ? { kind: target.kind, id: target.id, source: "auto" } : null, linkedBy: null, linkedAt: target ? at : null, muted: false, createdAt: at });
            data.convHandles.push({ id: randomUUID(), contactId, kind: handle.kind, value: handle.value });
          } else {
            const contact = data.convContacts.find((x) => x.id === contactId);
            if (contact && contact.displayName === null && e.direction === "in" && e.personName) contact.displayName = e.personName;
          }
          c = data.convConversations.find((x) => x.contactId === contactId);
          if (!c) {
            c = { id: randomUUID(), contactId, status: "open", box: "main", assignedTo: null, assignedBy: null, assignedAt: null, lastMessageAt: e.sentAt, lastChannel: e.channel, lastDirection: e.direction, lastInboundAt: null, channels: [], unreadCount: 0, waWindowClosesAt: null, createdAt: at };
            c.box = e.direction === "in" ? e.box : "main";
            data.convConversations.push(c);
          }
        }
        const contact = data.convContacts.find((x) => x.id === c.contactId);
        data.convMessages.push(
          messageRow(
            {
              conversationId: c.id, channel: e.channel, direction: e.direction, status: e.status, externalId, sentAt: e.sentAt, sentBy: null, sentFrom: e.sentFrom, senderVerified: e.senderVerified,
              failureCode: null, preview: e.preview.slice(0, 240) || null, mailBox: e.mail?.mailbox ?? null, mailFolder: e.mail?.folder ?? null, mailUid: e.mail?.uid ?? null, mailUidValidity: e.mail?.uidValidity ?? null,
              subject: e.subject, fromAddr: e.from, replyToAddr: e.replyTo, toAddrs: e.to, ccAddrs: e.cc, inReplyTo: e.inReplyTo, referenceIds: e.references, hasAttachments: e.hasAttachments, hasBill: false,
              waType: e.whatsapp?.type ?? null, waText: e.whatsapp?.text ?? null, waMedia: e.whatsapp?.media ?? null, waContextId: e.whatsapp?.contextId ?? null, waReactions: e.whatsapp?.reactions ?? null,
            },
            at,
          ),
        );
        result.added += 1;
        touch(c, e);
        if (e.direction === "in") {
          c.unreadCount = Math.min(100_000, c.unreadCount + 1);
          if (c.status === "done") c.status = "open";
          // rule 2: a muted sender goes to Other; a linked one stays in (or comes back to) the main list; a main-list message brings the conversation back
          if (contact?.muted) c.box = "other";
          else if (contact?.link || e.box === "main") c.box = "main";
          const name = contact?.displayName ?? (handlesOf(c.contactId)[0]?.value ?? "");
          const had = result.newInbound.find((n) => n.conversationId === c.id);
          if (!had) result.newInbound.push({ conversationId: c.id, name });
        }
        if (!result.conversationIds.includes(c.id)) result.conversationIds.push(c.id);
      }
      return result;
    },
    async recordOutgoing(conversationId, m) {
      const c = conv(conversationId);
      if (!c) throw new Error("conversation missing");
      const already = data.convMessages.find((x) => x.channel === m.channel && x.externalId === m.externalId);
      if (already) {
        // a mail check read our own reply from Sent between the send and this record: it is completed (who sent it, the bill), not refused
        if (already.direction !== "out" || already.conversationId !== conversationId) throw new RepoError("unique", "conv_messages_channel_external_id");
        Object.assign(already, { sentBy: m.sentBy, sentFrom: "hms", hasAttachments: m.hasAttachments || already.hasAttachments, hasBill: m.hasBill, preview: already.preview ?? (m.preview.slice(0, 240) || null), mailBox: already.mailBox ?? m.mailBox });
        touch(c, { sentAt: m.sentAt, channel: m.channel, direction: "out" });
        const { createdAt: _a, ...kept } = already;
        void _a;
        return copy(kept);
      }
      const row = messageRow(
        {
          conversationId, channel: m.channel, direction: "out", status: m.status, externalId: m.externalId, sentAt: m.sentAt, sentBy: m.sentBy, sentFrom: "hms", senderVerified: null, failureCode: null,
          preview: m.preview.slice(0, 240) || null, mailBox: m.mailBox, mailFolder: null, mailUid: null, mailUidValidity: null, subject: m.subject, fromAddr: m.fromAddr, replyToAddr: null, toAddrs: m.toAddrs,
          ccAddrs: m.ccAddrs, inReplyTo: m.inReplyTo, referenceIds: m.referenceIds, hasAttachments: m.hasAttachments, hasBill: m.hasBill, waType: null, waText: null, waMedia: null, waContextId: null, waReactions: null,
        },
        m.sentAt,
      );
      data.convMessages.push(row);
      touch(c, { sentAt: m.sentAt, channel: m.channel, direction: "out" });
      const { createdAt: _c, ...rest } = row;
      void _c;
      return copy(rest);
    },
    async setAssignee(id, userId, by, at) {
      const c = conv(id);
      if (!c) return false;
      c.assignedTo = userId;
      c.assignedBy = userId ? by : null;
      c.assignedAt = userId ? at : null;
      return true;
    },
    async setStatus(id, status) {
      const c = conv(id);
      if (!c) return false;
      c.status = status;
      return true;
    },
    async setBox(id, box: ConvBox) {
      const c = conv(id);
      if (!c) return false;
      c.box = box;
      return true;
    },
    async setMuted(contactId, muted) {
      const c = data.convContacts.find((x) => x.id === contactId);
      if (!c) return false;
      c.muted = muted;
      if (muted) for (const x of data.convConversations.filter((y) => y.contactId === contactId)) x.box = "other";
      return true;
    },
    async markRead(id) {
      const c = conv(id);
      if (!c) return false;
      c.unreadCount = 0;
      return true;
    },
    async markUnread(id) {
      const c = conv(id);
      if (!c) return false;
      c.unreadCount = Math.max(1, c.unreadCount);
      return true;
    },
    async notes(conversationId) {
      return data.convNotes.filter((n) => n.conversationId === conversationId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(copy);
    },
    async addNote(conversationId, authorId, body, at) {
      if (!conv(conversationId)) throw new Error("conversation missing");
      const t = body.trim();
      if (t.length < 1 || t.length > 2000) throw new RepoError("check", "conv_notes_body_check");
      const n: ConvNoteRecord = { id: randomUUID(), conversationId, authorId, body, createdAt: at };
      data.convNotes.push(n);
      return copy(n);
    },
    async note(conversationId, noteId) {
      const n = data.convNotes.find((x) => x.id === noteId && x.conversationId === conversationId);
      return n ? copy(n) : null;
    },
    async removeNote(conversationId, noteId) {
      const i = data.convNotes.findIndex((x) => x.id === noteId && x.conversationId === conversationId);
      if (i < 0) return false;
      data.convNotes.splice(i, 1);
      return true;
    },
    async setLink(contactId, link, by, at) {
      const c = data.convContacts.find((x) => x.id === contactId);
      if (!c) return false;
      c.link = { ...link };
      c.linkedBy = by;
      c.linkedAt = at;
      for (const x of data.convConversations.filter((y) => y.contactId === contactId)) if (!c.muted) x.box = "main";
      return true;
    },
    async clearLink(contactId) {
      const c = data.convContacts.find((x) => x.id === contactId);
      if (!c) return false;
      c.link = null;
      c.linkedBy = null;
      c.linkedAt = null;
      return true;
    },
    async quickReplies() {
      return [...data.convQuickReplies].sort((a, b) => a.sortOrder - b.sortOrder || a.title.toLowerCase().localeCompare(b.title.toLowerCase())).map(copy);
    },
    async addQuickReply(input, by) {
      if (data.convQuickReplies.some((q) => q.title.toLowerCase() === input.title.toLowerCase())) throw new RepoError("unique", "conv_quick_replies_title");
      const q: QuickReplyRecord = { id: randomUUID(), ...input, createdBy: by };
      data.convQuickReplies.push(q);
      return copy(q);
    },
    async updateQuickReply(id, input) {
      const q = data.convQuickReplies.find((x) => x.id === id);
      if (!q) return null;
      if (data.convQuickReplies.some((x) => x.id !== id && x.title.toLowerCase() === input.title.toLowerCase())) throw new RepoError("unique", "conv_quick_replies_title");
      Object.assign(q, input);
      return copy(q);
    },
    async removeQuickReply(id) {
      const i = data.convQuickReplies.findIndex((x) => x.id === id);
      if (i < 0) return false;
      data.convQuickReplies.splice(i, 1);
      return true;
    },
    async positions() {
      return data.convPositions.map(({ id: _id, ...p }) => (void _id, copy(p)));
    },
    async acquireLease(mailbox, now, ms) {
      for (const folder of ["inbox", "sent"] as const) {
        if (!data.convPositions.some((p) => p.folder === folder)) data.convPositions.push({ id: randomUUID(), folder, mailbox, uidValidity: null, lastUid: 0, checkedAt: null, lastOkAt: null, leaseUntil: null, lastError: null });
      }
      const inbox = data.convPositions.find((p) => p.folder === "inbox");
      if (!inbox || (inbox.leaseUntil !== null && inbox.leaseUntil.getTime() >= now.getTime())) return false;
      inbox.leaseUntil = new Date(now.getTime() + ms);
      return true;
    },
    async savePositions(mailbox, positions, r) {
      for (const p of positions) {
        const row = data.convPositions.find((x) => x.folder === p.folder);
        if (row) Object.assign(row, { mailbox, uidValidity: p.uidValidity, lastUid: p.lastUid });
      }
      for (const row of data.convPositions) {
        row.checkedAt = r.checkedAt;
        if (r.ok) row.lastOkAt = r.checkedAt;
        row.lastError = r.error;
        row.leaseUntil = null;
      }
    },
    async releaseLease() {
      for (const row of data.convPositions) row.leaseUntil = null;
    },
    async resetPositions(mailbox) {
      for (const row of data.convPositions) Object.assign(row, { mailbox, uidValidity: null, lastUid: 0 });
    },
    async purge(before) {
      const gone = data.convMessages.filter((m) => m.sentAt.getTime() < before.getTime()).length;
      data.convMessages = data.convMessages.filter((m) => m.sentAt.getTime() >= before.getTime());
      // the whole email goes with its message (ON DELETE CASCADE)
      const kept = new Set(data.convMessages.map((m) => m.id));
      if (data.convMailSources) data.convMailSources = data.convMailSources.filter((s) => kept.has(s.messageId));
      const live = new Set(data.convMessages.map((m) => m.conversationId));
      const dropped = new Set(data.convConversations.filter((c) => !live.has(c.id)).map((c) => c.id));
      data.convConversations = data.convConversations.filter((c) => !dropped.has(c.id));
      data.convNotes = data.convNotes.filter((n) => !dropped.has(n.conversationId));
      const used = new Set(data.convConversations.map((c) => c.contactId));
      const contactsGone = new Set(data.convContacts.filter((c) => !used.has(c.id)).map((c) => c.id));
      data.convContacts = data.convContacts.filter((c) => !contactsGone.has(c.id));
      data.convHandles = data.convHandles.filter((h) => !contactsGone.has(h.contactId));
      return gone;
    },
  };
  return repo;
}

// ------------------------------------------------------------------------------------------------ the hotel's matcher over the in-memory hotel data

const IN_STATUSES = new Set(["confirmed", "checked_in"]);

export function bindHotelMatcher(data: HotelData): LinkMatcher {
  const roomOf = (roomId: string): string | null => data.rooms.find((r) => r.id === roomId)?.number ?? null;
  const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const stayTarget = (s: HotelData["stays"][number]): LinkTarget => ({ kind: "stay", id: s.id, label: `${s.guestName}${roomOf(s.roomId) ? ` · Room ${roomOf(s.roomId)}` : ""}` });
  const sameEmail = (v: string | null, email: string): boolean => (v ?? "").trim().toLowerCase() === email;
  const samePhone = (v: string | null, digits: string): boolean => v !== null && last10(v) === last10(digits) && last10(digits).length === 10;
  const stays = (pred: (s: HotelData["stays"][number]) => boolean) => data.stays.filter(pred).sort((a, b) => (a.status === "in_house" ? 0 : 1) - (b.status === "in_house" ? 0 : 1) || b.checkInAt.getTime() - a.checkInAt.getTime());
  const find = (email: string | null, digits: string | null): LinkTarget | null => {
    const hit = (v: { email: string | null; mobile: string | null }) => (email !== null && sameEmail(v.email, email)) || (digits !== null && samePhone(v.mobile, digits));
    const s = stays((x) => hit(x))[0];
    if (s) return stayTarget(s);
    const r = data.reservations.filter((x) => IN_STATUSES.has(x.status) && hit(x)).sort((a, b) => b.checkIn.localeCompare(a.checkIn))[0];
    if (r) return { kind: "reservation", id: r.id, label: `${r.guestName} · ${r.reference}` };
    const c = data.customers.find((x) => hit({ email: x.email, mobile: x.mobile }));
    if (c) return { kind: "customer", id: c.id, label: c.name };
    const co = data.companyProfiles.find((x) => x.deletedAt === null && email !== null && sameEmail(x.email, email));
    return co ? { kind: "company", id: co.id, label: co.name } : null;
  };
  return {
    byEmail: async (email) => find(email.toLowerCase(), null),
    byPhone: async (digits) => find(null, digits),
    async search(words, kinds) {
      const has = (hay: string): boolean => words.every((w) => hay.toLowerCase().includes(w.toLowerCase()));
      const out: LinkCandidateRecord[] = [];
      if (kinds.includes("stay")) for (const s of stays((x) => has([x.guestName, x.email ?? "", x.mobile ?? ""].join(" ")))) out.push({ ...stayTarget(s), detail: `${istDay(s.checkInAt)} to ${s.expectedCheckOut}` });
      if (kinds.includes("reservation")) for (const r of data.reservations.filter((x) => IN_STATUSES.has(x.status) && has([x.guestName, x.email ?? "", x.mobile ?? "", x.reference].join(" ")))) out.push({ kind: "reservation", id: r.id, label: `${r.guestName} · ${r.reference}`, detail: `${r.checkIn} to ${r.checkOut}` });
      if (kinds.includes("customer")) for (const c of data.customers.filter((x) => has([x.name, x.email ?? "", x.mobile].join(" ")))) out.push({ kind: "customer", id: c.id, label: c.name, detail: c.mobile });
      if (kinds.includes("company")) for (const c of data.companyProfiles.filter((x) => x.deletedAt === null && has([x.name, x.email ?? ""].join(" ")))) out.push({ kind: "company", id: c.id, label: c.name, detail: c.email });
      return out.slice(0, 20);
    },
    async details(link) {
      if (link.kind === "stay") {
        const s = data.stays.find((x) => x.id === link.id);
        if (!s) return null;
        const bill = s.billId ? data.bills.find((b) => b.id === s.billId && b.deletedAt === null) : undefined;
        return { label: s.guestName, room: roomOf(s.roomId), checkIn: istDay(s.checkInAt), checkOut: s.checkOutAt ? istDay(s.checkOutAt) : s.expectedCheckOut, status: s.status, billId: bill?.id ?? null, billNo: bill?.billNumber ?? null, billTotalPaise: bill ? Number(bill.totalHotelAmountPaise + bill.totalFoodAmountPaise) : null } satisfies LinkDetailRecord;
      }
      if (link.kind === "reservation") {
        const r = data.reservations.find((x) => x.id === link.id);
        return r ? { label: `${r.guestName} · ${r.reference}`, checkIn: r.checkIn, checkOut: r.checkOut, status: r.status } : null;
      }
      if (link.kind === "customer") {
        const c = data.customers.find((x) => x.id === link.id);
        return c ? { label: c.name } : null;
      }
      if (link.kind === "company") {
        const c = data.companyProfiles.find((x) => x.id === link.id && x.deletedAt === null);
        return c ? { label: c.name } : null;
      }
      return null;
    },
    async exists(kind: ConvLinkKind, id) {
      if (kind === "stay") {
        const s = data.stays.find((x) => x.id === id);
        return s ? stayTarget(s) : null;
      }
      if (kind === "reservation") {
        const r = data.reservations.find((x) => x.id === id);
        return r ? { kind, id, label: `${r.guestName} · ${r.reference}` } : null;
      }
      if (kind === "customer") {
        const c = data.customers.find((x) => x.id === id);
        return c ? { kind, id, label: c.name } : null;
      }
      if (kind === "company") {
        const c = data.companyProfiles.find((x) => x.id === id && x.deletedAt === null);
        return c ? { kind, id, label: c.name } : null;
      }
      return null;
    },
  };
}

export type ConversationsHotelData = HotelData & ConversationsData;
export const emptyConversationsHotelData = (): ConversationsHotelData => ({ ...emptyHotelData(), ...emptyConversationsData() });

export function bindConversationsHotel(data: ConversationsHotelData): ConversationsRepos {
  const hotel = bindHotelRepos(data);
  return { conversations: bindConversations(data), matcher: bindHotelMatcher(data), adminSettings: hotel.adminSettings, hotelProfile: hotel.hotelProfile, systemLogs: hotel.systemLogs };
}

/** ONE in-memory hotel store with the Conversations tables next to the hotel's own (tests look inside through `store.dataFor`). */
export function createMemoryConversationsHotel(): { store: MemoryStore<ConversationsHotelData>; unit: Unit<ConversationsRepos> } {
  const store = new MemoryStore<ConversationsHotelData>(emptyConversationsHotelData);
  return { store, unit: createMemoryUnit(store, bindConversationsHotel) };
}

// ------------------------------------------------------------------------------------------------ the platform side

export interface PlatformConversationsData extends ConversationsData {
  accounts: ChannelAccountRecord[];
  /** platform.users (id, name, email) and platform.hotels (id, name, provisioned) as the matcher and the purge see them. */
  users: { id: string; name: string; email: string }[];
  hotels: { id: string; name: string; provisioned: boolean }[];
}

export const emptyPlatformConversationsData = (): PlatformConversationsData => ({
  ...emptyConversationsData(),
  accounts: [
    { id: randomUUID(), hotelId: null, channel: "email", status: "off", imapHost: null, imapPort: null, lastCheckedAt: null, lastOkAt: null, lastPurgedAt: null, lastError: null },
    { id: randomUUID(), hotelId: null, channel: "whatsapp", status: "off", imapHost: null, imapPort: null, lastCheckedAt: null, lastOkAt: null, lastPurgedAt: null, lastError: null },
  ],
  users: [],
  hotels: [],
});

export function bindPlatformMatcher(data: PlatformConversationsData): LinkMatcher {
  return {
    async byEmail(email) {
      const u = data.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
      return u ? { kind: "user", id: u.id, label: u.name } : null;
    },
    byPhone: async () => null,
    async search(words, kinds) {
      const has = (hay: string): boolean => words.every((w) => hay.toLowerCase().includes(w.toLowerCase()));
      const out: LinkCandidateRecord[] = [];
      if (kinds.includes("user")) for (const u of data.users.filter((x) => has(`${x.name} ${x.email}`))) out.push({ kind: "user", id: u.id, label: u.name, detail: u.email });
      if (kinds.includes("hotel")) for (const h of data.hotels.filter((x) => has(x.name))) out.push({ kind: "hotel", id: h.id, label: h.name, detail: null });
      return out.slice(0, 20);
    },
    async details(link) {
      if (link.kind === "user") {
        const u = data.users.find((x) => x.id === link.id);
        return u ? { label: u.name } : null;
      }
      if (link.kind === "hotel") {
        const h = data.hotels.find((x) => x.id === link.id);
        return h ? { label: h.name, hotelName: h.name } : null;
      }
      return null;
    },
    async exists(kind, id) {
      if (kind === "user") {
        const u = data.users.find((x) => x.id === id);
        return u ? { kind, id, label: u.name } : null;
      }
      if (kind === "hotel") {
        const h = data.hotels.find((x) => x.id === id);
        return h ? { kind, id, label: h.name } : null;
      }
      return null;
    },
  };
}

export function bindChannelAccounts(data: PlatformConversationsData): ChannelAccountsRepo {
  const hotelRow = (hotelId: string): ChannelAccountRecord => {
    let row = data.accounts.find((a) => a.hotelId === hotelId && a.channel === "email");
    if (!row) {
      row = { id: randomUUID(), hotelId, channel: "email", status: "off", imapHost: null, imapPort: null, lastCheckedAt: null, lastOkAt: null, lastPurgedAt: null, lastError: null };
      data.accounts.push(row);
    }
    return row;
  };
  return {
    async platformAccount(channel) {
      const a = data.accounts.find((x) => x.hotelId === null && x.channel === channel);
      return a ? copy(a) : null;
    },
    async savePlatformAccount(input) {
      let a = data.accounts.find((x) => x.hotelId === null && x.channel === "email");
      if (!a) {
        a = { id: randomUUID(), hotelId: null, channel: "email", status: "off", imapHost: null, imapPort: null, lastCheckedAt: null, lastOkAt: null, lastPurgedAt: null, lastError: null };
        data.accounts.push(a);
      }
      if (input.imapPort !== null && input.imapPort !== 993 && input.imapPort !== 143) throw new RepoError("check", "conv_channel_accounts_imap_port_check");
      Object.assign(a, input);
      return copy(a);
    },
    async setHotelReading(hotelId, on) {
      hotelRow(hotelId).status = on ? "on" : "off";
    },
    async report(hotelId, r) {
      const a = hotelId === null ? data.accounts.find((x) => x.hotelId === null && x.channel === "email") : hotelRow(hotelId);
      if (!a) return;
      a.lastCheckedAt = r.at;
      if (r.ok) a.lastOkAt = r.at;
      a.lastError = r.error;
    },
    async dueSync(now, limit) {
      const cut = now.getTime() - 6 * 3_600_000;
      return data.accounts
        .filter((a) => a.hotelId !== null && a.channel === "email" && a.status === "on" && (a.lastCheckedAt === null || a.lastCheckedAt.getTime() < cut))
        .sort((a, b) => (a.lastCheckedAt?.getTime() ?? -1) - (b.lastCheckedAt?.getTime() ?? -1))
        .slice(0, limit)
        .map((a) => a.hotelId as string);
    },
    async duePurge(today, limit) {
      return data.hotels
        .filter((h) => h.provisioned)
        .filter((h) => {
          const row = data.accounts.find((a) => a.hotelId === h.id && a.channel === "email");
          return !row || row.lastPurgedAt === null || row.lastPurgedAt.getTime() < today.getTime();
        })
        .slice(0, limit)
        .map((h) => h.id);
    },
    async markPurged(hotelId, at) {
      const row = hotelId === null ? data.accounts.find((x) => x.hotelId === null && x.channel === "email") : hotelRow(hotelId);
      if (row) row.lastPurgedAt = at;
    },
  };
}

export const bindPlatformConversations = (data: PlatformConversationsData): PlatformConversationsRepos => ({ conversations: bindConversations(data), matcher: bindPlatformMatcher(data), accounts: bindChannelAccounts(data) });

/** The platform's hub in memory: one store, and a unit that runs one piece of work at a time on it (the platform has no hotel). */
export function createMemoryPlatformConversations(): { data: () => PlatformConversationsData; unit: { run<T>(work: (repos: PlatformConversationsRepos) => Promise<T>): Promise<T>; read<T>(work: (repos: PlatformConversationsRepos) => Promise<T>): Promise<T> } } {
  const store = new MemoryStore<PlatformConversationsData>(emptyPlatformConversationsData);
  const KEY = "platform";
  const run = <T>(work: (repos: PlatformConversationsRepos) => Promise<T>): Promise<T> => store.exclusive(KEY, (d) => work(bindPlatformConversations(d)));
  return { data: () => store.dataFor(KEY), unit: { run, read: run } };
}
