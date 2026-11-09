// The in-memory mocks of notifications.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
// Two factories over ONE demo store: the hotel's (send, history, detail, withdraw) and the company portal's (list, unread, read, read all). They share a store when a caller passes the
// same one, so a notice sent in the hotel mock shows up in the portal mock. Nothing here is a real company. Dates follow the company portal's MOCK_TODAY (corporate.ts).
import type { DashResult, MockClock } from './common';
import { mockCall, mockEmptyHotel, mockError, ok } from './common';
import { MOCK_TODAY } from './corporate';
import { PORTAL_ALL_HOTELS, portalHotelStore } from './portalHotel';
import { mockListPage, mockUnavailable, mockUnreachableHotels } from './portalCursor.mock';
import {
  NOTIFICATION_BODY_MAX, NOTIFICATION_EMAIL_CAP, NOTIFICATION_SENDS_PER_HOUR, NOTIFICATION_TITLE_MAX,
  type Notification, type NotificationAudienceKind, type NotificationDetail, type NotificationEmailStatus, type NotificationInput, type NotificationListQuery, type NotificationPage,
  type NotificationStatus, type PortalNotification, type PortalNotificationPage, type PortalNotificationQuery,
} from './notifications';

const HOTEL = { hotelId: 'h-1', name: 'Hotel Sunrise, Rajkot' };
/** The portal demo: this company has notices from three hotels (the same three as the company portal mock). */
const PORTAL_HOTELS = [HOTEL, { hotelId: 'h-2', name: 'Sunrise Residency, Surat' }, { hotelId: 'h-3', name: 'Lakeview Inn, Udaipur' }];
const PORTAL_COMPANY = 'co-1';

/** The companies of the hotel demo (the same ids as companies.mock.ts) with an email address count. */
const COMPANY_NAMES: Record<string, { name: string; emails: number }> = {
  'co-1': { name: 'Tata Consultancy Services', emails: 4 },
  'co-2': { name: 'Reliance Industries Limited', emails: 2 },
  'co-3': { name: 'Larsen and Toubro', emails: 1 },
  'co-4': { name: 'Gujarat State Fertilizers and Chemicals Limited (Vadodara Corporate Office, Marketing Division)', emails: 2 },
  'co-5': { name: 'Zydus Lifesciences', emails: 0 },
};

interface StoredTarget {
  companyId: string;
  readAt: string | null;
  emailStatus: NotificationEmailStatus;
}
interface Stored {
  id: string;
  hotelId: string;
  title: string;
  body: string;
  priority: 'normal' | 'important';
  audienceKind: NotificationAudienceKind;
  expiresAt: string | null;
  withdrawnAt: string | null;
  alsoEmail: boolean;
  linkView: Notification['linkView'];
  linkId: string | null;
  createdAt: string;
  createdBy: string;
  targets: StoredTarget[];
}

const iso = (date: string, time = '10:30'): string => new Date(`${date}T${time}:00+05:30`).toISOString();

/** The demo notices. The first four are the hotel's own (h-1); the rest come from the other two hotels, for the company portal's "all hotels" view. */
function seed(): Stored[] {
  const t = (...rows: [string, string | null, NotificationEmailStatus?][]): StoredTarget[] => rows.map(([companyId, readAt, emailStatus]) => ({ companyId, readAt, emailStatus: emailStatus ?? 'none' }));
  const all = Object.keys(COMPANY_NAMES);
  return [
    { id: 'nt-1', hotelId: 'h-1', title: 'Rooms closed for renovation, 20 to 24 November', body: 'The third floor (rooms 301 to 312) is closed for renovation from 20 to 24 November.\nBookings for those dates are moved to the second floor at the same rate.', priority: 'important', audienceKind: 'all', expiresAt: '2026-11-24', withdrawnAt: null, alsoEmail: true, linkView: null, linkId: null, createdAt: iso('2026-11-04', '16:10'), createdBy: 'Priya Shah', targets: all.map((id, i) => ({ companyId: id, readAt: i === 1 || i === 2 ? iso('2026-11-04', '18:20') : null, emailStatus: (COMPANY_NAMES[id]?.emails ?? 0) > 0 ? 'queued' : 'skipped' })) },
    { id: 'nt-2', hotelId: 'h-1', title: 'Your October statement is ready', body: 'The statement for October is ready under Accounts > Statement. Please pay the open bills by 15 November.', priority: 'normal', audienceKind: 'selected', expiresAt: null, withdrawnAt: null, alsoEmail: false, linkView: 'corporate.ledger', linkId: null, createdAt: iso('2026-11-02', '11:00'), createdBy: 'Rahul Mehta', targets: t(['co-1', null], ['co-2', iso('2026-11-02', '15:45')], ['co-4', iso('2026-11-03', '09:05')]) },
    { id: 'nt-3', hotelId: 'h-1', title: 'New GST number for invoices', body: 'From 1 December our invoices carry a new GST number. The old one stays valid for bills dated before that.', priority: 'normal', audienceKind: 'one', expiresAt: null, withdrawnAt: null, alsoEmail: false, linkView: null, linkId: null, createdAt: iso('2026-10-28', '12:30'), createdBy: 'Priya Shah', targets: t(['co-1', iso('2026-10-28', '17:10')]) },
    { id: 'nt-4', hotelId: 'h-1', title: 'Diwali dinner offer (withdrawn: wrong date)', body: 'Dinner buffet for your guests at 20% off on Diwali night.', priority: 'normal', audienceKind: 'all', expiresAt: null, withdrawnAt: iso('2026-10-30', '10:00'), alsoEmail: false, linkView: null, linkId: null, createdAt: iso('2026-10-30', '09:40'), createdBy: 'Rahul Mehta', targets: all.map((id) => ({ companyId: id, readAt: null, emailStatus: 'none' as const })) },
    { id: 'nt-5', hotelId: 'h-1', title: 'Airport pick-up for the conference', body: 'Our airport cab desk is open 5 am to midnight during the conference week.', priority: 'normal', audienceKind: 'all', expiresAt: '2026-11-01', withdrawnAt: null, alsoEmail: false, linkView: null, linkId: null, createdAt: iso('2026-10-20', '10:00'), createdBy: 'Priya Shah', targets: all.map((id) => ({ companyId: id, readAt: iso('2026-10-21', '10:00'), emailStatus: 'none' as const })) },
    { id: 'nt-6', hotelId: 'h-2', title: 'Surat: pool closed on Sunday', body: 'The pool at Sunrise Residency is closed for cleaning on Sunday 8 November.', priority: 'normal', audienceKind: 'all', expiresAt: '2026-11-09', withdrawnAt: null, alsoEmail: false, linkView: null, linkId: null, createdAt: iso('2026-11-03', '09:00'), createdBy: 'Hotel desk', targets: all.map((id) => ({ companyId: id, readAt: null, emailStatus: 'none' as const })) },
    { id: 'nt-7', hotelId: 'h-3', title: 'Udaipur: new corporate rate card', body: 'The 2026-27 rate card for Lakeview Inn is ready. Ask the desk for a copy or open your profile for the prices set for you.', priority: 'important', audienceKind: 'all', expiresAt: null, withdrawnAt: null, alsoEmail: false, linkView: 'corporate.profile', linkId: null, createdAt: iso('2026-11-01', '14:00'), createdBy: 'Hotel desk', targets: all.map((id) => ({ companyId: id, readAt: iso('2026-11-01', '16:30'), emailStatus: 'none' as const })) },
  ];
}

export interface NotificationsStore {
  notifications: Stored[];
  seq: number;
  /** Epoch ms of each send, for the per-hour limit. */
  sends: number[];
}
export function createNotificationsStore(): NotificationsStore {
  return { notifications: mockEmptyHotel() ? [] : seed(), seq: 100, sends: [] };
}

const statusOf = (n: Pick<Stored, 'withdrawnAt' | 'expiresAt'>, today: string): NotificationStatus => (n.withdrawnAt ? 'withdrawn' : n.expiresAt !== null && n.expiresAt < today ? 'expired' : 'active');
const words = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

/** The hotel side: Companies > Notices. */
export function createNotificationsMock(clock: MockClock = {}, store: NotificationsStore = createNotificationsStore()) {
  const today = MOCK_TODAY;
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const mine = () => store.notifications.filter((n) => n.hotelId === HOTEL.hotelId);
  const nameOf = (id: string): string => COMPANY_NAMES[id]?.name ?? id;

  const label = (n: Stored): string => (n.audienceKind === 'all' ? `All companies (${n.targets.length})` : n.audienceKind === 'one' ? nameOf(n.targets[0]?.companyId ?? '') : `${n.targets.length} ${n.targets.length === 1 ? 'company' : 'companies'}`);
  const row = (n: Stored): Notification => ({
    id: n.id, title: n.title, body: n.body, priority: n.priority, audienceKind: n.audienceKind, audienceLabel: label(n), targetCount: n.targets.length, deliveredCount: n.targets.length,
    readCount: n.targets.filter((x) => x.readAt !== null).length, expiresAt: n.expiresAt, withdrawnAt: n.withdrawnAt, alsoEmail: n.alsoEmail, linkView: n.linkView, linkId: n.linkId,
    createdAt: n.createdAt, createdBy: n.createdBy, status: statusOf(n, today),
  });
  const detail = (n: Stored): NotificationDetail => ({
    ...row(n),
    targets: n.targets.map((t) => ({ companyId: t.companyId, companyName: nameOf(t.companyId), readAt: t.readAt, emailStatus: n.alsoEmail ? t.emailStatus : null })).sort((a, b) => a.companyName.localeCompare(b.companyName)),
    emailQueued: n.targets.filter((t) => t.emailStatus === 'queued').length,
    emailSkipped: n.targets.filter((t) => t.emailStatus === 'skipped').length,
  });

  return {
    /** The history, newest first; `search` in the title or text; `status` active, withdrawn or expired. */
    list(q: NotificationListQuery = {}): Promise<DashResult<NotificationPage>> {
      return call(() => {
        const w = words(q.search ?? '');
        const rows = mine()
          .filter((n) => (!q.status || statusOf(n, today) === q.status) && w.every((x) => `${n.title} ${n.body}`.toLowerCase().includes(x)))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const pageSize = q.pageSize ?? 25;
        const page = Math.max(1, q.page ?? 1);
        return ok({ items: rows.slice((page - 1) * pageSize, page * pageSize).map(row), total: rows.length, page, pageSize });
      });
    },
    /** One notification with the companies it went to and when each read it. */
    get(id: string): Promise<DashResult<NotificationDetail>> {
      return call(() => {
        const n = mine().find((x) => x.id === id);
        return n ? ok(detail(n)) : mockError('NOT_FOUND');
      });
    },
    /** Sends one. 422 `fields` title, body, companyIds, expiresAt, linkView, linkId, alsoEmail; the 21st send in an hour is 429 RATE_LIMITED. */
    send(input: NotificationInput): Promise<DashResult<NotificationDetail>> {
      return call(() => {
        const fields: Record<string, string> = {};
        const title = input.title.trim();
        const body = input.body.replace(/\r\n?/g, '\n').trim();
        if (!title) fields.title = 'The title field is required.';
        else if (Array.from(title).length > NOTIFICATION_TITLE_MAX) fields.title = `The title field must not be greater than ${NOTIFICATION_TITLE_MAX} characters.`;
        if (!body) fields.body = 'The message field is required.';
        else if (Array.from(body).length > NOTIFICATION_BODY_MAX) fields.body = `The message field must not be greater than ${NOTIFICATION_BODY_MAX} characters.`;
        if (HTML_TAG.test(title) || HTML_TAG.test(body)) fields[HTML_TAG.test(body) ? 'body' : 'title'] = 'Plain text only: please remove the HTML tags.';
        const expiresAt = input.expiresAt ?? null;
        if (expiresAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) fields.expiresAt = 'The expiry date must be a valid date.';
        else if (expiresAt !== null && expiresAt < today) fields.expiresAt = 'The expiry date cannot be in the past.';
        const ids = input.companyIds === 'all' ? Object.keys(COMPANY_NAMES) : [...new Set(input.companyIds)];
        if (ids.length === 0) fields.companyIds = 'Choose at least one company.';
        else if (ids.some((id) => !COMPANY_NAMES[id])) fields.companyIds = 'One of the companies you chose is no longer available.';
        const linkView = input.linkView ?? null;
        const linkId = input.linkId ?? null;
        if (linkView === null && linkId !== null) fields.linkView = 'Choose the page the link opens.';
        if (linkView === 'corporate.bill' && linkId === null) fields.linkId = 'Choose the bill the link opens.';
        if (linkView === 'corporate.bill' && linkId !== null && ids.length !== 1) fields.linkId = 'The link must be a bill of the one company you are sending to.';
        const emails = ids.reduce((t, id) => t + (COMPANY_NAMES[id]?.emails ?? 0), 0);
        if (input.alsoEmail && emails > NOTIFICATION_EMAIL_CAP) fields.alsoEmail = `This would send ${emails} emails; the limit is ${NOTIFICATION_EMAIL_CAP} at a time. Untick "Also send by email" or choose fewer companies.`;
        if (Object.keys(fields).length > 0) return mockError('VALIDATION_FAILED', fields);

        const hourAgo = Date.now() - 3_600_000;
        store.sends = store.sends.filter((t) => t > hourAgo);
        if (store.sends.length >= NOTIFICATION_SENDS_PER_HOUR) return mockError('RATE_LIMITED', undefined, { message: 'You have sent 20 notices in the last hour, which is the limit. Please try again a little later.' });
        store.sends.push(Date.now());

        const n: Stored = {
          id: `nt-${++store.seq}`, hotelId: HOTEL.hotelId, title, body, priority: input.priority ?? 'normal',
          audienceKind: input.companyIds === 'all' ? 'all' : ids.length === 1 ? 'one' : 'selected', expiresAt, withdrawnAt: null, alsoEmail: input.alsoEmail === true, linkView, linkId,
          createdAt: new Date().toISOString(), createdBy: 'You',
          targets: ids.map((companyId) => ({ companyId, readAt: null, emailStatus: input.alsoEmail ? ((COMPANY_NAMES[companyId]?.emails ?? 0) > 0 ? 'queued' : 'skipped') : 'none' })),
        };
        store.notifications.push(n);
        return ok(detail(n));
      });
    },
    /** Hides it from the companies; the history keeps it. Withdrawing twice changes nothing. */
    withdraw(id: string): Promise<DashResult<NotificationDetail>> {
      return call(() => {
        const n = mine().find((x) => x.id === id);
        if (!n) return mockError('NOT_FOUND');
        n.withdrawnAt ??= new Date().toISOString();
        return ok(detail(n));
      });
    },
  };
}

/** The company portal side: the demo company (co-1) reads its notices from the hotels the sidebar's choice names. */
export function createPortalNotificationsMock(clock: MockClock = {}, store: NotificationsStore = createNotificationsStore()) {
  const today = MOCK_TODAY;
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const hotelName = (id: string): string => PORTAL_HOTELS.find((h) => h.hotelId === id)?.name ?? id;
  const inScope = (n: Stored): boolean => portalHotelStore.get() === PORTAL_ALL_HOTELS || portalHotelStore.get() === n.hotelId;
  /** The live notices of this company in the chosen hotels, with its own read mark. */
  const visible = () =>
    store.notifications
      .filter((n) => inScope(n) && !mockUnreachableHotels().has(n.hotelId) && statusOf(n, today) === 'active')
      .map((n) => ({ n, t: n.targets.find((x) => x.companyId === PORTAL_COMPANY) }))
      .filter((x): x is { n: Stored; t: StoredTarget } => x.t !== undefined);
  const item = (n: Stored, t: StoredTarget): PortalNotification => ({ id: n.id, hotelId: n.hotelId, hotelName: hotelName(n.hotelId), title: n.title, body: n.body, priority: n.priority, createdAt: n.createdAt, readAt: t.readAt, linkView: n.linkView, linkId: n.linkId });

  return {
    /** Newest first; withdrawn and expired are hidden; `unread` the ones not read yet. `unread` in the answer is the badge. */
    list(q: PortalNotificationQuery = {}): Promise<DashResult<PortalNotificationPage>> {
      return call(() => {
        const sw = words(q.search ?? '');
        const rows = visible().filter((x) => (!q.unread || x.t.readAt === null) && (!q.read || x.t.readAt !== null) && sw.every((w) => `${x.n.title} ${x.n.body}`.toLowerCase().includes(w))).sort((a, b) => (a.n.createdAt < b.n.createdAt ? 1 : -1));
        const paged = mockListPage(rows.map((x) => item(x.n, x.t)), { page: q.page, pageSize: q.pageSize ?? 25, cursor: q.cursor, limit: q.limit }, `notifications|${portalHotelStore.get()}|${q.unread ? 'unread' : q.read ? 'read' : ''}|${q.search ?? ''}`, (r) => ({ d: r.createdAt, h: r.hotelId, i: r.id }));
        if (!paged.ok) return paged.error;
        return ok({ ...paged.page, unread: visible().filter((x) => x.t.readAt === null).length, unavailable: mockUnavailable(PORTAL_HOTELS, (id) => portalHotelStore.get() === PORTAL_ALL_HOTELS || portalHotelStore.get() === id) });
      });
    },
    /** The sidebar badge. */
    unreadCount(): Promise<DashResult<{ count: number }>> {
      return call(() => ok({ count: visible().filter((x) => x.t.readAt === null).length }));
    },
    /** Marks one read (the first read time stays). 404 for one that is not this company's live notice. */
    markRead(id: string): Promise<DashResult<{ id: string; read: true }>> {
      return call(() => {
        const hit = visible().find((x) => x.n.id === id);
        if (!hit) return mockError('NOT_FOUND');
        hit.t.readAt ??= new Date().toISOString();
        return ok({ id, read: true as const });
      });
    },
    /** Marks every unread one read. */
    markAllRead(): Promise<DashResult<{ marked: number }>> {
      return call(() => {
        const unread = visible().filter((x) => x.t.readAt === null);
        const at = new Date().toISOString();
        for (const x of unread) x.t.readAt = at;
        return ok({ marked: unread.length });
      });
    },
  };
}
