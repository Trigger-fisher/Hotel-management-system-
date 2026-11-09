import "server-only";
import {
  CHANNEL_LABELS,
  channelPageCopy,
  CONV_CC_MAX,
  CONV_NOTE_MAX,
  CONV_QUICK_BODY_MAX,
  CONV_QUICK_TITLE_MAX,
  CONV_REPLY_MAX,
  CONV_SUBJECT_MAX,
  CONV_THREAD_PAGE,
  conversationsCopy,
  isWhatsAppChat,
  type ConvAccess,
  type ConvBox,
  type ConvBulkAction,
  type ConversationList,
  type ConversationThread,
  type ConvLinkKind,
  type ConvNote,
  type ConvPerson,
  type ConvSummary,
  type ConvTab,
  type EmailBody,
  type ConvMessage,
  type LinkCandidate,
  type QuickReply,
  type QuickReplyInput,
  type SyncResult,
} from "@shared/dashboards/conversations";
import { WHATSAPP_NOT_CONNECTED, whatsappCopy, type WhatsAppSettings } from "@shared/dashboards/whatsapp";
import type { Catalog } from "../../auth/catalog";
import { can, isPortalAccount } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { InboundEntry, MailFolder } from "../../conversations/channel";
import { createEmailChannel, openStoredBody, storedAttachment, type MailRef } from "../../conversations/emailChannel";
import { normaliseEmail } from "../../conversations/match";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { MAIL_FAILURE_TEXT } from "../../mail/failure";
import { EMAIL_SETTING_KEYS } from "../../mail/hotelSmtp";
import { MESSAGE_ID, type ImapClientFactory } from "../../mail/imap";
import type { HotelMailRead } from "../../mail/hotelMail";
import { hotelMailboxFromAccount, hotelMailboxFromSettings, type MailboxRead } from "../../mail/mailbox";
import { MailHostError, type HostLookup } from "../../mail/safeHost";
import { isMailAddress, MailSendError, type TransportFactory } from "../../mail/smtp";
import { isConversationsNotReady, type ChannelAccountsRepo, type ConversationRecord, type ConversationsRepos, type ConvMessageRecord } from "../../repos/conversations";
import { RepoError, type Unit } from "../../repos/types";
import type { MailAttachment } from "../auth/mail";
import type { MailFiles, MailUpload, RawObjects } from "../../mail/files";
import { mediaPrefix, openStoredMedia, type StoredMediaFile } from "../../whatsapp/media";
import type { PeopleDirectory } from "../cash/ports";
import { searchWords } from "../../validation/listQuery";
import { emailEntryOf, hotelAccess, linkOf, mailboxStateOf, mayLink, messageOf, NEEDS_UPDATE_STATE, noteOf, peopleIdsOf, previewOfText, replyChannelsOf, replySubject, replyTargetOf, rowOf, threadingOf, whatsappChannelOf, windowOfConversation, type HubAccess } from "./hub";
import { syncMailbox, type SyncOutcome, type SyncRepos } from "./mailSync";
import type { SentMailPage } from "@shared/dashboards/sentMail";
import type { ComposeBody, ConversationListQueryInput, ReplyBody, SentMailQueryInput } from "./schemas";

// Conversations, the HOTEL's hub (decision 66; docs/plans/CONVERSATIONS-PLAN-2026-10-24.md). Who may open it (A1, A2, C4), in one place:
//   - never an API key; never an account outside a hotel; never a guest or company account;
//   - inside an Enter-hotel visit only a Group Hotel Admin, and only to READ ("Read only during a visit."); the Super Admin and platform admins never (a hotel's messages are
//     private, reads included);
//   - the Hotel Admin always; anyone else needs the Conversations right: View to read, Edit to reply, assign, add notes, link, move and keep quick replies.
// The mail server is never talked to inside a transaction (mailSync.ts; a reply is sent first, then recorded). The system log names the conversation by its id and says what
// was done in fixed words: never a name, an address, a subject or any text. A missing table (hotel 0050 not run yet) answers a plain sentence, never a server error.

const C = conversationsCopy;
const MODULE = "conversations";

export interface ConversationsDeps {
  unit: Unit<ConversationsRepos>;
  people: PeopleDirectory;
  catalog: Catalog;
  now: () => Date;
  /** The key the hotel's mail password is sealed with (mail/key.ts); null = none on this server. */
  smtpKey: () => Buffer | null;
  imap: ImapClientFactory;
  createTransport?: TransportFactory;
  lookup?: HostLookup;
  sleep?: (ms: number) => Promise<void>;
  /** The hotel's active staff (assignment). */
  staff: (hotelId: string) => Promise<ConvPerson[]>;
  /** A bill's PDF as the Bills screen prints it (the bill service checks the Bills right itself). */
  billPdf?: (session: VerifiedSession, billId: string) => Promise<{ filename: string; bytes: Uint8Array }>;
  /** Sends one email as the hotel when it has no mailbox of its own (Compose): through the hotel's mail (Amazon SES as its own address). */
  /**
   * One email through the hotel's own mail (its SES address, then its group's, then the platform's), for a hotel with no mailbox of its own. With `keep`, it also returns the whole
   * email as sent (`source`), which the hub keeps in the hotel's schema (hotel 0053).
   */
  /** The address mail reaches this inbox at through Amazon SES receiving (the hotel's or group's own), or null when receiving is not set up; shown when there is no mailbox of its own. */
  sesReceivingAddress?: (hotelId: string) => Promise<string | null>;
  sendHotelMail?: (
    hotelId: string,
    mail: { to: string; cc?: readonly string[]; bcc?: readonly string[]; subject: string; text: string; inReplyTo?: string | null; references?: readonly string[]; attachments?: MailAttachment[]; bill?: boolean; keep?: { conversationId: string; cc: readonly string[] }; from?: string },
  ) => Promise<{ messageId: string; sentAt: Date; source?: Buffer; from?: string }>;
  /** The addresses this inbox may send from (My mailbox: the person's main address and the extra ones). Absent = one address only, and a chosen From is refused. */
  fromChoices?: (hotelId: string) => Promise<string[]>;
  /** Files added to an email wait here until it is sent and are removed an hour after (mail/files.ts). Absent = this server cannot keep files, and an email with files is refused with a sentence. */
  mailFiles?: MailFiles;
  /** Reads the mail queue for the "Sent through Amazon SES" list (compose/sentMail.ts); the hotel's own mail only. */
  sentMail?: (hotelId: string, q: SentMailQueryInput) => Promise<SentMailPage>;
  /** The hotel's own accounts from the Super Admin (platform.hotel_mail); its Google login, when set, is the mailbox read here. */
  dedicatedMailbox?: (hotelId: string) => Promise<HotelMailRead | null>;
  /** The platform registry of mailboxes (platform 0139): the last check, for the daily safety net. Best effort. */
  registry?: Pick<ChannelAccountsRepo, "report">;
  /** WhatsApp's state for this hotel (the live site: not connected yet until WhatsApp is switched on and the hotel has a number). */
  whatsapp?: (hotelId: string) => Promise<WhatsAppSettings>;
  /**
   * Sends one WhatsApp message as this hotel through the sender (compose/whatsappPlatformChat.ts: kill switch, 24-hour window, opt-out, consent, caps, the Rules, the hotel's pause). `by` is the staff
   * login; a refusal is `ok: false` with one plain sentence for the screen. Absent while WhatsApp is not set up: a WhatsApp reply then answers "not connected yet", as before.
   */
  whatsappSend?: (req: { hotelId: string; by: string; to: string; text: string }) => Promise<{ ok: boolean; message: string; messageId?: string }>;
  /** The bucket the guests' WhatsApp files are kept in (the hotel's own folder of it). Absent = no file is kept and none can be opened. */
  whatsappFiles?: Pick<RawObjects, "get">;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

type Need = "view" | "edit";
type Edit = Pick<ConvAccess, "canEdit" | "readOnlyReason">;

/** WhatsApp is the hotel's one shared desk (MJ, 5 Nov 2026): a WhatsApp chat is never assigned or marked done, whoever asks. */
export function refuseOnSharedDesk(c: Pick<ConversationRecord, "channels">): void {
  if (isWhatsAppChat(c.channels)) throw new AppError("VALIDATION_FAILED", C.errors.waShared);
}

/** The largest whole email kept in the hotel's schema (hotel 0053's CHECK). */
export const MAIL_SOURCE_MAX = 1024 * 1024;

/** The session the daily safety net works in for one hotel (no person, no visit). */
export const workerSession = (hotelId: string): VerifiedSession => ({ hotelId, userId: "conversations-worker", accountRole: "hotel_admin", roleId: "", roleKey: "super_admin", roleLevel: 4, permissions: {}, sessionId: "conversations-worker", client: "web" });

/** The Conversations right of this session (A1, A2): Email. Throws 403 with a plain sentence. */
export function conversationsAccess(session: VerifiedSession, catalog: Catalog, need: Need): Edit {
  return moduleAccess(session, catalog, MODULE, need);
}

/** The WhatsApp right of this session (MJ, 4 Nov 2026): the same rules as Conversations, on its own permission, so a hotel can give Email without WhatsApp. */
export function whatsappAccess(session: VerifiedSession, catalog: Catalog, need: Need): Edit {
  return moduleAccess(session, catalog, "whatsapp", need);
}

function moduleAccess(session: VerifiedSession, catalog: Catalog, module: string, need: Need): Edit {
  if (session.client === "token" || session.token !== undefined) throw new AppError("FORBIDDEN", "Guest and staff messages are not available to an API key.");
  if (session.hotelId === "") throw new AppError("FORBIDDEN", "This account is not inside a hotel. Open a hotel first, or use the console.");
  if (isPortalAccount(session)) throw new AppError("FORBIDDEN");
  if (session.visit !== undefined) {
    if (session.visit.by !== "group_hotel_admin") throw new AppError("FORBIDDEN", C.errors.visitClosed);
    if (need === "edit") throw new AppError("FORBIDDEN", C.errors.readOnlyVisit);
    return { canEdit: false, readOnlyReason: "visit" };
  }
  if (session.accountRole === "hotel_admin") return { canEdit: true, readOnlyReason: null };
  if (session.accountRole !== "hotel_user") throw new AppError("FORBIDDEN");
  if (!can(session, catalog, module, need)) throw new AppError("FORBIDDEN");
  const canEdit = can(session, catalog, module, "edit");
  return { canEdit, readOnlyReason: canEdit ? null : "view_only" };
}

/** How a stored email is found again in the mailbox. */
export function mailRefOf(m: ConvMessageRecord): MailRef {
  const folder: MailFolder = m.mailFolder ?? (m.direction === "out" ? "sent" : "inbox");
  return { mailbox: m.mailBox, folder, uid: m.mailUid, uidValidity: m.mailUidValidity, messageId: MESSAGE_ID.test(m.externalId) ? m.externalId : null, from: m.fromAddr, sentAt: m.sentAt };
}

/** A send failure as one fixed sentence (never the server's words). */
export function sendFailure(error: unknown): AppError {
  const reason = error instanceof MailHostError ? "This server address is not on the internet." : error instanceof MailSendError ? MAIL_FAILURE_TEXT[error.reason] : "The mail server did not accept the reply.";
  return new AppError("CONFLICT", C.errors.sendFailed.replace("{reason}", reason));
}

/** The checks of an email reply that need no data (lengths, addresses). */
export function checkEmailReply(input: Extract<ReplyBody, { channel: "email" }>): { text: string; cc: string[]; subject: string | undefined } {
  const text = input.text.replace(/\r\n/g, "\n");
  if (text.trim() === "") throw new AppError("VALIDATION_FAILED", C.errors.textRequired, { fields: { text: C.errors.textRequired } });
  if (text.length > CONV_REPLY_MAX) throw new AppError("VALIDATION_FAILED", C.errors.textLong, { fields: { text: C.errors.textLong } });
  const cc = (input.cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (cc.length > CONV_CC_MAX) throw new AppError("VALIDATION_FAILED", C.errors.ccMany, { fields: { cc: C.errors.ccMany } });
  if (cc.some((a) => !isMailAddress(a))) throw new AppError("VALIDATION_FAILED", C.errors.ccBad, { fields: { cc: C.errors.ccBad } });
  const subject = input.subject?.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
  if (subject !== undefined && subject.length > CONV_SUBJECT_MAX) throw new AppError("VALIDATION_FAILED", C.errors.subjectLong, { fields: { subject: C.errors.subjectLong } });
  return { text, cc, subject: subject === "" ? undefined : subject };
}

/** A quick reply's fields, checked. */
export function checkQuickReply(input: QuickReplyInput): { title: string; body: string; channel: "any" | "email" | "whatsapp"; sortOrder: number } {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1 || title.length > CONV_QUICK_TITLE_MAX) throw new AppError("VALIDATION_FAILED", C.errors.quickTitle, { fields: { title: C.errors.quickTitle } });
  if (body.length < 1 || body.length > CONV_QUICK_BODY_MAX) throw new AppError("VALIDATION_FAILED", C.errors.quickBody, { fields: { body: C.errors.quickBody } });
  return { title, body, channel: input.channel ?? "any", sortOrder: input.sortOrder ?? 0 };
}

/** A note's text, checked. */
export function checkNote(text: string): string {
  const t = text.trim();
  if (t.length < 1) throw new AppError("VALIDATION_FAILED", C.errors.noteRequired, { fields: { text: C.errors.noteRequired } });
  if (t.length > CONV_NOTE_MAX) throw new AppError("VALIDATION_FAILED", C.errors.noteLong, { fields: { text: C.errors.noteLong } });
  return t;
}

export const quickReplyOf = (q: { id: string; title: string; body: string; channel: "any" | "email" | "whatsapp"; sortOrder: number }): QuickReply => ({ id: q.id, title: q.title, body: q.body, channel: q.channel, sortOrder: q.sortOrder });

/** The source right a hotel link needs, besides Conversations Edit (A14). */
export const HOTEL_LINK_KINDS: readonly ConvLinkKind[] = ["stay", "reservation", "customer", "company"];

export function createConversationsService(deps: ConversationsDeps) {
  const { unit, catalog, now } = deps;
  const channel = createEmailChannel({ imap: deps.imap, createTransport: deps.createTransport, lookup: deps.lookup, now, sleep: deps.sleep });
  const whatsapp = (hotelId: string): Promise<WhatsAppSettings> => (deps.whatsapp ? deps.whatsapp(hotelId) : Promise.resolve(WHATSAPP_NOT_CONNECTED));
  /** Does this person hold the separate WhatsApp right (MJ, 4 Nov 2026)? Without it the inbox is Email only: no WhatsApp chat, message, file or reply. */
  const mayWhatsApp = (session: VerifiedSession, need: Need = "view"): boolean => {
    try {
      whatsappAccess(session, catalog, need);
      return true;
    } catch {
      return false;
    }
  };
  /** WhatsApp's state for this person: the hotel's, or "not connected" when they lack the WhatsApp right. */
  const whatsappFor = (session: VerifiedSession): Promise<WhatsAppSettings> => (mayWhatsApp(session) ? whatsapp(session.hotelId) : Promise.resolve(WHATSAPP_NOT_CONNECTED));

  const readMailbox = async (repos: ConversationsRepos, hotelId: string): Promise<MailboxRead> => {
    // the Google account the Super Admin saved for this hotel is its mailbox (reading on by itself); otherwise the hotel's own Settings > Email rows decide, as before
    const given = deps.dedicatedMailbox ? hotelMailboxFromAccount(await deps.dedicatedMailbox(hotelId).catch(() => null)) : null;
    if (given) return given;
    const rows = await repos.adminSettings.get(EMAIL_SETTING_KEYS);
    const name = (await repos.hotelProfile.header()).name;
    return hotelMailboxFromSettings(rows, name, hotelId, deps.smtpKey());
  };

  /** Work in the hotel's unit; a missing table becomes the plain "needs the update" sentence. */
  /** A chosen From: only one of this inbox's own addresses (fromChoices); none chosen = the inbox's usual address. */
  async function chosenFrom(hotelId: string, asked: string | undefined): Promise<string | undefined> {
    const a = (asked ?? "").trim().toLowerCase();
    if (a === "") return undefined;
    const own = deps.fromChoices ? (await deps.fromChoices(hotelId)).map((x) => x.toLowerCase()) : [];
    if (!own.includes(a)) throw new AppError("FORBIDDEN", C.errors.fromNotOwn, { fields: { from: C.errors.fromNotOwn } });
    return a;
  }

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isConversationsNotReady(error)) throw new AppError("CONFLICT", C.errors.needsUpdate);
      throw error;
    }
  }

  const actorName = async (session: VerifiedSession): Promise<string> => (await deps.people.get([session.userId])).get(session.userId)?.name ?? "System";

  /** The system log line of a change: fixed words and the conversation's id only. */
  const audit = async (repos: ConversationsRepos, session: VerifiedSession, meta: RequestMeta, summary: string, conversationId: string | null, action: "created" | "updated" | "deleted" = "updated"): Promise<void> => {
    await repos.systemLogs.write({ module: MODULE, action, entity: "Conversation", subjectId: conversationId, subjectLabel: conversationId ? "Conversation" : null, summary, details: null, userId: session.userId, userName: await actorName(session), ipAddress: meta.ip, traceId: meta.traceId });
  };

  async function threadIn(repos: ConversationsRepos, session: VerifiedSession, c: ConversationRecord, access: HubAccess, before?: Date): Promise<ConversationThread> {
    const [{ rows, hasOlder }, notes, detail, mailbox, wa] = await Promise.all([
      repos.conversations.messages(c.id, { before, limit: CONV_THREAD_PAGE }),
      repos.conversations.notes(c.id),
      c.contact.link ? repos.matcher.details(c.contact.link) : Promise.resolve(null),
      readMailbox(repos, session.hotelId),
      whatsappFor(session),
    ]);
    const people = await deps.people.get(peopleIdsOf([c, ...rows, ...notes]));
    const { replyChannels, defaultChannel } = replyChannelsOf(c, mailbox, wa);
    return {
      id: c.id,
      contact: { name: c.contact.displayName?.trim() || (c.contact.handles[0]?.value ?? C.unknown), handles: c.contact.handles.map((h) => h.value), muted: c.contact.muted },
      links: c.contact.link ? [linkOf(c.contact.link, detail, access)] : [],
      status: c.status,
      box: c.box,
      assignedTo: c.assignedTo ? { id: c.assignedTo, name: people.get(c.assignedTo)?.name ?? "Former staff" } : null,
      unread: c.unreadCount,
      messages: rows.filter((m) => m.channel !== "whatsapp" || mayWhatsApp(session)).map((m) => messageOf(m, people)),
      hasOlder,
      notes: notes.map((n) => noteOf(n, people, session.userId)),
      window: windowOfConversation(c, now()),
      replyChannels,
      defaultChannel,
      access: { canEdit: access.canEdit, readOnlyReason: access.readOnlyReason, canSeeStay: access.canSeeStay, canSeeBills: access.canSeeBills, canLink: access.canLink },
      replyTo: replyTargetOf(rows, c.contact.handles),
      // the Email page's extras (hotel 0052), so the open thread's star and label menu show what is on (a label change sends the whole list)
      starred: c.starred ?? false,
      labels: [...(c.labels ?? [])],
    };
  }

  const getOr404 = async (repos: ConversationsRepos, id: string, session?: VerifiedSession): Promise<ConversationRecord> => {
    const c = await repos.conversations.get(id);
    if (!c) throw new AppError("NOT_FOUND");
    // a chat that is WhatsApp only does not exist for a person without the WhatsApp right
    if (session && !c.channels.includes("email") && !mayWhatsApp(session)) throw new AppError("NOT_FOUND");
    return c;
  };

  /** A change that answers the thread as it is after it (one unit), logged in fixed words. */
  async function change(session: VerifiedSession, id: string, meta: RequestMeta, work: (repos: ConversationsRepos, c: ConversationRecord) => Promise<string | null>): Promise<ConversationThread> {
    const edit = conversationsAccess(session, catalog, "edit");
    const access = hotelAccess(session, catalog, edit);
    return guarded(() =>
      unit.run(session, async (repos) => {
        const c = await getOr404(repos, id);
        const summary = await work(repos, c);
        if (summary) await audit(repos, session, meta, summary, c.id);
        return threadIn(repos, session, await getOr404(repos, id), access);
      }),
    );
  }

  /** The mailbox state, with the address that receives through Amazon SES when there is no mailbox of its own (the page then says Connected). */
  const withReceiving = async (state: ReturnType<typeof mailboxStateOf>, mailbox: MailboxRead, hotelId: string): Promise<ReturnType<typeof mailboxStateOf>> => {
    if (mailbox.config || !deps.sesReceivingAddress) return state;
    const address = await deps.sesReceivingAddress(hotelId).catch(() => null);
    return address ? { ...state, receivingAddress: address } : state;
  };

  async function summaryOf(session: VerifiedSession): Promise<ConvSummary> {
    const wa = whatsappChannelOf(await whatsappFor(session));
    try {
      return await unit.run(session, async (repos) => {
        const [unread, mailbox, positions] = await Promise.all([repos.conversations.unreadTotal(), readMailbox(repos, session.hotelId), repos.conversations.positions()]);
        return { unread, mailbox: await withReceiving(mailboxStateOf(mailbox, positions), mailbox, session.hotelId), whatsapp: wa };
      });
    } catch (error) {
      if (isConversationsNotReady(error)) return { unread: 0, mailbox: NEEDS_UPDATE_STATE, whatsapp: wa };
      throw error;
    }
  }

  /** One mail check of this hotel's mailbox (screens, the badge's poll and the daily safety net). */
  async function syncHotel(session: VerifiedSession, o: { force?: boolean; background?: boolean; budgetMs?: number }): Promise<SyncOutcome> {
    const outcome = await syncMailbox<ConversationsRepos>({
      target: { run: (work) => unit.run(session, work), mailbox: (repos) => readMailbox(repos, session.hotelId) },
      channel,
      now,
      force: o.force,
      background: o.background,
      budgetMs: o.budgetMs,
      log: (message, fields) => deps.log?.(message, { ...fields, hotelId: session.hotelId }),
    });
    if (outcome.checked && deps.registry) await deps.registry.report(session.hotelId, { at: now(), ok: outcome.error === null, error: outcome.error }).catch(() => undefined);
    return outcome;
  }

  let lastSweep = 0;
  const filesOrRefuse = (): MailFiles => {
    if (!deps.mailFiles) throw new AppError("CONFLICT", "Files cannot be added to an email on this server yet.");
    return deps.mailFiles;
  };

  return {
    /** A file is about to be added to an email: checked by the Gmail rules, then the address the browser sends it to (straight to the bucket). Conversations Edit. */
    async beginFile(session: VerifiedSession, file: { name: string; size: number }): Promise<MailUpload> {
      conversationsAccess(session, catalog, "edit");
      const upload = await filesOrRefuse().begin(session.hotelId, file);
      // the clean-up also runs here, at most every 10 minutes, so a quiet cron leaves nothing behind for long (best effort: a failure never stops the upload).
      // It is awaited: a function on Vercel is frozen once it has answered, so a sweep left running in the background never finished.
      if (now().getTime() - lastSweep >= 10 * 60 * 1000) {
        lastSweep = now().getTime();
        await filesOrRefuse().sweep().catch(() => undefined);
      }
      return upload;
    },

    /** The file itself, when the server has no bucket to send it to (a local disk). */
    async receiveFile(session: VerifiedSession, ref: string, bytes: Uint8Array): Promise<void> {
      conversationsAccess(session, catalog, "edit");
      await filesOrRefuse().receive(session.hotelId, ref, bytes);
    },

    /** The cron's hourly clean-up: files one hour after their email went, and files never sent after a day. */
    async sweepFiles(): Promise<{ removed: number; folders: number }> {
      return deps.mailFiles ? deps.mailFiles.sweep() : { removed: 0, folders: 0 };
    },

    /** The "Sent through Amazon SES" list of this hotel's Email page: its own mail only (never another hotel's), for anyone who may see Conversations. */
    async sentMail(session: VerifiedSession, q: SentMailQueryInput): Promise<SentMailPage> {
      conversationsAccess(session, catalog, "view");
      return deps.sentMail ? deps.sentMail(session.hotelId, q) : { rows: [], total: 0, page: q.page, size: q.size };
    },

    async list(session: VerifiedSession, q: ConversationListQueryInput): Promise<ConversationList> {
      conversationsAccess(session, catalog, "view");
      const wa = whatsappChannelOf(await whatsappFor(session));
      // without the WhatsApp right the list is Email only, whatever the page asked for
      const channel = mayWhatsApp(session) ? q.channel : "email";
      return guarded(() =>
        unit.run(session, async (repos) => {
          const words = searchWords(q.search);
          const tab = q.tab as ConvTab;
          const [page, counts, folderCounts, mailbox, positions] = await Promise.all([
            repos.conversations.list({ words, tab, channel, me: session.userId, page: q.page, pageSize: q.size, ...(q.folder ? { folder: q.folder } : {}), ...(q.label ? { label: q.label } : {}), ...(q.address && deps.fromChoices ? { address: q.address } : {}) }),
            repos.conversations.counts({ words, channel, me: session.userId }),
            repos.conversations.folderCounts({ words, channel, me: session.userId }),
            readMailbox(repos, session.hotelId),
            repos.conversations.positions(),
          ]);
          const people = await deps.people.get(peopleIdsOf(page.rows));
          return { items: page.rows.map((r) => rowOf(r, people)), page: q.page, size: q.size, total: page.total, counts, folderCounts, mailbox: await withReceiving(mailboxStateOf(mailbox, positions), mailbox, session.hotelId), whatsapp: wa };
        }),
      );
    },

    /** The menu badge: answers 200 even before hotel 0050 (the "needs update" state), so the poll can stop by itself. */
    async summary(session: VerifiedSession): Promise<ConvSummary> {
      conversationsAccess(session, catalog, "view");
      return summaryOf(session);
    },

    /** "Check now", the page's minute check and the badge's background poll (one request: the answer carries the summary). Never a check during a visit. */
    async sync(session: VerifiedSession, input: { background?: boolean }): Promise<SyncResult> {
      const edit = conversationsAccess(session, catalog, "view");
      if (edit.readOnlyReason === "visit") return { checked: false, added: 0, ...(await summaryOf(session)) };
      let outcome: SyncOutcome | null = null;
      try {
        outcome = await syncHotel(session, { background: input.background === true });
      } catch (error) {
        if (!isConversationsNotReady(error)) throw error;
      }
      return { checked: outcome?.checked ?? false, added: outcome?.added ?? 0, ...(await summaryOf(session)) };
    },

    async thread(session: VerifiedSession, id: string, before?: string): Promise<ConversationThread> {
      const access = hotelAccess(session, catalog, conversationsAccess(session, catalog, "view"));
      return guarded(() => unit.run(session, async (repos) => threadIn(repos, session, await getOr404(repos, id, session), access, before ? new Date(before) : undefined)));
    },

    async emailBody(session: VerifiedSession, id: string, messageId: string, o: { images: boolean }): Promise<EmailBody> {
      const access = hotelAccess(session, catalog, conversationsAccess(session, catalog, "view"));
      const { m, source, mailbox } = await guarded(() =>
        unit.run(session, async (repos) => {
          await getOr404(repos, id);
          const m = await repos.conversations.message(id, messageId);
          // the whole email kept in the hotel's own schema (hotel 0053) opens without any mail server
          return { m, source: m ? await repos.conversations.mailSource(m.id) : null, mailbox: await readMailbox(repos, session.hotelId) };
        }),
      );
      if (!m || m.channel !== "email") throw new AppError("NOT_FOUND");
      if (source) return { id: m.id, ...(await openStoredBody(source, mailRefOf(m), { canSeeBills: access.canSeeBills, showImages: o.images })) };
      if (!mailbox.config) throw new AppError("CONFLICT", C.errors.noMailbox);
      const body = await channel.openBody(mailbox.config, mailRefOf(m), { canSeeBills: access.canSeeBills, showImages: o.images });
      return { id: m.id, ...body };
    },

    async attachment(session: VerifiedSession, id: string, messageId: string, part: number): Promise<{ bytes: Uint8Array; type: string; name: string }> {
      const access = hotelAccess(session, catalog, conversationsAccess(session, catalog, "view"));
      const { m, source, mailbox } = await guarded(() =>
        unit.run(session, async (repos) => {
          await getOr404(repos, id);
          const m = await repos.conversations.message(id, messageId);
          return { m, source: m ? await repos.conversations.mailSource(m.id) : null, mailbox: await readMailbox(repos, session.hotelId) };
        }),
      );
      if (!m || m.channel !== "email" || !m.hasAttachments) throw new AppError("NOT_FOUND");
      if (source) return storedAttachment(source, part, { canSeeBills: access.canSeeBills });
      if (!mailbox.config) throw new AppError("CONFLICT", C.errors.noMailbox);
      return channel.attachment(mailbox.config, mailRefOf(m), part, { canSeeBills: access.canSeeBills });
    },

    /** A guest's photo, voice note, video or document from WhatsApp, kept in the hotel's own folder of the bucket (whatsapp/media.ts). WhatsApp View. */
    async whatsappMedia(session: VerifiedSession, id: string, messageId: string): Promise<StoredMediaFile> {
      whatsappAccess(session, catalog, "view");
      if (!deps.whatsappFiles) throw new AppError("NOT_FOUND");
      const m = await guarded(() =>
        unit.run(session, async (repos) => {
          await getOr404(repos, id);
          return repos.conversations.message(id, messageId);
        }),
      );
      if (!m || m.channel !== "whatsapp") throw new AppError("NOT_FOUND");
      const file = await openStoredMedia(deps.whatsappFiles, m.waMedia, mediaPrefix({ kind: "hotel", hotelId: session.hotelId }));
      if (file === "gone") throw new AppError("NOT_FOUND", "This file is no longer kept. WhatsApp files are kept for a limited time.");
      if (!file) throw new AppError("NOT_FOUND");
      return file;
    },

    /** A reply: email through the hotel's OWN mail server (outside any unit, then recorded with who sent it), or WhatsApp through the sender as this hotel (free text inside the 24-hour window). */
    async reply(session: VerifiedSession, id: string, input: ReplyBody, meta: RequestMeta): Promise<ConvMessage> {
      const access = hotelAccess(session, catalog, input.channel === "whatsapp" ? whatsappAccess(session, catalog, "edit") : conversationsAccess(session, catalog, "edit"));
      if (input.channel === "whatsapp") {
        // a template outside the window comes with the hotel's templates (phase 3); until then the sender's refusal ("the 24-hour window is closed") is what the screen shows
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!deps.whatsappSend || !(await whatsapp(session.hotelId)).connected) throw new AppError("CONFLICT", whatsappCopy.notAvailableWrite);
        if (text === "") throw new AppError("VALIDATION_FAILED", undefined, { fields: { text: "Write a message first" } });
        const conv = await guarded(() => unit.run(session, (repos) => getOr404(repos, id)));
        const phone = conv.contact.handles.find((h) => h.kind === "phone")?.value;
        if (!phone) throw new AppError("CONFLICT", "This person has no WhatsApp number on file.");
        const sent = await deps.whatsappSend({ hotelId: session.hotelId, by: session.userId, to: phone, text });
        if (!sent.ok || !sent.messageId) throw new AppError("CONFLICT", sent.message);
        return guarded(() =>
          unit.run(session, async (repos) => {
            const row = await repos.conversations.message(id, sent.messageId as string);
            if (!row) throw new AppError("NOT_FOUND");
            return messageOf(row, await deps.people.get([session.userId]));
          }),
        );
      }
      const checked = checkEmailReply(input);
      const from = await chosenFrom(session.hotelId, input.from);
      const facts = await guarded(() =>
        unit.run(session, async (repos) => {
          const c = await getOr404(repos, id);
          const original = input.inReplyTo ? await repos.conversations.message(id, input.inReplyTo) : [...(await repos.conversations.messages(id, { limit: CONV_THREAD_PAGE })).rows].reverse().find((m) => m.channel === "email") ?? null;
          if (input.inReplyTo && (!original || original.channel !== "email")) throw new AppError("NOT_FOUND");
          // the bill the server will attach is the linked record's own bill, whatever id the screen sent
          const linkedBillId = input.billId && c.contact.link ? ((await repos.matcher.details(c.contact.link))?.billId ?? null) : null;
          return { c, original, linkedBillId, mailbox: await readMailbox(repos, session.hotelId) };
        }),
      );
      const { c, original, linkedBillId, mailbox } = facts;
      // no Google mailbox of its own: the reply goes out through the hotel's mail (its SES address, then the group's and the platform's), like Compose
      if (!mailbox.config && !deps.sendHotelMail) throw new AppError("CONFLICT", C.errors.noMailbox);
      const handles = c.contact.handles.filter((h) => h.kind === "email").map((h) => h.value);
      // A12: the reply goes to the original's From; its Reply-To or another of the contact's own addresses only when chosen on purpose
      const defaultTo = original ? (original.direction === "in" ? original.fromAddr : original.toAddrs[0] ?? null) : handles[0] ?? null;
      const asked = input.to ? normaliseEmail(input.to) : null;
      if (input.to && !asked) throw new AppError("VALIDATION_FAILED", C.errors.recipient, { fields: { to: C.errors.recipient } });
      const allowed = new Set([original?.fromAddr, original?.replyToAddr, ...(original?.direction === "out" ? original.toAddrs : []), ...handles].filter((a): a is string => typeof a === "string" && a !== "").map((a) => a.toLowerCase()));
      const to = asked ?? defaultTo;
      if (!to) throw new AppError("CONFLICT", C.reply.noEmail);
      if (asked && !allowed.has(asked)) throw new AppError("VALIDATION_FAILED", C.errors.recipient, { fields: { to: C.errors.recipient } });
      // a bill goes only to the linked guest's own address, and only with the Bills right
      let attachments: MailAttachment[] | undefined;
      if (input.billId) {
        if (!access.canSeeBills) throw new AppError("FORBIDDEN", C.errors.billLocked);
        if (!c.contact.link || !handles.includes(to) || linkedBillId !== input.billId) throw new AppError("FORBIDDEN", C.errors.billOwn);
        if (!deps.billPdf) throw new AppError("CONFLICT", "Bills cannot be attached on this server.");
        const pdf = await deps.billPdf(session, input.billId);
        attachments = [{ filename: pdf.filename, contentType: "application/pdf", content: Buffer.from(pdf.bytes) }];
      }
      const subject = checked.subject ?? replySubject(original?.subject);
      const threading = threadingOf(original);
      if (mailbox.config && from) throw new AppError("FORBIDDEN", C.errors.fromNotOwn, { fields: { from: C.errors.fromNotOwn } });
      let sent: { messageId: string; sentAt: Date; source?: Buffer; from?: string };
      try {
        if (mailbox.config) {
          sent = await channel.send(mailbox.config, { conversationId: c.id, to, cc: checked.cc, subject, text: checked.text, inReplyTo: threading.inReplyTo, references: threading.references, attachments, bill: attachments !== undefined });
        } else {
          const sendAsHotel = deps.sendHotelMail as NonNullable<typeof deps.sendHotelMail>;
          const mail = { subject, text: checked.text, inReplyTo: threading.inReplyTo, references: threading.references, ...(attachments ? { attachments } : {}) };
          // ONE email with a real Cc header (MJ, 3 Nov 2026): the person written to sees who else got it. It also makes the copy kept in the hotel's schema (no Sent folder holds it)
          sent = await sendAsHotel(session.hotelId, { to, ...(checked.cc.length > 0 ? { cc: checked.cc } : {}), ...mail, keep: { conversationId: c.id, cc: checked.cc }, ...(from ? { from } : {}) });
        }
      } catch (error) {
        deps.log?.("conversation reply not sent", { hotelId: session.hotelId, code: error instanceof MailSendError ? error.reason : error instanceof MailHostError ? error.code : "UNKNOWN" });
        // a sentence the sender already wrote (a person's mailbox, a paused group) is shown as it is; any other failure becomes the fixed "could not be sent: <reason>" line
        throw error instanceof AppError ? error : sendFailure(error);
      }
      return guarded(() =>
        unit.run(session, async (repos) => {
          const row = await repos.conversations.recordOutgoing(c.id, {
            channel: "email",
            externalId: sent.messageId,
            sentAt: sent.sentAt,
            sentBy: session.userId,
            status: "sent",
            preview: previewOfText(checked.text),
            mailBox: mailbox.config?.address ?? null,
            subject,
            fromAddr: mailbox.config?.address ?? sent.from ?? null,
            toAddrs: [to],
            ccAddrs: checked.cc,
            inReplyTo: threading.inReplyTo,
            referenceIds: [...threading.references, ...(threading.inReplyTo ? [threading.inReplyTo] : [])].slice(-20),
            hasAttachments: attachments !== undefined,
            hasBill: attachments !== undefined,
          });
          if (sent.source) await repos.conversations.saveMailSource(row.id, sent.source);
          await audit(repos, session, meta, "Reply sent", c.id, "created");
          const people = await deps.people.get([session.userId]);
          return emailEntryOf(row, people);
        }),
      );
    },

    async patch(session: VerifiedSession, id: string, body: { assignedTo?: string | null; status?: "open" | "done"; box?: ConvBox; starred?: boolean; labels?: string[]; snoozedUntil?: string | null }, meta: RequestMeta): Promise<ConversationThread> {
      // the Email page's star, labels and snooze (hotel 0052)
      if (body.starred !== undefined) {
        const on = body.starred;
        return change(session, id, meta, async (repos, c) => {
          await repos.conversations.setExtras(c.id, { starred: on });
          return null;
        });
      }
      if (body.labels !== undefined) {
        const labels = CHANNEL_LABELS.filter((l) => body.labels?.includes(l));
        return change(session, id, meta, async (repos, c) => {
          await repos.conversations.setExtras(c.id, { labels });
          return "Labels changed";
        });
      }
      if (body.snoozedUntil !== undefined) {
        const until = body.snoozedUntil === null ? null : new Date(body.snoozedUntil);
        if (until && until.getTime() <= now().getTime()) throw new AppError("VALIDATION_FAILED", "Choose a time in the future.", { fields: { snoozedUntil: "Choose a time in the future." } });
        return change(session, id, meta, async (repos, c) => {
          await repos.conversations.setExtras(c.id, { snoozedUntil: until });
          return until ? "Snoozed" : "Snooze ended";
        });
      }
      if (body.assignedTo !== undefined) {
        const userId = body.assignedTo;
        conversationsAccess(session, catalog, "edit");
        if (userId !== null && !(await deps.staff(session.hotelId)).some((p) => p.id === userId)) throw new AppError("VALIDATION_FAILED", C.errors.notStaff, { fields: { assignedTo: C.errors.notStaff } });
        return change(session, id, meta, async (repos, c) => {
          refuseOnSharedDesk(c);
          await repos.conversations.setAssignee(c.id, userId, session.userId, now());
          return userId ? "Conversation assigned" : "Conversation unassigned";
        });
      }
      if (body.status !== undefined) {
        const status = body.status;
        return change(session, id, meta, async (repos, c) => {
          refuseOnSharedDesk(c);
          await repos.conversations.setStatus(c.id, status);
          return status === "done" ? "Marked done" : "Reopened";
        });
      }
      const box = body.box ?? "main";
      return change(session, id, meta, async (repos, c) => {
        await repos.conversations.setBox(c.id, box);
        return box === "other" ? "Moved to Other" : "Moved to main list";
      });
    },

    /** The Email page's bulk actions on the ticked conversations (at most 100). One system log line for the lot. */
    async bulk(session: VerifiedSession, ids: readonly string[], action: ConvBulkAction, meta: RequestMeta): Promise<{ changed: number }> {
      conversationsAccess(session, catalog, "edit");
      return guarded(() =>
        unit.run(session, async (repos) => {
          let changed = 0;
          const r = repos.conversations;
          for (const id of new Set(ids)) {
            const c = await r.get(id);
            if (!c || ((action === "done" || action === "reopen") && isWhatsAppChat(c.channels))) continue;
            changed += 1;
            if (action === "snooze") await r.setExtras(id, { snoozedUntil: new Date(now().getTime() + 3 * 3_600_000) });
            else if (action === "read") await r.markRead(id);
            else if (action === "unread") await r.markUnread(id);
            else if (action === "done") await r.setStatus(id, "done");
            else if (action === "reopen") {
              await r.setStatus(id, "open");
              await r.setBox(id, "main");
            } else if (action === "star" || action === "unstar") await r.setExtras(id, { starred: action === "star" });
            else if (action === "other" || action === "main") await r.setBox(id, action);
            else if (action === "trash") await r.setExtras(id, { trashed: true });
          }
          if (changed > 0) await audit(repos, session, meta, `Bulk action ${action} on ${changed} conversation${changed === 1 ? "" : "s"}`, null);
          return { changed };
        }),
      );
    },

    /**
     * Compose (Gmail's): a new email to anyone, or its draft. It goes out through the hotel's own mailbox when one is connected (like a reply), otherwise through the hotel's mail
     * (Amazon SES, its own address); either way it is kept in the person's conversation, so Sent shows it. A draft is kept on the conversation until it is sent.
     */
    async compose(session: VerifiedSession, input: ComposeBody, meta: RequestMeta): Promise<{ id: string }> {
      conversationsAccess(session, catalog, "edit");
      const F = channelPageCopy.email.composeForm;
      const to = normaliseEmail(input.to.trim());
      const cc = (input.cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
      // Bcc (Gmail's): delivered to these addresses and written in no header; a Bcc that is also the To or a Cc is dropped (it already gets the mail)
      const bcc = (input.bcc ?? []).map((a) => a.trim().toLowerCase()).filter((a, i, all) => a !== "" && all.indexOf(a) === i && a !== to && !cc.includes(a));
      const fields: Record<string, string> = {};
      if (input.to.trim() === "") fields.to = F.toRequired;
      else if (!to) fields.to = F.toBad;
      if (cc.some((a) => !isMailAddress(a))) fields.cc = C.errors.ccBad;
      if (bcc.some((a) => !isMailAddress(a))) fields.bcc = C.errors.ccBad;
      const text = input.text.replace(/\r\n/g, "\n");
      if (!input.draft && text.trim() === "") fields.text = F.bodyRequired;
      if (text.length > CONV_REPLY_MAX) fields.text = C.errors.textLong;
      const subject = input.subject.replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, CONV_SUBJECT_MAX) || F.noSubject;
      if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
      const from = input.draft ? undefined : await chosenFrom(session.hotelId, input.from);
      const address = to as string;
      const { id, mailbox } = await guarded(() =>
        unit.run(session, async (repos) => {
          const conversationId = await repos.conversations.conversationForAddress(address, now());
          if (input.draft) {
            await repos.conversations.setExtras(conversationId, { draft: { to: address, cc, subject, text, at: now().toISOString() } });
            await audit(repos, session, meta, "Draft saved", conversationId);
          }
          return { id: conversationId, mailbox: input.draft ? null : await readMailbox(repos, session.hotelId) };
        }),
      );
      if (input.draft) return { id };
      // Files added to the email (MJ, 2 Nov 2026): read from the bucket, sent as ordinary attachments, removed an hour after the send (mail/files.ts)
      const refs = input.attachments ?? [];
      let files: MailAttachment[] | undefined;
      if (refs.length > 0) {
        if (!deps.mailFiles) throw new AppError("CONFLICT", "Files cannot be added to an email on this server yet.");
        files = await deps.mailFiles.load(session.hotelId, refs);
      }
      const withFiles = files ? { attachments: files, bill: false } : {};
      let sent: { messageId: string; sentAt: Date; source?: Buffer; from?: string };
      let fromAddr: string | null = null;
      if (mailbox?.config && from) throw new AppError("FORBIDDEN", C.errors.fromNotOwn, { fields: { from: C.errors.fromNotOwn } });
      try {
        if (mailbox?.config) {
          sent = await channel.send(mailbox.config, { conversationId: id, to: address, cc, ...(bcc.length > 0 ? { bcc } : {}), subject, text, inReplyTo: null, references: [], attachments: files, bill: false });
          fromAddr = mailbox.config.address;
        } else if (deps.sendHotelMail) {
          // no mailbox of its own: the hotel's mail (its own SES address), ONE email with a real Cc header; the whole email is kept in the hotel's schema (hotel 0053)
          sent = await deps.sendHotelMail(session.hotelId, { to: address, ...(cc.length > 0 ? { cc } : {}), ...(bcc.length > 0 ? { bcc } : {}), subject, text, ...withFiles, keep: { conversationId: id, cc }, ...(from ? { from } : {}) });
          fromAddr = sent.from ?? null;
        } else throw new AppError("CONFLICT", C.errors.noMailbox);
      } catch (error) {
        if (error instanceof AppError) throw error;
        deps.log?.("compose not sent", { hotelId: session.hotelId, code: error instanceof MailSendError ? error.reason : error instanceof MailHostError ? error.code : "UNKNOWN" });
        throw sendFailure(error);
      }
      // the email went: its files are removed one hour from now (a failed send keeps them for the retry; the sweep removes an unsent file after a day)
      if (files) await deps.mailFiles?.markSent(session.hotelId, refs);
      return guarded(() =>
        unit.run(session, async (repos) => {
          const row = await repos.conversations.recordOutgoing(id, {
            channel: "email",
            externalId: sent.messageId,
            sentAt: sent.sentAt,
            sentBy: session.userId,
            status: "sent",
            preview: previewOfText(text),
            mailBox: fromAddr,
            subject,
            fromAddr,
            toAddrs: [address],
            ccAddrs: cc,
            inReplyTo: null,
            referenceIds: [],
            hasAttachments: files !== undefined,
            hasBill: false,
          });
          if (sent.source) await repos.conversations.saveMailSource(row.id, sent.source);
          await repos.conversations.setExtras(id, { draft: null });
          await audit(repos, session, meta, "Email sent", id, "created");
          return { id };
        }),
      );
    },

    async setMuted(session: VerifiedSession, id: string, on: boolean, meta: RequestMeta): Promise<ConversationThread> {
      return change(session, id, meta, async (repos, c) => {
        await repos.conversations.setMuted(c.contactId, on);
        if (!on && !c.contact.link) await repos.conversations.setBox(c.id, "main");
        return on ? "Sender always to Other" : "Sender no longer moved to Other";
      });
    },

    /** Read / unread is shared by the team (A9). Reading needs View; never during a visit (it is a change). */
    async setRead(session: VerifiedSession, id: string, read: boolean): Promise<ConversationThread> {
      const edit = conversationsAccess(session, catalog, "view");
      if (edit.readOnlyReason === "visit") throw new AppError("FORBIDDEN", C.errors.readOnlyVisit);
      const access = hotelAccess(session, catalog, edit);
      return guarded(() =>
        unit.run(session, async (repos) => {
          const c = await getOr404(repos, id);
          if (read) await repos.conversations.markRead(c.id);
          else await repos.conversations.markUnread(c.id);
          return threadIn(repos, session, await getOr404(repos, id), access);
        }),
      );
    },

    async addNote(session: VerifiedSession, id: string, text: string, meta: RequestMeta): Promise<ConvNote> {
      conversationsAccess(session, catalog, "edit");
      const body = checkNote(text);
      return guarded(() =>
        unit.run(session, async (repos) => {
          const c = await getOr404(repos, id);
          const n = await repos.conversations.addNote(c.id, session.userId, body, now());
          await audit(repos, session, meta, "Note added", c.id, "created");
          return noteOf(n, await deps.people.get([session.userId]), session.userId);
        }),
      );
    },

    async deleteNote(session: VerifiedSession, id: string, noteId: string, meta: RequestMeta): Promise<{ removed: true }> {
      conversationsAccess(session, catalog, "edit");
      return guarded(() =>
        unit.run(session, async (repos) => {
          const c = await getOr404(repos, id);
          const n = await repos.conversations.note(c.id, noteId);
          if (!n) throw new AppError("NOT_FOUND");
          if (n.authorId !== session.userId && session.accountRole !== "hotel_admin") throw new AppError("FORBIDDEN", C.errors.noteNotYours);
          await repos.conversations.removeNote(c.id, n.id);
          await audit(repos, session, meta, "Note removed", c.id, "deleted");
          return { removed: true as const };
        }),
      );
    },

    /** "Link guest" (A14): Conversations Edit and the view right of the record's own module. */
    async setLink(session: VerifiedSession, id: string, link: { kind: ConvLinkKind; targetId: string }, meta: RequestMeta): Promise<ConversationThread> {
      const access = hotelAccess(session, catalog, conversationsAccess(session, catalog, "edit"));
      if (!HOTEL_LINK_KINDS.includes(link.kind) || !mayLink(access, link.kind)) throw new AppError("FORBIDDEN");
      return change(session, id, meta, async (repos, c) => {
        const target = await repos.matcher.exists(link.kind, link.targetId);
        if (!target) throw new AppError("NOT_FOUND");
        await repos.conversations.setLink(c.contactId, { kind: link.kind, id: target.id, source: "manual" }, session.userId, now());
        return "Guest linked";
      });
    },

    async clearLink(session: VerifiedSession, id: string, meta: RequestMeta): Promise<ConversationThread> {
      return change(session, id, meta, async (repos, c) => {
        if (!c.contact.link) return null;
        await repos.conversations.clearLink(c.contactId);
        return "Link removed";
      });
    },

    /** What "Link guest" may offer: only the kinds this viewer may link to; nothing without Edit. */
    async linkCandidates(session: VerifiedSession, search: string | undefined, kind?: ConvLinkKind): Promise<LinkCandidate[]> {
      const access = hotelAccess(session, catalog, conversationsAccess(session, catalog, "view"));
      const kinds = access.canLink.filter((k) => kind === undefined || k === kind);
      const words = searchWords(search);
      if (kinds.length === 0 || words.length === 0) return [];
      const found = await guarded(() => unit.run(session, (repos) => repos.matcher.search(words, kinds)));
      return found.map((r) => ({ kind: r.kind, id: r.id, label: r.label, ...(r.detail ? { detail: r.detail } : {}) }));
    },

    async staff(session: VerifiedSession): Promise<ConvPerson[]> {
      conversationsAccess(session, catalog, "view");
      return deps.staff(session.hotelId);
    },

    async quickReplies(session: VerifiedSession): Promise<QuickReply[]> {
      conversationsAccess(session, catalog, "view");
      return guarded(() => unit.run(session, async (repos) => (await repos.conversations.quickReplies()).map(quickReplyOf)));
    },

    async addQuickReply(session: VerifiedSession, input: QuickReplyInput, meta: RequestMeta): Promise<QuickReply> {
      conversationsAccess(session, catalog, "edit");
      const q = checkQuickReply(input);
      return guarded(() =>
        unit.run(session, async (repos) => {
          try {
            const made = await repos.conversations.addQuickReply(q, session.userId);
            await audit(repos, session, meta, "Quick reply saved", null, "created");
            return quickReplyOf(made);
          } catch (error) {
            if (error instanceof RepoError && error.kind === "unique") throw new AppError("CONFLICT", C.errors.quickTaken, { fields: { title: C.errors.quickTaken } });
            throw error;
          }
        }),
      );
    },

    async updateQuickReply(session: VerifiedSession, quickId: string, input: QuickReplyInput, meta: RequestMeta): Promise<QuickReply> {
      conversationsAccess(session, catalog, "edit");
      const q = checkQuickReply(input);
      return guarded(() =>
        unit.run(session, async (repos) => {
          try {
            const saved = await repos.conversations.updateQuickReply(quickId, q);
            if (!saved) throw new AppError("NOT_FOUND");
            await audit(repos, session, meta, "Quick reply saved", null);
            return quickReplyOf(saved);
          } catch (error) {
            if (error instanceof RepoError && error.kind === "unique") throw new AppError("CONFLICT", C.errors.quickTaken, { fields: { title: C.errors.quickTaken } });
            throw error;
          }
        }),
      );
    },

    async deleteQuickReply(session: VerifiedSession, quickId: string, meta: RequestMeta): Promise<{ removed: true }> {
      conversationsAccess(session, catalog, "edit");
      return guarded(() =>
        unit.run(session, async (repos) => {
          if (!(await repos.conversations.removeQuickReply(quickId))) throw new AppError("NOT_FOUND");
          await audit(repos, session, meta, "Quick reply removed", null, "deleted");
          return { removed: true as const };
        }),
      );
    },

    async whatsapp(session: VerifiedSession): Promise<WhatsAppSettings> {
      whatsappAccess(session, catalog, "view");
      return whatsapp(session.hotelId);
    },

    /** The automatic WhatsApp messages: not before the Meta integration (409). */
    async setWhatsAppAutomatic(session: VerifiedSession): Promise<WhatsAppSettings> {
      whatsappAccess(session, catalog, "edit");
      throw new AppError("CONFLICT", whatsappCopy.notAvailableWrite);
    },

    /** The daily safety net: one hotel's mail check (forced: the throttle does not apply, the lease does). Not reachable from a route. */
    async syncForWorker(hotelId: string, o: { budgetMs: number }): Promise<SyncOutcome> {
      return syncHotel(workerSession(hotelId), { force: true, budgetMs: o.budgetMs });
    },

    /** Mail that reached the hotel through Amazon SES receiving (mail/inbound.ts, the mail-inbound route): taken into the hub like mail read by IMAP. Not reachable from a session route. */
    async receiveForWorker(hotelId: string, entries: InboundEntry[], sources: ReadonlyMap<string, Buffer> = new Map()): Promise<{ added: number }> {
      return unit.run(workerSession(hotelId), async (repos) => {
        const { added } = await repos.conversations.ingest(entries, { mailbox: null }, repos.matcher, now());
        // the whole email, kept in this hotel's own schema with its message (hotel 0053), so it opens with no mailbox
        for (const e of entries) {
          const source = sources.get(e.externalId);
          if (!source || source.byteLength < 1 || source.byteLength > MAIL_SOURCE_MAX) continue;
          const m = await repos.conversations.messageByExternal("email", e.externalId);
          if (m && m.direction === "in") await repos.conversations.saveMailSource(m.id, source);
        }
        return { added };
      });
    },

    /** C5: the hotel's messages older than `before` go, then the conversations and contacts left empty. Not reachable from a route. */
    async purgeForWorker(hotelId: string, before: Date): Promise<number> {
      return unit.run(workerSession(hotelId), (repos) => repos.conversations.purge(before));
    },
  };
}

export type ConversationsService = ReturnType<typeof createConversationsService>;
export type { SyncRepos };
