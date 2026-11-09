// Conversations (decision 66; docs/plans/CONVERSATIONS-PLAN-2026-10-24.md): one inbox where a hotel's email and WhatsApp messages arrive together, one thread per person.
// The hotel's hub (paths under /conversations: Hotel Admin, staff with the Conversations permission, a Group Hotel Admin reading its hotels) and the platform's own
// (paths under /platform/conversations: Super Admin and Platform Admin, the same access). Email works end to end: HMS keeps only a list entry per email and opens the
// full email from the mailbox when it is clicked (C3). WhatsApp is the design only for now (whatsapp.ts). Every sentence of these screens is in conversationsCopy.
import type { DashResult } from './common';
import type { EmailFileUpload } from './mailFiles';
import type { WhatsAppHotelRow, WhatsAppMessage, WhatsAppReplyInput, WhatsAppSettings, WhatsAppWindow, WhatsAppAutomaticKey } from './whatsapp';

export const CONVERSATIONS_ROUTES = (base: '/conversations' | '/platform/conversations' | '/group/conversations' | '/my-mailbox/mail') => ({
  /** GET ?search&tab&channel&page&size */
  list: `${base}`,
  /** GET: the menu badge (does not keep a session alive) */
  summary: `${base}/summary`,
  /** POST { background?: boolean } -> SyncResult (the summary included) */
  sync: `${base}/sync`,
  /** GET ?before ; PATCH { assignedTo? | status? | box? } (exactly one) */
  thread: (id: string) => `${base}/${id}`,
  /** PUT read / DELETE unread */
  read: (id: string) => `${base}/${id}/read`,
  /** PUT (always to Other) / DELETE */
  mute: (id: string) => `${base}/${id}/mute`,
  reply: (id: string) => `${base}/${id}/reply`,
  /** GET ?images=1 */
  body: (id: string, m: string) => `${base}/${id}/messages/${m}/body`,
  attachment: (id: string, m: string, part: number) => `${base}/${id}/messages/${m}/attachments/${part}`,
  notes: (id: string) => `${base}/${id}/notes`,
  note: (id: string, n: string) => `${base}/${id}/notes/${n}`,
  /** PUT { kind, targetId } / DELETE */
  link: (id: string) => `${base}/${id}/link`,
  /** GET ?search&kind */
  linkCandidates: `${base}/link-candidates`,
  staff: `${base}/staff`,
  quickReplies: `${base}/quick-replies`,
  quickReply: (id: string) => `${base}/quick-replies/${id}`,
  whatsapp: `${base}/whatsapp`,
  /** PATCH (live: 409 until WhatsApp is connected) */
  whatsappAutomatic: `${base}/whatsapp/automatic`,
});
export const PLATFORM_MAILBOX_ROUTES = { mailbox: '/platform/conversations/mailbox', test: '/platform/conversations/mailbox/test', whatsappHotels: '/platform/conversations/whatsapp/hotels' } as const;
/** Hotel Settings > Email: "Test connection" (IMAP and SMTP with the SAVED settings). */
export const HOTEL_MAIL_CONNECTION_TEST = '/admin/settings/email/connection-test';

export type ConvChannel = 'email' | 'whatsapp';
export type ConvDirection = 'in' | 'out';
export type ConvMessageStatus = 'pending' | 'received' | 'sent' | 'delivered' | 'read' | 'failed';
export type ConvTab = 'all' | 'unread' | 'mine' | 'unassigned' | 'waiting' | 'done' | 'other';
export const CONV_TABS: readonly ConvTab[] = ['all', 'unread', 'mine', 'unassigned', 'waiting', 'done', 'other'];
export type ConvChannelFilter = 'all' | ConvChannel;
/** Whose inbox: a hotel's, the platform's, or a group's own (platform 0166). */
export type ConvScope = 'hotel' | 'platform' | 'group' | 'personal';
/** main = the list; other = bulk and automated mail (newsletters, notices) kept apart. */
export type ConvBox = 'main' | 'other';
export const CONV_PAGE_SIZES = [25, 50, 100] as const;
export const CONV_NOTE_MAX = 2000;
export const CONV_REPLY_MAX = 20000;
export const CONV_SUBJECT_MAX = 500;
export const CONV_CC_MAX = 5;
export const CONV_QUICK_TITLE_MAX = 80;
export const CONV_QUICK_BODY_MAX = 2000;
/** A thread shows this many messages at a time (older ones by `before`). */
export const CONV_THREAD_PAGE = 50;

/**
 * WhatsApp is the hotel's one shared desk (MJ, 5 Nov 2026): every chat belongs to the whole team, so a chat is never assigned or closed, and a list of the
 * WhatsApp channel shows every chat whatever its done state (old data). Email keeps its owners and its done state.
 */
export const sharedDesk = (channel: ConvChannelFilter | undefined): boolean => channel === 'whatsapp';
/** A conversation of WhatsApp only: the server refuses to assign it or mark it done. */
export const isWhatsAppChat = (channels: readonly ConvChannel[]): boolean => channels.includes('whatsapp') && !channels.includes('email');

/**
 * Which tab a conversation belongs to (the server and the mock use the same rule):
 * all = main list and open; unread = main list with unread messages; mine = assigned to me and open; unassigned = main list, open, nobody assigned;
 * waiting = main list, open, the newest message is the guest's; done = marked done (either box); other = Other and open.
 * On the shared desk (sharedDesk) "open" holds for every chat.
 */
export function inTab(tab: ConvTab, c: { box: ConvBox; status: 'open' | 'done'; unread: number; assignedTo: string | null; lastDirection: ConvDirection }, me: string, channel?: ConvChannelFilter): boolean {
  const open = c.status === 'open' || sharedDesk(channel);
  switch (tab) {
    case 'all':
      return c.box === 'main' && open;
    case 'unread':
      return c.box === 'main' && c.unread > 0;
    case 'mine':
      return c.assignedTo === me && open;
    case 'unassigned':
      return c.box === 'main' && open && c.assignedTo === null;
    case 'waiting':
      return c.box === 'main' && open && c.lastDirection === 'in';
    case 'done':
      return c.status === 'done';
    case 'other':
      return c.box === 'other' && open;
  }
}

export interface ConvPerson {
  id: string;
  name: string;
}

export type ConvLinkKind = 'customer' | 'stay' | 'reservation' | 'company' | 'user' | 'hotel';

/** What a conversation is linked to. `detail` carries only what the viewer may see (room and dates need the matching Front Office view; the bill needs Bills view). */
export interface ConvLink {
  kind: ConvLinkKind;
  id: string;
  label: string;
  source: 'auto' | 'manual';
  detail?: { room?: string; checkIn?: string; checkOut?: string; status?: string; billId?: string; billNo?: string; billTotal?: number; hotelName?: string };
}

/** One row of the list. */
export interface ConversationRow {
  id: string;
  name: string;
  /** The address or number shown under the name (or instead of it, for an unknown sender). */
  handle: string;
  channels: ConvChannel[];
  lastChannel: ConvChannel;
  lastAt: string;
  lastDirection: ConvDirection;
  preview: string;
  subject?: string;
  unread: number;
  hasAttachments: boolean;
  /** Open, and the newest message is the guest's. */
  waiting: boolean;
  status: 'open' | 'done';
  box: ConvBox;
  assignedTo: ConvPerson | null;
  linked: boolean;
  /** The newest email from this person could not be verified by the mail server (A12). */
  unverified: boolean;
  /** Email: starred (Gmail's star). WhatsApp: a favourite. Only the demo carries these until the server does; absent = not starred. */
  starred?: boolean;
  /** WhatsApp: pinned to the top of the chat list. */
  pinned?: boolean;
  /** Labels on the conversation (CHANNEL_LABELS). */
  labels?: string[];
  /** WhatsApp: the number of messages from the guest the team has not answered (the green bubble), and a short word for the last message's ticks. */
  lastStatus?: ConvMessageStatus;
  /** Email: a draft is saved for this conversation. */
  draft?: boolean;
  /** Email: hidden from the Inbox until this time (ISO), then back on top. */
  snoozedUntil?: string;
  /** WhatsApp: minutes left of the 24-hour reply window (null = closed or never opened). */
  windowMinutes?: number | null;
  /** Email: how many messages the thread holds and who wrote in it (first names; 'me' for the hotel's own), for Gmail's "Anita, me (3)" line. */
  messageCount?: number;
  participants?: string[];
}

/** What the two channel pages (Email, WhatsApp) show in their left list: Gmail's folders and WhatsApp's chat filters. */
export type EmailFolder = 'inbox' | 'starred' | 'snoozed' | 'unread' | 'sent' | 'drafts' | 'mine' | 'waiting' | 'unassigned' | 'archive' | 'other';
export const EMAIL_FOLDERS: readonly EmailFolder[] = ['inbox', 'starred', 'snoozed', 'unread', 'sent', 'drafts', 'mine', 'waiting', 'unassigned', 'archive', 'other'];
export type WaFilter = 'all' | 'closing' | 'unread' | 'favourites' | 'pinned';
export const WA_FILTERS: readonly WaFilter[] = ['all', 'closing', 'unread', 'favourites', 'pinned'];
/** The platform's two desks (MJ, 2 Nov 2026): mail to sales@ or support@ (Google aliases of the platform mailbox) is labelled with its desk as it arrives, and answered from it. */
export const DESK_LABELS = ['Sales', 'Support'] as const;
export type DeskLabel = (typeof DESK_LABELS)[number];
/** The labels both pages offer (Gmail labels, WhatsApp Business labels); the desk labels are valid everywhere but offered first on the platform's page only. */
export const CHANNEL_LABELS: readonly string[] = ['Booking', 'Billing', 'Complaint', 'Corporate', 'VIP', 'Follow up', ...DESK_LABELS];
/** The labels one Email page offers, in order: the platform's desks first; a hotel's or group's page without them. */
export const labelsFor = (scope: ConvScope): readonly string[] =>
  scope === 'platform' ? [...DESK_LABELS, ...CHANNEL_LABELS.filter((l) => !(DESK_LABELS as readonly string[]).includes(l))] : CHANNEL_LABELS.filter((l) => !(DESK_LABELS as readonly string[]).includes(l));
/** The desk an email belongs to by the address it was sent to: `desks` maps a desk's lower-case address to its label. The first desk named wins. */
export function deskOf(addresses: readonly string[], desks: Readonly<Record<string, DeskLabel>>): DeskLabel | null {
  for (const a of addresses) {
    const hit = desks[a.trim().toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

/** A bulk action on the ticked conversations of the Email page. */
export type ConvBulkAction = 'snooze' | 'read' | 'unread' | 'done' | 'reopen' | 'star' | 'unstar' | 'other' | 'main' | 'trash';

/** What Gmail's search box understands, worked out of the typed text: from:, to:, subject:, label:, has:attachment, is:unread, is:starred, is:read; the rest are plain words. */
export interface ParsedSearch {
  words: string[];
  from: string[];
  subject: string[];
  label: string[];
  hasAttachment: boolean;
  isUnread: boolean;
  isRead: boolean;
  isStarred: boolean;
}
export function parseSearch(text: string): ParsedSearch {
  const out: ParsedSearch = { words: [], from: [], subject: [], label: [], hasAttachment: false, isUnread: false, isRead: false, isStarred: false };
  for (const raw of text.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const [k, ...rest] = raw.split(':');
    const v = rest.join(':');
    if (!v) out.words.push(raw);
    else if (k === 'from' || k === 'to') out.from.push(v);
    else if (k === 'subject') out.subject.push(v);
    else if (k === 'label') out.label.push(v);
    else if (k === 'has' && v === 'attachment') out.hasAttachment = true;
    else if (k === 'is' && v === 'unread') out.isUnread = true;
    else if (k === 'is' && v === 'read') out.isRead = true;
    else if (k === 'is' && v === 'starred') out.isStarred = true;
    else out.words.push(raw);
  }
  return out;
}

/** Where the mailbox stands: off, not usable for reading (with why), working, failing, or being checked. `message` is a fixed sentence. */
export interface MailboxState {
  state: 'off' | 'not_available' | 'ok' | 'error' | 'checking';
  reason?: 'off' | 'platform_mail' | 'send_only' | 'not_set' | 'password_unreadable' | 'needs_update';
  checkedAt: string | null;
  address: string | null;
  message?: string;
  /** No mailbox of its own, but mail to this address reaches this inbox through Amazon SES receiving (MJ, 2 Nov 2026), and replies go out from it. */
  receivingAddress?: string;
}

export interface WhatsAppChannelState {
  connected: boolean;
  available: boolean;
  number?: string;
  displayName?: string;
}

export interface ConversationList {
  items: ConversationRow[];
  page: number;
  size: number;
  total: number;
  counts: Record<ConvTab, number>;
  /** The size of each Email folder and WhatsApp filter (the channel pages' left list). Demo only until the server carries it. */
  folderCounts?: Record<string, number>;
  /** The numbers of the insights bar on the channel pages: how fast the team answers, how many were answered today, how many WhatsApp windows close soon, how many wait over a day. Demo only until the server carries them. */
  insights?: { avgReplyMinutes: number | null; repliedToday: number; closingSoon: number; overdue: number; waiting: number };
  mailbox: MailboxState;
  whatsapp: WhatsAppChannelState;
}

/** The menu badge: the team's unread count (main list), and where the two channels stand. */
export interface ConvSummary {
  unread: number;
  mailbox: MailboxState;
  whatsapp: WhatsAppChannelState;
}

/** A mail check: whether one ran now (another may be running, or one ran a moment ago) and how many new messages it listed, with the summary for the badge. */
export interface SyncResult extends ConvSummary {
  checked: boolean;
  added: number;
}

/** One email in a thread: the list entry (the body is opened on demand, getEmailBody). */
export interface EmailEntry {
  kind: 'email';
  id: string;
  direction: ConvDirection;
  status: ConvMessageStatus;
  at: string;
  from: string;
  replyTo: string | null;
  to: string[];
  cc: string[];
  subject: string;
  preview: string;
  hasAttachments: boolean;
  sentBy: ConvPerson | null;
  /** contact = the guest; hms = a reply from HMS; mailbox = written in the mailbox itself (Gmail) as an answer in a hub thread. */
  sentFrom: 'contact' | 'hms' | 'mailbox';
  /** Inbound only: did the receiving mail server confirm the sender (A12)? null for outgoing mail. */
  verified: boolean | null;
}

export type ConvMessage = EmailEntry | WhatsAppMessage;

export interface ConvNote {
  id: string;
  text: string;
  author: ConvPerson;
  at: string;
  /** Written by the viewer (they may remove it; the Hotel Admin may remove any). */
  mine: boolean;
}

export interface ReplyChannel {
  channel: ConvChannel;
  available: boolean;
  reason?: string;
}

/** What the viewer may do in this hub (the server works it out; screens never guess). */
export interface ConvAccess {
  canEdit: boolean;
  /** visit = a Group Hotel Admin reading during a visit; view_only = the Conversations right is View. */
  readOnlyReason: 'visit' | 'view_only' | null;
  canSeeStay: boolean;
  canSeeBills: boolean;
  /** The kinds the viewer may link to (empty without Edit). */
  canLink: ConvLinkKind[];
}

export interface ConversationThread {
  id: string;
  contact: { name: string; handles: string[]; muted: boolean };
  links: ConvLink[];
  status: 'open' | 'done';
  box: ConvBox;
  assignedTo: ConvPerson | null;
  unread: number;
  /** Oldest first, the newest CONV_THREAD_PAGE. */
  messages: ConvMessage[];
  hasOlder: boolean;
  notes: ConvNote[];
  window: WhatsAppWindow | null;
  replyChannels: ReplyChannel[];
  defaultChannel: ConvChannel;
  access: ConvAccess;
  /** Who an email reply goes to: the newest email's From; `differsFrom` is a different Reply-To it asked for (chosen only on purpose, A12). */
  replyTo: { address: string; differsFrom: string | null } | null;
  /** Starred (email) or a favourite (WhatsApp), pinned (WhatsApp), and the labels. Demo only until the server carries them. */
  starred?: boolean;
  pinned?: boolean;
  labels?: string[];
  snoozedUntil?: string | null;
}

/** A new email written in Compose (Gmail's Compose window). */
export interface ComposeEmailInput {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  /** The files added to the email: the `ref` of each (api.addEmailFile). They go as ordinary attachments (25 MB in all, Gmail's rules) and are removed from the bucket an hour after the send. */
  attachments?: string[];
  /** true = save as a draft instead of sending. */
  draft?: boolean;
  /** My mailbox only: one of the person's own addresses (the main one or an extra one); default the main one. */
  from?: string;
}

/** A new WhatsApp chat: the number (with the country code), a name, and the approved message or a first line (only inside an open window). */
export interface StartChatInput {
  phone: string;
  name?: string;
  text?: string;
  templateId?: string;
  variables?: string[];
}

export interface EmailAttachment {
  part: number;
  name: string;
  size: number;
  type: string;
  /** A bill PDF that the viewer may not open (Bills permission). */
  billLocked?: boolean;
}

/** One email opened from the mailbox: sanitised HTML (or null), the text, what was held back. Never stored. */
export interface EmailBody {
  id: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  at: string;
  html: string | null;
  /** The text (for an email without HTML: without its quoted history, which is in `quotedText`). */
  text: string;
  quotedText?: string;
  /** Remote images held back until "Show images". */
  remoteImages: number;
  /** Inline pictures left out (over the size budget). */
  droppedInline: number;
  /** The HTML holds quoted history (wrapped in data-hms-quote) or the text has a quoted part. */
  hasQuoted: boolean;
  attachments: EmailAttachment[];
  /** Too large to show here: open it in the mailbox. */
  tooLarge?: { size: number };
}

export interface EmailReplyInput {
  channel: 'email';
  /** The email this answers (its id in the thread); default the newest. */
  inReplyTo?: string;
  /** Only the original's Reply-To, chosen on purpose; default the original's From. */
  to?: string;
  cc?: string[];
  subject?: string;
  text: string;
  /** Attach this bill's PDF (Bills permission, and only to the linked guest's own address). */
  billId?: string;
  /** My mailbox only: one of the person's own addresses; default the main one. */
  from?: string;
}
export type ReplyInput = EmailReplyInput | WhatsAppReplyInput;

export interface QuickReply {
  id: string;
  title: string;
  body: string;
  channel: 'any' | ConvChannel;
  sortOrder: number;
}
export interface QuickReplyInput {
  title: string;
  body: string;
  channel?: 'any' | ConvChannel;
  sortOrder?: number;
}

export interface LinkCandidate {
  kind: ConvLinkKind;
  id: string;
  label: string;
  detail?: string;
}

/** One side of "Test connection": fixed sentences only, never the server's own words. */
export interface MailCheck {
  ok: boolean;
  code: string | null;
  message: string;
  hint?: string;
}
export interface MailConnectionTest {
  imap: MailCheck;
  smtp: MailCheck;
  at: string;
}

/** Console > Conversations > Settings > Mailbox. The login and password stay in Platform settings > Mail (Super Admin). */
export interface PlatformMailbox {
  reading: boolean;
  /** Reading can be switched on (a Gmail or own mail server is saved and its password opens). */
  canRead: boolean;
  reason?: MailboxState['reason'];
  provider: 'gmail' | 'smtp' | null;
  address: string | null;
  imapHost: string | null;
  imapPort: 993 | 143;
  /** Gmail: the IMAP server is fixed (imap.gmail.com, 993). */
  imapFixed: boolean;
  state: MailboxState;
  lastTest: MailConnectionTest | null;
}
export interface PlatformMailboxInput {
  reading: boolean;
  imapHost?: string;
  imapPort?: 993 | 143;
}

export interface ConversationListQuery {
  search?: string;
  tab?: ConvTab;
  channel?: ConvChannelFilter;
  page?: number;
  size?: number;
  /** The Email page's folder (inbox, starred, sent ...) or the WhatsApp page's filter; wins over `tab` where given. Demo only until the server carries it. */
  folder?: EmailFolder | WaFilter;
  label?: string;
  /** My mailbox only: the threads with mail to or from this one of the person's addresses. */
  address?: string;
}

export interface ConversationsApi {
  list(q: ConversationListQuery): Promise<DashResult<ConversationList>>;
  getSummary(): Promise<DashResult<ConvSummary>>;
  syncMail(opts?: { background?: boolean }): Promise<DashResult<SyncResult>>;
  getThread(id: string, opts?: { before?: string }): Promise<DashResult<ConversationThread>>;
  getEmailBody(id: string, messageId: string, opts?: { images?: boolean }): Promise<DashResult<EmailBody>>;
  attachmentHref(id: string, messageId: string, part: number): string;
  sendReply(id: string, input: ReplyInput): Promise<DashResult<ConvMessage>>;
  setAssignee(id: string, userId: string | null): Promise<DashResult<ConversationThread>>;
  setStatus(id: string, status: 'open' | 'done'): Promise<DashResult<ConversationThread>>;
  setBox(id: string, box: ConvBox): Promise<DashResult<ConversationThread>>;
  setMuted(id: string, on: boolean): Promise<DashResult<ConversationThread>>;
  markRead(id: string): Promise<DashResult<ConversationThread>>;
  markUnread(id: string): Promise<DashResult<ConversationThread>>;
  addNote(id: string, text: string): Promise<DashResult<ConvNote>>;
  deleteNote(id: string, noteId: string): Promise<DashResult<{ removed: true }>>;
  setLink(id: string, link: { kind: ConvLinkKind; targetId: string }): Promise<DashResult<ConversationThread>>;
  deleteLink(id: string): Promise<DashResult<ConversationThread>>;
  listLinkCandidates(search: string, kind?: ConvLinkKind): Promise<DashResult<LinkCandidate[]>>;
  listStaff(): Promise<DashResult<ConvPerson[]>>;
  listQuickReplies(): Promise<DashResult<QuickReply[]>>;
  addQuickReply(input: QuickReplyInput): Promise<DashResult<QuickReply>>;
  updateQuickReply(id: string, input: QuickReplyInput): Promise<DashResult<QuickReply>>;
  deleteQuickReply(id: string): Promise<DashResult<{ removed: true }>>;
  // The channel pages' extras (Gmail's star, labels, Compose, bulk actions; WhatsApp's favourites, pins, New chat, starred messages). Optional: the page shows a control only when its
  // method is there, so the live server keeps working as it is until it carries them.
  setStarred?(id: string, on: boolean): Promise<DashResult<ConversationThread>>;
  setPinned?(id: string, on: boolean): Promise<DashResult<ConversationThread>>;
  setLabels?(id: string, labels: string[]): Promise<DashResult<ConversationThread>>;
  sendNewEmail?(input: ComposeEmailInput): Promise<DashResult<{ id: string }>>;
  /** Adds a file to an email being written: checked by Gmail's rules, then sent straight to the bucket (`onProgress` gets 0 to 100). Absent = this inbox cannot carry files. */
  addEmailFile?(file: { name: string; size: number }, onProgress?: (percent: number) => void): Promise<DashResult<EmailFileUpload>>;
  startWhatsAppChat?(input: StartChatInput): Promise<DashResult<{ id: string }>>;
  bulk?(ids: string[], action: ConvBulkAction): Promise<DashResult<{ changed: number }>>;
  setMessageStarred?(id: string, messageId: string, on: boolean): Promise<DashResult<ConversationThread>>;
  /** Snooze (until a time) or bring back (null). */
  setSnoozed?(id: string, until: string | null): Promise<DashResult<ConversationThread>>;
  /** A WhatsApp reaction on a message (an emoji), or none (null). */
  setReaction?(id: string, messageId: string, emoji: string | null): Promise<DashResult<ConversationThread>>;
  getWhatsAppSettings(): Promise<DashResult<WhatsAppSettings>>;
  setWhatsAppAutomatic(key: WhatsAppAutomaticKey, on: boolean): Promise<DashResult<WhatsAppSettings>>;
}

export interface PlatformMailboxApi {
  getMailbox(): Promise<DashResult<PlatformMailbox>>;
  setMailbox(input: PlatformMailboxInput): Promise<DashResult<PlatformMailbox>>;
  startMailboxTest(): Promise<DashResult<MailConnectionTest>>;
  listWhatsAppHotels(): Promise<DashResult<WhatsAppHotelRow[]>>;
}

// ---- My mailbox (platform 0178, 0179; MJ, 3 Nov 2026): every staff login has its own mailbox on the platform's Amazon SES domain, the same page in the hotel, group and platform dashboards. Nobody else can open it.
/** The address route; the mail itself is CONVERSATIONS_ROUTES('/my-mailbox/mail'). Neutral: it works from any dashboard. */
export const PERSONAL_MAILBOX_ROUTES = { address: '/my-mailbox/address' } as const;
/** Why an address is not usable: no sending domain set up yet, a name that cannot be an address, or a name another mailbox already answers to. */
export type PersonalAddressReason = 'ok' | 'no_domain' | 'invalid' | 'reserved' | 'taken';
/** The signed-in person's mailbox address: <username>@<the platform sending domain>. `message` is a plain sentence when it is not usable. */
export interface PersonalAddressView {
  address: string | null;
  usable: boolean;
  reason: PersonalAddressReason;
  message: string | null;
  /** The extra addresses the Super Admin gave this login (MJ, 5 Nov 2026, rule 4): mail to them arrives in this mailbox too. */
  extras?: string[];
}
export interface PersonalMailboxApi {
  getAddress(): Promise<DashResult<PersonalAddressView>>;
}
export const personalMailboxCopy = {
  menu: 'My mailbox',
  title: 'My mailbox',
  addressIs: 'Your mailbox address is',
  alsoAt: 'Mail to these addresses arrives here too:',
  intro: 'Mail sent to this address arrives here, and every email you send from here goes out from it. Only you can open this mailbox: not the other admins, not a hotel.',
  copy: 'Copy',
  copied: 'Copied',
  unusable: 'This name is used by something else. Ask your admin to change your username.',
  noDomain: 'Mailbox addresses are not set up on this server yet. Ask your admin.',
  invalid: 'Your username cannot be used as a mailbox address. Ask your admin to change your username.',
  errors: {
    notStaff: 'My mailbox is for staff logins only.',
    visit: 'My mailbox cannot be opened while you are visiting a hotel. Leave the hotel first.',
    sendBlocked: 'Your mailbox cannot send until your username is changed. Ask your admin.',
    sendUnavailable: 'Your mailbox cannot send yet. Ask your admin.',
    sendFailed: 'Your email could not be sent. Try again in a minute.',
  },
} as const;
/** WhatsApp not connected yet (MJ, 5 Nov 2026): no greyed button, one line saying who acts; the Super Admin gets the working button. */
export const whatsappSetupCopy = {
  hotel: 'WhatsApp is not set up for this hotel yet. The platform team connects it.',
  platform: 'WhatsApp is not set up yet. The Super Admin connects the number.',
  setUp: 'Set up WhatsApp',
} as const;
/** The one Email page's switch between the mailboxes a person has (MJ, 5 Nov 2026). */
export const emailBoxCopy = {
  label: 'Mailbox',
  shared: { hotel: 'Hotel inbox', platform: 'Platform inbox', group: 'Group inbox' },
  mine: 'My mailbox',
} as const;
/** Every sentence of the Conversations screens (hotel and console). */
export const conversationsCopy = {
  title: 'Conversations',
  platformTitle: 'Conversations',
  searchPlaceholder: 'Search name, address, number or subject',
  tabs: { all: 'All', unread: 'Unread', mine: 'Mine', unassigned: 'Unassigned', waiting: 'Waiting', done: 'Done', other: 'Other' } as Record<ConvTab, string>,
  channels: { all: 'All channels', email: 'Email', whatsapp: 'WhatsApp' } as Record<ConvChannelFilter, string>,
  channelFilter: 'Channel',
  platformTabs: { inbox: 'Inbox', settings: 'Settings' },
  empty: {
    none: 'No conversations yet',
    noneBody: 'Emails to the hotel appear here a minute or two after they arrive.',
    search: 'Nothing matches your search',
    searchBody: 'Try another name, address or number.',
    other: 'Nothing in Other',
    otherBody: 'Newsletters and automated mail are kept here, away from guests.',
    done: 'Nothing marked done',
    offline: 'You are offline. Conversations show again when the connection is back.',
    thread: 'Pick a conversation to read it.',
  },
  unknown: 'Unknown',
  waiting: 'Waiting for reply',
  unverified: 'Unverified sender',
  unverifiedHelp: 'Your mail server could not confirm this email really came from {address}. Do not send bills or personal details until you are sure.',
  attachmentMark: 'Has attachments',
  newMessages: '{n} new message from {name}',
  newMessagesMany: '{n} new messages from {name}',
  mailbox: {
    checkedAgo: 'Checked {n} min ago',
    checkedJustNow: 'Checked just now',
    checking: 'Checking...',
    checkNow: 'Check now',
    neverChecked: 'Not checked yet',
    off: 'Reading this mailbox is off.',
    platformMail: 'This hotel sends its mail through the platform, so it has no inbox of its own to read. The platform administrator can connect the hotel\'s Google account under Hotel and group mail.',
    sendOnly: 'Your mail service only sends. Gmail or your own mail server is needed to read mail.',
    notSet: 'No mailbox is connected yet. The platform administrator connects the hotel\'s Google account under Hotel and group mail.',
    passwordUnreadable: 'The saved app password cannot be opened on this server. The platform administrator needs to type it again under Hotel and group mail.',
    needsUpdate: 'Conversations need the latest database update (platform 0139 and hotel 0050). Ask the platform owner to run them.',
    error: 'The last mail check did not work: {reason}',
    errorShort: 'Mail check failed',
  },
  setup: {
    emailTitle: "Read your hotel's email here",
    emailBody: "HMS checks the hotel's Inbox and Sent for new mail and lists each email here, grouped by guest. Replies go out from the hotel's own address. HMS keeps only a list of the emails (sender, subject, date, a short preview); the emails themselves stay in the mailbox.",
    platformEmailTitle: "Read the platform's email here",
    platformEmailBody: "HMS checks the platform mailbox's Inbox and Sent for new mail and lists each email here, grouped by person. Replies go out from the platform's own address.",
    actionPlatform: 'Open settings',
    staffLine: 'The hotel\'s mailbox is connected by the platform administrator. Ask them to connect the hotel\'s Google account to read mail here.',
    sendOnly: 'Your mail service only sends. Gmail or your own mail server is needed to read mail.',
    privacy: "Everyone with Conversations access can read every email in this mailbox, including password-reset emails. Use a front-desk address, not the owner's personal account.",
    whatsappTitle: 'WhatsApp',
  },
  readOnly: {
    visit: 'Read only during a visit.',
    viewOnly: 'You can read conversations. Ask your Hotel Admin for Edit access to reply, assign or add notes.',
  },
  email: {
    showImages: 'Show images',
    imagesHidden: 'Remote images are hidden to protect you.',
    droppedInline: '{n} pictures in this email are too large to show here.',
    showQuoted: 'Show quoted text',
    hideQuoted: 'Hide quoted text',
    attachments: 'Attachments',
    download: 'Download',
    tooLarge: 'Too large to open here ({size}). Open it in your mailbox.',
    gone: 'This email is no longer in the mailbox.',
    earlierMailbox: 'This email came from an earlier mailbox address.',
    loadFailed: 'This email could not be opened right now.',
    tryAgain: 'Try again',
    sentBy: 'Sent by {name}',
    sentFromMailbox: 'Sent from the mailbox',
    failed: 'Not sent',
    from: 'From',
    to: 'To',
    cc: 'Cc',
    subject: 'Subject',
    noSubject: '(no subject)',
    billLocked: 'Bill PDFs need the Bills permission to open.',
    replyToAlert: 'This email asks for replies to a different address ({address}).',
    replyToChoose: 'Reply to {address} instead',
    replyToBack: 'Reply to {address}',
    people: 'In this conversation',
    ccMark: 'Cc',
    messages: 'messages',
    message: 'message',
    attachment: 'Attachment',
  },
  reply: {
    channel: 'Reply on',
    to: 'To',
    cc: 'Cc',
    ccAdd: 'Add Cc',
    ccPlaceholder: 'Add an address, then Enter',
    ccRemove: 'Remove {address} from Cc',
    ccSuggested: 'People on this conversation',
    ccLimit: 'Up to {n} people can be in Cc.',
    ccBad: '{address} is not a valid email address.',
    mode: 'How to reply',
    modeReply: 'Reply',
    modeReplyAll: 'Reply all',
    subject: 'Subject',
    re: 'Re:',
    placeholder: 'Write a reply',
    fold: 'Fold the reply box',
    send: 'Send',
    sending: 'Sending...',
    shortcut: 'Ctrl+Enter to send',
    attachBill: 'Attach bill',
    billAttached: 'Bill {no} attached',
    removeBill: 'Remove bill',
    quickReplies: 'Quick replies',
    sent: 'Reply sent',
    comingSoon: 'Coming soon',
    whatsappNotConnected: 'WhatsApp is not connected yet.',
    emailNotAvailable: 'Email replies need the hotel\'s Google account, connected by the platform administrator.',
    noEmail: 'This person has no email address.',
  },
  notes: {
    title: 'Notes',
    hint: 'Only staff see notes',
    placeholder: 'Add a note for the team',
    add: 'Add note',
    remove: 'Remove note',
    removeConfirm: 'Remove this note?',
    empty: 'No notes yet.',
    added: 'Note added',
  },
  contact: {
    title: 'Contact',
    open: 'Contact details',
    close: 'Close contact details',
    linkGuest: 'Link guest',
    change: 'Change link',
    remove: 'Remove link',
    removeConfirm: 'Remove the link to {label}? The messages stay.',
    auto: 'Matched automatically',
    manual: 'Linked by staff',
    room: 'Room',
    dates: 'Dates',
    status: 'Status',
    bill: 'Bill',
    noLink: 'Not linked to a guest, stay or company.',
    /** The platform hub's words: there a conversation links to an account or a hotel. */
    noLinkPlatform: 'Not linked to an account or hotel.',
    linkPlatform: 'Link account or hotel',
    linkSearchPlatform: 'Search accounts and hotels',
    linkKinds: { customer: 'Guest', stay: 'Stay', reservation: 'Reservation', company: 'Company', user: 'Account', hotel: 'Hotel' } as Record<ConvLinkKind, string>,
    linkTitle: 'Link this conversation',
    linkSearch: 'Search guests, stays and companies',
    linkNone: 'Nothing found.',
    linked: 'Linked',
    link: 'Link',
  },
  actions: {
    markUnread: 'Mark unread',
    more: 'More',
    toOther: 'Not a guest: move to Other',
    muteSender: 'Always move this sender to Other',
    unmuteSender: 'Stop moving this sender to Other',
    toMain: 'Move back to the main list',
    undo: 'Undo',
    movedToOther: 'Moved to Other',
    movedToMain: 'Moved to the main list',
    back: 'Conversations',
    olderMessages: 'Show older messages',
  },
  quick: {
    title: 'Quick replies',
    manage: 'Manage quick replies',
    add: 'Add quick reply',
    titleLabel: 'Title',
    bodyLabel: 'Text',
    channelLabel: 'For',
    channelAny: 'Both channels',
    save: 'Save',
    edit: 'Change',
    remove: 'Remove',
    removeConfirm: 'Remove the quick reply "{title}"?',
    empty: 'No quick replies yet.',
    insert: 'Insert',
  },
  settings: {
    title: 'Settings',
    mailboxTitle: 'Mailbox',
    reading: 'Read this mailbox in Conversations',
    readingOn: 'On',
    readingOff: 'Off',
    readingLine: 'Reading this mailbox: {state}',
    loginWhere: 'The mailbox login and its password are in Platform settings > Mail (Super Admin).',
    imapHost: 'IMAP server (host)',
    imapPort: 'IMAP port',
    imapFixed: 'Gmail: imap.gmail.com, port 993.',
    save: 'Save',
    saved: 'Mailbox settings saved.',
    test: 'Test connection',
    saveFirst: 'Save first, then test.',
    checkOk: 'Works',
    checkFailed: 'Does not work',
    openMailSettings: 'Platform settings > Mail',
    testing: 'Checking...',
    reading_imap: 'Reading (IMAP)',
    sending_smtp: 'Sending (SMTP)',
    testedAt: 'Tested the saved settings, {time}',
  },
  errors: {
    needsUpdate: 'Conversations need the latest database update (platform 0139 and hotel 0050). Ask the platform owner to run them.',
    visitClosed: "A hotel's conversations are private: they do not open during a visit.",
    readOnlyVisit: 'Read only during a visit.',
    textRequired: 'Write a reply first.',
    textLong: 'The reply is too long.',
    subjectLong: 'The subject is too long.',
    ccMany: 'At most 5 Cc addresses.',
    ccBad: 'A Cc address is not valid.',
    recipient: 'Replies go to the sender of the email, or to the address it asked for.',
    fromNotOwn: 'You can send only from your own addresses. Choose one of them in From.',
    billOwn: "A bill can only be sent to the guest's own email address.",
    billLocked: 'Bill PDFs need the Bills permission to open.',
    noteRequired: 'Write the note first.',
    noteLong: 'The note is too long.',
    noteNotYours: 'Only the person who wrote a note (or the Hotel Admin) can remove it.',
    quickTitle: 'Give the quick reply a title.',
    quickBody: 'Write the quick reply text.',
    quickTaken: 'A quick reply with this title already exists.',
    notStaff: 'Choose someone from the team.',
    waShared: 'WhatsApp chats are shared by the whole team; they are not assigned or closed.',
    noMailbox: 'Email replies need the hotel\'s Google account, connected by the platform administrator.',
    sendFailed: 'The reply could not be sent: {reason}',
    tooLarge: 'This attachment is too large to open here. Open it in your mailbox.',
  },
} as const;

/** "{n} new message(s) from {name}": the live announcement for screen readers (the name only, never the text). */
export function newMessagesAnnouncement(n: number, name: string): string {
  return (n === 1 ? conversationsCopy.newMessages : conversationsCopy.newMessagesMany).replace('{n}', String(n)).replace('{name}', name);
}

export type { WhatsAppHotelRow, WhatsAppMessage, WhatsAppReplyInput, WhatsAppSettings, WhatsAppWindow };


/** A mail template of the mailbox (MJ, 5 Nov 2026): the desk picks the language, the text drops into the editor and stays editable. */
export interface MailTemplate {
  id: string;
  title: string;
  hint: string;
  body: Record<'en' | 'hi' | 'gu', string>;
}

/** The words of the hotel mailbox and My mailbox (GmailPage.tsx, MyMailbox.tsx; the mail-preview design, MJ, 5 Nov 2026). */
export const mailboxPageCopy = {
  title: 'Mailbox',
  newMail: 'New mail',
  search: 'Name, booking or subject',
  searchMine: 'Search my mail',
  folders: { inbox: 'Inbox', starred: 'Starred', snoozed: 'Snoozed', sent: 'Sent', drafts: 'Drafts', done: 'Done' },
  filters: { unassigned: 'Unassigned', mine: 'Mine' },
  labels: 'Labels',
  searchTips: 'Search tips: from:asha  subject:invoice  label:billing  is:unread  is:starred  has:attachment',
  star: 'Star',
  unstar: 'Remove star',
  starred: 'Starred',
  select: 'Select {name}',
  selectPage: 'Select all on this page',
  selected: '{n} selected',
  clearSelection: 'Clear selection',
  bulk: { done: 'Mark done', reopen: 'Reopen', read: 'Mark read', unread: 'Mark unread', star: 'Star', unstar: 'Remove star', snooze: 'Snooze 3 hours' },
  bulkDone: { done: '{n} marked done', reopen: '{n} back in the inbox', read: '{n} marked read', unread: '{n} marked unread', star: '{n} starred', unstar: '{n} unstarred', snooze: '{n} snoozed for 3 hours' },
  undo: 'Undo',
  snooze: {
    button: 'Snooze',
    title: 'Snooze until',
    later: 'Later today',
    tomorrow: 'Tomorrow',
    weekend: 'This weekend',
    nextWeek: 'Next week',
    pick: 'Pick a date and time',
    set: 'Snooze',
    future: 'Choose a time in the future.',
    snoozed: 'Snoozed until {when}',
    back: 'Back in the inbox',
    unsnooze: 'Unsnooze',
    until: 'Until {when}',
  },
  labelMenu: { button: 'Label', title: 'Labels on this mail', saved: 'Labels saved' },
  draftMark: 'Draft',
  sending: 'Sending...',
  sendCancelled: 'Not sent. Your text is kept.',
  shortcuts: {
    title: 'Keyboard shortcuts',
    open: 'Shortcuts',
    rows: [
      ['j / k', 'Next / previous mail'],
      ['Enter or o', 'Open'],
      ['x', 'Select'],
      ['s', 'Star'],
      ['e', 'Mark done'],
      ['r', 'Reply'],
      ['a', 'Reply all'],
      ['f', 'Forward'],
      ['c', 'New mail'],
      ['/', 'Search'],
      ['u', 'Back to the list'],
      ['?', 'This list'],
    ] as [string, string][],
  },
  threads: '{n} threads',
  thread: '1 thread',
  status: { open: 'Open', waiting: 'Waiting on guest', done: 'Done' },
  unassigned: 'Unassigned',
  you: 'You',
  hotelHint: 'Booking confirmations, bills and pay links go out by themselves. Automatic mails are set by the Hotel Admin in Settings > Messages.',
  mineHint: 'Only you read this box. Forward to desk sends a mail on to the hotel mailbox. Link to booking attaches it to a stay so the desk sees it on the guest file.',
  mineHintOwn: 'Only you read this box.',
  hotelFolder: 'Hotel mailbox',
  addresses: 'My addresses',
  actions: {
    reply: 'Reply',
    replyAll: 'Reply all',
    forward: 'Forward',
    openThread: 'Open thread',
    assign: 'Assign',
    assignToMe: 'Assign to me',
    assignTo: 'Assign to',
    markDone: 'Mark done',
    reopen: 'Reopen',
    attachBill: 'Attach bill',
    attachBillPdf: 'Attach bill PDF to reply',
    billAttached: 'Bill {no} goes with the reply',
    payLink: 'Send pay link',
    linkBooking: 'Link to booking',
    forwardDesk: 'Forward to desk',
    back: 'Back to the list',
  },
  toasts: {
    sent: 'Sent to {name}',
    done: 'Marked done',
    reopened: 'Back in the inbox',
    assigned: 'Assigned to {name}',
    unassigned: 'Nobody assigned now',
    saved: 'Draft saved',
    newSent: 'Mail sent',
  },
  empty: { inbox: 'Nothing waiting in the inbox', starred: 'No starred mail', snoozed: 'Nothing snoozed', sent: 'Nothing sent yet', drafts: 'No drafts', done: 'Nothing marked done yet', search: 'Nothing matches that', unassigned: 'Everything is assigned', mine: 'Nothing is assigned to you' },
  threadView: {
    showEarlier: 'Show earlier',
    hideEarlier: 'Hide earlier',
    auto: 'Sent automatically',
    hotel: 'Hotel',
    newMark: 'New',
    cc: 'Cc',
    idPhoto: 'ID photo · kept in the guest file, not shown here',
    automation: 'Automatic mails are set by the Hotel Admin in Settings > Messages.',
    guest: 'This guest',
    booking: 'Booking',
    room: 'Room',
    dates: 'Dates',
    bill: 'Bill',
    noBooking: 'No booking yet',
    noBookingBody: 'Not linked to a guest or booking.',
    firstMail: 'First mail',
    replyTo: 'Reply to {name}',
    verified: 'Sender confirmed',
    notVerified: 'Sender not confirmed',
  },
  compose: {
    title: 'New mail',
    replyTitle: 'Reply',
    to: 'To',
    cc: 'Cc',
    bcc: 'Bcc',
    subject: 'Subject',
    body: 'Write the mail',
    replyBody: 'Write a reply',
    from: 'Will go from {address}',
    fromLabel: 'From',
    send: 'Send',
    cancel: 'Cancel',
    saveDraft: 'Save draft',
    attach: 'Attach files',
    quick: 'Quick replies',
    templates: 'Templates',
    languages: { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' } as Record<'en' | 'hi' | 'gu', string>,
    toRequired: 'Enter the address to send to.',
    subjectRequired: 'Enter a subject.',
    bodyRequired: 'Write the mail first.',
    forwardLine: 'Forwarded from my mailbox',
    forwardedLine: 'Forwarded message',
    forwardTitle: 'Forward',
    replyAllTitle: 'Reply all',
  },
  templates: [
    {
      id: 'rates',
      title: 'Rates and availability',
      hint: 'Room types, rate, breakfast, GST line',
      body: {
        en: 'Thank you for writing to us. For your dates we have [room type] at [rate] a night with breakfast for two, GST extra. Early check-in is free when the room is ready. Shall we hold the rooms for you?',
        hi: 'हमें लिखने के लिए धन्यवाद। आपकी तारीखों के लिए [कमरे का प्रकार] [दर] प्रति रात उपलब्ध है, दो लोगों का नाश्ता शामिल, GST अलग। कमरा तैयार होने पर जल्दी चेक-इन निःशुल्क है। क्या हम आपके लिए कमरे रोक लें?',
        gu: 'અમને લખવા બદલ આભાર. તમારી તારીખો માટે [રૂમનો પ્રકાર] [દર] પ્રતિ રાત ઉપલબ્ધ છે, બે જણ માટે નાસ્તો સામેલ, GST અલગ. રૂમ તૈયાર હોય ત્યારે વહેલું ચેક-ઇન મફત છે. શું અમે તમારા માટે રૂમ રોકી રાખીએ?',
      },
    },
    {
      id: 'confirm',
      title: 'Booking confirmation',
      hint: 'Dates, advance, balance, check-in time',
      body: {
        en: 'Your booking is confirmed: [room type], [check-in] to [check-out]. Advance received [advance]; balance [balance] at check-out. Check-in is from 2 pm and check-out by 11 am. We look forward to having you.',
        hi: 'आपकी बुकिंग पक्की है: [कमरे का प्रकार], [चेक-इन] से [चेक-आउट] तक। अग्रिम [अग्रिम] मिला; शेष [शेष] चेक-आउट पर। चेक-इन दोपहर 2 बजे से और चेक-आउट सुबह 11 बजे तक। आपके स्वागत की प्रतीक्षा है।',
        gu: 'તમારું બુકિંગ પાકું છે: [રૂમનો પ્રકાર], [ચેક-ઇન] થી [ચેક-આઉટ]. એડવાન્સ [એડવાન્સ] મળ્યું; બાકી [બાકી] ચેક-આઉટ વખતે. ચેક-ઇન બપોરે 2 વાગ્યાથી અને ચેક-આઉટ સવારે 11 સુધી. તમારા સ્વાગત માટે આતુર છીએ.',
      },
    },
    {
      id: 'reminder',
      title: 'Payment reminder',
      hint: 'Balance due with the pay link',
      body: {
        en: 'A gentle reminder: [balance] is due on your bill [bill no]. You can pay at the desk or through the pay link below. Thank you.',
        hi: 'एक विनम्र स्मरण: आपके बिल [बिल नं] पर [शेष] बकाया है। आप डेस्क पर या नीचे दिए भुगतान लिंक से भुगतान कर सकते हैं। धन्यवाद।',
        gu: 'એક નમ્ર યાદ: તમારા બિલ [બિલ નં] પર [બાકી] બાકી છે. તમે ડેસ્ક પર અથવા નીચેની પે લિંકથી ચૂકવી શકો છો. આભાર.',
      },
    },
    {
      id: 'thanks',
      title: 'Thank you after stay',
      hint: 'Bill attached, review link',
      body: {
        en: 'Thank you for staying with us. Your bill is attached. If a moment allows, a short review helps us a great deal. We hope to see you again.',
        hi: 'हमारे साथ ठहरने के लिए धन्यवाद। आपका बिल संलग्न है। समय मिले तो एक छोटी समीक्षा हमारी बड़ी मदद करेगी। फिर मिलने की आशा है।',
        gu: 'અમારી સાથે રોકાવા બદલ આભાર. તમારું બિલ જોડેલું છે. સમય મળે તો ટૂંકી સમીક્ષા અમને ઘણી મદદ કરશે. ફરી મળવાની આશા છે.',
      },
    },
  ] as readonly MailTemplate[],
} as const;

/** The words of the two channel pages: Email (Gmail's way of working) and WhatsApp (WhatsApp Business's). */
export const channelPageCopy = {
  email: {
    title: 'Email',
    compose: 'Compose',
    searchPlaceholder: 'Search mail',
    searchHelp: 'Try from:name, subject:bill, label:vip, has:attachment, is:unread or is:starred.',
    folders: { inbox: 'Inbox', starred: 'Starred', snoozed: 'Snoozed', unread: 'Unread', sent: 'Sent', drafts: 'Drafts', mine: 'Assigned to me', waiting: 'Waiting for reply', unassigned: 'Unassigned', archive: 'Archive', other: 'Spam and promotions' } as Record<EmailFolder, string>,
    folderIcons: { inbox: 'inbox', starred: 'star', snoozed: 'clock', unread: 'envelope', sent: 'send', drafts: 'file-earmark-text', mine: 'person-check', waiting: 'hourglass-split', unassigned: 'person-dash', archive: 'archive', other: 'shield-exclamation' } as Record<EmailFolder, string>,
    labels: 'Labels',
    selectAll: 'Select all',
    selected: '{n} selected',
    bulk: { snooze: 'Snooze', read: 'Mark as read', unread: 'Mark as unread', done: 'Archive', reopen: 'Move to Inbox', star: 'Star', unstar: 'Remove star', other: 'Report as spam', main: 'Not spam', trash: 'Delete' } as Record<ConvBulkAction, string>,
    bulkDone: '{n} conversations updated.',
    empty: { inbox: 'Your inbox is empty', starred: 'No starred conversations', snoozed: 'Nothing snoozed', unread: 'Nothing unread', sent: 'Nothing sent yet', drafts: 'No drafts', mine: 'Nothing is assigned to you', waiting: 'Nobody is waiting for a reply', unassigned: 'Everything is assigned', archive: 'Nothing archived', other: 'No spam or promotions', search: 'Nothing matches your search' },
    star: 'Star', unstar: 'Remove star', labelsMenu: 'Labels', noLabels: 'No labels',
    reply: 'Reply', replyAll: 'Reply all', forward: 'Forward', print: 'Print',
    forwardSubject: 'Fwd:',
    shortcuts: { title: 'Keyboard shortcuts', items: [['c', 'Compose'], ['/', 'Search'], ['j / k', 'Next / previous conversation'], ['s', 'Star'], ['e', 'Archive'], ['Shift + U', 'Mark as unread'], ['?', 'This list']] as [string, string][] },
    composeForm: { title: 'New message', to: 'To', cc: 'Cc', bcc: 'Bcc', ccBcc: 'Cc Bcc', subject: 'Subject', body: 'Write your message', attach: 'Attach files', send: 'Send', saveDraft: 'Save draft', discard: 'Discard', sent: 'Message sent.', draftSaved: 'Draft saved.', toRequired: 'Enter the address to send to.', toBad: 'Enter a valid email address.', subjectRequired: 'Enter a subject.', bodyRequired: 'Write a message.', noSubject: '(no subject)', signature: '' },
    drafts: 'Draft',
    snooze: 'Snooze',
  },
  whatsapp: {
    title: 'WhatsApp',
    newChat: 'New chat',
    searchPlaceholder: 'Search or start a new chat',
    filters: { all: 'All', closing: 'Closing soon', unread: 'Unread', favourites: 'Favourites', pinned: 'Pinned' } as Record<WaFilter, string>,
    labels: 'Labels',
    pin: 'Pin chat', unpin: 'Unpin chat', favourite: 'Add to favourites', unfavourite: 'Remove from favourites',
    starMessage: 'Star message', unstarMessage: 'Unstar message', starredMessages: 'Starred messages', noStarred: 'No starred messages in this chat.',
    messageInfo: 'Message info', copy: 'Copy', copied: 'Copied.', reply: 'Reply',
    searchInChat: 'Search in chat', searchInChatPlaceholder: 'Search messages', noHits: 'No messages found', hits: '{n} found',
    emoji: 'Emoji', attach: 'Attach', attachMenu: { photo: 'Photos and videos', document: 'Document', location: 'Location', contact: 'Contact', voice: 'Voice message' },
    attachNote: 'Attachments go out once WhatsApp is connected. The demo keeps the name only.',
    info: { title: 'Message info', sent: 'Sent', delivered: 'Delivered', read: 'Read', by: 'Sent by', notYet: 'Not yet' },
    newChatForm: { title: 'New chat', phone: 'WhatsApp number', phoneHint: 'With the country code, for example +91 98765 43210.', name: 'Name (optional)', message: 'First message', templateNote: 'A new chat starts with an approved message: WhatsApp only allows free text once the guest has written to you.', template: 'Approved message', start: 'Start chat', phoneBad: 'Enter the number with the country code, like +91 98765 43210.', templateRequired: 'Choose an approved message.', started: 'Chat started.' },
    empty: { all: 'No chats yet', closing: 'No window is closing soon', unread: 'No unread chats', favourites: 'No favourite chats', pinned: 'No pinned chats' } as Record<WaFilter, string>,
    typing: 'typing...',
    pinnedLimit: 'You can pin up to 3 chats.',
  },
} as const;
