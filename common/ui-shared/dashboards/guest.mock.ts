// The in-memory mock of guest.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import { MOCK_MENU_PHOTOS } from './roomMenu.mock';
import type { MockClock, DashResult, Kpi } from './common';
import { mockCall, ok, pageOf, mockError } from './common';
import { hotelParam } from './portalHotel';
import { mockListPage, mockUnavailable, mockUnreachableHotels } from './portalCursor.mock';
import { GUEST_TODAY, MAX_ITEM_QTY, billState, billTotals, cartSummary, daysBetween, guestBusinesses, guestCopy, guestHotel, nightsLeft, validatePasswordChange, type BillPersons, type BillTab, type BusinessKey, type CurrentStay, type GuestAccount, type GuestApi, type GuestBill, type GuestKeep, type GuestProfile, type GuestSnapshot, type HistoryCategory, type HistoryItem, type HistoryStatus, type HistoryTab, type MenuGroup, type MenuItem, type PaymentReceipt, type ScheduledOrder, type UpcomingStay, } from './guest';
import type { GuestStage } from './guestStage';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const P = (rupees: number) => Math.round(rupees * 100);

function seedProfile(): GuestProfile {
  return {
    id: 'g-1001',
    name: 'Amit Joshi',
    username: 'guest',
    mobile: '+91 98765 43210',
    email: 'amit.joshi@example.com',
    city: 'Ahmedabad',
    address: '12, Shanti Kunj Society, Satellite Road, Ahmedabad 380015',
    idProofType: 'aadhaar',
    idProofNumber: 'XXXX XXXX 4321',
    notifyEmail: true,
    lastSignInAt: '2026-11-05T03:42:00Z',
    memberSince: '2026-01-20',
    // Jan, Mar, Jun, Jul and Sep 2026, and the stay going on now
    staysCount: 6,
    // the ONE common profile (platform 0132) with a profile photo; a new demo account (blankProfile) shows the hotel's own record, so both looks can be seen
    common: true,
    // who last changed the common profile (review M1(a)): shown with lastChangeLine (profileReview.ts)
    lastChange: { at: '2026-11-04T10:05:00Z', hotelName: 'Hotel Grand Palace', by: 'Priya Desai', via: 'desk', fields: ['address'] },
    photoUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='48' fill='%2338383d'/><text x='48' y='60' font-family='Arial' font-size='36' fill='white' text-anchor='middle'>AJ</text></svg>",
  };
}

function seedStay(): CurrentStay {
  return {
    bookingNo: 'BK-26-0874',
    roomNumber: '204',
    roomType: 'Deluxe Room',
    checkIn: '2026-11-03',
    checkOut: '2026-11-06',
    nights: 3,
    nightsDone: daysBetween('2026-11-03', GUEST_TODAY),
    adults: 2,
    children: 0,
  };
}

/** Decision 48: the demo guest stays at two hotels. The July stay (HS-0301, SF-0799) was at the second one, everything else at the first. */
// Decision 71 (D4): each hotel also carries its public website slug (the hotel card's check-in times and address come from it).
const MOCK_HOTELS = [
  { hotelId: 'h-1', name: 'Hotel Sunrise, Rajkot', phone: '9876500001', slug: 'hotel-sunrise-rajkot' },
  { hotelId: 'h-2', name: 'Sunrise Residency, Surat', phone: '9876500002', slug: 'sunrise-residency-surat' },
];
const SECOND_HOTEL_BILLS = new Set(['HS-0301', 'SF-0799']);
const hotelOfBill = (number: string | null) => (number !== null && SECOND_HOTEL_BILLS.has(number) ? MOCK_HOTELS[1] : MOCK_HOTELS[0]);
/** The food side's own company (each business bills on its own). */
const FOOD_SELLER = 'Sunrise Foods';

/** Decision 71 (D1): the demo guest's next booking, shown in the "arriving" scenario (its advance is history row h26). */
const UPCOMING: UpcomingStay = {
  reference: 'BK-26-1061', hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot', checkIn: '2026-11-08', checkOut: '2026-11-10', nights: 2,
  roomType: 'Deluxe Room', adults: 2, children: 0, advancePaise: P(4500),
};
/** The demo stay's first day: in the "arriving" and "no stay" scenarios nothing from this day on has happened yet. */
const STAY_START_ISO = '2026-11-03T00:00:00Z';
/** Decision 52: who each bill is for (the stay's members where known). */
const BILL_PERSONS: Record<string, BillPersons> = {
  'HS-0412': { adults: 2, children: 0, names: ['Amit Joshi', 'Neha Joshi'] },
  'SF-0988': { adults: 2, children: 0, names: ['Amit Joshi', 'Neha Joshi'] },
  'SF-0870': { adults: 3, children: 0, names: ['Amit Joshi', 'Rahul Mehta', 'Kiran Mehta'] },
  'HS-0377': { adults: 2, children: 0, names: ['Amit Joshi', 'Rahul Mehta'] },
  'SF-0799': { adults: 10, children: 2, names: [] },
  'HS-0301': { adults: 2, children: 1, names: ['Amit Joshi', 'Neha Joshi', 'Aarav Joshi'] },
};
/**
 * The hotel a list reads: the page's own chips (`q.hotel`, decision 71: a hotel id, or "all" whatever the sidebar says), else the sidebar's choice
 * (portalHotel.ts), like the server's `?hotel=`. undefined = every hotel.
 */
const chosenHotel = (q?: { hotel?: string }): string | undefined => (q?.hotel === undefined ? hotelParam() : q.hotel === 'all' ? undefined : q.hotel);
const inChosenHotel = (hotelId: string | undefined, chosen: string | undefined = hotelParam()) => !chosen || hotelId === chosen;
/** In the chosen hotels AND answering (setMockUnreachableHotels / ?mockDown= leaves a hotel out, as the server does). */
const reachableHotel = (hotelId: string | undefined, chosen: string | undefined = hotelParam()) => inChosenHotel(hotelId, chosen) && !(hotelId !== undefined && mockUnreachableHotels().has(hotelId));

/** The mock's issuer of a bill: the business's own details (the hotel side prints as the hotel, the food side as Sunrise Foods), plus its hotel and persons. */
function withSeller(b: GuestBill): GuestBill {
  const biz = guestBusinesses[b.business];
  const hotel = hotelOfBill(b.number);
  return {
    ...b,
    // no address in the demo (the businesses' placeholder "Hotel address, city" is not printed on a guest's bill)
    seller: b.seller ?? { name: b.business === 'hotel' ? hotel.name : FOOD_SELLER, address: null, phone: hotel.phone ?? guestHotel.reception, gstin: biz.gstin },
    hotelId: b.hotelId ?? hotel.hotelId,
    hotelName: b.hotelName ?? hotel.name,
    persons: b.persons ?? BILL_PERSONS[b.number] ?? { adults: 1, children: 0, names: [b.billedTo] },
  };
}

function seedBills(): GuestBill[] {
  const rows: Omit<GuestBill, 'billedTo'>[] = [
    {
      id: 'b-hs-0412', number: 'HS-0412', business: 'hotel', issuedOn: '2026-11-03', dueOn: null,
      roomNumber: '204', stayFrom: '2026-11-03', stayTo: '2026-11-06', current: true, status: 'open',
      lines: [
        { id: 'l1', label: 'Room 204, Deluxe Room', detail: '3 nights × ₹4,500.00', date: '2026-11-03', kind: 'room', amountPaise: P(13500) },
        { id: 'l2', label: 'Laundry', detail: '6 items', date: '2026-11-04', kind: 'laundry', amountPaise: P(450) },
      ],
      payments: [{ id: 'p1', at: '2026-10-28T06:00:00Z', method: 'advance', reference: 'UPI 427781903312', amountPaise: P(5000) }],
    },
    {
      id: 'b-sf-0988', number: 'SF-0988', business: 'food', issuedOn: '2026-11-03', dueOn: null,
      roomNumber: '204', stayFrom: '2026-11-03', stayTo: '2026-11-06', current: true, status: 'open',
      lines: [
        { id: 'l1', label: 'Restaurant: Dinner', detail: '2 covers', date: '2026-11-03', kind: 'food', amountPaise: P(1200) },
        { id: 'l2', label: 'Restaurant: Lunch', detail: '2 covers', date: '2026-11-04', kind: 'food', amountPaise: P(1180) },
        { id: 'l3', label: 'Room service: Dinner', detail: 'Paneer Butter Masala, Butter Naan × 4', date: '2026-11-05', kind: 'service', amountPaise: P(640) },
      ],
      payments: [],
    },
    {
      id: 'b-sf-0870', number: 'SF-0870', business: 'food', issuedOn: '2026-09-13', dueOn: '2026-09-21',
      roomNumber: '112', stayFrom: '2026-09-12', stayTo: '2026-09-14', current: false, status: 'open',
      lines: [
        { id: 'l1', label: 'Restaurant: Dinner', detail: '3 covers', date: '2026-09-12', kind: 'food', amountPaise: P(1860) },
        { id: 'l2', label: 'Room service: Breakfast tray', detail: null, date: '2026-09-13', kind: 'service', amountPaise: P(420) },
      ],
      payments: [{ id: 'p1', at: '2026-09-14T05:10:00Z', method: 'upi', reference: 'UPI 318820045519', amountPaise: P(1500) }],
    },
    {
      id: 'b-hs-0377', number: 'HS-0377', business: 'hotel', issuedOn: '2026-09-12', dueOn: null,
      roomNumber: '112', stayFrom: '2026-09-12', stayTo: '2026-09-14', current: false, status: 'paid',
      lines: [
        { id: 'l1', label: 'Room 112, Standard Room', detail: '2 nights × ₹4,000.00', date: '2026-09-12', kind: 'room', amountPaise: P(8000) },
        { id: 'l2', label: 'Airport pickup', detail: 'Rajkot airport', date: '2026-09-12', kind: 'other', amountPaise: P(250) },
      ],
      payments: [{ id: 'p1', at: '2026-09-14T05:00:00Z', method: 'card', reference: 'Visa ending 4417', amountPaise: P(9240) }],
    },
    {
      id: 'b-sf-0799', number: 'SF-0799', business: 'food', issuedOn: '2026-07-20', dueOn: null,
      roomNumber: '301', stayFrom: '2026-07-18', stayTo: '2026-07-21', current: false, status: 'paid',
      lines: [
        {
          id: 'l1', label: 'Banquet: birthday dinner for 12 guests in Hall B, with live chaat counter and dessert table',
          detail: '12 covers × ₹1,500.00', date: '2026-07-20', kind: 'food', amountPaise: P(18000),
        },
      ],
      payments: [{ id: 'p1', at: '2026-07-21T04:00:00Z', method: 'netbanking', reference: 'HDFC NB 99120374', amountPaise: P(18900) }],
    },
    {
      id: 'b-hs-0301', number: 'HS-0301', business: 'hotel', issuedOn: '2026-07-18', dueOn: null,
      roomNumber: '301', stayFrom: '2026-07-18', stayTo: '2026-07-21', current: false, status: 'paid',
      lines: [
        { id: 'l1', label: 'Room 301, Family Suite', detail: '3 nights × ₹7,200.00', date: '2026-07-18', kind: 'room', amountPaise: P(21600) },
        { id: 'l2', label: 'Extra bed', detail: '3 nights × ₹600.00', date: '2026-07-18', kind: 'other', amountPaise: P(1800) },
      ],
      payments: [
        { id: 'p1', at: '2026-07-10T09:30:00Z', method: 'advance', reference: 'UPI 290011847720', amountPaise: P(7200) },
        { id: 'p2', at: '2026-07-21T04:15:00Z', method: 'cash', reference: 'Receipt R-2231', amountPaise: P(19008) },
      ],
    },
    {
      id: 'b-sf-0750', number: 'SF-0750', business: 'food', issuedOn: '2026-06-02', dueOn: null,
      roomNumber: '108', stayFrom: '2026-06-02', stayTo: '2026-06-03', current: false, status: 'paid',
      lines: [{ id: 'l1', label: 'Welcome drinks (complimentary)', detail: '2 glasses', date: '2026-06-02', kind: 'food', amountPaise: 0 }],
      payments: [],
    },
    {
      id: 'b-hs-0288', number: 'HS-0288', business: 'hotel', issuedOn: '2026-05-11', dueOn: null,
      roomNumber: '—', stayFrom: '2026-05-18', stayTo: '2026-05-20', current: false, status: 'cancelled',
      lines: [{ id: 'l1', label: 'Booking cancelled by guest, advance refunded', detail: 'Booking BK-26-0410', date: '2026-05-11', kind: 'other', amountPaise: 0 }],
      payments: [],
    },
    {
      id: 'b-sf-0612', number: 'SF-0612', business: 'food', issuedOn: '2026-03-09', dueOn: null,
      roomNumber: '206', stayFrom: '2026-03-07', stayTo: '2026-03-09', current: false, status: 'paid',
      lines: [
        { id: 'l1', label: 'Restaurant: Dinner', detail: '2 covers', date: '2026-03-07', kind: 'food', amountPaise: P(1450) },
        { id: 'l2', label: 'Room service: Tea / Coffee', detail: '3 × ₹80.00', date: '2026-03-08', kind: 'service', amountPaise: P(240) },
      ],
      payments: [{ id: 'p1', at: '2026-03-09T05:20:00Z', method: 'upi', reference: 'UPI 240901553872', amountPaise: P(1774.5) }],
    },
    {
      id: 'b-hs-0215', number: 'HS-0215', business: 'hotel', issuedOn: '2026-03-07', dueOn: null,
      roomNumber: '206', stayFrom: '2026-03-07', stayTo: '2026-03-09', current: false, status: 'paid',
      lines: [
        { id: 'l1', label: 'Room 206, Deluxe Room', detail: '2 nights × ₹4,200.00', date: '2026-03-07', kind: 'room', amountPaise: P(8400) },
        { id: 'l2', label: 'Laundry', detail: '4 items', date: '2026-03-08', kind: 'laundry', amountPaise: P(220) },
      ],
      payments: [{ id: 'p1', at: '2026-03-09T05:15:00Z', method: 'card', reference: 'Visa ending 4417', amountPaise: P(9654.4) }],
    },
    {
      id: 'b-sf-0402', number: 'SF-0402', business: 'food', issuedOn: '2026-01-21', dueOn: null,
      roomNumber: '105', stayFrom: '2026-01-20', stayTo: '2026-01-21', current: false, status: 'paid',
      lines: [{ id: 'l1', label: 'Restaurant: Gujarati Thali', detail: '3 × ₹320.00', date: '2026-01-20', kind: 'food', amountPaise: P(960) }],
      payments: [{ id: 'p1', at: '2026-01-21T04:40:00Z', method: 'cash', reference: 'Receipt R-1874', amountPaise: P(1008) }],
    },
    {
      id: 'b-hs-0118', number: 'HS-0118', business: 'hotel', issuedOn: '2026-01-20', dueOn: null,
      roomNumber: '105', stayFrom: '2026-01-20', stayTo: '2026-01-21', current: false, status: 'paid',
      lines: [{ id: 'l1', label: 'Room 105, Standard Room', detail: '1 night × ₹3,800.00', date: '2026-01-20', kind: 'room', amountPaise: P(3800) }],
      payments: [{ id: 'p1', at: '2026-01-21T04:35:00Z', method: 'upi', reference: 'UPI 335120098451', amountPaise: P(4256) }],
    },
    // June 2026 stay (booking BK-26-0466): the hotel side of SF-0750. 1 night × ₹3,600 + GST 12% = ₹4,032.
    {
      id: 'b-hs-0295', number: 'HS-0295', business: 'hotel', issuedOn: '2026-06-02', dueOn: null,
      roomNumber: '108', stayFrom: '2026-06-02', stayTo: '2026-06-03', current: false, status: 'paid',
      lines: [{ id: 'l1', label: 'Room 108, Standard Room', detail: '1 night × ₹3,600.00', date: '2026-06-02', kind: 'room', amountPaise: P(3600) }],
      payments: [{ id: 'p1', at: '2026-06-03T04:30:00Z', method: 'cash', reference: 'Receipt R-2087', amountPaise: P(4032) }],
    },
  ];
  return rows.map((b) => ({ ...b, billedTo: 'Amit Joshi' }));
}

function seedHistory(): HistoryItem[] {
  const h = (
    id: string, at: string, kind: HistoryItem['kind'], category: HistoryCategory, title: string,
    business: BusinessKey, rupees: number, status: HistoryStatus, billNumber: string | null,
  ): HistoryItem => ({ id, at, kind, category, title, business, amountPaise: P(rupees), status, billNumber, hotelId: hotelOfBill(billNumber).hotelId, hotelName: hotelOfBill(billNumber).name });
  return [
    h('h01', '2026-11-05T14:10:00Z', 'charge', 'service', 'Room service: Dinner', 'food', 640, 'on_bill', 'SF-0988'),
    h('h02', '2026-11-05T03:30:00Z', 'charge', 'room', 'Room 204, night of 05 Nov', 'hotel', 4500, 'on_bill', 'HS-0412'),
    h('h03', '2026-11-04T16:30:00Z', 'charge', 'service', 'Room service: Breakfast tray', 'food', 220, 'cancelled', null),
    h('h04', '2026-11-04T07:20:00Z', 'charge', 'food', 'Restaurant: Lunch', 'food', 1180, 'on_bill', 'SF-0988'),
    h('h05', '2026-11-04T05:00:00Z', 'charge', 'laundry', 'Laundry: 6 items', 'hotel', 450, 'on_bill', 'HS-0412'),
    h('h06', '2026-11-04T03:30:00Z', 'charge', 'room', 'Room 204, night of 04 Nov', 'hotel', 4500, 'on_bill', 'HS-0412'),
    h('h07', '2026-11-03T15:00:00Z', 'charge', 'food', 'Restaurant: Dinner', 'food', 1200, 'on_bill', 'SF-0988'),
    h('h08', '2026-11-03T08:30:00Z', 'charge', 'room', 'Checked in, Room 204, night of 03 Nov', 'hotel', 4500, 'on_bill', 'HS-0412'),
    h('h09', '2026-10-28T06:00:00Z', 'payment', 'payment', 'Advance received (UPI)', 'hotel', 5000, 'paid', 'HS-0412'),
    h('h10', '2026-09-14T05:10:00Z', 'payment', 'payment', 'Part payment (UPI)', 'food', 1500, 'paid', 'SF-0870'),
    h('h11', '2026-09-14T05:00:00Z', 'payment', 'payment', 'Paid by card', 'hotel', 9240, 'paid', 'HS-0377'),
    h('h12', '2026-09-13T14:00:00Z', 'charge', 'food', 'Restaurant and room service', 'food', 2394, 'on_bill', 'SF-0870'),
    h('h13', '2026-09-12T09:00:00Z', 'charge', 'room', 'Stay HS-0377, 2 nights', 'hotel', 9240, 'paid', 'HS-0377'),
    h('h14', '2026-07-21T04:15:00Z', 'payment', 'payment', 'Paid in cash at check-out', 'hotel', 19008, 'paid', 'HS-0301'),
    h('h15', '2026-07-21T04:00:00Z', 'payment', 'payment', 'Paid by net banking', 'food', 18900, 'paid', 'SF-0799'),
    h('h16', '2026-07-20T15:00:00Z', 'charge', 'food', 'Banquet: birthday dinner for 12 guests', 'food', 18900, 'paid', 'SF-0799'),
    h('h17', '2026-07-18T08:00:00Z', 'charge', 'room', 'Stay HS-0301, 3 nights', 'hotel', 26208, 'paid', 'HS-0301'),
    h('h18', '2026-05-11T10:20:00Z', 'charge', 'booking', 'Booking BK-26-0410 cancelled', 'hotel', 0, 'cancelled', 'HS-0288'),
    h('h19', '2026-03-09T05:20:00Z', 'payment', 'payment', 'Paid by UPI at check-out', 'food', 1774.5, 'paid', 'SF-0612'),
    h('h20', '2026-03-09T05:15:00Z', 'payment', 'payment', 'Paid by card', 'hotel', 9654.4, 'paid', 'HS-0215'),
    h('h21', '2026-03-07T15:30:00Z', 'charge', 'food', 'Restaurant: Dinner', 'food', 1522.5, 'paid', 'SF-0612'),
    h('h22', '2026-03-07T08:00:00Z', 'charge', 'room', 'Stay HS-0215, 2 nights', 'hotel', 9408, 'paid', 'HS-0215'),
    h('h23', '2026-01-21T04:40:00Z', 'payment', 'payment', 'Paid in cash at check-out', 'food', 1008, 'paid', 'SF-0402'),
    h('h24', '2026-01-21T04:35:00Z', 'payment', 'payment', 'Paid by UPI', 'hotel', 4256, 'paid', 'HS-0118'),
    h('h25', '2026-01-20T09:10:00Z', 'charge', 'room', 'Checked in, Room 105, 1 night', 'hotel', 4256, 'paid', 'HS-0118'),
    // advances for the upcoming bookings, and the June stay (HS-0295, SF-0750)
    h('h26', '2026-11-01T07:40:00Z', 'payment', 'booking', 'Advance for booking BK-26-1061', 'hotel', 4500, 'paid', null),
    h('h27', '2026-10-30T12:20:00Z', 'payment', 'booking', 'Advance for booking BK-26-1038', 'hotel', 3200, 'paid', null),
    h('h28', '2026-06-03T04:30:00Z', 'payment', 'payment', 'Paid in cash at check-out', 'hotel', 4032, 'paid', 'HS-0295'),
    h('h29', '2026-06-02T14:30:00Z', 'charge', 'food', 'Welcome drinks (complimentary)', 'food', 0, 'paid', 'SF-0750'),
    h('h30', '2026-06-02T08:40:00Z', 'charge', 'room', 'Checked in, Room 108, 1 night', 'hotel', 4032, 'paid', 'HS-0295'),
  ];
}

function seedMenu(): MenuGroup[] {
  const i = (id: string, name: string, rupees: number, note: string | null = null, available = true, extra: Partial<Pick<MenuItem, 'category' | 'veg' | 'photoUrl'>> = {}): MenuItem =>
    ({ id, name, pricePaise: P(rupees), note, available, category: null, veg: 'unknown', photoUrl: null, ...extra });
  return [
    {
      id: 'restaurant', label: 'Restaurant', icon: 'utensils', business: 'food', kind: 'food', hint: 'Served 7 am to 11 pm.',
      items: [
        i('m-pti', 'Paneer Tikka', 260, 'Six pieces', true, { category: 'Starters', veg: 'yes', photoUrl: MOCK_MENU_PHOTOS.plate }),
        i('m-egg', 'Egg Bhurji', 160, null, true, { category: 'Starters', veg: 'no' }),
        i('m-pbm', 'Paneer Butter Masala', 280, null, true, { category: 'Mains', veg: 'yes' }),
        i('m-dal', 'Dal Tadka', 190, null, true, { category: 'Mains', veg: 'yes' }),
        i('m-bir', 'Veg Biryani', 240, 'With raita', true, { category: 'Mains', veg: 'yes' }),
        i('m-nan', 'Butter Naan', 45, null, true, { category: 'Mains', veg: 'yes' }),
        i('m-dos', 'Masala Dosa', 150, 'Breakfast only, till 11 am', false, { category: 'Mains', veg: 'yes' }),
        i('m-gth', 'Gujarati Thali (unlimited, with sweet of the day)', 320, null, true, { category: 'Mains', veg: 'yes', photoUrl: MOCK_MENU_PHOTOS.plate }),
        i('m-lim', 'Fresh Lime Soda', 90, null, true, { category: 'Drinks', veg: 'yes', photoUrl: MOCK_MENU_PHOTOS.glass }),
        i('m-tea', 'Tea / Coffee (2 cups)', 80, null, true, { category: 'Drinks', veg: 'yes' }),
        i('m-wat', 'Drinking water (1 L)', 30, null, true, { category: 'Drinks', veg: 'yes' }),
        i('m-brk', 'Breakfast tray', 220, null, true, { category: 'Breakfast', veg: 'yes' }),
        i('m-snk', 'Late-night snack box', 180, 'Sandwich, chips and cookies', true, { category: 'Snacks', veg: 'yes' }),
      ],
    },
    // MJ, 26 Oct 2026: room service is food to the room only; no laundry or other services (ORDERABLE_MENU_GROUPS).
  ];
}

/** Mock password for the demo guest. */
const MOCK_PASSWORD = 'Guest@123';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function billSearch(b: GuestBill, s: string): boolean {
  const biz = guestBusinesses[b.business];
  return `${b.number} ${biz.name} ${b.roomNumber}`.toLowerCase().includes(s);
}

function historySearch(h: HistoryItem, s: string): boolean {
  return `${h.title} ${guestBusinesses[h.business].name} ${h.billNumber ?? ''}`.toLowerCase().includes(s);
}

function blankProfile(a: GuestAccount): GuestProfile {
  const digits = a.mobile.replace(/\D/g, '').slice(-10);
  return {
    id: a.id,
    name: a.name,
    mobile: digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : a.mobile,
    email: a.email,
    city: '',
    address: '',
    idProofType: 'none',
    idProofNumber: '',
    notifyEmail: true,
    lastSignInAt: '2026-11-05T14:30:00Z',
    memberSince: GUEST_TODAY,
    staysCount: 0,
  };
}

function asSnapshot(x: unknown): GuestSnapshot | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Partial<GuestSnapshot>;
  const okShape =
    s.v === 1 && !!s.profile && typeof s.profile === 'object' && Array.isArray(s.bills) && Array.isArray(s.history) &&
    typeof s.seq === 'number' && typeof s.nowOffset === 'number' && (s.password === null || typeof s.password === 'string');
  return okShape ? (s as GuestSnapshot) : null;
}

/** "XXXX XXXX 4321": an ID number as the guest sees it (the last 4 only). */
const maskId = (n: string): string => {
  const plain = n.replace(/\s+/g, '');
  return plain.length <= 4 ? plain : `XXXX XXXX ${plain.slice(-4)}`;
};

/** Options of the mock store. `scenario` (decision 71): which stage the demo guest is in, read at every call (the hotel's portal preview switches it). */
export interface GuestMockOptions {
  scenario?: () => GuestStage;
}

/**
 * The mock guest portal. With no `account` it is the demo guest Amit Joshi (current stay, bills, history); with one it is that guest's
 * own empty account (no stay, bills or history) and any current password is accepted (the mock does not know it).
 * With `keep`, the store starts from the saved snapshot (when there is a valid one) and saves itself after every successful change.
 * Decision 71: the demo guest can be shown in each stage (`opts.scenario`, default "staying"): arriving (the next booking, nothing of this stay yet), staying,
 * the check-out day (the stay ends today), checked out (this stay ended today, its bills still open) and no stay (only the older stays). A registered account is
 * always "no stay".
 */
export function createGuestApi(clock: MockClock = {}, account?: GuestAccount, keep?: GuestKeep, opts: GuestMockOptions = {}): GuestApi {
  let saved: GuestSnapshot | null = null;
  try {
    saved = keep ? asSnapshot(keep.load()) : null;
  } catch {
    saved = null;
  }
  let profile = saved ? saved.profile : account ? blankProfile(account) : seedProfile();
  const seededStay: CurrentStay | null = account ? null : seedStay();
  const bills = saved ? saved.bills : account ? [] : seedBills();
  const history = saved ? saved.history : account ? [] : seedHistory();
  const menu = seedMenu();
  /** Orders placed for a later time in this session (the "Coming up" list). */
  const scheduled: ScheduledOrder[] = account ? [] : [{ id: 'so-1', orderNo: 'O-1031', scheduledFor: '2026-11-06T08:00:00+05:30', totalPaise: P(399), lines: [{ name: 'Breakfast tray', qty: 2 }, { name: 'Tea / Coffee (2 cups)', qty: 1 }], hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot' }];
  /** null = not known to the mock (a registered account): any current password is accepted once, then the new one counts. */
  let password: string | null = saved ? saved.password : account ? null : MOCK_PASSWORD;
  let seq = saved ? saved.seq : 1040;
  let nowOffset = saved ? saved.nowOffset : 0;

  /** After a successful change: hand the whole store to `keep` (a failing save never breaks the call). */
  const persist = <T>(r: DashResult<T>): DashResult<T> => {
    if (r.ok && keep) {
      try {
        keep.save(clone({ v: 1, profile, bills, history, password, seq, nowOffset }));
      } catch {
        // storage full or blocked: the store still works for this page
      }
    }
    return r;
  };

  /** Mock "now": a few minutes after the last seeded event, moving forward with each action. */
  const now = () => new Date(Date.parse('2026-11-05T14:30:00Z') + (nowOffset += 60_000)).toISOString();
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  /** A call that changes the store: saved through `keep` when it succeeds. */
  const write = <T>(fn: () => DashResult<T>) => mockCall(() => persist(fn()), clock);

  // ---- decision 71: the demo guest's stage (read at every call) ----
  const scenario = (): GuestStage => (account || !seededStay ? 'none' : (opts.scenario?.() ?? 'staying'));
  /** The stay going on in this stage: the seeded one, or (check-out day) the same stay ending today; none otherwise. */
  const currentStay = (): CurrentStay | null => {
    const s = scenario();
    if (!seededStay || (s !== 'staying' && s !== 'checkoutDay')) return null;
    if (s === 'staying') return seededStay;
    const nights = Math.max(1, daysBetween(seededStay.checkIn, GUEST_TODAY));
    return { ...seededStay, checkOut: GUEST_TODAY, nights, nightsDone: nights };
  };
  const currentNumbers = () => new Set(bills.filter((b) => b.current).map((b) => b.number));
  /** The bills as this stage shows them (copies where they change; payments and orders still change the real rows by id). */
  const shownBills = (): GuestBill[] => {
    const s = scenario();
    if (s === 'arriving' || s === 'none') return bills.filter((b) => !b.current);
    if (s === 'checkedOut') return bills.map((b) => (b.current ? { ...b, current: false, stayTo: GUEST_TODAY } : b));
    return bills;
  };
  const shownHistory = (): HistoryItem[] => {
    const s = scenario();
    if (s !== 'arriving' && s !== 'none') return history;
    const mine = currentNumbers();
    return history.filter((h) => h.at < STAY_START_ISO && !(h.billNumber !== null && mine.has(h.billNumber)));
  };

  const openBills = () =>
    shownBills()
      .filter((b) => b.status === 'open' && billTotals(b).duePaise > 0 && reachableHotel(hotelOfBill(b.number).hotelId))
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number)); // decision 52: strictly newest first

  function settle(bill: GuestBill) {
    if (bill.status === 'open' && billTotals(bill).duePaise <= 0) bill.status = 'paid';
    if (bill.status === 'paid') {
      for (const h of history) if (h.billNumber === bill.number && h.status === 'on_bill') h.status = 'paid';
    }
  }

  function overviewKpis(): Kpi[] {
    const stay = currentStay();
    const current = shownBills().filter((b) => b.current);
    const due = openBills().reduce((s, b) => s + billTotals(b).duePaise, 0);
    const paid = current.reduce((s, b) => s + billTotals(b).paidPaise, 0);
    const ordered = current.flatMap((b) => b.lines).filter((l) => l.kind !== 'room').reduce((s, l) => s + l.amountPaise, 0);
    return [
      {
        id: 'due', label: guestCopy.home.kpiDue, value: due, kind: 'money', trend: null, tone: due > 0 ? 'warning' : 'success', icon: 'wallet',
        hint: openBills().length === 0 ? 'Nothing to pay' : `${openBills().length} ${openBills().length === 1 ? 'bill' : 'bills'} open`,
      },
      { id: 'paid', label: guestCopy.home.kpiPaid, value: paid, kind: 'money', trend: null, tone: 'success', icon: 'check', hint: paid > 0 ? 'Advance received' : 'No payments yet' },
      { id: 'ordered', label: guestCopy.home.kpiOrdered, value: ordered, kind: 'money', trend: null, tone: 'graphite', icon: 'utensils', hint: ordered > 0 ? 'On your room bill' : 'Nothing ordered yet' },
      {
        id: 'nights', label: guestCopy.home.kpiNights, value: stay ? nightsLeft(stay) : 0, kind: 'count', trend: null, tone: 'info', icon: 'calendar',
        hint: stay ? `Check-out ${guestHotel.checkOutTime}` : 'No stay yet',
      },
    ];
  }

  return {
    // decision 48: the demo guest stays at two hotels, so the selector shows (the demo's data is the one hotel's)
    listHotels: () => call(() => ok(MOCK_HOTELS.map((h) => ({ ...h })))),
    getOverview: () =>
      call(() =>
        ok(clone({
          profile,
          stay: currentStay(),
          openBills: openBills().map(withSeller),
          recent: [...shownHistory()].filter((h) => reachableHotel(h.hotelId)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5),
          kpis: overviewKpis(),
          upcoming: scenario() === 'arriving' && reachableHotel(UPCOMING.hotelId) ? UPCOMING : null,
        })),
      ),

    listBills: (q) =>
      call(() => {
        const chosen = chosenHotel(q);
        const sorted = [...shownBills()].map(withSeller).filter((b) => reachableHotel(b.hotelId, chosen)).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
        const isOpen = (b: GuestBill) => { const st = billState(b); return st === 'due' || st === 'overdue'; };
        const counts: Record<BillTab, number> = {
          open: sorted.filter(isOpen).length,
          paid: sorted.filter((b) => billState(b) === 'paid').length,
          cancelled: sorted.filter((b) => b.status === 'cancelled').length,
          all: sorted.length,
        };
        const tab = (q.tab ?? 'all') as BillTab;
        const byTab = sorted.filter((b) =>
          tab === 'open' ? isOpen(b) : tab === 'paid' ? billState(b) === 'paid' : tab === 'cancelled' ? b.status === 'cancelled' : true,
        );
        const s = (q.search ?? '').trim().toLowerCase();
        const found = s ? byTab.filter((b) => billSearch(b, s)) : byTab;
        const cq = q as typeof q & { cursor?: string; limit?: number };
        const paged = mockListPage(found, { page: q.page, pageSize: q.pageSize, cursor: cq.cursor, limit: cq.limit }, `guest-bills|${chosen ?? 'all'}|${tab}|${s}`, (b) => ({ d: b.issuedOn, h: b.hotelId ?? '', i: b.id }));
        if (!paged.ok) return paged.error;
        return ok(clone({ ...paged.page, counts, unavailable: mockUnavailable(MOCK_HOTELS, (id) => inChosenHotel(id, chosen)) }));
      }),

    getBill: (id) =>
      call(() => {
        const b = shownBills().find((x) => x.id === id);
        return b ? ok(clone(withSeller(b))) : mockError('NOT_FOUND');
      }),

    payBills: (ids) =>
      write(() => {
        if (ids.length === 0) return mockError('VALIDATION_FAILED', { bills: guestCopy.errors.nothingSelected });
        const visible = new Set(shownBills().map((b) => b.id));
        const picked = ids.map((id) => (visible.has(id) ? bills.find((b) => b.id === id) : undefined));
        if (picked.some((b) => !b)) return mockError('NOT_FOUND');
        if (picked.some((b) => !b || b.status !== 'open' || billTotals(b).duePaise <= 0)) return mockError('CONFLICT');
        const receipts: PaymentReceipt[] = [];
        for (const bill of picked) {
          if (!bill) continue;
          const due = billTotals(bill).duePaise;
          const at = now();
          const reference = `pay_${(seq++).toString(36).toUpperCase()}RZP${bill.number.replace('-', '')}`;
          bill.payments.push({ id: `p-${seq}`, at, method: 'upi', reference, amountPaise: due });
          history.unshift({
            id: `h-${seq}`, at, kind: 'payment', category: 'payment', title: 'Paid online (Razorpay)',
            business: bill.business, amountPaise: due, status: 'paid', billNumber: bill.number,
          });
          settle(bill);
          receipts.push({ billId: bill.id, billNumber: bill.number, business: bill.business, amountPaise: due, reference });
        }
        return ok({ receipts, totalPaise: receipts.reduce((s, r) => s + r.amountPaise, 0) });
      }),

    emailBill: (id) =>
      call(() => (shownBills().some((b) => b.id === id) ? ok({ sentTo: profile.email }) : mockError('NOT_FOUND'))),

    listHistory: (q) =>
      call(() => {
        const chosen = chosenHotel(q);
        const sorted = [...shownHistory()].filter((h) => reachableHotel(h.hotelId, chosen)).sort((a, b) => b.at.localeCompare(a.at));
        const counts: Record<HistoryTab, number> = {
          all: sorted.length,
          charges: sorted.filter((h) => h.kind === 'charge').length,
          payments: sorted.filter((h) => h.kind === 'payment').length,
        };
        const tab = (q.tab ?? 'all') as HistoryTab;
        const byTab = sorted.filter((h) => (tab === 'charges' ? h.kind === 'charge' : tab === 'payments' ? h.kind === 'payment' : true));
        const s = (q.search ?? '').trim().toLowerCase();
        const found = s ? byTab.filter((h) => historySearch(h, s)) : byTab;
        const cq = q as typeof q & { cursor?: string; limit?: number };
        const paged = mockListPage(found, { page: q.page, pageSize: q.pageSize, cursor: cq.cursor, limit: cq.limit }, `guest-history|${chosen ?? 'all'}|${tab}|${s}`, (h) => ({ d: h.at, h: h.hotelId ?? '', i: h.id }));
        if (!paged.ok) return paged.error;
        return ok(clone({ ...paged.page, counts, unavailable: mockUnavailable(MOCK_HOTELS, (id) => inChosenHotel(id, chosen)) }));
      }),

    getMenu: () => call(() => ok(clone({ stay: currentStay(), profileName: profile.name, menu }))),

    listScheduledOrders: () =>
      call(() => ok(clone({ items: [...scheduled].filter((o) => currentStay() !== null && reachableHotel(o.hotelId)).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)) }))),

    placeOrder: (req) =>
      write(() => {
        if (!currentStay()) return mockError('FORBIDDEN');
        const cart = cartSummary(menu, req.qty);
        if (cart.lines.length === 0) return mockError('VALIDATION_FAILED', { cart: guestCopy.errors.cartEmpty });
        if (cart.lines.some((l) => !l.item.available || l.qty > MAX_ITEM_QTY)) return mockError('VALIDATION_FAILED', { cart: guestCopy.errors.cartEmpty });
        seq += 1;
        const orderNo = `O-${seq}`;
        const at = now();
        for (const part of cart.parts) {
          const partLines = cart.lines.filter((l) => l.group.business === part.business);
          const label = partLines.map((l) => `${l.item.name} × ${l.qty}`).join(', ');
          const kind = partLines[0]?.group.kind ?? 'other';
          const category: HistoryCategory = kind === 'laundry' ? 'laundry' : kind === 'service' ? 'service' : 'food';
          const bill = bills.find((b) => b.current && b.business === part.business && b.status !== 'cancelled');
          if (req.payWith === 'room_bill' && bill) {
            bill.status = 'open';
            bill.lines.push({ id: `l-${seq}-${part.business}`, label: `Order ${orderNo}`, detail: label, date: GUEST_TODAY, kind, amountPaise: part.subtotalPaise });
          }
          history.unshift({
            id: `h-${seq}-${part.business}`, at, kind: 'charge', category,
            title: `Order ${orderNo}: ${label}`, business: part.business,
            amountPaise: req.payWith === 'room_bill' ? part.subtotalPaise : part.totalPaise,
            status: req.payWith === 'room_bill' ? 'on_bill' : 'paid',
            billNumber: req.payWith === 'room_bill' && bill ? bill.number : null,
          });
        }
        if (req.scheduledFor) {
          scheduled.push({
            id: `so-${seq}`, orderNo, scheduledFor: req.scheduledFor, totalPaise: cart.totalPaise,
            lines: cart.lines.map((l) => ({ name: l.item.name, qty: l.qty })), hotelId: MOCK_HOTELS[0].hotelId, hotelName: MOCK_HOTELS[0].name,
          });
        }
        return ok({ orderNo, placedAt: at, payWith: req.payWith, totalPaise: cart.totalPaise, parts: cart.parts, etaMinutes: 25 });
      }),

    getProfile: () => call(() => ok(clone(profile))),

    updateProfile: (input) =>
      write(() => {
        const fields: Record<string, string> = {};
        const name = input.name.trim();
        if (!name) fields.name = guestCopy.errors.nameRequired;
        else if (name.length > 80) fields.name = guestCopy.errors.nameLong;
        if (!EMAIL_RE.test(input.email.trim())) fields.email = guestCopy.errors.emailInvalid;
        if (input.idProofType !== 'none' && !input.idProofNumber.trim()) fields.idProofNumber = guestCopy.errors.idNumberRequired;
        if (Object.keys(fields).length) return mockError('VALIDATION_FAILED', fields);
        profile = {
          ...profile,
          name,
          email: input.email.trim(),
          city: input.city.trim(),
          address: input.address.trim(),
          idProofType: input.idProofType,
          // decision 71: the masked number sent back unchanged (only the type changed) keeps the number; a new number is kept masked, as the server shows it
          idProofNumber: input.idProofType === 'none' ? '' : input.idProofNumber.trim() === profile.idProofNumber ? profile.idProofNumber : maskId(input.idProofNumber.trim()),
          notifyEmail: input.notifyEmail,
        };
        return ok(clone(profile));
      }),

    changePassword: (input) =>
      write(() => {
        const fields = validatePasswordChange(input);
        if (!fields.current && password !== null && input.current !== password) fields.current = guestCopy.errors.currentWrong;
        if (Object.keys(fields).length) return mockError('VALIDATION_FAILED', fields);
        password = input.next;
        return ok({ changed: true as const });
      }),
  };
}
