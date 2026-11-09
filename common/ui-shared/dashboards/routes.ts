// The address of every dashboard page (MJ, 17 Oct 2026: "the URL shows which page you are on"; decision 49 now reads "the URL decides").
// The addresses follow the REST API (MJ: "for the URL slug follow the rest api"): a page lives at the path of the API resource it shows, without /api/v1:
// Revenue is /revenue/deposits (GET /api/v1/revenue/deposits), In House is /front-office/stays and one stay /front-office/stays/<id>, a guest's bill is
// /guest/bills/<id>, the Platform's hotels /platform/hotels. Plural collections, the record id after them, "new" and "<id>/edit" for the forms. "/" is the
// role's first page. Nothing else is ever put in an address: no names, no tokens. Platform and group staff visiting a hotel use the hotel paths under
// /inside (no hotel id: the visit is the session's), so a visit is never mistaken for a platform or group page.
// Pure data, used by the server (which page to draw for an address, and 404 for an address no role has) and by the shell (the address to show).
import { drillParent, nav, subNav, type DashboardKind } from './nav';

export const INSIDE_PREFIX = '/inside';
const KINDS: readonly DashboardKind[] = ['guest', 'corporate', 'hotel', 'platform', 'group'];
/**
 * A record id in a path: letters, digits, dash, underscore and dot (uuids, short codes, a guest bill's "<uuid>.hotel"), starting with a letter or digit,
 * so "." and ".." can never be one; nothing else is accepted from an address.
 */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** Query parameters a page may carry besides those in its path. */
// guest.history `statement=1` opens the statement sheet (decision 71: Home's "Get a statement" after a stay).
const QUERY_PARAMS: Readonly<Record<string, readonly string[]>> = { 'guest.bill': ['preview'], 'guest.history': ['statement'], 'platform.conversations': ['tab'], 'platform.central': ['tab'], 'platform.email': ['tab', 'box'], 'platform.whatsapp': ['tab'], 'platform.emailThread': ['box'], 'hotel.email': ['box'], 'hotel.emailThread': ['box'], 'group.email': ['box'], 'group.emailThread': ['box'], 'platform.setup': ['step', 'hotelId'], 'platform.hotel': ['tab', 'service', 'step'], 'platform.vault': ['hotel'] };

/**
 * Every page's address, as the API names the resource. A ":name" segment is a record id taken from the page's params; a page with two forms
 * (a new-record form and the same form for an existing record, or a group shown by its id or by its waiting invitation) has one template per form,
 * the one with the most parameters first.
 */
const PATHS: Readonly<Record<string, readonly string[]>> = {
  // ---- hotel ----
  'hotel.dashboard': ['/dashboard'],
  'hotel.reports': ['/reports'],
  'hotel.books': ['/books'],
  'hotel.billing.advances': ['/billing/advances'],
  'hotel.billing.bills': ['/billing/bills'],
  'hotel.cash.revenue': ['/revenue/deposits'],
  'hotel.cash.expenses': ['/expense/entries'],
  'hotel.cash.handover': ['/handover'],
  'hotel.co.profiles': ['/companies'],
  'hotel.co.statement': ['/companies/:id/statement'],
  'hotel.co.customers': ['/companies/customers'],
  'hotel.co.marketing': ['/companies/marketing'],
  'hotel.co.notifications': ['/companies/notifications'],
  'hotel.co.notification': ['/companies/notifications/:id'],
  'hotel.co.ledger': ['/companies/ledger'],
  'hotel.reports.daily': ['/reports/daily'],
  'hotel.reports.foodPlan': ['/reports/food-plan'],
  'hotel.reports.occupancy': ['/reports/occupancy'],
  'hotel.reports.gst': ['/reports/gst'],
  'hotel.fo.board': ['/front-office/board'],
  'hotel.fo.reservations': ['/front-office/reservations'],
  'hotel.fo.reservation': ['/front-office/reservations/:id'],
  'hotel.fo.reservationForm': ['/front-office/reservations/:id/edit', '/front-office/reservations/new'],
  'hotel.fo.inHouse': ['/front-office/stays'],
  'hotel.fo.stay': ['/front-office/stays/:id'],
  'hotel.fo.requests': ['/front-office/requests'],
  'hotel.fo.roomOrders': ['/front-office/room-service/orders'],
  'hotel.fo.guestMessages': ['/front-office/support'],
  'hotel.fo.checkIn': ['/front-office/check-in'],
  'hotel.fo.rooms': ['/front-office/rooms'],
  'hotel.conversations': ['/conversations'],
  'hotel.conversation': ['/conversations/:id'],
  'hotel.email': ['/email'],
  'hotel.emailThread': ['/email/:id'],
  'hotel.whatsapp': ['/whatsapp'],
  'hotel.whatsappThread': ['/whatsapp/:id'],
  'hotel.myMailbox': ['/my-mailbox'],
  'hotel.myMailboxThread': ['/my-mailbox/:id'],
  'hotel.web.overview': ['/website/overview'],
  'hotel.web.enquiries': ['/website/enquiries'],
  'hotel.web.enquiry': ['/website/enquiries/:id'],
  'hotel.web.rooms': ['/website/rooms'],
  'hotel.web.roomForm': ['/website/rooms/:id/edit', '/website/rooms/new'],
  'hotel.web.rates': ['/website/rates'],
  'hotel.web.calendar': ['/website/calendar'],
  'hotel.web.gallery': ['/website/photos'],
  'hotel.web.content': ['/website/content'],
  'hotel.web.services': ['/website/services'],
  'hotel.web.policies': ['/website/policies'],
  'hotel.web.nearby': ['/website/nearby'],
  'hotel.web.settings': ['/website/settings'],
  'hotel.admin.masters': ['/admin/masters'],
  'hotel.admin.users': ['/admin/users'],
  'hotel.admin.roles': ['/admin/roles'],
  'hotel.admin.settings': ['/admin/settings'],
  'hotel.admin.payments': ['/admin/razorpay'],
  'hotel.admin.guestPortal': ['/admin/guest-portal'],
  'hotel.admin.companyPortal': ['/admin/company-portal'],
  'hotel.admin.system': ['/system/health'],
  'hotel.admin.log': ['/system/log'],
  'hotel.admin.forceLog': ['/system/force-log'],
  'hotel.admin.profile': ['/profile'],
  'hotel.payroll.home': ['/payroll'],
  'hotel.payroll.companies': ['/payroll/companies'],
  'hotel.payroll.dashboard': ['/payroll/dashboard'],
  'hotel.payroll.staff': ['/payroll/employees'],
  'hotel.payroll.attendance': ['/payroll/attendance'],
  'hotel.payroll.resignations': ['/payroll/separations'],
  'hotel.payroll.staffEmails': ['/payroll/staff-emails'],
  'hotel.payroll.salaryUpdate': ['/payroll/salary-profiles'],
  'hotel.payroll.advances': ['/payroll/advances'],
  'hotel.payroll.bonus': ['/payroll/bonuses'],
  'hotel.payroll.meals': ['/payroll/meals'],
  'hotel.payroll.salaryPayments': ['/payroll/payments'],
  'hotel.payroll.salarySlips': ['/payroll/slips'],
  'hotel.payroll.reports': ['/payroll/reports/monthly'],
  'hotel.payroll.periodReport': ['/payroll/reports/period'],
  'hotel.payroll.joiningLetter': ['/payroll/letters/joining'],
  'hotel.payroll.experienceLetter': ['/payroll/letters/experience'],
  'hotel.payroll.attendanceStatuses': ['/payroll/attendance-statuses'],
  'hotel.payroll.deductions': ['/payroll/deductions'],
  'hotel.payroll.mealPrice': ['/payroll/meals/prices'],
  'hotel.payroll.master': ['/payroll/master'],
  'hotel.payroll.log': ['/payroll/log'],
  // ---- guest portal ----
  'guest.home': ['/guest/overview'],
  'guest.bills': ['/guest/bills'],
  'guest.bill': ['/guest/bills/:id'],
  'guest.history': ['/guest/history'],
  'guest.order': ['/guest/orders'],
  'guest.profile': ['/guest/profile'],
  'guest.support': ['/guest/support'],
  // ---- company portal ----
  'corporate.dashboard': ['/corporate/dashboard'],
  'corporate.notifications': ['/corporate/notifications'],
  'corporate.bills': ['/corporate/due-bills'],
  'corporate.bill': ['/corporate/bills/:id'],
  'corporate.payments': ['/corporate/payment-history'],
  'corporate.ledger': ['/corporate/ledger'],
  'corporate.support': ['/corporate/support'],
  'corporate.profile': ['/corporate/profile'],
  'corporate.myProfile': ['/profile'],
  // ---- platform console ----
  'platform.overview': ['/platform/overview'],
  'platform.hotels': ['/platform/hotels'],
  'platform.hotel': ['/platform/hotels/:id'],
  'platform.invitations': ['/platform/invitations'],
  'platform.groups': ['/platform/groups'],
  'platform.group': ['/platform/groups/:id', '/platform/invitations/:invite'],
  'platform.admins': ['/platform/hotel-admins'],
  'platform.users': ['/platform/users'],
  'platform.audit': ['/platform/audit'],
  'platform.central': ['/platform/central'],
  'platform.duplicates': ['/platform/duplicates'],
  'platform.signins': ['/platform/sign-ins'],
  'platform.demoRequests': ['/platform/demo-requests'],
  'platform.vault': ['/platform/vault'],
  'platform.staff': ['/platform/staff'],
  'platform.health': ['/platform/health'],
  'platform.setup': ['/platform/setup'],
  'platform.settings': ['/platform/settings'],
  'platform.archived': ['/platform/archived-hotels'],
  'platform.announcements': ['/platform/announcements'],
  'platform.hotelMail': ['/platform/hotel-mail'],
  'platform.conversations': ['/platform/conversations'],
  'platform.conversation': ['/platform/conversations/:id'],
  'platform.email': ['/platform/email'],
  'platform.emailThread': ['/platform/email/:id'],
  'platform.myMailbox': ['/platform/my-mailbox'],
  'platform.myMailboxThread': ['/platform/my-mailbox/:id'],
  'platform.whatsapp': ['/platform/whatsapp'],
  'platform.whatsappThread': ['/platform/whatsapp/:id'],
  'platform.profile': ['/profile'],
  // ---- group console ----
  'group.overview': ['/group/overview'],
  'group.hotels': ['/group/hotels'],
  'group.hotels.invite': ['/group/invitations/new'],
  'group.hotel': ['/group/hotels/:id'],
  'group.payments': ['/group/payments'],
  'group.invitations': ['/group/invitations'],
  'group.admins': ['/group/hotel-admins'],
  'group.email': ['/group/email'],
  'group.emailThread': ['/group/email/:id'],
  'group.myMailbox': ['/group/my-mailbox'],
  'group.myMailboxThread': ['/group/my-mailbox/:id'],
  'group.profile': ['/profile'],
};

export interface Route {
  viewId: string;
  params: Record<string, string>;
}

interface Template {
  viewId: string;
  segments: string[];
  /** The ":name" segments, in order. */
  keys: string[];
}

function viewIdsOf(kind: DashboardKind): string[] {
  const ids = new Set<string>();
  for (const section of nav[kind]) for (const item of section.items) ids.add(item.id);
  if (kind === 'hotel') {
    for (const [key, sections] of Object.entries(subNav)) {
      if (key.startsWith('hotel.')) ids.add(key);
      for (const section of sections) for (const item of section.items) ids.add(item.id);
    }
  }
  for (const id of Object.keys(drillParent)) if (id.startsWith(`${kind}.`)) ids.add(id);
  return [...ids].filter((id) => id.startsWith(`${kind}.`));
}

const templateCache = new Map<DashboardKind, Template[]>();
/** The templates of a kind: static paths first (so "/front-office/reservations/new" wins over ".../:id"), then by length. */
function templates(kind: DashboardKind): Template[] {
  let list = templateCache.get(kind);
  if (!list) {
    list = [];
    for (const viewId of viewIdsOf(kind)) {
      for (const path of PATHS[viewId] ?? []) {
        const segments = path.split('/').filter(Boolean);
        list.push({ viewId, segments, keys: segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1)) });
      }
    }
    list.sort((a, b) => a.keys.length - b.keys.length || b.segments.length - a.segments.length);
    templateCache.set(kind, list);
  }
  return list;
}

/** Every view id that has an address for a kind (for tests). */
export function routeViewIds(kind: DashboardKind): string[] {
  return [...new Set(templates(kind).map((t) => t.viewId))];
}

/** Every view id of a kind, with or without an address (for tests: none may be missing). */
export function allViewIds(kind: DashboardKind): string[] {
  return viewIdsOf(kind);
}

/**
 * The address of a page. `home` is the role's first page: it is shown as "/". `inside` = a platform or group visit to a hotel (kind is then 'hotel').
 * A page whose address needs a record id it was not given, or an unknown page, gives null (the shell then leaves the address as it is).
 */
export function pathForRoute(kind: DashboardKind, route: Route, opts: { home?: string; inside?: boolean } = {}): string | null {
  const prefix = opts.inside ? INSIDE_PREFIX : '';
  const forms = templates(kind).filter((t) => t.viewId === route.viewId);
  if (forms.length === 0) return null;
  // the form that uses the most of the given parameters (an edit form when there is an id, the new-record form when not)
  const usable = forms.filter((t) => t.keys.every((k) => route.params[k] !== undefined && ID_SHAPE.test(route.params[k])));
  usable.sort((a, b) => b.keys.length - a.keys.length);
  const t = usable[0];
  if (!t) return null;
  if (route.viewId === opts.home && t.keys.length === 0) return prefix || '/';
  const path = `/${t.segments.map((s) => (s.startsWith(':') ? route.params[s.slice(1)] : s)).join('/')}`;
  const extra = (QUERY_PARAMS[route.viewId] ?? []).filter((k) => route.params[k] !== undefined && ID_SHAPE.test(route.params[k]));
  const query = extra.length ? `?${extra.map((k) => `${k}=${encodeURIComponent(route.params[k])}`).join('&')}` : '';
  return `${prefix}${path}${query}`;
}

/**
 * The page an address names for this kind, or null (not a page of this kind). "/" (or "/inside" for a visit) is the home page: `home` when given.
 * Only paths from the table and ids of the allowed shape are accepted, so an address can never name anything else.
 */
export function routeForPath(kind: DashboardKind, pathname: string, search = '', opts: { home?: string; inside?: boolean } = {}): Route | null {
  let path = pathname.replace(/\/+$/, '') || '/';
  if (opts.inside) {
    if (path !== INSIDE_PREFIX && !path.startsWith(`${INSIDE_PREFIX}/`)) return null;
    path = path.slice(INSIDE_PREFIX.length) || '/';
  } else if (path === INSIDE_PREFIX || path.startsWith(`${INSIDE_PREFIX}/`)) {
    return null;
  }
  if (path === '/') return opts.home ? { viewId: opts.home, params: {} } : null;
  const parts = path.split('/').filter(Boolean);
  for (const t of templates(kind)) {
    if (t.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length && ok; i++) {
      const seg = t.segments[i];
      if (seg.startsWith(':')) {
        if (ID_SHAPE.test(parts[i])) params[seg.slice(1)] = parts[i];
        else ok = false;
      } else if (seg !== parts[i]) ok = false;
    }
    if (ok) return { viewId: t.viewId, params: { ...params, ...queryParams(t.viewId, search) } };
  }
  return null;
}

/** The declared query parameters of a page (QUERY_PARAMS), of the allowed shape; anything else in the query is ignored. */
function queryParams(viewId: string, search: string): Record<string, string> {
  const params: Record<string, string> = {};
  const query = new URLSearchParams(search);
  for (const k of QUERY_PARAMS[viewId] ?? []) {
    const v = query.get(k);
    if (v !== null && ID_SHAPE.test(v)) params[k] = v;
  }
  return params;
}

/**
 * The Company and Guest portals' hotel choice in the address (decision 48): `?hotel=<hotel id>` on every portal page, so a link keeps the hotel. No parameter
 * means "All hotels". It is not a page parameter (the page is the same for every hotel): the shell adds it to the page's address and the store reads it back.
 */
export const PORTAL_HOTEL_PARAM = 'hotel';
const ALL_HOTELS = 'all';
const isHotelId = (v: string): boolean => v !== ALL_HOTELS && ID_SHAPE.test(v);

export const isPortalKind = (kind: DashboardKind): boolean => kind === 'guest' || kind === 'corporate';

/** The hotel an address names: a hotel id, null when there is none. "all" and a value of the wrong shape count as none. */
export function portalHotelFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get(PORTAL_HOTEL_PARAM);
  return v !== null && isHotelId(v) ? v : null;
}

/** True when the address carries a `hotel` value that is neither an id nor "all" (the proxy then drops it). */
export function badPortalHotel(search: string): boolean {
  const v = new URLSearchParams(search).get(PORTAL_HOTEL_PARAM);
  return v !== null && v !== ALL_HOTELS && !ID_SHAPE.test(v);
}

/** A page's address with the hotel choice added (a hotel id) or left out ("all", or anything else). */
export function withPortalHotel(address: string, hotel: string | null | undefined): string {
  if (!hotel || !isHotelId(hotel)) return address;
  return `${address}${address.includes('?') ? '&' : '?'}${PORTAL_HOTEL_PARAM}=${encodeURIComponent(hotel)}`;
}

/** True when some role has a page at this address ("/" and "/inside" included). Used to answer 404 before any session work. */
export function isAppPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === INSIDE_PREFIX) return true;
  if (path.startsWith(`${INSIDE_PREFIX}/`)) return routeForPath('hotel', path, '', { inside: true }) !== null;
  return KINDS.some((k) => routeForPath(k, path) !== null);
}
