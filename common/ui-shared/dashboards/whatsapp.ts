// WhatsApp in Conversations (decision 66; docs/plans/WHATSAPP-PLAN-2026-10-24.md, section 7 screens inside Conversations). DESIGN ONLY for now (MJ, 24 Oct 2026: "whatsapp
// desgin for now"): the screens are complete and run on sample data in mock mode; the live API answers "WhatsApp not connected yet" (WHATSAPP_NOT_CONNECTED, and a 409 on any
// WhatsApp write). The types already carry every state Meta produces (pending, the automatic sender, the "sent from Phone" echo of coexistence, video, sticker, contacts and
// unsupported messages, the reply context, reactions), so the Meta integration later adds only a server adapter and a webhook, and no screen changes.
import type { DashResult } from './common';
import type { ConvMessageStatus, ConvPerson } from './conversations';

/** The ticks of an outgoing message: waiting to go, accepted by WhatsApp, on the guest's phone, read, or not delivered. */
export type WaTick = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
/** Who sent a message: the guest, a staff member in HMS, the hotel's own phone (coexistence echo), or HMS by itself (an automatic message). */
export type WaSender = 'contact' | 'hms' | 'phone' | 'auto';
export type WaMessageType = 'text' | 'image' | 'video' | 'document' | 'audio' | 'sticker' | 'location' | 'contacts' | 'template' | 'unsupported';
export type WaTemplateCategory = 'utility' | 'marketing' | 'authentication';
export type WaTemplateStatus = 'approved' | 'pending' | 'rejected' | 'paused';
/** Meta's quality rating of a number (green high, yellow medium, red low). */
export type WaQuality = 'green' | 'yellow' | 'red' | 'unknown';

export interface WhatsAppMessage {
  kind: 'whatsapp';
  id: string;
  direction: 'in' | 'out';
  status: ConvMessageStatus;
  at: string;
  /** The staff member who sent it from HMS; null for the guest, the phone and automatic messages. */
  sentBy: ConvPerson | null;
  sentFrom: WaSender;
  type: WaMessageType;
  text?: string;
  /** A photo, video, document, voice note or sticker: its name, size and type. `previewUrl` exists only in the mock (the live media comes with the adapter). */
  media?: { name: string; size: number; mime: string; caption?: string; previewUrl?: string; /** seconds, for a video or a voice note */ duration?: number; /** The file itself: kept in the hotel's bucket (open it), still being downloaded, or not kept (too old, refused type, no storage). */ kept?: 'yes' | 'waiting' | 'no' };
  location?: { label: string };
  contacts?: { name: string; phone?: string }[];
  template?: { name: string; language: string; text: string; category: WaTemplateCategory };
  /** The message this one answers (WhatsApp's reply context): its id and a short preview. */
  replyTo?: { id: string; preview: string };
  reactions?: { emoji: string; fromContact: boolean }[];
  /** Why it was not delivered, as a fixed sentence. */
  failure?: string;
  /** Starred by the team (WhatsApp's Starred messages). Demo only until the server carries it. */
  starred?: boolean;
}

/** The 24-hour customer service window (Meta's rule): free replies while it is open; only an approved template once it closed. */
export interface WhatsAppWindow {
  open: boolean;
  /** When it closes (ISO), or null when the guest never wrote. */
  closesAt: string | null;
  minutesLeft: number | null;
  /** Less than 2 hours left: the band turns to the warning tone. */
  closingSoon: boolean;
}

export const WA_WINDOW_HOURS = 24;
export const WA_CLOSING_SOON_MINUTES = 120;

/** The window from the guest's last message (pure: the mock and the future adapter use the same rule). */
export function windowOf(lastInboundAt: string | Date | null | undefined, now: Date | number = Date.now()): WhatsAppWindow {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  if (lastInboundAt === null || lastInboundAt === undefined || lastInboundAt === '') return { open: false, closesAt: null, minutesLeft: null, closingSoon: false };
  const last = typeof lastInboundAt === 'string' ? Date.parse(lastInboundAt) : lastInboundAt.getTime();
  if (!Number.isFinite(last)) return { open: false, closesAt: null, minutesLeft: null, closingSoon: false };
  const closes = last + WA_WINDOW_HOURS * 3_600_000;
  const left = closes - nowMs;
  if (left <= 0) return { open: false, closesAt: new Date(closes).toISOString(), minutesLeft: 0, closingSoon: false };
  const minutesLeft = Math.floor(left / 60_000);
  return { open: true, closesAt: new Date(closes).toISOString(), minutesLeft, closingSoon: minutesLeft < WA_CLOSING_SOON_MINUTES };
}

/** An approved message of the hotel (or the platform). Variables are numbered as in Meta's template ({{1}}, {{2}}); `source` says what HMS fills in from the linked guest. */
export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: WaTemplateCategory;
  language: string;
  status: WaTemplateStatus;
  /** The text with {{1}}, {{2}} where the variables go. */
  text: string;
  variables: { index: number; label: string; source?: 'guest_name' | 'room' | 'check_in' | 'check_out' | 'hotel_name' }[];
}

export interface WhatsAppReplyInput {
  channel: 'whatsapp';
  /** Free text: only while the window is open. */
  text?: string;
  /** An approved template (the only thing allowed once the window closed), with its variables in order. */
  templateId?: string;
  variables?: string[];
  /** Send this bill's PDF (needs the Bills permission). */
  billId?: string;
  /** Answer this message (WhatsApp's reply context). */
  replyToId?: string;
  /** The attach menu: a photo, a video, a document, a voice note, a location or a contact card (the demo keeps names only; the live media comes with the Meta adapter). */
  attachment?: { type: 'image' | 'video' | 'document' | 'audio' | 'location' | 'contacts'; name?: string; size?: number; mime?: string; duration?: number; label?: string; phone?: string };
}

/** The messages HMS sends by itself, each switchable by the Hotel Admin (only with the guest's WhatsApp consent). */
export type WhatsAppAutomaticKey = 'booking_confirmed' | 'check_in_welcome' | 'bill_link' | 'check_out_thanks' | 'advance_received';
export const WHATSAPP_AUTOMATIC_KEYS: readonly WhatsAppAutomaticKey[] = ['booking_confirmed', 'check_in_welcome', 'bill_link', 'check_out_thanks', 'advance_received'];

export interface WhatsAppSettings {
  connected: boolean;
  /** false on the live site until the Meta integration is built: the Connect button shows "Coming soon". */
  available: boolean;
  number?: string;
  displayName?: string;
  displayNameStatus?: 'approved' | 'pending' | 'rejected';
  quality?: WaQuality;
  connectedAt?: string;
  lastSentAt?: string | null;
  lastReceivedAt?: string | null;
  templates: WhatsAppTemplate[];
  automatic: { key: WhatsAppAutomaticKey; on: boolean; templateId?: string }[];
  /** This month's counts (no content). */
  month?: { templates: number; free: number; received: number };
}

/** Console > Conversations > Settings > WhatsApp: each hotel's connection, quality and this month's counts. No chat content (D6). */
export interface WhatsAppHotelRow {
  hotelId: string;
  hotelName: string;
  connected: boolean;
  number: string | null;
  quality: WaQuality;
  monthTemplates: number;
  monthMessages: number;
}

/** What the live site answers until the Meta integration exists. */
export const WHATSAPP_NOT_CONNECTED: WhatsAppSettings = { connected: false, available: false, templates: [], automatic: [] };

// ---- Hotel settings > Messages (MJ, 5 Nov 2026): the automatic messages set once by the Hotel Admin; staff only see "Sent automatically" lines ----

/** The six automatic messages of the Messages tab, in the order the table shows them. */
export type MessagesAutomaticKey = 'booking_confirmation' | 'pre_arrival' | 'welcome' | 'bill_checkout' | 'review_ask' | 'company_payment_reminder';
export const MESSAGES_AUTOMATIC_KEYS: readonly MessagesAutomaticKey[] = ['booking_confirmation', 'pre_arrival', 'welcome', 'bill_checkout', 'review_ask', 'company_payment_reminder'];
export type MessagesChannel = 'whatsapp' | 'email' | 'both';
export const MESSAGES_CHANNELS: readonly MessagesChannel[] = ['whatsapp', 'email', 'both'];
/** `guest` = the guest's own language when HMS knows it, else English. */
export type MessagesLanguage = 'guest' | 'en' | 'hi' | 'gu';
export const MESSAGES_LANGUAGES: readonly MessagesLanguage[] = ['guest', 'en', 'hi', 'gu'];

/** The rows whose on/off the server already keeps (Settings > WhatsApp's switches); the others wait for a server field. */
export const MESSAGES_SERVER_KEY: Partial<Record<MessagesAutomaticKey, WhatsAppAutomaticKey>> = {
  booking_confirmation: 'booking_confirmed',
  welcome: 'check_in_welcome',
  bill_checkout: 'bill_link',
  review_ask: 'check_out_thanks',
};

export interface MessagesAutomaticRow {
  key: MessagesAutomaticKey;
  on: boolean;
  channel: MessagesChannel;
  language: MessagesLanguage;
  /** The approved WhatsApp message it sends (a WhatsAppTemplate id), or null while none is picked. */
  templateId: string | null;
}

export interface MessagesSettings {
  /** Bumped by every save; a save with an older version is refused (CONFLICT with currentVersion). */
  version: number;
  automatic: MessagesAutomaticRow[];
  /** 24-hour "HH:MM". Scheduled messages wait until quietTo; staff replies are never held. */
  quietFrom: string;
  quietTo: string;
  fallbackEmail: boolean;
  stopWhenPaid: boolean;
  consentOnly: boolean;
  /** The hotel's own number for the test send. */
  testPhone: string;
  savedBy: string | null;
  savedAt: string | null;
}

export type MessagesSettingsInput = Omit<MessagesSettings, 'savedBy' | 'savedAt'>;

export interface MessagesSettingsApi {
  getMessagesSettings(): Promise<DashResult<MessagesSettings>>;
  saveMessagesSettings(input: MessagesSettingsInput): Promise<DashResult<{ settings: MessagesSettings; message: string }>>;
  /** One pre-arrival message with sample booking values to the hotel's own number. */
  testSendMessage(phone: string): Promise<DashResult<{ message: string }>>;
}

export function defaultMessagesSettings(): MessagesSettings {
  const row = (key: MessagesAutomaticKey, on: boolean, channel: MessagesChannel, language: MessagesLanguage = 'guest', templateId: string | null = null): MessagesAutomaticRow => ({ key, on, channel, language, templateId });
  return {
    version: 1,
    automatic: [
      row('booking_confirmation', true, 'both'),
      row('pre_arrival', true, 'whatsapp'),
      row('welcome', true, 'whatsapp'),
      row('bill_checkout', true, 'both', 'en'),
      row('review_ask', false, 'whatsapp'),
      row('company_payment_reminder', true, 'email', 'en'),
    ],
    quietFrom: '21:00',
    quietTo: '08:00',
    fallbackEmail: true,
    stopWhenPaid: true,
    consentOnly: true,
    testPhone: '',
    savedBy: null,
    savedAt: null,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^\+?[0-9][0-9 ]{8,16}$/;

/** The checks a save runs (the mock today, the server later): field errors keyed as the form shows them. */
export function checkMessagesSettings(input: MessagesSettingsInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!HHMM.test(input.quietFrom)) errors.quietFrom = messagesSettingsCopy.errors.time;
  if (!HHMM.test(input.quietTo)) errors.quietTo = messagesSettingsCopy.errors.time;
  if (input.quietFrom === input.quietTo && HHMM.test(input.quietFrom)) errors.quietTo = messagesSettingsCopy.errors.sameTime;
  if (input.testPhone.trim() !== '' && !PHONE.test(input.testPhone.trim())) errors.testPhone = messagesSettingsCopy.errors.phone;
  const seen = new Set<string>();
  for (const r of input.automatic) {
    if (!MESSAGES_AUTOMATIC_KEYS.includes(r.key) || seen.has(r.key)) errors.automatic = messagesSettingsCopy.errors.rows;
    seen.add(r.key);
    if (!MESSAGES_CHANNELS.includes(r.channel) || !MESSAGES_LANGUAGES.includes(r.language)) errors.automatic = messagesSettingsCopy.errors.rows;
  }
  if (seen.size !== MESSAGES_AUTOMATIC_KEYS.length) errors.automatic = messagesSettingsCopy.errors.rows;
  return errors;
}

export const messagesSettingsCopy = {
  tab: 'Messages',
  title: 'Automatic messages',
  about: 'Set once here. Staff never switch these per guest; a thread only shows "Sent automatically".',
  columns: { message: 'Message', on: 'On', when: 'When', channel: 'Channel', language: 'Language', template: 'Template' },
  names: {
    booking_confirmation: 'Booking confirmation',
    pre_arrival: 'Pre-arrival',
    welcome: 'Welcome',
    bill_checkout: 'Bill at check-out',
    review_ask: 'Review ask',
    company_payment_reminder: 'Payment reminder to companies',
  } as Record<MessagesAutomaticKey, string>,
  when: {
    booking_confirmation: 'As soon as the booking is saved',
    pre_arrival: '48 hours before check-in, with the pre-check-in link',
    welcome: 'On check-in, with the house rules and Wi-Fi',
    bill_checkout: 'On check-out, PDF attached',
    review_ask: '24 hours after check-out, 10:00 AM',
    company_payment_reminder: 'On the due date, then every 7 days until paid',
  } as Record<MessagesAutomaticKey, string>,
  channel: { whatsapp: 'WhatsApp', email: 'Email', both: 'WhatsApp and email' } as Record<MessagesChannel, string>,
  language: { guest: "Guest's language, else English", en: 'English', hi: 'Hindi', gu: 'Gujarati' } as Record<MessagesLanguage, string>,
  template: { none: 'None picked yet', emailOnly: 'Not needed for email' },
  onLabel: (name: string) => `${name} on`,
  quiet: { label: 'Quiet hours', to: 'to', help: 'Scheduled messages wait until the morning. Replies by staff are never held.', from: 'Quiet from', until: 'Quiet until' },
  fallback: { label: 'Fallback to email', text: 'Send by email when WhatsApp fails or the guest has not opted in', help: 'Uses the booking email. Shown in the thread as "Sent by email".' },
  stopWhenPaid: { label: 'Stop reminders when paid', text: 'Payment reminders end the moment the bill is settled', help: 'Applies to company reminders and the bill at check-out.' },
  consentOnly: { label: 'Consent only', text: 'WhatsApp only to guests who agreed at booking or check-in', help: 'A guest who said STOP is never messaged again.' },
  test: { label: 'Test send', placeholder: '+91 98250 00000', button: 'Send a test pre-arrival', help: 'Goes to your own number with sample booking values.', sent: (phone: string) => `Test pre-arrival sent to ${phone}. Check that phone.` },
  save: 'Save messages',
  saved: 'Messages saved.',
  lastSaved: (who: string, when: string) => `Last saved by ${who} · ${when}`,
  neverSaved: 'Not saved yet: these are the starting values.',
  noServer: "Kept on this screen for now: the server does not carry these settings yet. The WhatsApp on/off switches are saved.",
  notConnected: 'WhatsApp is not connected yet: rows set to WhatsApp go by email while fallback is on.',
  errors: { time: 'Use a time like 21:00.', sameTime: 'Quiet hours need two different times.', phone: 'Use a number like +91 98250 00000.', rows: 'The list of messages did not read right. Refresh and try again.' },
} as const;

export const whatsappCopy = {
  name: 'WhatsApp',
  notConnected: 'WhatsApp not connected yet',
  comingSoon: 'WhatsApp in HMS is coming soon. Guests will be able to message the hotel here, next to email, and staff will reply from the same screen.',
  connect: 'Connect WhatsApp',
  comingSoonChip: 'Coming soon',
  openSettings: 'Settings > WhatsApp',
  filterEmpty: 'No WhatsApp messages yet.',
  window: {
    open: 'Free replies for {h} more hours',
    openMinutes: 'Free replies for {m} more minutes',
    closingSoon: 'Free replies end in {m} min',
    closed: 'More than 24 hours since the guest last wrote. WhatsApp only allows an approved message now; their next message reopens free replies.',
    never: 'This person has not written on WhatsApp yet. WhatsApp only allows an approved message to start a chat.',
    draftKept: 'The 24 hours ended while you were typing. Your text is kept: pick an approved message to send.',
  },
  template: {
    pick: 'Approved message',
    choose: 'Choose an approved message',
    none: 'No approved messages yet.',
    preview: 'Preview',
    variable: 'Fills {label}',
    charge: 'Meta charges this as a {category} message.',
    send: 'Send approved message',
    /** Under the preview while a blank is empty: {fields} = the empty blanks' labels ("Guest name and Room"). */
    fillIn: 'Fill in {fields} to send.',
    and: 'and',
    category: { utility: 'utility', marketing: 'marketing', authentication: 'authentication' } as Record<WaTemplateCategory, string>,
    status: { approved: 'Approved', pending: 'Waiting for Meta', rejected: 'Rejected', paused: 'Paused by Meta' } as Record<WaTemplateStatus, string>,
  },
  ticks: { pending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not delivered' } as Record<WaTick, string>,
  sentFromPhone: 'Sent from Phone',
  sentAutomatically: 'Sent automatically',
  sentBy: 'Sent by {name}',
  unsupported: "This kind of message can't be shown here. Open WhatsApp on the phone to see it.",
  replyingTo: 'Replying to',
  reply: 'Reply',
  cancelReply: 'Cancel reply',
  location: 'Location',
  contactCard: 'Contact',
  voiceNote: 'Voice note',
  video: 'Video',
  sticker: 'Sticker',
  photo: 'Photo',
  document: 'Document',
  failedLine: 'Not delivered. {reason}',
  quality: { green: 'High', yellow: 'Medium', red: 'Low', unknown: 'Not rated yet' } as Record<WaQuality, string>,
  qualityLabel: 'Quality rating',
  qualityHelp: 'Meta rates the number by how guests react to its messages. Keep automatic messages useful and few.',
  displayName: 'Display name',
  displayNameStatus: { approved: 'Approved by Meta', pending: 'Waiting for Meta', rejected: 'Rejected by Meta' } as Record<'approved' | 'pending' | 'rejected', string>,
  number: 'Number',
  connectedOn: 'Connected on {date}',
  lastSent: 'Last message sent',
  lastReceived: 'Last message received',
  templates: 'Approved messages',
  templatesHelp: 'Meta approves each message once. Only approved messages can be sent after the 24 hours.',
  automaticTitle: 'Automatic messages',
  automaticHelp: 'Sent only to guests who agreed to WhatsApp at check-in or booking.',
  /** Settings > WhatsApp's card head while nothing is connected. */
  notConnectedAbout: 'Guests message your hotel on WhatsApp, next to email.',
  automatic: {
    booking_confirmed: 'Booking confirmed',
    check_in_welcome: 'Check-in welcome',
    bill_link: 'Bill or receipt link',
    check_out_thanks: 'Check-out thank-you',
    advance_received: 'Advance received',
  } as Record<WhatsAppAutomaticKey, string>,
  /** One line each: what the automatic message sends, and when. */
  automaticAbout: {
    booking_confirmed: 'Sends the dates, room type and booking number as soon as a booking is saved.',
    check_in_welcome: 'Welcomes the guest at check-in with the room number and the Wi-Fi details.',
    bill_link: 'Sends a link to the bill or receipt when a payment is taken or the bill is closed.',
    check_out_thanks: 'Thanks the guest after check-out and asks how the stay was.',
    advance_received: 'Confirms the amount when an advance is paid for a booking.',
  } as Record<WhatsAppAutomaticKey, string>,
  /** Under an automatic message: the approved message it uses. */
  automaticUses: 'Uses the approved message "{name}"',
  /** An automatic message with no approved message to send: it cannot be switched on until it has one. */
  automaticNoTemplate: 'No approved message yet: it cannot be switched on.',
  automaticTemplateNotApproved: {
    pending: 'Its message "{name}" is waiting for approval by Meta: it cannot be switched on yet.',
    rejected: 'Its message "{name}" was rejected by Meta: it cannot be switched on.',
    paused: 'Its message "{name}" is paused by Meta: nothing is sent until it is active again.',
  },
  month: { title: 'This month', templates: '{n} approved messages sent', free: '{n} free replies', received: '{n} messages received' },
  hotels: { title: 'Hotels on WhatsApp', empty: 'No hotel has connected WhatsApp yet.', hotel: 'Hotel', status: 'Status', connected: 'Connected', notConnected: 'Not connected', messages: 'Messages this month', templates: 'Approved messages this month' },
  platformTitle: 'Platform WhatsApp number',
  notAvailableWrite: 'WhatsApp is not connected yet.',
  /** The desk's WhatsApp page (WhatsAppPage.tsx, MJ's 5 Nov 2026 design): the list, the thread, the guest card and the composer. */
  desk: {
    filters: { all: 'All', unread: 'Unread', waiting: 'Waiting' },
    search: 'Search chats',
    searchChat: 'Search in this chat',
    hits: '{n} of {total}',
    noHits: 'No match',
    prevHit: 'Earlier match',
    nextHit: 'Later match',
    closeSearch: 'Close search',
    guestCard: 'Guest card',
    more: 'More',
    contactInfo: 'Contact info',
    windowShort: 'Reply window open until {time}',
    windowShortClosed: 'Reply window closed',
    pin: 'Pin chat',
    unpin: 'Unpin chat',
    pinned: 'Pinned',
    markUnread: 'Mark as unread',
    labels: 'Labels',
    draft: 'Draft',
    copied: 'Copied.',
    newMessages: '{n} new message',
    newMessagesMany: '{n} new messages',
    emoji: 'Emoji and quick replies',
    quickReplies: 'Quick replies',
    template: 'Template',
    sendTemplate: 'Send a template',
    files: { title: 'Media, documents and links', media: 'Media', docs: 'Documents', links: 'Links', noMedia: 'No photos or videos in this chat yet.', noDocs: 'No documents in this chat yet.', noLinks: 'No links in this chat yet.' },
    info: { title: 'Message info', sent: 'Sent', state: 'Now', by: 'Sent by', hotelPhone: "The hotel's phone", auto: 'HMS, automatically', note: 'WhatsApp tells HMS the latest state only, so the times it was delivered and read are not kept.' },
    writeTo: 'Write to {name}',
    pickTemplate: 'Pick a template to message {name}',
    windowOpenUntil: 'Window open until {time} · free text allowed',
    windowClosed: 'Outside the 24-hour window: only templates can be sent',
    windowNever: 'This guest has not written yet: only templates can be sent',
    replyingAs: 'Replying as {name}',
    templates: 'Templates',
    payLink: 'Pay link',
    sendPayLink: 'Send pay link',
    makingLink: 'Making the link…',
    payLinkSent: 'Pay link for {amount} sent.',
    nothingOwed: 'Nothing is owed on this bill.',
    billSent: 'Bill {no} sent.',
    sent: 'Sent',
    quick: 'Quick',
    guest: {
      details: 'Guest details',
      room: 'Room',
      dates: 'Dates',
      status: 'Status',
      notes: 'Notes',
      bill: 'Bill {no}',
      billTotal: 'Bill total',
      notLinked: 'Not linked to a booking yet',
    },
    /** The centre line of a message HMS sent by itself: "Booking confirmed · Sent automatically · 6:12 pm". */
    autoLine: '{what} · {auto} · {time}',
    languages: { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' } as Record<'en' | 'hi' | 'gu', string>,
    language: 'Language',
    noLanguage: 'No {language} version is approved yet',
    filledFrom: '{n} values filled from the booking',
    filledNone: 'Nothing filled from the booking yet',
    cancel: 'Cancel',
  },
} as const;
