'use client';

// The search mock for the dev preview: it asks the group mocks that already hold the rows (bills, advances, reservations, guests in house,
// rooms and room types, companies, customers, payroll staff, and user accounts for the roles that see User Accounts). Enquiries are on the
// real server only. The real client calls GET /api/v1/search?q= and shows the same shape (the server has no room, room type or user kinds yet).
import { formatINR } from '@shared/dashboards/format';
import { billTotal } from '@shared/dashboards/billing';
import { ok } from '@shared/dashboards/common';
import { searchCopy, searchKinds, type SearchApi, type SearchHit, type SearchResult, type SearchSource } from '@shared/dashboards/search';
import { get as apiGet } from '@/lib/api/client';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

// The group APIs load only when a search runs: the shell does not carry them, and a group mock that fails to load costs only its own hits.
const billingApi = () => import('../groups/billing/api').then((m) => m.billingApi);
const companiesApi = () => import('../groups/companies/api').then((m) => m.api);
const foApi = () => import('../groups/frontOffice/api').then((m) => m.foApi);

/** How close a record number is to what was typed: the whole number, then its last part alone ("101" for "2026 / 101"), then anywhere. */
function numberRank(no: string, q: string): number {
  const a = no.trim().toLowerCase();
  const b = q.trim().toLowerCase();
  if (a === b) return 0;
  if (a.split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop() === b) return 1;
  if (a.includes(b)) return 2;
  return 3;
}

/** Puts the records whose number fits best first (stable for the rest), then keeps `n`. */
function byNumber<T>(rows: T[], no: (r: T) => string, q: string, n: number): T[] {
  return rows
    .map((r, i) => ({ r, i, k: numberRank(no(r), q) }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .slice(0, n)
    .map((x) => x.r);
}

const bills: SearchSource = async (q, n) => {
  const res = await (await billingApi()).listBills({ search: q, page: 1, pageSize: 50 });
  if (!res.ok) return [];
  return byNumber(res.data.page.items, (b) => b.billNo, q, n).map((b): SearchHit => ({
    kind: 'bill', id: b.id, title: `Bill ${b.billNo}`, subtitle: `${b.guestName} · ${b.companyName ?? 'Walk-in'} · ${formatINR(billTotal(b))}`, find: b.billNo,
    ...(b.companyId ? { companyId: b.companyId } : {}),
  }));
};
const advances: SearchSource = async (q, n) => {
  const res = await (await billingApi()).listAdvances({ search: q, page: 1, pageSize: 50 });
  if (!res.ok) return [];
  return byNumber(res.data.page.items, (a) => a.receiptNo, q, n).map((a): SearchHit => ({
    kind: 'advance', id: a.id, title: `Advance ${a.receiptNo}`, subtitle: `${a.guestName} · ${a.companyName ?? 'Walk-in'}`, find: a.receiptNo,
  }));
};
const companies: SearchSource = async (q, n) => {
  const res = await (await companiesApi()).lookupCompanies({ q, limit: n });
  return res.ok ? res.data.map((c): SearchHit => ({ kind: 'company', id: c.id, title: c.label, subtitle: c.hint ?? '', companyId: c.id })) : [];
};
const customers: SearchSource = async (q, n) => {
  const res = await (await companiesApi()).listCustomers({ search: q, page: 1, pageSize: n });
  return res.ok ? res.data.page.items.map((c): SearchHit => ({ kind: 'customer', id: c.id, title: c.name, subtitle: [c.mobile, c.city].filter(Boolean).join(' · '), find: c.name })) : [];
};
const reservations: SearchSource = async (q, n) => {
  const res = await (await foApi()).listReservations({ tab: 'all', search: q, page: 1, pageSize: n });
  return res.ok ? res.data.items.map((r): SearchHit => ({ kind: 'reservation', id: r.id, title: `${r.reference} · ${r.guestName}`, subtitle: `${r.rooms} × ${r.roomTypeName} · ${r.checkIn} to ${r.checkOut}` })) : [];
};
const stays: SearchSource = async (q, n) => {
  const res = await (await foApi()).listStays({ tab: 'inHouse', search: q, page: 1, pageSize: n });
  return res.ok ? res.data.items.map((s): SearchHit => ({ kind: 'stay', id: s.id, title: `Room ${s.roomNumber} · ${s.guestName}`, subtitle: `${s.mobile}${s.companyName ? ` · ${s.companyName}` : ''}` })) : [];
};

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Every word typed starts a word of the text ("del" finds "Deluxe Room"). */
const startsWords = (text: string, q: string) => {
  const hay = words(text);
  const want = words(q);
  return want.length > 0 && want.every((w) => hay.some((h) => h.startsWith(w)));
};

/** Rooms by number (a guest in it opens the stay); "Room 101" works as well as "101". */
const rooms: SearchSource = async (q, n) => {
  const typed = q.trim().replace(/^room\s*/i, '');
  if (!typed) return [];
  const [res, { roomStateLabel }] = await Promise.all([foApi().then((fo) => fo.listRooms({ page: 1, pageSize: 500 })), import('@shared/dashboards/frontOffice')]);
  if (!res.ok) return [];
  const fit = res.data.items.filter((r) => r.number.toLowerCase().startsWith(typed.toLowerCase()));
  return byNumber(fit, (r) => r.number, typed, n).map((r): SearchHit => ({
    kind: 'room',
    id: r.id,
    title: `Room ${r.number}`,
    subtitle: [r.roomTypeName, r.floor ? searchCopy.floor(r.floor) : null, r.currentStay ? r.currentStay.guestName : roomStateLabel[r.state] ?? r.state].filter(Boolean).join(' · '),
    find: r.number,
    ...(r.currentStay ? { open: { viewId: 'hotel.fo.stay', id: r.currentStay.id } } : {}),
  }));
};

/** Room categories by name, with how many rooms each has. */
const roomTypes: SearchSource = async (q, n) => {
  const [opts, list] = await foApi().then((fo) => Promise.all([fo.getOptions(), fo.listRooms({ page: 1, pageSize: 500 })]));
  if (!opts.ok) return [];
  const all = list.ok ? list.data.items : [];
  return opts.data.roomTypes
    .filter((t) => startsWords(t.name, q))
    .slice(0, n)
    .map((t): SearchHit => {
      const count = all.filter((r) => r.roomTypeId === t.id).length;
      const plans = t.plans.map((p) => p.code).join(', ');
      return { kind: 'roomType', id: t.id, title: t.name, subtitle: [searchCopy.rooms(count), plans ? searchCopy.plans(plans) : null].filter(Boolean).join(' · '), find: t.name };
    });
};

/** Payroll staff of every payroll company, by name, code, mobile, designation. */
const staff: SearchSource = async (q, n) => {
  const { payrollApi } = await import('../groups/payrollCore/api');
  const cos = await payrollApi.listCompanies();
  if (!cos.ok) return [];
  const pages = await Promise.all(cos.data.map((c) => payrollApi.listEmployees(c.id, { search: q, page: 1, pageSize: n }).then((r) => ({ c, r }))));
  return pages.flatMap(({ c, r }) => (r.ok ? r.data.items.map((e): SearchHit => ({
    kind: 'staff', id: e.id, title: e.name, subtitle: [e.employeeCode, e.designation, c.name].filter(Boolean).join(' · '), find: e.name, companyId: c.id,
  })) : []));
};

/** User accounts (Administration): only offered to the roles that see User Accounts. */
const users: SearchSource = async (q, n) => {
  const [{ adminApi }, { userStatusLabel }] = await Promise.all([import('../groups/admin/api'), import('@shared/dashboards/admin')]);
  const res = await adminApi.listUsers({ search: q, page: 1, pageSize: n });
  return res.ok ? res.data.page.items.map((u): SearchHit => ({ kind: 'user', id: u.id, title: u.name, subtitle: [`@${u.username}`, u.roleName, userStatusLabel[u.status] ?? u.status].filter(Boolean).join(' · '), find: u.username })) : [];
};

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const real = (): SearchApi => ({ search: (q: string) => apiGet<SearchResult>('/search', { q }) });
const made = new Map<boolean, SearchApi>();

/**
 * The hotel search. Real server: GET /api/v1/search?q= (every kind, each by the person's own permissions). Mock: the group mocks above;
 * `seesUsers` (every role but Hotel User, as the menu shows User Accounts) adds the user accounts.
 */
export function hotelSearchApi(seesUsers: boolean): SearchApi {
  let api = made.get(seesUsers);
  if (!api) {
    const sources = [bills, advances, companies, customers, staff, reservations, stays, rooms, roomTypes, ...(seesUsers ? [users] : [])];
    api = chooseApi(real, () => lazyMock(async () => (await loadMocks()).createSearchApi(sources, { offline })), { guard: false });
    made.set(seesUsers, api);
  }
  return api;
}

/** Guest and Corporate dashboards: only their own screens are searched (the server search is for hotel staff), so no request is made. */
export const screensOnlyApi: SearchApi = {
  search: async (q) => ok<SearchResult>({ query: q.trim(), hits: [], counts: Object.fromEntries(searchKinds.map((k) => [k.kind, 0])) as SearchResult['counts'] }),
};

/**
 * Where a hit opens: the record itself where a page for it exists (reservation, stay, company statement, enquiry; a room with a guest in it
 * opens that stay), else the list that holds it with its number or name carried along as the search.
 */
export function hitTarget(hit: SearchHit): { viewId: string; params: Record<string, string> } {
  if (hit.open) return { viewId: hit.open.viewId, params: { id: hit.open.id } };
  const find = hit.find ?? hit.title;
  switch (hit.kind) {
    case 'bill': return { viewId: 'hotel.billing.bills', params: { search: hit.find ?? hit.title.replace(/^Bill /, '') } };
    case 'advance': return { viewId: 'hotel.billing.advances', params: { search: hit.find ?? hit.title.replace(/^Advance /, '') } };
    case 'company': return { viewId: 'hotel.co.statement', params: { id: hit.companyId ?? hit.id } };
    case 'customer': return { viewId: 'hotel.co.customers', params: { search: find } };
    case 'reservation': return { viewId: 'hotel.fo.reservation', params: { id: hit.id } };
    case 'stay': return { viewId: 'hotel.fo.stay', params: { id: hit.id } };
    case 'room': return { viewId: 'hotel.fo.rooms', params: { search: find } };
    case 'roomType': return { viewId: 'hotel.fo.rooms', params: { search: find } };
    case 'staff': return { viewId: 'hotel.payroll.home', params: { search: find } };
    case 'enquiry': return { viewId: 'hotel.web.enquiry', params: { id: hit.id } };
    case 'user': return { viewId: 'hotel.admin.users', params: { search: find } };
  }
}
