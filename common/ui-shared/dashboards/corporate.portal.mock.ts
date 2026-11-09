// The Company portal redesign's part of the corporate mock (decision 48; dev and local-demo builds only, loaded with corporate.mock.ts): three demo hotels, the
// calm dashboard, the Accounts pages (Due bills, Payment history, Ledger) and the company's own profile, all following the sidebar's hotel choice
// (portalHotelStore), the way the real server follows `?hotel=`. Nothing here is a real company.
import type { MockClock } from './common';
import { mockCall, mockError, ok, pageOf } from './common';
import {
  MOCK_TODAY,
  PAY_WITHIN_DAYS,
  daysBetween,
  addDays,
  type AccountsQuery,
  type CompanyBill,
  type CorpDashboard,
  type DueBillRow,
  type DueBillsPage,
  type LedgerAccountPage,
  type LedgerRow,
  type PaymentHistoryPage,
  type PaymentRow,
  type PortalProfile,
  type PortalProfileInput,
} from './corporate';
import { PORTAL_ALL_HOTELS, portalHotelStore } from './portalHotel';
import { mockListPage, mockUnavailable, mockUnreachableHotels } from './portalCursor.mock';

const HOTELS = [
  { hotelId: 'h-1', name: 'Hotel Sunrise, Rajkot' },
  { hotelId: 'h-2', name: 'Sunrise Residency, Surat' },
  { hotelId: 'h-3', name: 'Lakeview Inn, Udaipur' },
];
const nameOf = (id: string): string => HOTELS.find((h) => h.hotelId === id)?.name ?? id;
const rs = (rupees: number): number => Math.round(rupees * 100);

interface SeedBill {
  id: string;
  hotelId: string;
  number: string;
  daysAgo: number;
  guest: string;
  room: string;
  hotelRs: number;
  foodRs: number;
  advanceRs: number;
  adults: number;
  children: number;
  /** How the advance (advanceRs) was paid. */
  advance?: { daysAgo: number; mode: string; receipt: string };
  /** Paid in full later (not open any more): the rest of the bill after its advance. */
  paid?: { daysAgo: number; mode: string; ref: string | null; receipt: string };
}

const BILLS: SeedBill[] = [
  { id: 'cb-1', hotelId: 'h-1', number: 'HS-2041', daysAgo: 52, guest: 'Mr. Rakesh Mehta', room: '204', hotelRs: 18400, foodRs: 2600, advanceRs: 5000, adults: 2, children: 1, advance: { daysAgo: 53, mode: 'Bank transfer', receipt: 'ADV-0204' } },
  { id: 'cb-2', hotelId: 'h-1', number: 'HS-2078', daysAgo: 21, guest: 'Ms. Kavita Shah', room: '311', hotelRs: 12600, foodRs: 1800, advanceRs: 0, adults: 1, children: 0 },
  { id: 'cb-3', hotelId: 'h-2', number: 'SR-0412', daysAgo: 38, guest: 'Mr. Anil Desai', room: '102', hotelRs: 9800, foodRs: 1200, advanceRs: 0, adults: 2, children: 0 },
  { id: 'cb-4', hotelId: 'h-2', number: 'SR-0455', daysAgo: 9, guest: 'Ms. Pooja Iyer', room: '208', hotelRs: 15200, foodRs: 3100, advanceRs: 4000, adults: 2, children: 2, advance: { daysAgo: 10, mode: 'UPI', receipt: 'ADV-0071' } },
  { id: 'cb-5', hotelId: 'h-3', number: 'LI-0127', daysAgo: 14, guest: 'Mr. Sunil Parmar', room: '12', hotelRs: 21500, foodRs: 4200, advanceRs: 10000, adults: 3, children: 0, advance: { daysAgo: 15, mode: 'Bank transfer', receipt: 'ADV-0019' } },
  { id: 'cb-6', hotelId: 'h-1', number: 'HS-1990', daysAgo: 75, guest: 'Mr. Dev Joshi', room: '118', hotelRs: 8800, foodRs: 900, advanceRs: 0, adults: 1, children: 0, paid: { daysAgo: 4, mode: 'Bank transfer', ref: 'UTR 2026110100451', receipt: 'RCPT-0311' } },
  { id: 'cb-7', hotelId: 'h-3', number: 'LI-0101', daysAgo: 60, guest: 'Ms. Nisha Rao', room: '7', hotelRs: 17400, foodRs: 2500, advanceRs: 0, adults: 2, children: 0, paid: { daysAgo: 12, mode: 'Cheque', ref: 'Cheque 004512', receipt: 'RCPT-0088' } },
  { id: 'cb-8', hotelId: 'h-1', number: 'HS-2102', daysAgo: 3, guest: 'Ms. Rina Kapadia', room: '305', hotelRs: 9600, foodRs: 1400, advanceRs: 2000, adults: 2, children: 1, advance: { daysAgo: 4, mode: 'UPI', receipt: 'ADV-0213' } },
];

interface SeedPay {
  id: string;
  hotelId: string;
  daysAgo: number;
  rs: number;
  mode: string;
  ref: string | null;
  kind: 'payment' | 'advance';
  bill: string | null;
  guest: string | null;
  receipt: string | null;
}

// Every payment comes from the bills above, so Due bills, the dashboard and the Statement always agree.
const PAYS: SeedPay[] = BILLS.flatMap((b): SeedPay[] => [
  ...(b.advance && b.advanceRs > 0 ? [{ id: `cp-a-${b.id}`, hotelId: b.hotelId, daysAgo: b.advance.daysAgo, rs: b.advanceRs, mode: b.advance.mode, ref: null, kind: 'advance' as const, bill: b.number, guest: b.guest, receipt: b.advance.receipt }] : []),
  ...(b.paid ? [{ id: `cp-p-${b.id}`, hotelId: b.hotelId, daysAgo: b.paid.daysAgo, rs: b.hotelRs + b.foodRs - b.advanceRs, mode: b.paid.mode, ref: b.paid.ref, kind: 'payment' as const, bill: b.number, guest: b.guest, receipt: b.paid.receipt }] : []),
]);

const dateOf = (daysAgo: number): string => addDays(MOCK_TODAY, -daysAgo);
const chosen = (): string => portalHotelStore.get();
const inScope = (hotelId: string): boolean => chosen() === PORTAL_ALL_HOTELS || chosen() === hotelId;
/** In scope AND answering (a hotel set unreachable with setMockUnreachableHotels / ?mockDown= is left out, as the server does). */
const reachable = (hotelId: string): boolean => inScope(hotelId) && !mockUnreachableHotels().has(hotelId);
const unavailableNow = () => mockUnavailable(HOTELS, inScope);
/** Every hotel asked for is unreachable: the server's 503. */
const allDown = (): boolean => HOTELS.some((h) => inScope(h.hotelId)) && HOTELS.filter((h) => inScope(h.hotelId)).every((h) => mockUnreachableHotels().has(h.hotelId));
const NONE_REACHED = 'None of your hotels could be reached right now. Please try again in a moment.';

function dueRows(): DueBillRow[] {
  return BILLS.filter((b) => !b.paid && reachable(b.hotelId))
    .map((b): DueBillRow => {
      const total = rs(b.hotelRs + b.foodRs);
      const due = total - rs(b.advanceRs);
      const age = daysBetween(dateOf(b.daysAgo), MOCK_TODAY);
      return {
        id: b.id,
        hotelId: b.hotelId,
        hotelName: nameOf(b.hotelId),
        billNumber: b.number,
        billDate: dateOf(b.daysAgo),
        guestName: b.guest,
        duePaise: due,
        ageDays: age,
        status: age > PAY_WITHIN_DAYS ? 'overdue' : 'due',
        detail: {
          persons: { adults: b.adults, children: b.children, names: [b.guest] },
          guestMobile: '98250 00000',
          roomNumber: b.room,
          plan: 'CP (with breakfast)',
          checkIn: dateOf(b.daysAgo + 2),
          nights: 2,
          hotelAmountPaise: rs(b.hotelRs),
          foodAmountPaise: rs(b.foodRs),
          advancePaise: rs(b.advanceRs),
          balanceHotelPaise: Math.max(0, rs(b.hotelRs) - rs(b.advanceRs)),
          balanceFoodPaise: rs(b.foodRs),
          reference: null,
          note: null,
        },
      };
    })
    .sort((a, b) => a.ageDays - b.ageDays || a.billNumber.localeCompare(b.billNumber)); // latest bill first (decision 52)
}

function payRows(): PaymentRow[] {
  return PAYS.filter((p) => reachable(p.hotelId))
    .map((p): PaymentRow => ({
      id: p.id,
      hotelId: p.hotelId,
      hotelName: nameOf(p.hotelId),
      date: dateOf(p.daysAgo),
      amountPaise: rs(p.rs),
      mode: p.mode,
      reference: p.ref,
      kind: p.kind,
      detail: { billNumber: p.bill, guestName: p.guest, receipt: p.receipt, note: null },
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** One bill of the demo company in full (the screen that opens from "Open bill" in Due bills). Not the old mock's bills: these are the ones the lists show. */
export function portalBill(id: string): CompanyBill | null {
  const b = BILLS.find((x) => x.id === id || x.number === id);
  if (!b) return null;
  const hotel = rs(b.hotelRs);
  const food = rs(b.foodRs);
  const advance = rs(b.advanceRs);
  return {
    id: b.id,
    billNumber: b.number,
    billDate: dateOf(b.daysAgo),
    guestName: b.guest,
    persons: { adults: b.adults, children: b.children, names: [b.guest] },
    guestMobile: '98250 00000',
    roomNumber: b.room,
    roomType: 'Deluxe Room',
    plan: 'CP (with breakfast)',
    checkIn: dateOf(b.daysAgo + 2),
    nights: 2,
    roomTariffPaise: hotel,
    discountPaise: 0,
    laundryPaise: 0,
    hotelGstPaise: 0,
    totalHotelPaise: hotel,
    foodPaise: food,
    foodGstPaise: 0,
    totalFoodPaise: food,
    hotelMode: 'On account',
    foodMode: 'On account',
    advanceHotelPaise: advance,
    advanceFoodPaise: 0,
    advanceReceipt: advance ? (b.advance?.receipt ?? null) : null,
    advanceIsCompanys: advance > 0,
    settlements: [],
    balanceHotelPaise: b.paid ? 0 : Math.max(0, hotel - advance),
    balanceFoodPaise: b.paid ? 0 : food,
    reference: null,
    note: null,
  };
}

/** Each hotel's lines get that hotel's own running balance (oldest first); the list then shows the latest line first across all hotels (decision 52). */
function ledgerRows(): LedgerRow[] {
  const out: LedgerRow[] = [];
  for (const h of HOTELS) {
    if (!reachable(h.hotelId)) continue;
    const lines: Omit<LedgerRow, 'balancePaise'>[] = [];
    for (const b of BILLS.filter((x) => x.hotelId === h.hotelId)) {
      lines.push({
        id: `l-${b.id}`, hotelId: h.hotelId, hotelName: h.name, date: dateOf(b.daysAgo), what: `Bill ${b.number}`, debitPaise: rs(b.hotelRs + b.foodRs), creditPaise: 0,
        detail: { kind: 'bill', ref: b.number, guest: b.guest, room: b.room, mode: null, note: null, billId: b.id },
      });
    }
    for (const p of PAYS.filter((x) => x.hotelId === h.hotelId)) {
      lines.push({
        id: `l-${p.id}`, hotelId: h.hotelId, hotelName: h.name, date: dateOf(p.daysAgo), what: p.kind === 'advance' ? `Advance ${p.receipt ?? ''}`.trim() : `Payment ${p.receipt ?? ''}`.trim(), debitPaise: 0, creditPaise: rs(p.rs),
        detail: { kind: p.kind === 'advance' ? 'advance' : 'settlement', ref: p.receipt, guest: p.guest, room: null, mode: p.mode, note: p.ref, billId: null },
      });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let balance = 0;
    for (const l of lines) {
      balance += l.debitPaise - l.creditPaise;
      out.push({ ...l, balancePaise: balance });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

const profiles = new Map<string, PortalProfile>(
  HOTELS.map((h, i): [string, PortalProfile] => [
    h.hotelId,
    {
      hotelId: h.hotelId,
      hotelName: h.name,
      id: `co-${h.hotelId}`,
      // the same company as corporate.mock.ts seedProfile and companies.mock.ts co-1
      name: 'Tata Consultancy Services',
      mainContactName: 'Deepa Iyer',
      email: 'traveldesk.gnr@tcs.com',
      mobile: '9824012399',
      landline: '079 6678 1234',
      address: 'Garima Park, IT-SEZ, Gandhinagar–Sarkhej Highway',
      pincode: '382421',
      country: 'India',
      gstin: '24AAACT2727Q1ZV',
      contacts: [{ name: 'Ms. Reena Shah', role: 'Accounts', email: 'reena@example.test', mobile: '9825000022' }],
      pricing: { discountPct: 10 - i * 2, gstPct: 12, tcsPct: 0, tdsPct: 2 },
      setByHotel: true,
      // the first hotel shows the ONE common profile (platform 0132), the others their own record, so both looks can be seen
      common: i === 0,
      // who last changed the common profile (review M1(a)): shown with lastChangeLine (profileReview.ts)
      lastChange: i === 0 ? { at: '2026-10-16T08:35:00Z', hotelName: h.name, by: 'Deepa Iyer', via: 'desk', fields: ['email'] } : null,
      photoUrl: null,
    },
  ]),
);

function qs(q: AccountsQuery): { page: number | undefined; pageSize: number; cursor?: string; limit?: number } {
  return { page: q.page, pageSize: q.pageSize ?? 10, cursor: q.cursor, limit: q.limit };
}

/** The new methods of CorporateApi, spread into the mock (corporate.mock.ts). */
export function corporatePortalMock(clock: MockClock) {
  return {
    listHotels: () => mockCall(() => ok(HOTELS.map((h) => ({ ...h }))), clock),

    getDashboard: () =>
      mockCall(() => {
        if (allDown()) return mockError('NETWORK_OFFLINE', undefined, { message: NONE_REACHED });
        const due = dueRows();
        const pays = payRows();
        const totalDue = due.reduce((s, b) => s + b.duePaise, 0);
        const month = MOCK_TODAY.slice(0, 7);
        const bucket = (lo: number, hi: number) => due.filter((b) => b.ageDays >= lo && b.ageDays <= hi).reduce((s, b) => s + b.duePaise, 0);
        const overdue = due.filter((b) => b.status === 'overdue');
        const dash: CorpDashboard = {
          ageing: { upTo30Paise: bucket(0, 30), upTo60Paise: bucket(31, 60), upTo90Paise: bucket(61, 90), over90Paise: bucket(91, 100_000), overdueCount: overdue.length, overduePaise: overdue.reduce((s, b) => s + b.duePaise, 0) },
          cards: {
            totalDuePaise: totalDue,
            creditPaise: 0,
            billsThisMonth: BILLS.filter((b) => inScope(b.hotelId) && dateOf(b.daysAgo).startsWith(month)).length,
            lastPayment: pays[0] ? { date: pays[0].date, amountPaise: pays[0].amountPaise, mode: pays[0].mode, hotelName: pays[0].hotelName } : null,
          },
          attention: [...due].sort((a, b) => b.ageDays - a.ageDays).slice(0, 5).map((b) => ({ billId: b.id, hotelId: b.hotelId, hotelName: b.hotelName, billNumber: b.billNumber, billDate: b.billDate, guestName: b.guestName, duePaise: b.duePaise, ageDays: b.ageDays, status: b.status })),
          recentPayments: pays.slice(0, 5).map((p) => ({ id: p.id, hotelId: p.hotelId, hotelName: p.hotelName, date: p.date, amountPaise: p.amountPaise, mode: p.mode, reference: p.reference, kind: p.kind })),
          byHotel: HOTELS.filter((h) => reachable(h.hotelId)).map((h) => ({ hotelId: h.hotelId, hotelName: h.name, totalDuePaise: due.filter((b) => b.hotelId === h.hotelId).reduce((s, b) => s + b.duePaise, 0) })),
          unavailable: unavailableNow(),
          // the demo company's unread notices (notifications.mock.ts seeds three over the three hotels)
          unreadNotifications: 3,
        };
        return ok(dash);
      }, clock),

    listDueBills: (q: AccountsQuery) =>
      mockCall(() => {
        if (allDown()) return mockError('NETWORK_OFFLINE', undefined, { message: NONE_REACHED });
        const all = dueRows();
        const s = (q.search ?? '').trim().toLowerCase();
        const found = s ? all.filter((b) => `${b.billNumber} ${b.guestName} ${b.hotelName}`.toLowerCase().includes(s)) : all;
        const paged = mockListPage(found, qs(q), `due-bills|${chosen()}|${s}`, (b) => ({ d: b.billDate, h: b.hotelId, i: b.id }));
        if (!paged.ok) return paged.error;
        const out: DueBillsPage = {
          ...paged.page,
          unavailable: unavailableNow(),
          summary: {
            totalDuePaise: all.reduce((s, b) => s + b.duePaise, 0),
            openBills: all.length,
            byHotel: HOTELS.filter((h) => reachable(h.hotelId)).map((h) => ({ hotelId: h.hotelId, hotelName: h.name, totalDuePaise: all.filter((b) => b.hotelId === h.hotelId).reduce((s, b) => s + b.duePaise, 0) })),
          },
        };
        return ok(out);
      }, clock),

    listPaymentHistory: (q: AccountsQuery) =>
      mockCall(() => {
        if (allDown()) return mockError('NETWORK_OFFLINE', undefined, { message: NONE_REACHED });
        const all = payRows();
        const s = (q.search ?? '').trim().toLowerCase();
        const found = s ? all.filter((p) => `${p.reference ?? ''} ${p.mode ?? ''} ${p.hotelName} ${p.detail.billNumber ?? ''} ${p.detail.guestName ?? ''}`.toLowerCase().includes(s)) : all;
        const paged = mockListPage(found, qs(q), `payment-history|${chosen()}|${s}`, (p) => ({ d: p.date, h: p.hotelId, i: p.id }));
        if (!paged.ok) return paged.error;
        const out: PaymentHistoryPage = {
          ...paged.page,
          unavailable: unavailableNow(),
          summary: {
            receivedPaise: all.reduce((s, p) => s + p.amountPaise, 0),
            byHotel: HOTELS.filter((h) => reachable(h.hotelId)).map((h) => ({ hotelId: h.hotelId, hotelName: h.name, receivedPaise: all.filter((p) => p.hotelId === h.hotelId).reduce((s, p) => s + p.amountPaise, 0) })),
          },
        };
        return ok(out);
      }, clock),

    getLedgerAccount: (q: AccountsQuery) =>
      mockCall(() => {
        if (allDown()) return mockError('NETWORK_OFFLINE', undefined, { message: NONE_REACHED });
        const all = ledgerRows();
        const s = (q.search ?? '').trim().toLowerCase();
        const found = s ? all.filter((l) => `${l.what} ${l.hotelName} ${l.detail.guest ?? ''} ${l.detail.ref ?? ''}`.toLowerCase().includes(s)) : all;
        const paged = mockListPage(found, qs(q), `ledger|${chosen()}|${s}|${q.period ?? 'all'}`, (l) => ({ d: l.date, h: l.hotelId, i: l.id }));
        if (!paged.ok) return paged.error;
        const page = { ...paged.page, unavailable: unavailableNow() };
        const billed = all.reduce((s, l) => s + l.debitPaise, 0);
        const received = all.reduce((s, l) => s + l.creditPaise, 0);
        const out: LedgerAccountPage = {
          ...page,
          totals: { billedPaise: billed, receivedPaise: received, refundedPaise: 0, balancePaise: billed - received },
          byHotel: HOTELS.filter((h) => reachable(h.hotelId)).map((h) => {
            const mine = all.filter((l) => l.hotelId === h.hotelId);
            return { hotelId: h.hotelId, hotelName: h.name, openingPaise: 0, closingPaise: mine.length ? mine[0].balancePaise : 0 };
          }),
          capped: false,
        };
        return ok(out);
      }, clock),

    getPortalProfile: (hotelId?: string) =>
      mockCall(() => {
        const p = profiles.get(hotelId ?? HOTELS[0].hotelId);
        return p ? ok({ ...p, contacts: p.contacts.map((c) => ({ ...c })), pricing: { ...p.pricing } }) : mockError('FORBIDDEN', undefined, { message: 'You are not linked to that hotel.' });
      }, clock),

    savePortalProfile: (hotelId: string, input: PortalProfileInput) =>
      mockCall(() => {
        const p = profiles.get(hotelId);
        if (!p) return mockError('FORBIDDEN', undefined, { message: 'You are not linked to that hotel.' });
        const f: Record<string, string> = {};
        if (input.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) f.email = 'Enter a valid email address.';
        if (input.mobile !== undefined && !/^\d{10}$/.test(input.mobile.replace(/\D/g, '').slice(-10))) f.mobile = 'Enter a 10 digit mobile number.';
        if (input.pincode !== undefined && input.pincode.trim() && !/^\d{6}$/.test(input.pincode.trim())) f.pincode = 'Enter a 6 digit pincode.';
        if (input.gstin !== undefined && input.gstin.trim() && !/^[0-9A-Z]{15}$/.test(input.gstin.trim().toUpperCase())) f.gstin = 'A GST number has 15 letters and digits.';
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const next: PortalProfile = {
          ...p,
          mainContactName: input.mainContactName ?? p.mainContactName,
          email: input.email?.trim() ?? p.email,
          mobile: input.mobile ?? p.mobile,
          landline: input.landline ?? p.landline,
          address: input.address ?? p.address,
          pincode: input.pincode ?? p.pincode,
          country: input.country ?? p.country,
          gstin: input.gstin ? input.gstin.trim().toUpperCase() : p.gstin,
          contacts: input.contacts ? input.contacts.map((c) => ({ ...c })) : p.contacts,
        };
        profiles.set(hotelId, next);
        return ok({ ...next });
      }, clock),
  };
}
