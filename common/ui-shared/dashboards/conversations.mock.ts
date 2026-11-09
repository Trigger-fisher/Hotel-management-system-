// The Conversations hub in memory (decision 66): SAMPLE data for the design and the dev previews (/dev/dashboard, the local demo build), never the live site.
// The same contract as the server (conversations.ts): the tab rules (inTab), newest first, the channel filter, the search, team-wide unread, assignment, notes,
// quick replies, links (with the A14 detail rules), Other and mute, and the email bodies opened on demand. WhatsApp is the design (whatsapp.ts): every message
// type, the ticks (a reply goes pending -> sent -> delivered after 2 s -> read after 5 s), the 24-hour window, templates, "Sent from Phone" and automatic messages.
// Dev switches, set in the browser console and read at call time:
//   window.__convWhatsApp = 'off'                                        WhatsApp not connected (as the live site today)
//   window.__convMailbox  = 'error' | 'off' | 'not_available' | 'needs_update'   the mailbox line; the last three show a hotel that has not started (the setup panel)
//   window.__convAccess   = 'view_only' | 'visit'                        the read-only screens
//   window.__convProvider = 'smtp'                                       the platform mailbox on its own mail server (host and port fields)
import { mockCall, mockEmptyHotel, mockError, ok, type DashResult, type MockClock } from './common';
import { mailFileProblem, type EmailFileUpload } from './mailFiles';
import {
  CONV_CC_MAX,
  CONV_NOTE_MAX,
  CONV_QUICK_BODY_MAX,
  CONV_QUICK_TITLE_MAX,
  CONV_REPLY_MAX,
  CONV_SUBJECT_MAX,
  CONV_TABS,
  CONV_THREAD_PAGE,
  CHANNEL_LABELS,
  EMAIL_FOLDERS,
  WA_FILTERS,
  channelPageCopy,
  conversationsCopy,
  inTab,
  isWhatsAppChat,
  parseSearch,
  type ComposeEmailInput,
  type ConvBulkAction,
  type EmailFolder,
  type StartChatInput,
  type WaFilter,
  type ConvAccess,
  type ConvBox,
  type ConvChannel,
  type ConvLink,
  type ConvLinkKind,
  type ConvMessage,
  type ConvNote,
  type ConvPerson,
  type ConvScope,
  type ConvSummary,
  type ConvTab,
  type ConversationList,
  type ConversationListQuery,
  type ConversationRow,
  type ConversationsApi,
  type ConversationThread,
  type EmailBody,
  type EmailEntry,
  type LinkCandidate,
  type MailboxState,
  type MailConnectionTest,
  type PlatformMailbox,
  type PlatformMailboxApi,
  type PlatformMailboxInput,
  type QuickReply,
  type QuickReplyInput,
  type ReplyChannel,
  type ReplyInput,
  type SyncResult,
  type WhatsAppChannelState,
} from './conversations';
import { createWhatsAppSettingsMock, mockWhatsAppOff } from './whatsapp.mock';
import { WHATSAPP_NOT_CONNECTED, whatsappCopy, windowOf, type WhatsAppMessage } from './whatsapp';

declare function setTimeout(callback: () => void, ms?: number): unknown;

/** Who is working (the real server reads the session): the id decides "Mine" and "my" notes; the role and grants decide what the person may do (ConvAccess). */
export interface ConversationsMockActor {
  id: string;
  name: string;
  role?: string;
  grants?: Readonly<Record<string, string>> | null;
  /** A Group Hotel Admin's visit: read only. */
  visit?: boolean;
}

export interface ConversationsMockOptions extends MockClock {
  scope?: ConvScope;
  now?: () => number;
  /** How long a WhatsApp reply waits before each tick (ms). */
  waDelays?: { sent: number; delivered: number; read: number };
  /** The mailbox the list shows as its own (My mailbox: the person's address); default the scope's. */
  mailboxAddress?: string;
  /** Told when conversations change by themselves (a tick moves, a guest writes): the ids only, as the live server tells its pages. */
  onChange?: (ids: string[]) => void;
}

type DevSwitch = '__convWhatsApp' | '__convMailbox' | '__convAccess' | '__convProvider';
const dev = (k: DevSwitch): string | undefined => {
  const v = (globalThis as Record<string, unknown>)[k];
  return typeof v === 'string' ? v : undefined;
};

interface MockNote {
  id: string;
  text: string;
  author: ConvPerson;
  at: string;
}

interface MockThread {
  id: string;
  contact: { name: string; handles: string[]; muted: boolean };
  links: ConvLink[];
  status: 'open' | 'done';
  box: ConvBox;
  assignedTo: ConvPerson | null;
  unread: number;
  messages: ConvMessage[];
  notes: MockNote[];
  /** Opened emails, by message id (the server fetches these from the mailbox; never stored there). */
  bodies: Record<string, EmailBody>;
  /** Messages that are no longer in the mailbox (opening one answers NOT_FOUND). */
  gone?: string[];
  /** The channel pages' extras: Gmail's star / WhatsApp favourite, a WhatsApp pin, labels, a saved draft, and deleted (Trash). */
  starred?: boolean;
  pinned?: boolean;
  labels?: string[];
  draft?: boolean;
  deleted?: boolean;
  snoozedUntil?: string;
}

/** What the sample shows on the two channel pages the first time: a few stars, pins and labels, so the folders and filters have something in them. */
const SAMPLE_EXTRAS: Record<string, Pick<MockThread, 'starred' | 'pinned' | 'labels'>> = {
  'cv-asha': { starred: true, pinned: true, labels: ['VIP', 'Booking'] },
  'cv-ravi': { starred: true, labels: ['Booking'] },
  'cv-kiran': { labels: ['Billing'] },
  'cv-pooja': { starred: true, pinned: true },
  'cv-vikram': { labels: ['Complaint'] },
  'cv-sneha': { pinned: true, labels: ['Follow up'] },
  'cv-rahul': { labels: ['Corporate'] },
};

const ME = 'u-me';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const isPhone = (h: string) => /^\+?[0-9 ]{8,20}$/.test(h);
const isEmail = (h: string) => h.includes('@');
const digits = (h: string) => h.replace(/[^0-9]/g, '');
const addrOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();
const isMailAddress = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);

function emailMsg(p: Pick<EmailEntry, 'id' | 'direction' | 'at' | 'from' | 'to' | 'subject' | 'preview'> & Partial<EmailEntry>): EmailEntry {
  return {
    kind: 'email',
    status: p.direction === 'in' ? 'received' : 'sent',
    replyTo: null,
    cc: [],
    hasAttachments: false,
    sentBy: null,
    sentFrom: p.direction === 'in' ? 'contact' : 'hms',
    verified: p.direction === 'in' ? true : null,
    ...p,
  };
}

function waMsg(p: Pick<WhatsAppMessage, 'id' | 'direction' | 'at'> & Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    kind: 'whatsapp',
    status: p.direction === 'in' ? 'received' : 'read',
    sentBy: null,
    sentFrom: p.direction === 'in' ? 'contact' : 'hms',
    type: 'text',
    ...p,
  };
}

/** A small picture drawn inline (the mock's photos, posters, stickers and the "remote" images once shown): never a request to anywhere. */
function picture(label: string, tone: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' fill='${tone}'/><text x='160' y='108' font-family='sans-serif' font-size='20' fill='white' text-anchor='middle'>${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function htmlBody(id: string, at: string, from: string, to: string[], subject: string, html: string, text: string, more: Partial<EmailBody> = {}): EmailBody {
  return { id, subject, from, to, cc: [], at, html, text, remoteImages: 0, droppedInline: 0, hasQuoted: html.includes('data-hms-quote'), attachments: [], ...more };
}

function textBody(id: string, at: string, from: string, to: string[], subject: string, text: string, more: Partial<EmailBody> = {}): EmailBody {
  return { id, subject, from, to, cc: [], at, html: null, text, remoteImages: 0, droppedInline: 0, hasQuoted: Boolean(more.quotedText), attachments: [], ...more };
}

// ------------------------------------------------------------------------------------------------ the hotel's sample

const HOTEL_MAILBOX = 'frontdesk@hotelsunrise.in';
const HOTEL_STAFF: ConvPerson[] = [
  { id: 'u-neha', name: 'Neha Patel' },
  { id: 'u-arjun', name: 'Arjun Mehta' },
  { id: 'u-sonal', name: 'Sonal Joshi' },
];
const NEHA = HOTEL_STAFF[0];
const ARJUN = HOTEL_STAFF[1];

function isoDay(ms: number): string {
  const x = new Date(ms + 330 * MIN);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/** The hotel sample; `box` is the mailbox it was sent to (the hotel desk, or the signed-in person in My mailbox). */
function hotelSample(now: number, box: string = HOTEL_MAILBOX): MockThread[] {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const me: ConvPerson = { id: ME, name: 'You' };

  // Asha Rao: WhatsApp, the window closing soon (her last message 22 h 50 min ago), 2 unread, linked to her stay in 204 with the bill, a note, a reaction, a reply-to.
  const asha: MockThread = {
    id: 'cv-asha',
    contact: { name: 'Asha Rao', handles: ['+91 98250 43210'], muted: false },
    links: [{ kind: 'stay', id: 'st-204', label: 'Asha Rao · Room 204', source: 'auto', detail: { room: '204', checkIn: isoDay(now - 2 * DAY), checkOut: isoDay(now + DAY), status: 'In house', billId: 'b-1042', billNo: 'B-1042', billTotal: 1_245_000 } }],
    status: 'open',
    box: 'main',
    assignedTo: NEHA,
    unread: 2,
    messages: [
      waMsg({ id: 'm-asha-1', direction: 'in', at: ago(2 * DAY + 3 * HOUR), text: 'Hi, is early check-in possible tomorrow? Our train reaches Rajkot at 7 am.' }),
      waMsg({ id: 'm-asha-2', direction: 'out', at: ago(2 * DAY + 2 * HOUR), sentBy: NEHA, text: 'Good morning Ms Rao! Yes, room 204 will be ready from 9 am. See you tomorrow.', reactions: [{ emoji: '🙏', fromContact: true }] }),
      waMsg({ id: 'm-asha-3', direction: 'in', at: ago(2 * DAY + HOUR), type: 'image', media: { name: 'ticket.jpg', size: 184_320, mime: 'image/jpeg', caption: 'Our train ticket, in case you need it', previewUrl: picture('Train ticket', '#111114') } }),
      waMsg({ id: 'm-asha-4', direction: 'out', at: ago(DAY + 2 * HOUR), sentBy: NEHA, text: 'Your bill so far is ready. You can pay at the desk or by UPI.', status: 'read' }),
      waMsg({ id: 'm-asha-5', direction: 'in', at: ago(22 * HOUR + 52 * MIN), text: 'Can we get an extra bed for our son tonight?', replyTo: { id: 'm-asha-2', preview: 'Good morning Ms Rao! Yes, room 204 will be ready from 9 am.' } }),
      waMsg({ id: 'm-asha-6', direction: 'in', at: ago(22 * HOUR + 50 * MIN), text: 'And a late check-out on Sunday, if possible. Thank you!' }),
    ],
    notes: [{ id: 'n-asha-1', text: 'Extra bed is ₹800 a night. Check with housekeeping before confirming.', author: NEHA, at: ago(22 * HOUR) }],
    bodies: {},
  };

  // Ravi Shah: email with a PDF, waiting for a reply; the newest email carries its quoted history. Assigned to the person signed in.
  const raviAddr = 'ravi.shah@shahexports.in';
  const ravi: MockThread = {
    id: 'cv-ravi',
    contact: { name: 'Ravi Shah', handles: [raviAddr], muted: false },
    links: [{ kind: 'reservation', id: 'rs-881', label: 'Ravi Shah · 12 to 15 Nov', source: 'auto', detail: { checkIn: isoDay(now + 18 * DAY), checkOut: isoDay(now + 21 * DAY), status: 'Confirmed' } }],
    status: 'open',
    box: 'main',
    assignedTo: me,
    unread: 1,
    messages: [
      emailMsg({ id: 'm-ravi-1', direction: 'in', at: ago(5 * DAY), from: `Ravi Shah <${raviAddr}>`, to: [box], subject: 'Room for 3 nights, 12 to 15 November', preview: 'Hello, we need two deluxe rooms for three nights for our export fair team. The list of guests is attached.', hasAttachments: true }),
      emailMsg({ id: 'm-ravi-2', direction: 'out', at: ago(4 * DAY + 20 * HOUR), from: box, to: [raviAddr], subject: 'Re: Room for 3 nights, 12 to 15 November', preview: 'Dear Mr Shah, thank you for writing. Two deluxe rooms are held for you at the corporate rate of ₹4,200 a night.', sentBy: NEHA }),
      emailMsg({ id: 'm-ravi-3', direction: 'in', at: ago(3 * HOUR), from: `Ravi Shah <${raviAddr}>`, to: [box], subject: 'Re: Room for 3 nights, 12 to 15 November', preview: 'Thank you. Please confirm the airport pickup on the 12th at 6 pm as well, and whether breakfast is included.' }),
    ],
    notes: [],
    bodies: {
      'm-ravi-1': htmlBody('m-ravi-1', ago(5 * DAY), `Ravi Shah <${raviAddr}>`, [box], 'Room for 3 nights, 12 to 15 November',
        '<p>Hello,</p><p>We need <strong>two deluxe rooms</strong> for three nights, 12 to 15 November, for our export fair team. The list of guests is attached.</p><p>Regards,<br>Ravi Shah<br>Shah Exports, Ahmedabad</p>',
        'Hello, we need two deluxe rooms for three nights, 12 to 15 November, for our export fair team. The list of guests is attached.',
        { attachments: [{ part: 0, name: 'Guest list - Shah Exports.pdf', size: 186_400, type: 'application/pdf' }, { part: 1, name: 'Company GST certificate.pdf', size: 92_100, type: 'application/pdf' }] }),
      'm-ravi-2': textBody('m-ravi-2', ago(4 * DAY + 20 * HOUR), box, [raviAddr], 'Re: Room for 3 nights, 12 to 15 November',
        'Dear Mr Shah,\n\nThank you for writing. Two deluxe rooms are held for you at the corporate rate of ₹4,200 a night, breakfast for two included.\n\nWarm regards,\nNeha Patel\nFront desk, Hotel Sunrise'),
      'm-ravi-3': htmlBody('m-ravi-3', ago(3 * HOUR), `Ravi Shah <${raviAddr}>`, [box], 'Re: Room for 3 nights, 12 to 15 November',
        '<p>Thank you.</p><p>Please confirm the <strong>airport pickup</strong> on the 12th at 6 pm as well, and whether breakfast is included for all four guests.</p><p>Ravi</p>' +
          '<div data-hms-quote="1"><p>On Mon, Neha Patel &lt;frontdesk@hotelsunrise.in&gt; wrote:</p><blockquote><p>Dear Mr Shah,</p><p>Thank you for writing. Two deluxe rooms are held for you at the corporate rate of ₹4,200 a night, breakfast for two included.</p><p>Warm regards,<br>Neha Patel</p></blockquote></div>',
        'Thank you. Please confirm the airport pickup on the 12th at 6 pm as well, and whether breakfast is included for all four guests.'),
    },
  };

  // An unknown number on WhatsApp: the window closed two days ago (only an approved message may be sent now).
  const unknown: MockThread = {
    id: 'cv-unknown',
    contact: { name: '', handles: ['+91 98765 01234'], muted: false },
    links: [],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 0,
    messages: [
      waMsg({ id: 'm-unk-1', direction: 'in', at: ago(2 * DAY + 5 * HOUR), text: 'Do you have two rooms for this weekend? What is the price?' }),
      waMsg({ id: 'm-unk-2', direction: 'in', at: ago(2 * DAY + 4 * HOUR), type: 'location', location: { label: 'Kalawad Road, Rajkot' } }),
    ],
    notes: [],
    bodies: {},
  };

  // Meera Iyer: a guest from last month, WhatsApp closed for three days: the template picker fills her name and the hotel from the link. Marked done before the
  // shared desk (old data): still listed on WhatsApp.
  const meera: MockThread = {
    id: 'cv-meera',
    contact: { name: 'Meera Iyer', handles: ['+91 99099 87654', 'meera.iyer@outlook.com'], muted: false },
    links: [{ kind: 'customer', id: 'cu-77', label: 'Meera Iyer', source: 'auto', detail: { room: '311', checkIn: isoDay(now - 34 * DAY), checkOut: isoDay(now - 31 * DAY), status: 'Checked out' } }],
    status: 'done',
    box: 'main',
    assignedTo: null,
    unread: 0,
    messages: [
      waMsg({ id: 'm-meera-1', direction: 'in', at: ago(3 * DAY + 2 * HOUR), text: 'I think I left my charger in room 311 last month. Did housekeeping find it?' }),
    ],
    notes: [],
    bodies: {},
  };

  // Kiran Desai of Infosys: email and WhatsApp in one thread, the window open (3 h ago), a document, a bill sent by email.
  const kiranMail = 'kiran.desai@infosys.com';
  const kiran: MockThread = {
    id: 'cv-kiran',
    contact: { name: 'Kiran Desai', handles: [kiranMail, '+91 98980 22110'], muted: false },
    links: [{ kind: 'company', id: 'co-infosys', label: 'Infosys Ltd', source: 'auto', detail: { billId: 'b-0981', billNo: 'B-0981', billTotal: 3_860_000 } }],
    status: 'open',
    box: 'main',
    assignedTo: ARJUN,
    unread: 0,
    messages: [
      emailMsg({ id: 'm-kiran-1', direction: 'in', at: ago(DAY + 6 * HOUR), from: `Kiran Desai <${kiranMail}>`, to: [box], subject: 'Corporate booking for 4 staff, 3 to 6 Nov', preview: 'Please block four single rooms for our audit team, 3 to 6 November, billed to Infosys.' }),
      emailMsg({ id: 'm-kiran-2', direction: 'out', at: ago(DAY + 4 * HOUR), from: box, to: [kiranMail], subject: 'Re: Corporate booking for 4 staff, 3 to 6 Nov', preview: 'Four rooms are blocked. The September bill is attached for your accounts team.', sentBy: ARJUN, hasAttachments: true }),
      waMsg({ id: 'm-kiran-3', direction: 'in', at: ago(3 * HOUR), type: 'document', media: { name: 'PO-4471-Infosys.pdf', size: 248_000, mime: 'application/pdf', caption: 'Sent the PO here as well' } }),
      waMsg({ id: 'm-kiran-4', direction: 'out', at: ago(2 * HOUR + 40 * MIN), sentBy: ARJUN, text: 'Received, thank you. The rooms are confirmed.', status: 'delivered' }),
    ],
    notes: [],
    bodies: {
      'm-kiran-1': textBody('m-kiran-1', ago(DAY + 6 * HOUR), `Kiran Desai <${kiranMail}>`, [box], 'Corporate booking for 4 staff, 3 to 6 Nov',
        'Hello,\n\nPlease block four single rooms for our audit team, 3 to 6 November, billed to Infosys as usual.\n\nThanks,\nKiran Desai\nAdmin, Infosys Rajkot',
        { quotedText: '> From: Front desk, Hotel Sunrise\n> Sent: last month\n> Your rooms for the October visit are confirmed.' }),
      'm-kiran-2': textBody('m-kiran-2', ago(DAY + 4 * HOUR), box, [kiranMail], 'Re: Corporate booking for 4 staff, 3 to 6 Nov',
        'Dear Kiran,\n\nFour rooms are blocked for 3 to 6 November. The September bill is attached for your accounts team.\n\nRegards,\nArjun Mehta\nHotel Sunrise',
        { attachments: [{ part: 0, name: 'Bill B-0981.pdf', size: 64_200, type: 'application/pdf', billLocked: false }] }),
    },
  };

  // Pooja Nair: a WhatsApp message that was not delivered.
  const pooja: MockThread = {
    id: 'cv-pooja',
    contact: { name: 'Pooja Nair', handles: ['+91 90990 11223'], muted: false },
    links: [],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 0,
    messages: [
      waMsg({ id: 'm-pooja-1', direction: 'in', at: ago(9 * HOUR), text: 'Is the restaurant open for dinner on Saturday?' }),
      waMsg({ id: 'm-pooja-2', direction: 'out', at: ago(8 * HOUR), sentBy: NEHA, text: 'Yes, from 7 pm to 11 pm. Shall we reserve a table?', status: 'failed', failure: 'The guest\'s phone did not receive it. Try again later.' }),
    ],
    notes: [],
    bodies: {},
  };

  // Vikram Singh: answered from the hotel's own phone (the coexistence echo), a video and a location.
  const vikram: MockThread = {
    id: 'cv-vikram',
    contact: { name: 'Vikram Singh', handles: ['+91 97140 55667'], muted: false },
    links: [],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 1,
    messages: [
      waMsg({ id: 'm-vik-1', direction: 'in', at: ago(6 * HOUR), text: 'Where exactly is the parking entrance?' }),
      waMsg({ id: 'm-vik-2', direction: 'out', at: ago(5 * HOUR + 50 * MIN), sentFrom: 'phone', text: 'Behind the building, gate 2. Sending the location.', status: 'read' }),
      waMsg({ id: 'm-vik-3', direction: 'out', at: ago(5 * HOUR + 49 * MIN), sentFrom: 'phone', type: 'location', location: { label: 'Hotel Sunrise parking, gate 2' }, status: 'read' }),
      waMsg({ id: 'm-vik-4', direction: 'in', at: ago(40 * MIN), type: 'video', media: { name: 'gate.mp4', size: 2_840_000, mime: 'video/mp4', caption: 'Is this the gate?', duration: 14, previewUrl: picture('', '#0F766E') } }),
    ],
    notes: [],
    bodies: {},
  };

  // Sneha Kulkarni: the booking confirmation HMS sent by itself, then a voice note, a sticker and a contact card.
  const sneha: MockThread = {
    id: 'cv-sneha',
    contact: { name: 'Sneha Kulkarni', handles: ['+91 98240 99881'], muted: false },
    links: [{ kind: 'reservation', id: 'rs-902', label: 'Sneha Kulkarni · 1 to 3 Nov', source: 'auto', detail: { checkIn: isoDay(now + 7 * DAY), checkOut: isoDay(now + 9 * DAY), status: 'Confirmed' } }],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 3,
    messages: [
      waMsg({ id: 'm-sneha-1', direction: 'out', at: ago(26 * MIN), sentFrom: 'auto', type: 'template', template: { name: 'booking_confirmed', language: 'en', category: 'utility', text: 'Hello Sneha Kulkarni, your booking at Hotel Sunrise is confirmed for 1 Nov to 3 Nov. We look forward to seeing you.' }, status: 'read' }),
      waMsg({ id: 'm-sneha-2', direction: 'in', at: ago(20 * MIN), type: 'audio', media: { name: 'voice-note.ogg', size: 42_000, mime: 'audio/ogg', duration: 18 } }),
      waMsg({ id: 'm-sneha-3', direction: 'in', at: ago(19 * MIN), type: 'sticker', media: { name: 'sticker.webp', size: 18_000, mime: 'image/webp', previewUrl: picture('🙂', '#F59E0B') } }),
      waMsg({ id: 'm-sneha-4', direction: 'in', at: ago(18 * MIN), type: 'contacts', contacts: [{ name: 'Rohan Kulkarni', phone: '+91 98240 77665' }], text: 'My husband\'s number, he will check in first.' }),
    ],
    notes: [],
    bodies: {},
  };

  // Rahul Verma: a message type WhatsApp cannot show here, and two replies still on their way (sending, sent).
  const rahul: MockThread = {
    id: 'cv-rahul',
    contact: { name: 'Rahul Verma', handles: ['+91 93270 44001'], muted: false },
    links: [],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 0,
    messages: [
      waMsg({ id: 'm-rahul-1', direction: 'in', at: ago(75 * MIN), type: 'unsupported' }),
      waMsg({ id: 'm-rahul-2', direction: 'out', at: ago(70 * MIN), sentBy: NEHA, text: 'Hello Mr Verma, we could not open that message. Could you type it, please?', status: 'sent' }),
      waMsg({ id: 'm-rahul-3', direction: 'out', at: ago(69 * MIN), sentBy: NEHA, text: 'You can also call the desk on 0281 245 6789.', status: 'pending' }),
    ],
    notes: [],
    bodies: {},
  };

  // Thomas Wright: a long email thread ("Re:" each time); the oldest email is no longer in the mailbox.
  const tomAddr = 'thomas.wright@wright-travel.co.uk';
  const tomSubject = 'Airport pickup on 2 Nov';
  const tom: MockThread = {
    id: 'cv-thomas',
    contact: { name: 'Thomas Wright', handles: [tomAddr], muted: false },
    links: [],
    status: 'open',
    box: 'main',
    assignedTo: ARJUN,
    unread: 0,
    messages: [
      emailMsg({ id: 'm-tom-1', direction: 'in', at: ago(9 * DAY), from: `Thomas Wright <${tomAddr}>`, to: [box], subject: tomSubject, preview: 'Could you arrange a pickup from Rajkot airport on 2 November? Flight AI 655, landing 14:20.' }),
      emailMsg({ id: 'm-tom-2', direction: 'out', at: ago(8 * DAY + 20 * HOUR), from: box, to: [tomAddr], subject: `Re: ${tomSubject}`, preview: 'Certainly. A driver will wait at arrivals with your name. The fare is ₹1,200.', sentBy: ARJUN }),
      emailMsg({ id: 'm-tom-3', direction: 'in', at: ago(8 * DAY + 10 * HOUR), from: `Thomas Wright <${tomAddr}>`, to: [box], subject: `Re: ${tomSubject}`, preview: 'Lovely. Can the driver also stop at a pharmacy on the way?' }),
      emailMsg({ id: 'm-tom-4', direction: 'out', at: ago(8 * DAY + 2 * HOUR), from: box, to: [tomAddr], subject: `Re: ${tomSubject}`, preview: 'Of course, there is one on the way. Safe travels!', sentBy: ARJUN }),
      emailMsg({ id: 'm-tom-5', direction: 'in', at: ago(30 * HOUR), from: `Thomas Wright <${tomAddr}>`, to: [box], subject: `Re: ${tomSubject}`, preview: 'Small change: the flight now lands at 15:05.' }),
      emailMsg({ id: 'm-tom-6', direction: 'out', at: ago(29 * HOUR), from: box, to: [tomAddr], subject: `Re: ${tomSubject}`, preview: 'Noted, the driver will be there at 15:05. See you on Sunday.', sentFrom: 'mailbox', sentBy: null }),
    ],
    notes: [{ id: 'n-tom-1', text: 'Driver: Mahesh, 98250 66554.', author: ARJUN, at: ago(29 * HOUR) }],
    bodies: {
      'm-tom-2': textBody('m-tom-2', ago(8 * DAY + 20 * HOUR), box, [tomAddr], `Re: ${tomSubject}`, 'Certainly. A driver will wait at arrivals with your name. The fare is ₹1,200, added to your bill.\n\nArjun'),
      'm-tom-3': textBody('m-tom-3', ago(8 * DAY + 10 * HOUR), `Thomas Wright <${tomAddr}>`, [box], `Re: ${tomSubject}`, 'Lovely. Can the driver also stop at a pharmacy on the way?\n\nTom', { quotedText: '> Certainly. A driver will wait at arrivals with your name.' }),
      'm-tom-4': textBody('m-tom-4', ago(8 * DAY + 2 * HOUR), box, [tomAddr], `Re: ${tomSubject}`, 'Of course, there is one on the way. Safe travels!\n\nArjun'),
      'm-tom-5': textBody('m-tom-5', ago(30 * HOUR), `Thomas Wright <${tomAddr}>`, [box], `Re: ${tomSubject}`, 'Small change: the flight now lands at 15:05.\n\nTom'),
      'm-tom-6': textBody('m-tom-6', ago(29 * HOUR), box, [tomAddr], `Re: ${tomSubject}`, 'Noted, the driver will be there at 15:05. See you on Sunday.'),
    },
    gone: ['m-tom-1'],
  };

  // Fatima Sheikh: answered and marked done.
  const fatimaAddr = 'fatima.sheikh@gmail.com';
  const fatima: MockThread = {
    id: 'cv-fatima',
    contact: { name: 'Fatima Sheikh', handles: [fatimaAddr], muted: false },
    links: [],
    status: 'done',
    box: 'main',
    assignedTo: NEHA,
    unread: 0,
    messages: [
      emailMsg({ id: 'm-fat-1', direction: 'in', at: ago(4 * DAY), from: `Fatima Sheikh <${fatimaAddr}>`, to: [box], subject: 'GST invoice for my stay', preview: 'Could you send the GST invoice for my stay last week in the name of my company?' }),
      emailMsg({ id: 'm-fat-2', direction: 'out', at: ago(3 * DAY + 20 * HOUR), from: box, to: [fatimaAddr], subject: 'Re: GST invoice for my stay', preview: 'Here it is. Thank you for staying with us.', sentBy: NEHA }),
    ],
    notes: [],
    bodies: {
      'm-fat-1': textBody('m-fat-1', ago(4 * DAY), `Fatima Sheikh <${fatimaAddr}>`, [box], 'GST invoice for my stay', 'Hello,\n\nCould you send the GST invoice for my stay last week in the name of my company, Sheikh Textiles?\n\nFatima'),
      'm-fat-2': textBody('m-fat-2', ago(3 * DAY + 20 * HOUR), box, [fatimaAddr], 'Re: GST invoice for my stay', 'Here it is. Thank you for staying with us.\n\nNeha'),
    },
  };

  // An email the mail server could not verify, asking for replies to another address (A12).
  const spoofFrom = 'accounts@shahexports-in.com';
  const spoof: MockThread = {
    id: 'cv-spoof',
    contact: { name: 'Shah Exports Accounts', handles: [spoofFrom], muted: false },
    links: [],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 1,
    messages: [
      emailMsg({ id: 'm-spoof-1', direction: 'in', at: ago(55 * MIN), from: `Shah Exports Accounts <${spoofFrom}>`, replyTo: 'payments.shahexports@protonmail.com', to: [box], subject: 'Urgent: send the bill and your bank details', preview: 'Please send the bill PDF for Ravi Shah\'s booking and your updated bank details today.', verified: false }),
    ],
    notes: [],
    bodies: {
      'm-spoof-1': htmlBody('m-spoof-1', ago(55 * MIN), `Shah Exports Accounts <${spoofFrom}>`, [box], 'Urgent: send the bill and your bank details',
        '<p>Dear Sir,</p><p>Please send the <b>bill PDF</b> for Ravi Shah\'s booking and your updated bank details <u>today</u>, our accounts close at 5 pm.</p><p>Accounts team</p>',
        'Please send the bill PDF for Ravi Shah\'s booking and your updated bank details today.'),
    },
  };

  // Two newsletters under Other.
  const mmt: MockThread = {
    id: 'cv-mmt',
    contact: { name: 'MakeMyTrip Partner News', handles: ['partners@news.makemytrip.com'], muted: false },
    links: [],
    status: 'open',
    box: 'other',
    assignedTo: null,
    unread: 1,
    messages: [
      emailMsg({ id: 'm-mmt-1', direction: 'in', at: ago(5 * HOUR), from: 'MakeMyTrip Partner News <partners@news.makemytrip.com>', to: [box], subject: 'Festive season: boost your listing', preview: 'Hotels with 10 photos or more get 30% more bookings this season.' }),
    ],
    notes: [],
    bodies: {
      'm-mmt-1': htmlBody('m-mmt-1', ago(5 * HOUR), 'MakeMyTrip Partner News <partners@news.makemytrip.com>', [box], 'Festive season: boost your listing',
        '<table role="presentation" width="600" style="width:600px;border-collapse:collapse"><tr><td style="padding:16px;background:#fff7ed"><h2 style="margin:0 0 8px">Festive season is here</h2><p>Hotels with 10 photos or more get 30% more bookings this season.</p></td></tr><tr><td style="padding:16px">[image]</td></tr><tr><td style="padding:16px">[image]</td></tr></table>',
        'Hotels with 10 photos or more get 30% more bookings this season.',
        { remoteImages: 2 }),
    },
  };
  const gbp: MockThread = {
    id: 'cv-gbp',
    contact: { name: 'Google Business Profile', handles: ['businessprofile-noreply@google.com'], muted: false },
    links: [],
    status: 'open',
    box: 'other',
    assignedTo: null,
    unread: 0,
    messages: [
      emailMsg({ id: 'm-gbp-1', direction: 'in', at: ago(2 * DAY), from: 'Google Business Profile <businessprofile-noreply@google.com>', to: [box], subject: 'Your September performance', preview: '1,240 people found Hotel Sunrise on Google Search and Maps last month.' }),
    ],
    notes: [],
    bodies: {
      'm-gbp-1': textBody('m-gbp-1', ago(2 * DAY), 'Google Business Profile <businessprofile-noreply@google.com>', [box], 'Your September performance', '1,240 people found Hotel Sunrise on Google Search and Maps last month. 86 asked for directions.'),
    },
  };

  return [asha, ravi, unknown, meera, kiran, pooja, vikram, sneha, rahul, tom, fatima, spoof, mmt, gbp];
}

// ------------------------------------------------------------------------------------------------ the platform's sample

const PLATFORM_MAILBOX = 'hello@easyhotelsolutions.in';
/** The desks (Google aliases of the platform mailbox): their mail arrives labelled Sales or Support. */
const SALES_DESK = 'sales@easyhotelsolutions.in';
const SUPPORT_DESK = 'support@easyhotelsolutions.in';
const PLATFORM_STAFF: ConvPerson[] = [
  { id: 'u-platform', name: 'Neha Kapoor' },
  { id: 'u-superadmin', name: 'Rajiv Malhotra' },
];

function platformSample(now: number): MockThread[] {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const owner = (id: string, name: string, address: string, hotelId: string, hotelName: string, msgs: ConvMessage[], more: Partial<MockThread> = {}): MockThread => ({
    id,
    contact: { name, handles: [address], muted: false },
    links: [{ kind: 'hotel', id: hotelId, label: hotelName, source: 'auto', detail: { hotelName } }],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 0,
    messages: msgs,
    notes: [],
    bodies: {},
    ...more,
  });
  const lakeview = owner('pv-lakeview', 'Mahendra Rathore', 'owner@hotellakeview.in', 'h-2', 'Hotel Lakeview, Udaipur', [
    emailMsg({ id: 'pm-lv-1', direction: 'in', at: ago(2 * HOUR), from: 'Mahendra Rathore <owner@hotellakeview.in>', to: [SUPPORT_DESK], subject: 'Second front desk account', preview: 'How do I add a second front desk login for the night shift?' }),
  ], { unread: 1, labels: ['Support'] });
  const sunrise = owner('pv-sunrise', 'Anita Shah', 'anita@hotelsunrise.in', 'h-1', 'Hotel Sunrise, Rajkot', [
    emailMsg({ id: 'pm-su-1', direction: 'in', at: ago(DAY + 3 * HOUR), from: 'Anita Shah <anita@hotelsunrise.in>', to: [SUPPORT_DESK], subject: 'GST report for October', preview: 'The GST summary shows two bills twice. Can you check?' }),
    emailMsg({ id: 'pm-su-2', direction: 'out', at: ago(DAY + HOUR), from: SUPPORT_DESK, to: ['anita@hotelsunrise.in'], subject: 'Re: GST report for October', preview: 'Thank you, we found it: two bills were reopened and closed again. It is fixed now.', sentBy: PLATFORM_STAFF[0] }),
  ], { labels: ['Support'] });
  const seaBreeze = owner('pv-seabreeze', 'Joseph Fernandes', '+91 98201 55443', 'h-3', 'Sea Breeze Resort, Diu', [
    waMsg({ id: 'pm-sb-1', direction: 'in', at: ago(50 * MIN), text: 'Hello, our invitation link has expired. Can you send a new one?' }),
  ], { unread: 1 });
  seaBreeze.contact.handles = ['+91 98201 55443'];
  const lead: MockThread = {
    id: 'pv-lead',
    contact: { name: 'Priya Menon', handles: ['priya@kochiharbourinn.com'], muted: false },
    links: [],
    status: 'open',
    box: 'main',
    assignedTo: null,
    unread: 0,
    messages: [
      emailMsg({ id: 'pm-lead-1', direction: 'in', at: ago(3 * DAY), from: 'Priya Menon <priya@kochiharbourinn.com>', to: [SALES_DESK], subject: 'Pricing for a 24-room hotel', preview: 'We run a 24-room hotel in Kochi and would like to know the pricing.' }),
    ],
    notes: [],
    bodies: {},
    labels: ['Sales'],
  };
  const bodies: Record<string, EmailBody> = {
    'pm-lv-1': textBody('pm-lv-1', ago(2 * HOUR), 'Mahendra Rathore <owner@hotellakeview.in>', [SUPPORT_DESK], 'Second front desk account', 'Hello,\n\nHow do I add a second front desk login for the night shift?\n\nMahendra'),
    'pm-su-1': textBody('pm-su-1', ago(DAY + 3 * HOUR), 'Anita Shah <anita@hotelsunrise.in>', [SUPPORT_DESK], 'GST report for October', 'The GST summary shows two bills twice. Can you check?\n\nAnita'),
    'pm-su-2': textBody('pm-su-2', ago(DAY + HOUR), SUPPORT_DESK, ['anita@hotelsunrise.in'], 'Re: GST report for October', 'Thank you, we found it: two bills were reopened and closed again. It is fixed now.'),
    'pm-lead-1': textBody('pm-lead-1', ago(3 * DAY), 'Priya Menon <priya@kochiharbourinn.com>', [SALES_DESK], 'Pricing for a 24-room hotel', 'We run a 24-room hotel in Kochi and would like to know the pricing.'),
  };
  for (const t of [lakeview, sunrise, lead]) for (const m of t.messages) if (bodies[m.id]) t.bodies[m.id] = bodies[m.id];
  return [lakeview, sunrise, seaBreeze, lead];
}

const HOTEL_CANDIDATES: (LinkCandidate & { linkDetail?: ConvLink['detail'] })[] = [
  { kind: 'stay', id: 'st-204', label: 'Asha Rao · Room 204', detail: 'In house', linkDetail: { room: '204', status: 'In house' } },
  { kind: 'stay', id: 'st-118', label: 'Vikram Singh · Room 118', detail: 'In house', linkDetail: { room: '118', status: 'In house' } },
  { kind: 'reservation', id: 'rs-881', label: 'Ravi Shah · 12 to 15 Nov', detail: 'Confirmed' },
  { kind: 'reservation', id: 'rs-915', label: 'Pooja Nair · 9 Nov', detail: 'Confirmed' },
  { kind: 'customer', id: 'cu-77', label: 'Meera Iyer', detail: 'Guest since 2025' },
  { kind: 'customer', id: 'cu-91', label: 'Rahul Verma', detail: 'Guest since 2026' },
  { kind: 'company', id: 'co-infosys', label: 'Infosys Ltd', detail: 'Company' },
  { kind: 'company', id: 'co-shah', label: 'Shah Exports', detail: 'Company' },
];

const PLATFORM_CANDIDATES: LinkCandidate[] = [
  { kind: 'hotel', id: 'h-1', label: 'Hotel Sunrise, Rajkot', detail: 'Hotel' },
  { kind: 'hotel', id: 'h-2', label: 'Hotel Lakeview, Udaipur', detail: 'Hotel' },
  { kind: 'hotel', id: 'h-3', label: 'Sea Breeze Resort, Diu', detail: 'Hotel' },
  { kind: 'user', id: 'u-anita', label: 'Anita Shah', detail: 'Hotel Admin, Hotel Sunrise' },
  { kind: 'user', id: 'u-mahendra', label: 'Mahendra Rathore', detail: 'Hotel Admin, Hotel Lakeview' },
];

// ------------------------------------------------------------------------------------------------ the hub

const copyOf = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function previewOf(m: ConvMessage): string {
  if (m.kind === 'email') return m.preview;
  if (m.text) return m.text;
  if (m.media?.caption) return m.media.caption;
  switch (m.type) {
    case 'image':
      return whatsappCopy.photo;
    case 'video':
      return whatsappCopy.video;
    case 'document':
      return m.media?.name ?? whatsappCopy.document;
    case 'audio':
      return whatsappCopy.voiceNote;
    case 'sticker':
      return whatsappCopy.sticker;
    case 'location':
      return `${whatsappCopy.location}: ${m.location?.label ?? ''}`.trim();
    case 'contacts':
      return `${whatsappCopy.contactCard}: ${m.contacts?.[0]?.name ?? ''}`.trim();
    case 'template':
      return m.template?.text ?? '';
    default:
      return whatsappCopy.unsupported;
  }
}

/** The mock hub with its actor; `simulateInbound` (mock only) brings a guest's message in, as a mail check or a webhook would. */
export type ConversationsMock = ConversationsApi & {
  setActor(actor: ConversationsMockActor): void;
  simulateInbound(conversationId: string, m: { channel: ConvChannel; text: string }): void;
};

export function createConversationsMock(opts: ConversationsMockOptions = {}): ConversationsMock {
  const scope: ConvScope = opts.scope ?? 'hotel';
  const now = opts.now ?? (() => Date.now());
  const clock: MockClock = { latencyMs: opts.latencyMs, offline: opts.offline };
  const delays = opts.waDelays ?? { sent: 600, delivered: 2000, read: 5000 };
  const threads: MockThread[] = scope === 'hotel' ? hotelSample(now(), opts.mailboxAddress) : platformSample(now());
  const staff: ConvPerson[] = (scope === 'hotel' ? HOTEL_STAFF : PLATFORM_STAFF).map((p) => ({ ...p }));
  const mailboxAddress = opts.mailboxAddress ?? (scope === 'hotel' ? HOTEL_MAILBOX : PLATFORM_MAILBOX);
  // a group's inbox (platform 0166) has the hotel's WhatsApp sample in the mock
  const whatsapp = createWhatsAppSettingsMock(scope === 'platform' ? 'platform' : 'hotel', { latencyMs: opts.latencyMs, offline: opts.offline, now });
  let quick: QuickReply[] = (scope === 'hotel'
    ? [
        { id: 'qr-1', title: 'Check-in time', body: 'Check-in is from 12 noon and check-out by 11 am. Early check-in depends on the room being free; we will do our best.', channel: 'any', sortOrder: 0 },
        { id: 'qr-2', title: 'Directions', body: 'We are on Kalawad Road, 200 m after the Indira Circle signal. Parking is behind the building, gate 2.', channel: 'any', sortOrder: 1 },
        { id: 'qr-3', title: 'Thank you', body: 'Thank you for writing to us. We look forward to welcoming you.', channel: 'email', sortOrder: 2 },
      ]
    : [{ id: 'qr-p1', title: 'Invitation resent', body: 'We have sent a new invitation link. It is valid for 7 days.', channel: 'any', sortOrder: 0 }]) as QuickReply[];
  let actor: ConversationsMockActor = { id: ME, name: 'You', role: scope === 'hotel' ? 'hotel_admin' : 'platform_admin', grants: null };
  let checkedAt: string | null = new Date(now() - 2 * MIN).toISOString();
  let seq = 0;
  const nextId = (p: string) => `${p}-${now().toString(36)}-${++seq}`;

  /** The mailbox has not started (off, send-only, before the database update) or the hotel is brand new: no conversations at all (the setup panel). */
  const blank = () => {
    const m = dev('__convMailbox');
    return m === 'off' || m === 'not_available' || m === 'needs_update' || (scope === 'hotel' && mockEmptyHotel());
  };
  const waConnected = () => !mockWhatsAppOff() && !blank();
  const visible = () => (blank() ? [] : threads.filter((t) => !t.deleted));
  for (const t of threads) Object.assign(t, SAMPLE_EXTRAS[t.id] ?? {});

  const mailbox = (): MailboxState => {
    const m = dev('__convMailbox');
    if (m === 'off' || (scope === 'hotel' && mockEmptyHotel() && m === undefined)) return { state: 'off', reason: 'off', checkedAt: null, address: null, message: conversationsCopy.mailbox.off };
    if (m === 'not_available') return { state: 'not_available', reason: 'send_only', checkedAt: null, address: null, message: conversationsCopy.mailbox.sendOnly };
    if (m === 'needs_update') return { state: 'not_available', reason: 'needs_update', checkedAt: null, address: null, message: conversationsCopy.mailbox.needsUpdate };
    if (m === 'error') return { state: 'error', checkedAt, address: mailboxAddress, message: conversationsCopy.mailbox.error.replace('{reason}', 'Google refused the app password. Make a new app password and paste it in Settings > Email.') };
    return { state: 'ok', checkedAt, address: mailboxAddress };
  };
  const waState = (): WhatsAppChannelState => {
    if (!waConnected()) return { connected: false, available: false };
    const s = whatsapp.current();
    return { connected: true, available: true, number: s.number, displayName: s.displayName };
  };

  const access = (): ConvAccess => {
    const force = dev('__convAccess');
    const g = actor.grants ?? null;
    const admin = scope === 'platform' || actor.role === 'hotel_admin' || g === null;
    const level = g?.conversations;
    const visit = force === 'visit' || actor.visit === true;
    const viewOnly = force === 'view_only' || (!admin && level !== 'edit' && level !== 'full');
    const sees = (m: string) => admin || (g?.[m] !== undefined && g[m] !== 'none');
    const canEdit = !visit && !viewOnly;
    if (scope === 'platform') return { canEdit, readOnlyReason: visit ? 'visit' : viewOnly ? 'view_only' : null, canSeeStay: false, canSeeBills: false, canLink: canEdit ? ['user', 'hotel'] : [] };
    const kinds: ConvLinkKind[] = [];
    if (canEdit && sees('pms')) kinds.push('stay', 'reservation');
    if (canEdit && sees('companies')) kinds.push('customer', 'company');
    return { canEdit, readOnlyReason: visit ? 'visit' : viewOnly ? 'view_only' : null, canSeeStay: sees('pms'), canSeeBills: sees('bills'), canLink: kinds };
  };
  const refuse = (a: ConvAccess) => mockError('FORBIDDEN', undefined, { message: a.readOnlyReason === 'visit' ? conversationsCopy.readOnly.visit : conversationsCopy.readOnly.viewOnly });

  const find = (id: string) => visible().find((t) => t.id === id);
  const lastOf = (t: MockThread) => t.messages[t.messages.length - 1];
  const nameOf = (t: MockThread) => t.contact.name || t.contact.handles[0] || conversationsCopy.unknown;

  const channelsOf = (t: MockThread): ConvChannel[] => (['email', 'whatsapp'] as ConvChannel[]).filter((c) => t.messages.some((m) => m.kind === c));
  const rowOf = (t: MockThread): ConversationRow => {
    const last = lastOf(t);
    const channels = channelsOf(t);
    const lastEmailIn = [...t.messages].reverse().find((m): m is EmailEntry => m.kind === 'email' && m.direction === 'in');
    return {
      id: t.id,
      name: nameOf(t),
      handle: t.contact.handles[0] ?? '',
      channels,
      lastChannel: last.kind,
      lastAt: last.at,
      lastDirection: last.direction,
      preview: previewOf(last),
      subject: last.kind === 'email' ? last.subject : undefined,
      unread: t.unread,
      hasAttachments: t.messages.some((m) => (m.kind === 'email' ? m.hasAttachments : Boolean(m.media) && m.type === 'document')),
      waiting: t.status === 'open' && t.box === 'main' && last.direction === 'in',
      status: t.status,
      box: t.box,
      assignedTo: t.assignedTo ? { ...t.assignedTo } : null,
      linked: t.links.length > 0,
      unverified: lastEmailIn?.verified === false,
      starred: Boolean(t.starred),
      pinned: Boolean(t.pinned),
      labels: [...(t.labels ?? [])],
      lastStatus: last.status,
      draft: Boolean(t.draft),
      ...(snoozed(t) ? { snoozedUntil: t.snoozedUntil } : {}),
      windowMinutes: waConnected() && hasPhone(t) ? (windowOf(lastInboundWa(t), now()).minutesLeft ?? null) : null,
      messageCount: t.messages.length,
      participants: participantsOf(t),
    };
  };
  /** Who wrote in a thread, first names in order of appearance; the hotel's own messages are 'me' (Gmail's participant line). */
  /** The insights bar: average minutes from a guest's message to our next one, replies sent today, windows closing within 3 hours, and conversations waiting over a day. */
  const insightsOf = (list: MockThread[]) => {
    const gaps: number[] = [];
    let repliedToday = 0;
    let closingSoon = 0;
    let overdue = 0;
    let waiting = 0;
    const day = new Date(now());
    day.setHours(0, 0, 0, 0);
    for (const t of list) {
      let pending: number | null = null;
      for (const m of t.messages) {
        const at = Date.parse(m.at);
        if (m.direction === 'in') pending = pending ?? at;
        else {
          if (pending !== null) gaps.push((at - pending) / 60_000);
          pending = null;
          if (at >= day.getTime()) repliedToday += 1;
        }
      }
      if (t.status === 'open' && t.box === 'main' && lastOf(t).direction === 'in') {
        waiting += 1;
        if (now() - Date.parse(lastOf(t).at) > 24 * 3_600_000) overdue += 1;
      }
      if (inFolder('closing', t)) closingSoon += 1;
    }
    const usable = gaps.filter((g) => g >= 0 && g < 3 * 1440);
    return { avgReplyMinutes: usable.length ? Math.round(usable.reduce((a, b) => a + b, 0) / usable.length) : null, repliedToday, closingSoon, overdue, waiting };
  };
  const participantsOf = (t: MockThread): string[] => {
    const seen: string[] = [];
    for (const m of t.messages) {
      const who = m.direction === 'out' ? 'me' : m.kind === 'email' ? (m.from.replace(/<[^>]*>/, '').replace(/"/g, '').trim().split(/\s+/)[0] || m.from) : nameOf(t).split(/\s+/)[0];
      if (!seen.includes(who)) seen.push(who);
    }
    return seen.slice(0, 4);
  };
  /** The Email page's folders (Gmail's) and the WhatsApp page's filters, as one rule each. */
  const snoozed = (t: MockThread) => Boolean(t.snoozedUntil && Date.parse(t.snoozedUntil) > now());
  const inFolder = (folder: EmailFolder | WaFilter, t: MockThread): boolean => {
    const f = tabFacts(t);
    switch (folder) {
      case 'inbox': return t.box === 'main' && t.status === 'open' && !t.draft && !snoozed(t);
      case 'snoozed': return snoozed(t);
      case 'starred': return Boolean(t.starred);
      case 'unread': return t.unread > 0 && t.box === 'main';
      case 'sent': return !t.draft && t.messages.some((m) => m.direction === 'out');
      case 'drafts': return Boolean(t.draft);
      case 'mine': return f.assignedTo === actor.id && t.status === 'open';
      case 'waiting': return t.box === 'main' && t.status === 'open' && f.lastDirection === 'in';
      case 'unassigned': return t.box === 'main' && t.status === 'open' && f.assignedTo === null;
      case 'archive': return t.status === 'done';
      case 'other': return t.box === 'other' && t.status === 'open';
      case 'all': return inTab('all', f, actor.id, 'whatsapp');
      case 'favourites': return Boolean(t.starred);
      case 'closing': {
        const w = waConnected() && hasPhone(t) ? windowOf(lastInboundWa(t), now()) : null;
        return Boolean(w?.open && (w.minutesLeft ?? 0) < 180);
      }
      case 'pinned': return Boolean(t.pinned);
    }
  };
  const tabFacts = (t: MockThread) => {
    const last = lastOf(t);
    return { box: t.box, status: t.status, unread: t.unread, assignedTo: t.assignedTo?.id ?? null, lastDirection: last.direction };
  };
  const newestFirst = (a: MockThread, b: MockThread) => (lastOf(b).at > lastOf(a).at ? 1 : lastOf(b).at < lastOf(a).at ? -1 : b.id > a.id ? 1 : -1);

  const matches = (t: MockThread, search: string, channel: ConversationListQuery['channel'], label?: string) => {
    if (channel && channel !== 'all' && !t.messages.some((m) => m.kind === channel)) return false;
    if (label && !(t.labels ?? []).includes(label)) return false;
    const p = parseSearch(search);
    const last = lastOf(t);
    const who = [nameOf(t), ...t.contact.handles, ...t.messages.map((m) => (m.kind === 'email' ? m.from : ''))].join(' ').toLowerCase();
    const subjects = t.messages.map((m) => (m.kind === 'email' ? m.subject : '')).join(' ').toLowerCase();
    if (p.from.some((v) => !who.includes(v))) return false;
    if (p.subject.some((v) => !subjects.includes(v))) return false;
    if (p.label.some((v) => !(t.labels ?? []).some((l) => l.toLowerCase().replace(/\s+/g, '').includes(v.replace(/\s+/g, ''))))) return false;
    if (p.hasAttachment && !t.messages.some((m) => (m.kind === 'email' ? m.hasAttachments : Boolean(m.media) && m.type === 'document'))) return false;
    if (p.isUnread && t.unread === 0) return false;
    if (p.isRead && t.unread > 0) return false;
    if (p.isStarred && !t.starred) return false;
    if (!p.words.length) return true;
    const hay = [who, subjects, previewOf(last), ...t.messages.map((m) => previewOf(m))].join(' ').toLowerCase();
    return p.words.every((w) => hay.includes(w));
  };

  const linksFor = (t: MockThread, a: ConvAccess): ConvLink[] =>
    t.links.map((l) => {
      const d = l.detail ?? {};
      const detail: NonNullable<ConvLink['detail']> = {};
      if (a.canSeeStay) {
        if (d.room) detail.room = d.room;
        if (d.checkIn) detail.checkIn = d.checkIn;
        if (d.checkOut) detail.checkOut = d.checkOut;
        if (d.status) detail.status = d.status;
      }
      if (a.canSeeBills && d.billId) {
        detail.billId = d.billId;
        if (d.billNo) detail.billNo = d.billNo;
        if (d.billTotal !== undefined) detail.billTotal = d.billTotal;
      }
      if (d.hotelName) detail.hotelName = d.hotelName;
      return { kind: l.kind, id: l.id, label: l.label, source: l.source, ...(Object.keys(detail).length ? { detail } : {}) };
    });

  const lastInboundWa = (t: MockThread) => [...t.messages].reverse().find((m) => m.kind === 'whatsapp' && m.direction === 'in')?.at ?? null;
  const hasPhone = (t: MockThread) => t.contact.handles.some(isPhone) || t.messages.some((m) => m.kind === 'whatsapp');
  const emailHandles = (t: MockThread) => t.contact.handles.filter(isEmail).map((h) => h.toLowerCase());

  const replyTarget = (t: MockThread): ConversationThread['replyTo'] => {
    const lastIn = [...t.messages].reverse().find((m): m is EmailEntry => m.kind === 'email' && m.direction === 'in');
    if (lastIn) {
      const from = addrOf(lastIn.from);
      const rt = lastIn.replyTo ? addrOf(lastIn.replyTo) : null;
      return { address: from, differsFrom: rt && rt !== from ? rt : null };
    }
    const lastOut = [...t.messages].reverse().find((m): m is EmailEntry => m.kind === 'email');
    if (lastOut?.to[0]) return { address: addrOf(lastOut.to[0]), differsFrom: null };
    const handle = emailHandles(t)[0];
    return handle ? { address: handle, differsFrom: null } : null;
  };

  const threadOf = (t: MockThread, before?: string): ConversationThread => {
    const a = access();
    const mb = mailbox();
    const older = before ? t.messages.filter((m) => m.at < before) : t.messages;
    const page = older.slice(-CONV_THREAD_PAGE);
    const emailOk = mb.state === 'ok' || mb.state === 'error' || mb.state === 'checking';
    const replyChannels: ReplyChannel[] = [
      {
        channel: 'email',
        available: emailOk && replyTarget(t) !== null,
        ...(emailOk ? (replyTarget(t) ? {} : { reason: conversationsCopy.reply.noEmail }) : { reason: conversationsCopy.reply.emailNotAvailable }),
      },
      { channel: 'whatsapp', available: waConnected() && hasPhone(t), ...(waConnected() ? {} : { reason: whatsappCopy.notConnected }) },
    ];
    const last = lastOf(t);
    const preferred = replyChannels.find((c) => c.channel === last.kind && c.available) ?? replyChannels.find((c) => c.available);
    const mine = (n: MockNote) => n.author.id === actor.id;
    return {
      id: t.id,
      contact: { name: nameOf(t), handles: [...t.contact.handles], muted: t.contact.muted },
      links: linksFor(t, a),
      status: t.status,
      box: t.box,
      assignedTo: t.assignedTo ? { ...t.assignedTo } : null,
      unread: t.unread,
      messages: copyOf(page),
      hasOlder: older.length > page.length,
      notes: t.notes.map((n): ConvNote => ({ id: n.id, text: n.text, author: { ...n.author }, at: n.at, mine: mine(n) })),
      window: waConnected() && hasPhone(t) ? windowOf(lastInboundWa(t), now()) : null,
      replyChannels,
      defaultChannel: preferred?.channel ?? last.kind,
      access: a,
      replyTo: replyTarget(t),
      starred: Boolean(t.starred),
      pinned: Boolean(t.pinned),
      labels: [...(t.labels ?? [])],
    };
  };

  const summary = (): ConvSummary => ({ unread: visible().filter((t) => t.box === 'main' && t.unread > 0).length, mailbox: mailbox(), whatsapp: waState() });

  const write = <T>(id: string, fn: (t: MockThread, a: ConvAccess) => DashResult<T>): Promise<DashResult<T>> =>
    mockCall(() => {
      const t = find(id);
      if (!t) return mockError('NOT_FOUND');
      const a = access();
      if (!a.canEdit) return refuse(a);
      return fn(t, a);
    }, clock);

  /** A WhatsApp reply moves on by itself, as Meta's status webhooks would: sent, then delivered, then read. */
  const tick = (t: MockThread, id: string) => {
    const set = (status: WhatsAppMessage['status']) => () => {
      const m = t.messages.find((x) => x.id === id);
      if (m && m.status !== 'failed') {
        m.status = status;
        opts.onChange?.([t.id]);
      }
    };
    setTimeout(set('sent'), delays.sent);
    setTimeout(set('delivered'), delays.delivered);
    setTimeout(set('read'), delays.read);
  };

  const api: ConversationsMock = {
    setActor(a) {
      actor = { ...a };
      // the sample's "assigned to you" rows and staff list follow the person signed in
      for (const t of threads) if (t.assignedTo?.id === ME || t.assignedTo?.id === a.id) t.assignedTo = { id: a.id, name: a.name };
      if (!staff.some((p) => p.id === a.id)) staff.unshift({ id: a.id, name: a.name });
    },

    simulateInbound(conversationId, m) {
      const t = threads.find((x) => x.id === conversationId);
      if (!t) return;
      const at = new Date(now()).toISOString();
      const id = nextId('m-in');
      if (m.channel === 'whatsapp') t.messages.push(waMsg({ id, direction: 'in', at, text: m.text }));
      else {
        const from = emailHandles(t)[0] ?? 'guest@example.com';
        const subject = [...t.messages].reverse().find((x): x is EmailEntry => x.kind === 'email')?.subject ?? '';
        t.messages.push(emailMsg({ id, direction: 'in', at, from, to: [mailboxAddress], subject: subject && !/^re:/i.test(subject) ? `Re: ${subject}` : subject, preview: m.text.slice(0, 200) }));
        t.bodies[id] = textBody(id, at, from, [mailboxAddress], subject, m.text);
      }
      t.unread += 1;
      if (t.status === 'done') t.status = 'open';
      opts.onChange?.([t.id]);
    },

    list: (q) =>
      mockCall(() => {
        const tab: ConvTab = q.tab ?? 'all';
        const size = q.size ?? 25;
        const page = Math.max(1, q.page ?? 1);
        const base = visible().filter((t) => matches(t, q.search ?? '', q.channel, q.label));
        const counts = Object.fromEntries(CONV_TABS.map((k) => [k, base.filter((t) => inTab(k, tabFacts(t), actor.id, q.channel)).length])) as Record<ConvTab, number>;
        // a channel page asks for a folder: Gmail's (inbox, starred, sent ...) or WhatsApp's (all, favourites, pinned ...); pinned chats come first on WhatsApp
        const folder = q.folder;
        const folderCounts = Object.fromEntries([...EMAIL_FOLDERS, ...WA_FILTERS].map((k) => [k, base.filter((t) => inFolder(k, t)).length]));
        const pool = folder ? base.filter((t) => inFolder(folder, t)) : base.filter((t) => inTab(tab, tabFacts(t), actor.id, q.channel));
        const rows = pool.sort((a, b) => (q.channel === 'whatsapp' && Boolean(b.pinned) !== Boolean(a.pinned) ? (b.pinned ? 1 : -1) : newestFirst(a, b)));
        const insights = insightsOf(base);
        const data: ConversationList = { items: rows.slice((page - 1) * size, page * size).map(rowOf), page, size, total: rows.length, counts, folderCounts, insights, mailbox: mailbox(), whatsapp: waState() };
        return ok(data);
      }, clock),

    getSummary: () => mockCall(() => ok(summary()), clock),

    syncMail: (o) =>
      mockCall(() => {
        if (access().readOnlyReason === 'visit') return ok<SyncResult>({ checked: false, added: 0, ...summary() });
        const mb = mailbox();
        if (mb.state === 'off' || mb.state === 'not_available') return ok<SyncResult>({ checked: false, added: 0, ...summary() });
        // a background check only about every 1.5 minutes, as the server throttles it
        if (o?.background && checkedAt && now() - Date.parse(checkedAt) < 85_000) return ok<SyncResult>({ checked: false, added: 0, ...summary() });
        checkedAt = new Date(now()).toISOString();
        return ok<SyncResult>({ checked: true, added: 0, ...summary() });
      }, clock),

    getThread: (id, o) =>
      mockCall(() => {
        const t = find(id);
        return t ? ok(threadOf(t, o?.before)) : mockError('NOT_FOUND');
      }, clock),

    getEmailBody: (id, messageId, o) =>
      mockCall(() => {
        const t = find(id);
        const m = t?.messages.find((x) => x.id === messageId && x.kind === 'email');
        if (!t || !m) return mockError('NOT_FOUND');
        if (t.gone?.includes(messageId)) return mockError('NOT_FOUND', undefined, { message: conversationsCopy.email.gone });
        const a = access();
        const body = t.bodies[messageId] ?? textBody(messageId, m.at, (m as EmailEntry).from, (m as EmailEntry).to, (m as EmailEntry).subject, (m as EmailEntry).preview);
        const out = copyOf(body);
        out.attachments = out.attachments.map((x) => (/^bill/i.test(x.name) ? { ...x, billLocked: !a.canSeeBills } : x));
        if (out.remoteImages > 0 && o?.images && out.html) {
          let n = 0;
          out.html = out.html.replace(/\[image\]/g, () => `<img src="${picture(++n === 1 ? 'Festive offers' : 'Add photos', n === 1 ? '#EA580C' : '#111114')}" width="320" height="200" alt="">`);
          out.remoteImages = 0;
        } else if (out.html) {
          out.html = out.html.replace(/<tr><td style="padding:16px">\[image\]<\/td><\/tr>/g, '');
        }
        return ok(out);
      }, clock),

    attachmentHref: (id, messageId, part) => `data:text/plain;charset=utf-8,${encodeURIComponent(`Sample attachment ${part + 1} of email ${messageId} (conversation ${id}). The live site downloads the file from the mailbox.`)}`,

    sendReply: (id, input: ReplyInput) =>
      write(id, (t, a) => {
        const at = new Date(now()).toISOString();
        if (input.channel === 'whatsapp') {
          if (!waConnected()) return mockError('CONFLICT', undefined, { message: whatsappCopy.notAvailableWrite });
          const w = windowOf(lastInboundWa(t), now());
          let msg: WhatsAppMessage;
          if (input.templateId) {
            const tpl = whatsapp.current().templates.find((x) => x.id === input.templateId && x.status === 'approved');
            if (!tpl) return mockError('VALIDATION_FAILED', { templateId: whatsappCopy.template.choose });
            const vars = input.variables ?? [];
            const text = tpl.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => vars[Number(n) - 1] || `{{${n}}}`);
            msg = waMsg({ id: nextId('m-wa'), direction: 'out', at, status: 'pending', sentBy: { id: actor.id, name: actor.name }, type: 'template', template: { name: tpl.name, language: tpl.language, text, category: tpl.category } });
          } else if (input.attachment) {
            if (!w.open) return mockError('CONFLICT', undefined, { message: whatsappCopy.window.closed });
            const at2 = input.attachment;
            const caption = (input.text ?? '').trim();
            const base = { id: nextId('m-wa'), direction: 'out' as const, at, status: 'pending' as const, sentBy: { id: actor.id, name: actor.name } };
            if (at2.type === 'location') msg = waMsg({ ...base, type: 'location', location: { label: at2.label || 'Hotel location' } });
            else if (at2.type === 'contacts') msg = waMsg({ ...base, type: 'contacts', contacts: [{ name: at2.name || 'Contact', ...(at2.phone ? { phone: at2.phone } : {}) }] });
            else msg = waMsg({ ...base, type: at2.type, media: { name: at2.name || (at2.type === 'audio' ? 'Voice message' : 'File'), size: at2.size ?? 120_000, mime: at2.mime ?? (at2.type === 'document' ? 'application/pdf' : at2.type === 'audio' ? 'audio/ogg' : at2.type === 'video' ? 'video/mp4' : 'image/jpeg'), ...(caption ? { caption } : {}), ...(at2.duration !== undefined ? { duration: at2.duration } : {}) } });
          } else {
            const text = (input.text ?? '').trim();
            if (!text) return mockError('VALIDATION_FAILED', { text: conversationsCopy.errors.textRequired });
            if (!w.open) return mockError('CONFLICT', undefined, { message: whatsappCopy.window.closed });
            const replied = input.replyToId ? t.messages.find((x) => x.id === input.replyToId) : undefined;
            msg = waMsg({ id: nextId('m-wa'), direction: 'out', at, status: 'pending', sentBy: { id: actor.id, name: actor.name }, text, ...(replied ? { replyTo: { id: replied.id, preview: previewOf(replied).slice(0, 120) } } : {}) });
          }
          t.messages.push(msg);
          tick(t, msg.id);
          return ok<ConvMessage>(copyOf(msg));
        }
        const mb = mailbox();
        if (mb.state === 'off' || mb.state === 'not_available') return mockError('CONFLICT', undefined, { message: conversationsCopy.errors.noMailbox });
        const text = input.text.trim();
        if (!text) return mockError('VALIDATION_FAILED', { text: conversationsCopy.errors.textRequired });
        if (text.length > CONV_REPLY_MAX) return mockError('VALIDATION_FAILED', { text: conversationsCopy.errors.textLong });
        const cc = (input.cc ?? []).map((c) => c.trim()).filter(Boolean);
        if (cc.length > CONV_CC_MAX) return mockError('VALIDATION_FAILED', { cc: conversationsCopy.errors.ccMany });
        if (cc.some((c) => !isMailAddress(c))) return mockError('VALIDATION_FAILED', { cc: conversationsCopy.errors.ccBad });
        const target = replyTarget(t);
        if (!target) return mockError('CONFLICT', undefined, { message: conversationsCopy.reply.noEmail });
        const to = (input.to ?? target.address).trim().toLowerCase();
        if (to !== target.address && to !== target.differsFrom && !emailHandles(t).includes(to)) return mockError('VALIDATION_FAILED', { to: conversationsCopy.errors.recipient });
        if (input.billId) {
          if (!a.canSeeBills) return mockError('FORBIDDEN', undefined, { message: conversationsCopy.errors.billLocked });
          if (t.links.length === 0 || !emailHandles(t).includes(to) || !t.links.some((l) => l.detail?.billId === input.billId)) return mockError('FORBIDDEN', undefined, { message: conversationsCopy.errors.billOwn });
        }
        const original = [...t.messages].reverse().find((m): m is EmailEntry => m.kind === 'email' && (input.inReplyTo ? m.id === input.inReplyTo : true));
        const base = (input.subject ?? original?.subject ?? '').trim();
        if (base.length > CONV_SUBJECT_MAX) return mockError('VALIDATION_FAILED', { subject: conversationsCopy.errors.subjectLong });
        const subject = !base ? conversationsCopy.email.noSubject : /^re:/i.test(base) ? base : `${conversationsCopy.reply.re} ${base}`;
        const msg = emailMsg({ id: nextId('m-mail'), direction: 'out', at, from: mailboxAddress, to: [to], cc, subject, preview: text.replace(/\s+/g, ' ').slice(0, 200), sentBy: { id: actor.id, name: actor.name }, hasAttachments: Boolean(input.billId) });
        t.messages.push(msg);
        const billNo = t.links.find((l) => l.detail?.billId === input.billId)?.detail?.billNo ?? 'bill';
        t.bodies[msg.id] = textBody(msg.id, at, mailboxAddress, [to], subject, text, input.billId ? { attachments: [{ part: 0, name: `Bill ${billNo}.pdf`, size: 61_000, type: 'application/pdf' }] } : {});
        return ok<ConvMessage>(copyOf(msg));
      }),

    setAssignee: (id, userId) =>
      write(id, (t) => {
        if (isWhatsAppChat(channelsOf(t))) return mockError('VALIDATION_FAILED', undefined, { message: conversationsCopy.errors.waShared });
        if (userId === null) t.assignedTo = null;
        else {
          const p = staff.find((s) => s.id === userId);
          if (!p) return mockError('VALIDATION_FAILED', { assignedTo: conversationsCopy.errors.notStaff });
          t.assignedTo = { ...p };
        }
        return ok(threadOf(t));
      }),
    setStatus: (id, status) =>
      write(id, (t) => {
        if (isWhatsAppChat(channelsOf(t))) return mockError('VALIDATION_FAILED', undefined, { message: conversationsCopy.errors.waShared });
        t.status = status;
        return ok(threadOf(t));
      }),
    setBox: (id, box) =>
      write(id, (t) => {
        t.box = box;
        if (box === 'main') t.contact.muted = false;
        return ok(threadOf(t));
      }),
    setMuted: (id, on) =>
      write(id, (t) => {
        t.contact.muted = on;
        t.box = on ? 'other' : 'main';
        return ok(threadOf(t));
      }),
    markRead: (id) =>
      mockCall(() => {
        const t = find(id);
        if (!t) return mockError('NOT_FOUND');
        if (access().readOnlyReason === 'visit') return refuse(access());
        t.unread = 0;
        return ok(threadOf(t));
      }, clock),
    markUnread: (id) =>
      mockCall(() => {
        const t = find(id);
        if (!t) return mockError('NOT_FOUND');
        if (access().readOnlyReason === 'visit') return refuse(access());
        t.unread = Math.max(1, t.unread);
        return ok(threadOf(t));
      }, clock),

    // ---- the channel pages' extras (Gmail's star, labels, Compose, bulk actions; WhatsApp's favourites, pins, New chat, starred messages)
    setStarred: (id, on) =>
      write(id, (t) => {
        t.starred = on;
        return ok(threadOf(t));
      }),
    setPinned: (id, on) =>
      write(id, (t) => {
        if (on && !t.pinned && visible().filter((x) => x.pinned).length >= 3) return mockError('CONFLICT', undefined, { message: channelPageCopy.whatsapp.pinnedLimit });
        t.pinned = on;
        return ok(threadOf(t));
      }),
    setLabels: (id, labels) =>
      write(id, (t) => {
        t.labels = CHANNEL_LABELS.filter((l) => labels.includes(l));
        return ok(threadOf(t));
      }),
    setSnoozed: (id, until) =>
      write(id, (t) => {
        t.snoozedUntil = until ?? undefined;
        return ok(threadOf(t));
      }),
    setReaction: (id, messageId, emoji) =>
      write(id, (t) => {
        const m = t.messages.find((x) => x.id === messageId);
        if (!m || m.kind !== 'whatsapp') return mockError('NOT_FOUND');
        m.reactions = (m.reactions ?? []).filter((r) => r.fromContact);
        if (emoji) m.reactions.push({ emoji, fromContact: false });
        return ok(threadOf(t));
      }),
    setMessageStarred: (id, messageId, on) =>
      write(id, (t) => {
        const m = t.messages.find((x) => x.id === messageId);
        if (!m || m.kind !== 'whatsapp') return mockError('NOT_FOUND');
        m.starred = on;
        return ok(threadOf(t));
      }),
    // the demo keeps nothing: it applies Gmail's rules and answers with a reference, with a little progress
    addEmailFile: async (file: { name: string; size: number }, onProgress?: (percent: number) => void) => {
      const problem = mailFileProblem(file.name, file.size);
      if (problem) return { ok: false as const, error: { code: 'VALIDATION_FAILED' as const, message: problem, traceId: 'mock', details: { fields: { attachments: problem } } } };
      for (const p of [30, 70, 100]) {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 120));
        onProgress?.(p);
      }
      return ok<EmailFileUpload>({ ref: `${nextId('file')}/${file.name}`, name: file.name, size: file.size });
    },
    sendNewEmail: (input: ComposeEmailInput) =>
      mockCall(() => {
        const a = access();
        if (!a.canEdit) return refuse(a);
        const F = channelPageCopy.email.composeForm;
        const to = input.to.trim().toLowerCase();
        const fields: Record<string, string> = {};
        if (!to) fields.to = F.toRequired;
        else if (!isMailAddress(to)) fields.to = F.toBad;
        const cc = (input.cc ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
        if (cc.some((c) => !isMailAddress(c))) fields.cc = conversationsCopy.errors.ccBad;
        if (!input.draft && !input.text.trim()) fields.text = F.bodyRequired;
        if (Object.keys(fields).length) return mockError('VALIDATION_FAILED', fields);
        const at = new Date(now()).toISOString();
        const subject = input.subject.trim() || F.noSubject;
        const msg = emailMsg({ id: nextId('m-mail'), direction: 'out', at, from: mailboxAddress, to: [to], cc, subject, preview: input.text.replace(/\s+/g, ' ').slice(0, 200), sentBy: { id: actor.id, name: actor.name }, hasAttachments: (input.attachments ?? []).length > 0 });
        const existing = visible().find((x) => emailHandles(x).includes(to));
        const t: MockThread = existing ?? { id: nextId('cv'), contact: { name: to, handles: [to], muted: false }, links: [], status: 'open', box: 'main', assignedTo: null, unread: 0, messages: [], notes: [], bodies: {} };
        t.messages.push(msg);
        t.bodies[msg.id] = textBody(msg.id, at, mailboxAddress, [to], subject, input.text, (input.attachments ?? []).length ? { attachments: (input.attachments ?? []).map((name, part) => ({ part, name, size: 52_000, type: 'application/octet-stream' })) } : {});
        t.draft = input.draft === true;
        if (!existing) threads.push(t);
        return ok({ id: t.id });
      }, clock),
    startWhatsAppChat: (input: StartChatInput) =>
      mockCall(() => {
        const a = access();
        if (!a.canEdit) return refuse(a);
        if (!waConnected()) return mockError('CONFLICT', undefined, { message: whatsappCopy.notAvailableWrite });
        const N = channelPageCopy.whatsapp.newChatForm;
        const phone = input.phone.trim();
        if (!/^\+[0-9][0-9 ]{7,17}$/.test(phone)) return mockError('VALIDATION_FAILED', { phone: N.phoneBad });
        const at = new Date(now()).toISOString();
        const existing = visible().find((x) => digits(x.contact.handles.find(isPhone) ?? '') === digits(phone));
        const t: MockThread = existing ?? { id: nextId('cv'), contact: { name: (input.name ?? '').trim() || phone, handles: [phone], muted: false }, links: [], status: 'open', box: 'main', assignedTo: null, unread: 0, messages: [], notes: [], bodies: {} };
        const open = windowOf(lastInboundWa(t), now()).open;
        let msg: WhatsAppMessage;
        if (input.templateId) {
          const tpl = whatsapp.current().templates.find((x) => x.id === input.templateId && x.status === 'approved');
          if (!tpl) return mockError('VALIDATION_FAILED', { templateId: N.templateRequired });
          const vars = input.variables ?? [];
          const text = tpl.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => vars[Number(n) - 1] || `{{${n}}}`);
          msg = waMsg({ id: nextId('m-wa'), direction: 'out', at, status: 'pending', sentBy: { id: actor.id, name: actor.name }, type: 'template', template: { name: tpl.name, language: tpl.language, text, category: tpl.category } });
        } else {
          if (!open) return mockError('VALIDATION_FAILED', { templateId: N.templateRequired });
          msg = waMsg({ id: nextId('m-wa'), direction: 'out', at, status: 'pending', sentBy: { id: actor.id, name: actor.name }, text: (input.text ?? '').trim() });
        }
        t.messages.push(msg);
        tick(t, msg.id);
        t.status = 'open';
        if (!existing) threads.push(t);
        return ok({ id: t.id });
      }, clock),
    bulk: (ids, action: ConvBulkAction) =>
      mockCall(() => {
        const a = access();
        if (!a.canEdit) return refuse(a);
        let changed = 0;
        for (const id of ids) {
          const t = find(id);
          if (!t || ((action === 'done' || action === 'reopen') && isWhatsAppChat(channelsOf(t)))) continue;
          changed += 1;
          if (action === 'snooze') t.snoozedUntil = new Date(now() + 3 * 3_600_000).toISOString();
          else if (action === 'read') t.unread = 0;
          else if (action === 'unread') t.unread = Math.max(1, t.unread);
          else if (action === 'done') t.status = 'done';
          else if (action === 'reopen') {
            t.status = 'open';
            t.box = 'main';
          } else if (action === 'star') t.starred = true;
          else if (action === 'unstar') t.starred = false;
          else if (action === 'other') t.box = 'other';
          else if (action === 'main') t.box = 'main';
          else if (action === 'trash') t.deleted = true;
        }
        return ok({ changed });
      }, clock),

    addNote: (id, text) =>
      write(id, (t) => {
        const body = text.trim();
        if (!body) return mockError('VALIDATION_FAILED', { text: conversationsCopy.errors.noteRequired });
        if (body.length > CONV_NOTE_MAX) return mockError('VALIDATION_FAILED', { text: conversationsCopy.errors.noteLong });
        const note: MockNote = { id: nextId('n'), text: body, author: { id: actor.id, name: actor.name }, at: new Date(now()).toISOString() };
        t.notes.push(note);
        return ok<ConvNote>({ ...note, author: { ...note.author }, mine: true });
      }),
    deleteNote: (id, noteId) =>
      write(id, (t) => {
        const n = t.notes.find((x) => x.id === noteId);
        if (!n) return mockError('NOT_FOUND');
        if (n.author.id !== actor.id && actor.role !== 'hotel_admin' && scope === 'hotel') return mockError('FORBIDDEN', undefined, { message: conversationsCopy.errors.noteNotYours });
        t.notes = t.notes.filter((x) => x.id !== noteId);
        return ok({ removed: true as const });
      }),

    setLink: (id, link) =>
      write(id, (t, a) => {
        if (!a.canLink.includes(link.kind)) return mockError('FORBIDDEN');
        const c = (scope === 'hotel' ? HOTEL_CANDIDATES : PLATFORM_CANDIDATES).find((x) => x.kind === link.kind && x.id === link.targetId) as (LinkCandidate & { linkDetail?: ConvLink['detail'] }) | undefined;
        if (!c) return mockError('NOT_FOUND');
        t.links = [{ kind: c.kind, id: c.id, label: c.label, source: 'manual', ...(c.linkDetail ? { detail: { ...c.linkDetail } } : c.kind === 'hotel' ? { detail: { hotelName: c.label } } : {}) }];
        if (t.box === 'other' && !t.contact.muted) t.box = 'main';
        return ok(threadOf(t));
      }),
    deleteLink: (id) =>
      write(id, (t) => {
        t.links = [];
        return ok(threadOf(t));
      }),
    listLinkCandidates: (search, kind) =>
      mockCall(() => {
        const a = access();
        const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const all = scope === 'hotel' ? HOTEL_CANDIDATES : PLATFORM_CANDIDATES;
        return ok(
          all
            .filter((c) => a.canLink.includes(c.kind) && (!kind || c.kind === kind) && words.every((w) => `${c.label} ${c.detail ?? ''}`.toLowerCase().includes(w)))
            .map((c) => ({ kind: c.kind, id: c.id, label: c.label, ...(c.detail ? { detail: c.detail } : {}) })),
        );
      }, clock),

    listStaff: () => mockCall(() => ok(staff.map((p) => ({ ...p }))), clock),
    listQuickReplies: () => mockCall(() => ok([...quick].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)).map((q) => ({ ...q }))), clock),
    addQuickReply: (input: QuickReplyInput) =>
      mockCall(() => {
        const a = access();
        if (!a.canEdit) return refuse(a);
        const bad = checkQuick(input, quick);
        if (bad) return bad;
        const q: QuickReply = { id: nextId('qr'), title: input.title.trim(), body: input.body.trim(), channel: input.channel ?? 'any', sortOrder: input.sortOrder ?? quick.length };
        quick = [...quick, q];
        return ok({ ...q });
      }, clock),
    updateQuickReply: (qid, input) =>
      mockCall(() => {
        const a = access();
        if (!a.canEdit) return refuse(a);
        const cur = quick.find((q) => q.id === qid);
        if (!cur) return mockError('NOT_FOUND');
        const bad = checkQuick(input, quick.filter((q) => q.id !== qid));
        if (bad) return bad;
        const next: QuickReply = { ...cur, title: input.title.trim(), body: input.body.trim(), channel: input.channel ?? cur.channel, sortOrder: input.sortOrder ?? cur.sortOrder };
        quick = quick.map((q) => (q.id === qid ? next : q));
        return ok({ ...next });
      }, clock),
    deleteQuickReply: (qid) =>
      mockCall(() => {
        const a = access();
        if (!a.canEdit) return refuse(a);
        if (!quick.some((q) => q.id === qid)) return mockError('NOT_FOUND');
        quick = quick.filter((q) => q.id !== qid);
        return ok({ removed: true as const });
      }, clock),

    getWhatsAppSettings: () => mockCall(() => ok(blank() ? { ...WHATSAPP_NOT_CONNECTED, templates: [], automatic: [] } : whatsapp.current()), clock),
    setWhatsAppAutomatic: (key, on) => (access().canEdit ? whatsapp.setAutomatic(key, on) : mockCall(() => refuse(access()), clock)),
  };
  return api;
}

function checkQuick(input: QuickReplyInput, others: QuickReply[]): DashResult<never> | null {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > CONV_QUICK_TITLE_MAX) return mockError('VALIDATION_FAILED', { title: conversationsCopy.errors.quickTitle });
  if (!body || body.length > CONV_QUICK_BODY_MAX) return mockError('VALIDATION_FAILED', { body: conversationsCopy.errors.quickBody });
  if (others.some((q) => q.title.toLowerCase() === title.toLowerCase())) return mockError('CONFLICT', undefined, { message: conversationsCopy.errors.quickTaken });
  return null;
}

// ------------------------------------------------------------------------------------------------ the platform mailbox card

/** Console > Conversations > Settings in the mock: the reading switch, the IMAP server (own mail server only), Test connection and the hotels on WhatsApp. */
export function createPlatformMailboxMock(opts: MockClock & { now?: () => number } = {}): PlatformMailboxApi {
  const now = opts.now ?? (() => Date.now());
  const clock: MockClock = { latencyMs: opts.latencyMs, offline: opts.offline };
  const whatsapp = createWhatsAppSettingsMock('platform', { latencyMs: opts.latencyMs, offline: opts.offline, now });
  let reading = true;
  let imapHost: string | null = 'mail.easyhotelsolutions.in';
  let imapPort: 993 | 143 = 993;
  let lastTest: MailConnectionTest | null = null;
  const smtp = () => dev('__convProvider') === 'smtp';
  const card = (): PlatformMailbox => ({
    reading,
    canRead: true,
    provider: smtp() ? 'smtp' : 'gmail',
    address: PLATFORM_MAILBOX,
    imapHost: smtp() ? imapHost : null,
    imapPort: smtp() ? imapPort : 993,
    imapFixed: !smtp(),
    state: reading ? { state: 'ok', checkedAt: new Date(now() - 3 * MIN).toISOString(), address: PLATFORM_MAILBOX } : { state: 'off', reason: 'off', checkedAt: null, address: PLATFORM_MAILBOX, message: conversationsCopy.mailbox.off },
    lastTest,
  });
  return {
    getMailbox: () => mockCall(() => ok(card()), clock),
    setMailbox: (input: PlatformMailboxInput) =>
      mockCall(() => {
        if (smtp() && input.reading) {
          const host = (input.imapHost ?? '').trim();
          if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !host.includes('.') || /^localhost$|\.localhost$/i.test(host) || /^[0-9.]+$/.test(host)) return mockError('VALIDATION_FAILED', { imapHost: 'Enter the public name of your mail server, for example mail.example.com.' });
          if (input.imapPort !== 993 && input.imapPort !== 143) return mockError('VALIDATION_FAILED', { imapPort: 'The IMAP port is 993 (SSL/TLS) or 143 (STARTTLS).' });
          imapHost = host;
          imapPort = input.imapPort;
        }
        reading = input.reading;
        return ok(card());
      }, clock),
    startMailboxTest: () =>
      mockCall(() => {
        const at = new Date(now()).toISOString();
        lastTest =
          dev('__convMailbox') === 'error'
            ? {
                imap: { ok: false, code: 'AUTH', message: 'The mail server did not accept the login.', hint: 'Google refused the app password. Make a new app password (Google Account > Security > App passwords), paste it in Platform settings > Mail and save.' },
                smtp: { ok: false, code: 'AUTH', message: 'The mail server did not accept the login.', hint: 'Google refused the app password. Make a new app password and save it again.' },
                at,
              }
            : { imap: { ok: true, code: null, message: 'Signed in. Sent folder found.' }, smtp: { ok: true, code: null, message: 'Signed in. Mail can be sent.' }, at };
        return ok(lastTest);
      }, clock),
    listWhatsAppHotels: () => whatsapp.hotels(),
  };
}
