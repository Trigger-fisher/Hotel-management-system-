import "server-only";
import {
  CONV_THREAD_PAGE,
  conversationsCopy,
  DESK_LABELS,
  deskOf,
  labelsFor,
  type DeskLabel,
  type ConvBox,
  type ConversationList,
  type ConversationThread,
  type ConvLinkKind,
  type ConvNote,
  type ConvMessage,
  type ConvPerson,
  type ConvSummary,
  type ConvTab,
  type EmailBody,
  type LinkCandidate,
  type MailConnectionTest,
  type PlatformMailbox,
  type PlatformMailboxInput,
  type QuickReply,
  type QuickReplyInput,
  type SyncResult,
} from "@shared/dashboards/conversations";
import { OWN_MAILBOX_ONLY_ROLES } from "@shared/dashboards/mailboxAccess";
import { WHATSAPP_NOT_CONNECTED, whatsappCopy, type WhatsAppHotelRow, type WhatsAppSettings } from "@shared/dashboards/whatsapp";
import type { VerifiedSession } from "../../auth/session";
import { uuidv7, type InboundEntry } from "../../conversations/channel";
import { createEmailChannel, openStoredBody, storedAttachment } from "../../conversations/emailChannel";
import { normaliseEmail } from "../../conversations/match";
import { AppError } from "../../errors";
import { testMailConnection } from "../../mail/connectionTest";
import type { ImapClientFactory } from "../../mail/imap";
import type { RawObjects } from "../../mail/files";
import { platformMailboxFrom, type MailboxRead } from "../../mail/mailbox";
import { openStoredMedia, PLATFORM_PREFIXES, type StoredMediaFile } from "../../whatsapp/media";
import { isSafeHostName, MailHostError, type HostLookup } from "../../mail/safeHost";
import { composeReply, MailSendError, sendRaw, type SmtpConfig, type TransportFactory } from "../../mail/smtp";
import { isConversationsNotReady, type ChannelAccountRecord, type ConversationRecord, type PlatformConversationsRepos } from "../../repos/conversations";
import { RepoError } from "../../repos/types";
import type { PeopleDirectory } from "../cash/ports";
import type { PlatformMeta } from "../platform/access";
import { searchWords } from "../../validation/listQuery";
import { checkEmailReply, checkNote, checkQuickReply, MAIL_SOURCE_MAX, mailRefOf, quickReplyOf, refuseOnSharedDesk, sendFailure } from "./conversationsService";
import { emailEntryOf, linkOf, mailboxStateOf, mayLink, messageOf, NEEDS_UPDATE_STATE, noteOf, peopleIdsOf, platformAccess, previewOfText, replyChannelsOf, replySubject, replyTargetOf, rowOf, threadingOf, whatsappChannelOf, windowOfConversation } from "./hub";
import { syncMailbox, type SyncOutcome } from "./mailSync";
import type { SentMailPage } from "@shared/dashboards/sentMail";
import type { ConversationListQueryInput, ReplyBody, SentMailQueryInput } from "./schemas";

// Conversations, the PLATFORM's hub (decision 66, A5): the platform mailbox (its login and sealed password stay in Super Admin > Platform settings > Mail; the reading switch and
// the IMAP server are here, Console > Conversations > Settings) and the people who write to the platform (hotel owners and staff). Super Admin and Platform Admin have the SAME
// access (the console gate); never an API key, never anyone else. The hotels' conversations are never read from here (C4). Changes are in the platform audit as
// "conversation_updated" with fixed words only.

const C = conversationsCopy;
/** Free mail services: their sales@ and support@ are other people's, never the platform's desks. */
const PUBLIC_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com"]);

/** The console's gate for this hub (compose builds it over the platform console unit). */
export interface PlatformGatePort {
  /** 403 for anyone but Platform / Super Admin. */
  read(session: VerifiedSession): void;
  /** 403 (audited as refused) for anyone but Platform / Super Admin. */
  write(session: VerifiedSession, meta: PlatformMeta): Promise<void>;
  /** 403 for anyone but the Super Admin: the mailbox set-up and the WhatsApp hotels list (MJ, 5 Nov 2026). */
  superRead(session: VerifiedSession): void;
  /** 403 (audited as refused) for anyone but the Super Admin. */
  superWrite(session: VerifiedSession, meta: PlatformMeta): Promise<void>;
  /** The platform audit row of a change: fixed words only. */
  audit(session: VerifiedSession, meta: PlatformMeta, reason: string): Promise<void>;
}

export interface PlatformConversationsDeps {
  unit: { run<T>(work: (repos: PlatformConversationsRepos) => Promise<T>): Promise<T> };
  gate: PlatformGatePort;
  people: PeopleDirectory;
  now: () => Date;
  imap: ImapClientFactory;
  createTransport?: TransportFactory;
  lookup?: HostLookup;
  sleep?: (ms: number) => Promise<void>;
  /** The platform mail server of Platform settings > Mail (mail/platformSmtp.ts). */
  smtp: () => Promise<{ config: SmtpConfig | null; passwordUnreadable: boolean }>;
  /** The platform's staff (Super Admin and Platform Admins), for assignment. */
  staff: () => Promise<ConvPerson[]>;
  whatsapp?: () => Promise<WhatsAppSettings>;
  /**
   * Sends a WhatsApp message on the platform line (compose/whatsappSend.ts through the sender of plan part 12: kill switch, window, opt-out, cap). `by` is the staff login; a refusal comes back as
   * `ok: false` with one plain sentence for the screen. Absent while WhatsApp is not set up: a WhatsApp reply then answers "not connected yet", as before.
   */
  whatsappSend?: (req: { by: string; to: string; text: string }) => Promise<{ ok: boolean; message: string; messageId?: string }>;
  /** The hotels that use a WhatsApp number, with the number and its quality (no chat content); also the hotel picker of the Rules screen. */
  whatsappHotels?: () => Promise<WhatsAppHotelRow[]>;
  /** The bucket the guests' WhatsApp files are kept in (the platform's folder of it). Absent = none can be opened. */
  whatsappFiles?: Pick<RawObjects, "get">;
  /** Reads the mail queue for the "Sent through Amazon SES" list (compose/sentMail.ts); null hotel = every mail. */
  sentMail?: (hotelId: string | null, q: SentMailQueryInput) => Promise<SentMailPage>;
  /** The platform's own domain (Platform settings > Mail: the sending domain), where the desks sales@ and support@ live; null = the mailbox's own domain only. */
  deskDomain?: () => Promise<string | null>;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

const SAVED = "Conversations mailbox settings saved";
const SHARED_INBOX_REFUSED = "The Super Admin uses only their own mailbox. The platform inbox is for the Platform Admins.";

export function createPlatformConversationsService(deps: PlatformConversationsDeps) {
  const { unit, gate, now } = deps;
  // every mail the platform sends is system mail (codes, reset links, invitations): an answer to it quotes them, so none is listed (A10)
  const channel = createEmailChannel({ imap: deps.imap, createTransport: deps.createTransport, lookup: deps.lookup, now, sleep: deps.sleep, hideHmsAnswers: true });
  const whatsapp = (): Promise<WhatsAppSettings> => (deps.whatsapp ? deps.whatsapp() : Promise.resolve(WHATSAPP_NOT_CONNECTED));
  const access = platformAccess();

  /** Never an API key; then the console gate (Platform and Super Admin alike). */
  const read = (session: VerifiedSession): void => {
    if (session.client === "token" || session.token !== undefined) throw new AppError("FORBIDDEN", "Guest and staff messages are not available to an API key.");
    gate.read(session);
  };
  const write = async (session: VerifiedSession, meta: PlatformMeta): Promise<void> => {
    if (session.client === "token" || session.token !== undefined) throw new AppError("FORBIDDEN", "Guest and staff messages are not available to an API key.");
    await gate.write(session, meta);
  };
  // the platform's shared inbox (its email) is the Platform Admin's: the Super Admin has only their own mailbox (MJ, 5 Nov 2026); the platform WhatsApp chats stay for both
  const ownMailboxOnly = (session: VerifiedSession): boolean => (OWN_MAILBOX_ONLY_ROLES as readonly string[]).includes(session.accountRole);
  const sharedMailRead = (session: VerifiedSession): void => {
    read(session);
    if (ownMailboxOnly(session)) throw new AppError("FORBIDDEN", SHARED_INBOX_REFUSED);
  };
  const superRead = (session: VerifiedSession): void => {
    read(session);
    gate.superRead(session);
  };
  const superWrite = async (session: VerifiedSession, meta: PlatformMeta): Promise<void> => {
    await write(session, meta);
    await gate.superWrite(session, meta);
  };
  const audit = async (session: VerifiedSession, meta: PlatformMeta, reason: string): Promise<void> => {
    try {
      await gate.audit(session, meta, reason);
    } catch {
      deps.log?.("platform conversations audit row not written", { traceId: meta.traceId });
    }
  };

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isConversationsNotReady(error)) throw new AppError("CONFLICT", C.errors.needsUpdate);
      throw error;
    }
  }

  const accountView = (a: ChannelAccountRecord | null) => (a ? { status: a.status, imapHost: a.imapHost, imapPort: a.imapPort } : null);
  const readMailbox = async (repos: PlatformConversationsRepos): Promise<MailboxRead> => platformMailboxFrom(await deps.smtp(), accountView(await repos.accounts.platformAccount("email")));

  const getOr404 = async (repos: PlatformConversationsRepos, id: string): Promise<ConversationRecord> => {
    const c = await repos.conversations.get(id);
    if (!c) throw new AppError("NOT_FOUND");
    return c;
  };

  async function threadIn(repos: PlatformConversationsRepos, session: VerifiedSession, c: ConversationRecord, before?: Date): Promise<ConversationThread> {
    const [{ rows: all, hasOlder }, notes, detail, mailbox, wa] = await Promise.all([
      repos.conversations.messages(c.id, { before, limit: CONV_THREAD_PAGE }),
      repos.conversations.notes(c.id),
      c.contact.link ? repos.matcher.details(c.contact.link) : Promise.resolve(null),
      readMailbox(repos),
      whatsapp(),
    ]);
    const rows = ownMailboxOnly(session) ? all.filter((m) => m.channel === "whatsapp") : all;
    const people = await deps.people.get(peopleIdsOf([c, ...rows, ...notes]));
    // with no mailbox read, a reply still goes out through the platform's own mail (the desks' mail comes through Amazon SES)
    const { replyChannels, defaultChannel } = replyChannelsOf(c, mailbox, wa, !mailbox.config && (await deps.smtp()).config !== null);
    return {
      id: c.id,
      contact: { name: c.contact.displayName?.trim() || (c.contact.handles[0]?.value ?? C.unknown), handles: c.contact.handles.map((h) => h.value), muted: c.contact.muted },
      links: c.contact.link ? [linkOf(c.contact.link, detail, access)] : [],
      status: c.status,
      box: c.box,
      assignedTo: c.assignedTo ? { id: c.assignedTo, name: people.get(c.assignedTo)?.name ?? "Former staff" } : null,
      unread: c.unreadCount,
      messages: rows.map((m) => messageOf(m, people)),
      hasOlder,
      notes: notes.map((n) => noteOf(n, people, session.userId)),
      window: windowOfConversation(c, now()),
      replyChannels,
      defaultChannel,
      access: { canEdit: true, readOnlyReason: null, canSeeStay: false, canSeeBills: false, canLink: access.canLink },
      replyTo: replyTargetOf(rows, c.contact.handles),
      // the labels (the desks Sales and Support among them), so the thread's label menu shows which are on
      labels: [...(c.labels ?? [])],
    };
  }

  async function change(session: VerifiedSession, id: string, meta: PlatformMeta, work: (repos: PlatformConversationsRepos, c: ConversationRecord) => Promise<string | null>): Promise<ConversationThread> {
    await write(session, meta);
    let said: string | null = null;
    const out = await guarded(() =>
      unit.run(async (repos) => {
        const c = await getOr404(repos, id);
        said = await work(repos, c);
        return threadIn(repos, session, await getOr404(repos, id));
      }),
    );
    if (said) await audit(session, meta, said);
    return out;
  }

  async function summaryOf(): Promise<ConvSummary> {
    const wa = whatsappChannelOf(await whatsapp());
    try {
      return await unit.run(async (repos) => {
        const [unread, mailbox, positions] = await Promise.all([repos.conversations.unreadTotal(), readMailbox(repos), repos.conversations.positions()]);
        return { unread, mailbox: mailboxStateOf(mailbox, positions), whatsapp: wa };
      });
    } catch (error) {
      if (isConversationsNotReady(error)) return { unread: 0, mailbox: NEEDS_UPDATE_STATE, whatsapp: wa };
      throw error;
    }
  }

  /**
   * The desks (MJ, 2 Nov 2026): sales@ and support@ of the platform's domain (and of the mailbox's own domain, unless that is a public one like gmail.com) are Google aliases
   * that deliver into the platform mailbox. Their addresses, lower case, with the label each one's mail gets.
   */
  async function desks(mailboxAddress: string | null): Promise<Record<string, DeskLabel>> {
    const own = mailboxAddress?.split("@")[1] ?? null;
    const domains = [...new Set([await deps.deskDomain?.().catch(() => null), own && !PUBLIC_MAIL_DOMAINS.has(own) ? own : null].filter((d): d is string => !!d).map((d) => d.toLowerCase()))];
    const out: Record<string, DeskLabel> = {};
    for (const d of domains) for (const label of DESK_LABELS) out[`${label.toLowerCase()}@${d}`] = label;
    return out;
  }

  /** Puts the desk's label on the conversation of this message (the labels it has are kept). */
  async function labelOf(repos: PlatformConversationsRepos, e: InboundEntry, desk: DeskLabel): Promise<void> {
    const m = await repos.conversations.messageByExternal(e.channel, e.externalId);
    const c = m ? await repos.conversations.get(m.conversationId) : null;
    if (c && !c.labels.includes(desk)) await repos.conversations.setExtras(c.id, { labels: [...c.labels, desk].slice(0, 10) });
  }

  /** New mail sent to a desk gets the desk's label (a conversation keeps the labels it has; a person's own reply is not looked at). */
  async function labelDesks(repos: PlatformConversationsRepos, entries: readonly InboundEntry[], mailboxAddress: string): Promise<void> {
    const map = await desks(mailboxAddress);
    if (Object.keys(map).length === 0) return;
    for (const e of entries) {
      if (e.direction !== "in") continue;
      const desk = deskOf([...e.to, ...e.cc], map);
      if (desk) await labelOf(repos, e, desk);
    }
  }

  /** One message of a conversation, its stored whole email (platform 0171) when there is one, and the mailbox as set up now. */
  async function storedOrMailbox(repos: PlatformConversationsRepos, id: string, messageId: string) {
    await getOr404(repos, id);
    const m = await repos.conversations.message(id, messageId);
    return { m, source: m ? await repos.conversations.mailSource(m.id) : null, mailbox: await readMailbox(repos) };
  }

  async function syncPlatform(o: { force?: boolean; background?: boolean; budgetMs?: number }): Promise<SyncOutcome> {
    let address: string | null = null;
    const target = {
      run: <T>(work: (repos: PlatformConversationsRepos) => Promise<T>) => unit.run(work),
      mailbox: async (repos: PlatformConversationsRepos) => {
        const read = await readMailbox(repos);
        address = read.config?.address ?? null;
        return read;
      },
      afterIngest: (repos: PlatformConversationsRepos, entries: InboundEntry[]) => (address ? labelDesks(repos, entries, address) : Promise.resolve()),
    };
    const outcome = await syncMailbox<PlatformConversationsRepos>({ target, channel, now, force: o.force, background: o.background, budgetMs: o.budgetMs, log: (m, f) => deps.log?.(m, { ...f, hotelId: null }) });
    if (outcome.checked) await unit.run((repos) => repos.accounts.report(null, { at: now(), ok: outcome.error === null, error: outcome.error })).catch(() => undefined);
    return outcome;
  }

  /** The mailbox card: what is saved, whether reading can be switched on, where it stands. */
  async function mailboxView(): Promise<PlatformMailbox> {
    const smtp = await deps.smtp();
    const { account, positions } = await guarded(() => unit.run(async (repos) => ({ account: await repos.accounts.platformAccount("email"), positions: await repos.conversations.positions() })));
    const now_ = platformMailboxFrom(smtp, accountView(account));
    const provider = now_.provider === "gmail" || now_.provider === "smtp" ? now_.provider : null;
    const canRead = provider !== null && smtp.config !== null && !smtp.passwordUnreadable;
    const reason = now_.reason ?? undefined;
    const address = smtp.config ? (/<([^>]+)>/.exec(provider === "gmail" && smtp.config.user ? smtp.config.user : smtp.config.from)?.[1] ?? (provider === "gmail" && smtp.config.user ? smtp.config.user : smtp.config.from)).toLowerCase() : null;
    return {
      reading: account?.status === "on",
      canRead,
      ...(reason ? { reason } : {}),
      provider,
      address,
      imapHost: provider === "gmail" ? "imap.gmail.com" : (account?.imapHost ?? null),
      imapPort: provider === "gmail" ? 993 : account?.imapPort === 143 ? 143 : 993,
      imapFixed: provider === "gmail",
      state: mailboxStateOf(now_, positions),
      lastTest: null,
    };
  }

  return {
    /** The "Sent through Amazon SES" list of the platform's Email page: every mail the system sent, with the hotel named (the Platform Admin's shared inbox). */
    async sentMail(session: VerifiedSession, q: SentMailQueryInput): Promise<SentMailPage> {
      sharedMailRead(session);
      return deps.sentMail ? deps.sentMail(null, q) : { rows: [], total: 0, page: q.page, size: q.size };
    },

    async list(session: VerifiedSession, q: ConversationListQueryInput): Promise<ConversationList> {
      if (q.channel === "whatsapp") read(session);
      else sharedMailRead(session);
      const wa = whatsappChannelOf(await whatsapp());
      return guarded(() =>
        unit.run(async (repos) => {
          const words = searchWords(q.search);
          const [page, counts, mailbox, positions] = await Promise.all([
            // the Email page's folder and label (the desks Sales and Support, platform 0163's columns) narrow the list as on a hotel's page
            repos.conversations.list({ words, tab: q.tab as ConvTab, channel: q.channel, me: session.userId, page: q.page, pageSize: q.size, ...(q.folder ? { folder: q.folder } : {}), ...(q.label ? { label: q.label } : {}) }),
            repos.conversations.counts({ words, channel: q.channel, me: session.userId }),
            readMailbox(repos),
            repos.conversations.positions(),
          ]);
          const people = await deps.people.get(peopleIdsOf(page.rows));
          return { items: page.rows.map((r) => rowOf(r, people)), page: q.page, size: q.size, total: page.total, counts, mailbox: mailboxStateOf(mailbox, positions), whatsapp: wa };
        }),
      );
    },

    async summary(session: VerifiedSession): Promise<ConvSummary> {
      read(session);
      return summaryOf();
    },

    async sync(session: VerifiedSession, input: { background?: boolean }): Promise<SyncResult> {
      sharedMailRead(session);
      let outcome: SyncOutcome | null = null;
      try {
        outcome = await syncPlatform({ background: input.background === true });
      } catch (error) {
        if (!isConversationsNotReady(error)) throw error;
      }
      return { checked: outcome?.checked ?? false, added: outcome?.added ?? 0, ...(await summaryOf()) };
    },

    async thread(session: VerifiedSession, id: string, before?: string): Promise<ConversationThread> {
      read(session);
      return guarded(() =>
        unit.run(async (repos) => {
          const c = await getOr404(repos, id);
          // the Super Admin opens the platform's WhatsApp chats only, never its shared mail
          if (ownMailboxOnly(session) && !c.channels.includes("whatsapp")) throw new AppError("NOT_FOUND");
          return threadIn(repos, session, c, before ? new Date(before) : undefined);
        }),
      );
    },

    async emailBody(session: VerifiedSession, id: string, messageId: string, o: { images: boolean }): Promise<EmailBody> {
      sharedMailRead(session);
      const { m, source, mailbox } = await guarded(() => unit.run(async (repos) => storedOrMailbox(repos, id, messageId)));
      if (!m || m.channel !== "email") throw new AppError("NOT_FOUND");
      // a desk's mail came through Amazon SES and is kept whole (platform 0171): it opens without any mailbox
      if (source) return { id: m.id, ...(await openStoredBody(source, mailRefOf(m), { canSeeBills: false, showImages: o.images })) };
      if (!mailbox.config) throw new AppError("CONFLICT", C.errors.noMailbox);
      return { id: m.id, ...(await channel.openBody(mailbox.config, mailRefOf(m), { canSeeBills: false, showImages: o.images })) };
    },

    async attachment(session: VerifiedSession, id: string, messageId: string, part: number): Promise<{ bytes: Uint8Array; type: string; name: string }> {
      sharedMailRead(session);
      const { m, source, mailbox } = await guarded(() => unit.run(async (repos) => storedOrMailbox(repos, id, messageId)));
      if (!m || m.channel !== "email" || !m.hasAttachments) throw new AppError("NOT_FOUND");
      if (source) return storedAttachment(source, part, { canSeeBills: false });
      if (!mailbox.config) throw new AppError("CONFLICT", C.errors.noMailbox);
      return channel.attachment(mailbox.config, mailRefOf(m), part, { canSeeBills: false });
    },

    /** A guest's photo, voice note, video or document from WhatsApp on the platform number, kept in the platform's folder of the bucket (whatsapp/media.ts). */
    async whatsappMedia(session: VerifiedSession, id: string, messageId: string): Promise<StoredMediaFile> {
      read(session);
      if (!deps.whatsappFiles) throw new AppError("NOT_FOUND");
      const m = await guarded(() =>
        unit.run(async (repos) => {
          await getOr404(repos, id);
          return repos.conversations.message(id, messageId);
        }),
      );
      if (!m || m.channel !== "whatsapp") throw new AppError("NOT_FOUND");
      // the Console's chats open the files of the platform side only (the company number and the Super Admin's and Platform Admin's own numbers), never a hotel's folder
      const file = await openStoredMedia(deps.whatsappFiles, m.waMedia, PLATFORM_PREFIXES);
      if (file === "gone") throw new AppError("NOT_FOUND", "This file is no longer kept. WhatsApp files are kept for a limited time.");
      if (!file) throw new AppError("NOT_FOUND");
      return file;
    },

    async reply(session: VerifiedSession, id: string, input: ReplyBody, meta: PlatformMeta): Promise<ConvMessage> {
      await write(session, meta);
      if (input.channel !== "whatsapp" && ownMailboxOnly(session)) throw new AppError("FORBIDDEN", SHARED_INBOX_REFUSED);
      if (input.channel === "whatsapp") {
        // the platform line (Super Admin and Platform Admin alike): free text inside the 24-hour window; a template outside it comes with the platform templates (phase 2)
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!deps.whatsappSend || !(await whatsapp()).connected) throw new AppError("CONFLICT", whatsappCopy.notAvailableWrite);
        if (text === "") throw new AppError("VALIDATION_FAILED", undefined, { fields: { text: "Write a message first" } });
        const conv = await guarded(() => unit.run((repos) => getOr404(repos, id)));
        const phone = conv.contact.handles.find((h) => h.kind === "phone")?.value;
        if (!phone) throw new AppError("CONFLICT", "This person has no WhatsApp number on file.");
        const sent = await deps.whatsappSend({ by: session.userId, to: phone, text });
        if (!sent.ok || !sent.messageId) throw new AppError("CONFLICT", sent.message);
        const message = await guarded(() =>
          unit.run(async (repos) => {
            const row = await repos.conversations.message(id, sent.messageId as string);
            if (!row) throw new AppError("NOT_FOUND");
            return messageOf(row, await deps.people.get([session.userId]));
          }),
        );
        await audit(session, meta, "WhatsApp reply sent");
        return message;
      }
      if (input.billId) throw new AppError("FORBIDDEN", C.errors.billOwn);
      if (input.from) throw new AppError("FORBIDDEN", C.errors.fromNotOwn, { fields: { from: C.errors.fromNotOwn } });
      const checked = checkEmailReply(input);
      const { c, original, mailbox } = await guarded(() =>
        unit.run(async (repos) => {
          const conv = await getOr404(repos, id);
          const orig = input.inReplyTo ? await repos.conversations.message(id, input.inReplyTo) : [...(await repos.conversations.messages(id, { limit: CONV_THREAD_PAGE })).rows].reverse().find((m) => m.channel === "email") ?? null;
          if (input.inReplyTo && (!orig || orig.channel !== "email")) throw new AppError("NOT_FOUND");
          return { c: conv, original: orig, mailbox: await readMailbox(repos) };
        }),
      );
      // no mailbox read here (a desk's mail came through Amazon SES): the reply goes out through the platform's own mail (Platform settings > Mail, e.g. Amazon SES), as a group's does
      const smtpOnly = mailbox.config ? null : (await deps.smtp()).config;
      const smtpCfg = mailbox.config?.smtp ?? smtpOnly;
      if (!smtpCfg) throw new AppError("CONFLICT", C.errors.noMailbox);
      const handles = c.contact.handles.filter((h) => h.kind === "email").map((h) => h.value);
      const defaultTo = original ? (original.direction === "in" ? original.fromAddr : original.toAddrs[0] ?? null) : handles[0] ?? null;
      const asked = input.to ? normaliseEmail(input.to) : null;
      const allowed = new Set([original?.fromAddr, original?.replyToAddr, ...(original?.direction === "out" ? original.toAddrs : []), ...handles].filter((a): a is string => typeof a === "string" && a !== "").map((a) => a.toLowerCase()));
      if (input.to && (!asked || !allowed.has(asked))) throw new AppError("VALIDATION_FAILED", C.errors.recipient, { fields: { to: C.errors.recipient } });
      const to = asked ?? defaultTo;
      if (!to) throw new AppError("CONFLICT", C.reply.noEmail);
      const subject = checked.subject ?? replySubject(original?.subject);
      const threading = threadingOf(original);
      // a desk's mail is answered from the desk (MJ, 2 Nov 2026): the address the person wrote to, else the desk the conversation is labelled with; the name stays the platform's
      const deskMap = await desks(mailbox.config?.address ?? null);
      const wrote = original?.direction === "in" ? [...original.toAddrs, ...original.ccAddrs].map((a) => a.toLowerCase()).find((a) => deskMap[a]) : undefined;
      const deskAddress = wrote ?? Object.keys(deskMap).find((a) => c.labels.includes(deskMap[a] as string));
      const fromName = (/^\s*"?([^"<]*?)"?\s*</.exec(smtpCfg.from)?.[1] ?? "").trim();
      const deskFrom = deskAddress ? `${[fromName, deskMap[deskAddress]].filter(Boolean).join(" ")} <${deskAddress}>` : null;
      let sent: { messageId: string; sentAt: Date; source?: Buffer };
      try {
        if (mailbox.config) {
          const sendAs = deskFrom ? { ...mailbox.config, smtp: { ...mailbox.config.smtp, from: deskFrom } } : mailbox.config;
          sent = await channel.send(sendAs, { conversationId: c.id, to, cc: checked.cc, subject, text: checked.text, inReplyTo: threading.inReplyTo, references: threading.references, bill: false });
        } else {
          const cfg = deskFrom ? { ...smtpCfg, from: deskFrom } : smtpCfg;
          const at = now();
          const domain = (deskAddress ?? /<?([^<>\s]+@[^<>\s]+)>?\s*$/.exec(cfg.from)?.[1] ?? "").split("@")[1] || "hms.local";
          const messageId = `<${uuidv7(at.getTime())}@${domain}>`;
          const { raw, envelope } = await composeReply(cfg, { to, cc: checked.cc, subject, text: checked.text, inReplyTo: threading.inReplyTo, references: threading.references, messageId, conversationId: c.id, bill: false, date: at });
          await sendRaw(cfg, { raw, envelope }, { createTransport: deps.createTransport, lookup: deps.lookup });
          // no Sent folder holds this copy: it is kept whole with its message (platform 0171)
          sent = { messageId, sentAt: at, source: raw };
        }
      } catch (error) {
        deps.log?.("platform conversation reply not sent", { code: error instanceof MailSendError ? error.reason : error instanceof MailHostError ? error.code : "UNKNOWN" });
        throw sendFailure(error);
      }
      const entry = await guarded(() =>
        unit.run(async (repos) => {
          const row = await repos.conversations.recordOutgoing(c.id, { channel: "email", externalId: sent.messageId, sentAt: sent.sentAt, sentBy: session.userId, status: "sent", preview: previewOfText(checked.text), mailBox: mailbox.config?.address ?? null, subject, fromAddr: deskAddress ?? mailbox.config?.address ?? null, toAddrs: [to], ccAddrs: checked.cc, inReplyTo: threading.inReplyTo, referenceIds: [...threading.references, ...(threading.inReplyTo ? [threading.inReplyTo] : [])].slice(-20), hasAttachments: false, hasBill: false });
          if (sent.source && sent.source.byteLength <= MAIL_SOURCE_MAX) await repos.conversations.saveMailSource(row.id, sent.source);
          return emailEntryOf(row, await deps.people.get([session.userId]));
        }),
      );
      await audit(session, meta, "Reply sent");
      return entry;
    },

    async patch(session: VerifiedSession, id: string, body: { assignedTo?: string | null; status?: "open" | "done"; box?: ConvBox; labels?: string[] }, meta: PlatformMeta): Promise<ConversationThread> {
      // the route's body also carries the hotels' Email page fields: labels are the platform's too (the desks Sales and Support, MJ 2 Nov 2026); star and snooze stay the hotels'
      const extra = body as { starred?: unknown; snoozedUntil?: unknown };
      if (extra.starred !== undefined || extra.snoozedUntil !== undefined) throw new AppError("VALIDATION_FAILED", "Stars and snooze are on the hotels' Email page only.");
      if (body.labels !== undefined) {
        const labels = labelsFor("platform").filter((l) => body.labels?.includes(l));
        return change(session, id, meta, async (repos, c) => {
          await repos.conversations.setExtras(c.id, { labels });
          return "Labels changed";
        });
      }
      if (body.assignedTo !== undefined) {
        const userId = body.assignedTo;
        await write(session, meta);
        if (userId !== null && !(await deps.staff()).some((p) => p.id === userId)) throw new AppError("VALIDATION_FAILED", C.errors.notStaff, { fields: { assignedTo: C.errors.notStaff } });
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

    async setMuted(session: VerifiedSession, id: string, on: boolean, meta: PlatformMeta): Promise<ConversationThread> {
      return change(session, id, meta, async (repos, c) => {
        await repos.conversations.setMuted(c.contactId, on);
        if (!on && !c.contact.link) await repos.conversations.setBox(c.id, "main");
        return on ? "Sender always to Other" : "Sender no longer moved to Other";
      });
    },

    async setRead(session: VerifiedSession, id: string, isRead: boolean): Promise<ConversationThread> {
      read(session);
      return guarded(() =>
        unit.run(async (repos) => {
          const c = await getOr404(repos, id);
          if (isRead) await repos.conversations.markRead(c.id);
          else await repos.conversations.markUnread(c.id);
          return threadIn(repos, session, await getOr404(repos, id));
        }),
      );
    },

    async addNote(session: VerifiedSession, id: string, text: string, meta: PlatformMeta): Promise<ConvNote> {
      await write(session, meta);
      const body = checkNote(text);
      const note = await guarded(() =>
        unit.run(async (repos) => {
          const c = await getOr404(repos, id);
          return noteOf(await repos.conversations.addNote(c.id, session.userId, body, now()), await deps.people.get([session.userId]), session.userId);
        }),
      );
      await audit(session, meta, "Note added");
      return note;
    },

    async deleteNote(session: VerifiedSession, id: string, noteId: string, meta: PlatformMeta): Promise<{ removed: true }> {
      await write(session, meta);
      await guarded(() =>
        unit.run(async (repos) => {
          const c = await getOr404(repos, id);
          const n = await repos.conversations.note(c.id, noteId);
          if (!n) throw new AppError("NOT_FOUND");
          if (n.authorId !== session.userId && session.accountRole !== "super_admin") throw new AppError("FORBIDDEN", C.errors.noteNotYours);
          await repos.conversations.removeNote(c.id, n.id);
        }),
      );
      await audit(session, meta, "Note removed");
      return { removed: true };
    },

    async setLink(session: VerifiedSession, id: string, link: { kind: ConvLinkKind; targetId: string }, meta: PlatformMeta): Promise<ConversationThread> {
      if (!mayLink(access, link.kind)) throw new AppError("FORBIDDEN");
      return change(session, id, meta, async (repos, c) => {
        const target = await repos.matcher.exists(link.kind, link.targetId);
        if (!target) throw new AppError("NOT_FOUND");
        await repos.conversations.setLink(c.contactId, { kind: link.kind, id: target.id, source: "manual" }, session.userId, now());
        return "Linked";
      });
    },

    async clearLink(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<ConversationThread> {
      return change(session, id, meta, async (repos, c) => {
        if (!c.contact.link) return null;
        await repos.conversations.clearLink(c.contactId);
        return "Link removed";
      });
    },

    async linkCandidates(session: VerifiedSession, search: string | undefined, kind?: ConvLinkKind): Promise<LinkCandidate[]> {
      read(session);
      const kinds = access.canLink.filter((k) => kind === undefined || k === kind);
      const words = searchWords(search);
      if (kinds.length === 0 || words.length === 0) return [];
      const found = await guarded(() => unit.run((repos) => repos.matcher.search(words, kinds)));
      return found.map((r) => ({ kind: r.kind, id: r.id, label: r.label, ...(r.detail ? { detail: r.detail } : {}) }));
    },

    async staff(session: VerifiedSession): Promise<ConvPerson[]> {
      read(session);
      return deps.staff();
    },

    async quickReplies(session: VerifiedSession): Promise<QuickReply[]> {
      read(session);
      return guarded(() => unit.run(async (repos) => (await repos.conversations.quickReplies()).map(quickReplyOf)));
    },

    async addQuickReply(session: VerifiedSession, input: QuickReplyInput, meta: PlatformMeta): Promise<QuickReply> {
      await write(session, meta);
      const q = checkQuickReply(input);
      try {
        const made = await guarded(() => unit.run((repos) => repos.conversations.addQuickReply(q, session.userId)));
        await audit(session, meta, "Quick reply saved");
        return quickReplyOf(made);
      } catch (error) {
        if (error instanceof RepoError && error.kind === "unique") throw new AppError("CONFLICT", C.errors.quickTaken, { fields: { title: C.errors.quickTaken } });
        throw error;
      }
    },

    async updateQuickReply(session: VerifiedSession, quickId: string, input: QuickReplyInput, meta: PlatformMeta): Promise<QuickReply> {
      await write(session, meta);
      const q = checkQuickReply(input);
      try {
        const saved = await guarded(() => unit.run((repos) => repos.conversations.updateQuickReply(quickId, q)));
        if (!saved) throw new AppError("NOT_FOUND");
        await audit(session, meta, "Quick reply saved");
        return quickReplyOf(saved);
      } catch (error) {
        if (error instanceof RepoError && error.kind === "unique") throw new AppError("CONFLICT", C.errors.quickTaken, { fields: { title: C.errors.quickTaken } });
        throw error;
      }
    },

    async deleteQuickReply(session: VerifiedSession, quickId: string, meta: PlatformMeta): Promise<{ removed: true }> {
      await write(session, meta);
      if (!(await guarded(() => unit.run((repos) => repos.conversations.removeQuickReply(quickId))))) throw new AppError("NOT_FOUND");
      await audit(session, meta, "Quick reply removed");
      return { removed: true };
    },

    async whatsapp(session: VerifiedSession): Promise<WhatsAppSettings> {
      read(session);
      return whatsapp();
    },

    async setWhatsAppAutomatic(session: VerifiedSession, meta: PlatformMeta): Promise<WhatsAppSettings> {
      await write(session, meta);
      throw new AppError("CONFLICT", whatsappCopy.notAvailableWrite);
    },

    /** Console > Conversations > Settings > WhatsApp: the hotels' numbers (none until the Meta integration). No chat content. */
    async whatsappHotels(session: VerifiedSession): Promise<WhatsAppHotelRow[]> {
      superRead(session);
      return deps.whatsappHotels ? deps.whatsappHotels() : [];
    },

    async mailbox(session: VerifiedSession): Promise<PlatformMailbox> {
      superRead(session);
      return mailboxView();
    },

    /** The reading switch and the IMAP server (another mail server only: Gmail's is fixed). Only public server names; ports 993 and 143 (A13). */
    async setMailbox(session: VerifiedSession, input: Omit<PlatformMailboxInput, "imapPort"> & { imapPort?: number }, meta: PlatformMeta): Promise<PlatformMailbox> {
      await superWrite(session, meta);
      const view = await mailboxView();
      let imapHost: string | null = null;
      let imapPort: 993 | 143 | null = null;
      if (view.provider === "smtp") {
        const host = (input.imapHost ?? view.imapHost ?? "").trim().toLowerCase();
        if (host !== "" && !isSafeHostName(host)) throw new AppError("VALIDATION_FAILED", "Enter the public IMAP server name, like imap.example.com.", { fields: { imapHost: "Enter the public IMAP server name, like imap.example.com." } });
        const port = input.imapPort ?? view.imapPort;
        if (port !== 993 && port !== 143) throw new AppError("VALIDATION_FAILED", "The IMAP port is 993 (SSL/TLS) or 143 (STARTTLS).", { fields: { imapPort: "The IMAP port is 993 (SSL/TLS) or 143 (STARTTLS)." } });
        imapHost = host === "" ? null : host;
        imapPort = port;
        if (input.reading && imapHost === null) throw new AppError("VALIDATION_FAILED", "Enter the IMAP server of this mail service.", { fields: { imapHost: "Enter the IMAP server of this mail service." } });
      }
      if (input.reading && !view.canRead) throw new AppError("CONFLICT", view.reason === "send_only" ? C.mailbox.sendOnly : view.reason === "password_unreadable" ? C.mailbox.passwordUnreadable : "Set up the platform mail server in Platform settings > Mail first (Gmail or your own mail server).");
      await guarded(() => unit.run((repos) => repos.accounts.savePlatformAccount({ status: input.reading ? "on" : "off", imapHost, imapPort }, session.userId)));
      await audit(session, meta, SAVED);
      return mailboxView();
    },

    /** "Test connection" with the SAVED settings: reading (IMAP) and sending (SMTP) at once, fixed sentences only. The result is in the answer only. */
    async startMailboxTest(session: VerifiedSession, meta: PlatformMeta): Promise<MailConnectionTest> {
      await superWrite(session, meta);
      const smtp = await deps.smtp();
      const account = await guarded(() => unit.run((repos) => repos.accounts.platformAccount("email")));
      const asIfOn = platformMailboxFrom(smtp, { status: "on", imapHost: account?.imapHost ?? null, imapPort: account?.imapPort ?? null });
      return testMailConnection({ smtp: smtp.config, imap: asIfOn.config?.imap ?? null, sendOnly: asIfOn.reason === "send_only" }, { imap: deps.imap, createTransport: deps.createTransport, lookup: deps.lookup, now });
    },

    /** The daily safety net (not reachable from a route). */
    async syncForWorker(o: { budgetMs: number }): Promise<SyncOutcome> {
      return syncPlatform({ force: true, budgetMs: o.budgetMs });
    },

    /**
     * Mail to a desk (sales@, support@ at the platform sending domain) that reached HMS through Amazon SES receiving (services/mail/inboundService.ts): taken into the platform's
     * hub like mail read by IMAP, the whole email kept with its message (platform 0171) so it opens with no mailbox, and the conversation labelled with the desk. Not reachable from a route.
     */
    async receiveForWorker(entries: InboundEntry[], sources: ReadonlyMap<string, Buffer>, desk: DeskLabel): Promise<{ added: number }> {
      return unit.run(async (repos) => {
        const { added } = await repos.conversations.ingest(entries, { mailbox: null }, repos.matcher, now());
        for (const e of entries) {
          const m = await repos.conversations.messageByExternal("email", e.externalId);
          if (!m || m.direction !== "in") continue;
          const source = sources.get(e.externalId);
          if (source && source.byteLength >= 1 && source.byteLength <= MAIL_SOURCE_MAX && !(await repos.conversations.mailSource(m.id))) await repos.conversations.saveMailSource(m.id, source);
          await labelOf(repos, e, desk);
        }
        return { added };
      });
    },

    async purgeForWorker(before: Date): Promise<number> {
      return unit.run((repos) => repos.conversations.purge(before));
    },

    /** Platform settings > Mail: the read-only line "Reading this mailbox: on/off". null when 0139 is not run yet. */
    async readingLine(): Promise<{ reading: boolean; state: PlatformMailbox["state"]["state"] } | null> {
      try {
        const view = await mailboxView();
        return { reading: view.reading, state: view.state.state };
      } catch {
        return null;
      }
    },
  };
}

export type PlatformConversationsService = ReturnType<typeof createPlatformConversationsService>;
