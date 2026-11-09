// The in-memory mock of frontOffice.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { GuestRequestRow } from './guestRequests';
import type { MockClock, DashResult, ListQuery, Page } from './common';
import { mockCall, mockError, ok, pageOf, mockEmptyHotel } from './common';
import { addDays, chargeCategories, daysBetween, EMPTY_REGISTER_FIELDS, type GuestDetailsInput, type IdPhotoList, type IdPhotoResult, type IdReading, type GuestRegisterFields, folioTotals, frontOfficeCopy, gstSlabPercent, isGstin, isPlainDate, istDate, parseRoomNumbers, planRate, reservationViews, todayIst, type Advance, type AdvanceInput, type AdvanceRow, type Board, type BulkRoomsInput, type BulkRoomsResult, type CancelResult, type Charge, type ChargeCategory, type ChargeInput, type CheckInInput, type CheckInPrefill, type CheckOutInput, type CheckoutDefaults, type CompanyOption, type FrontOfficeOptions, type FrontOfficeStore, type GuestLookupMatch, type GuestLookupResult, type HkStatus, type Reservation, type ReservationInput, type ReservationPage, type ReservationRow, type ReservationView, type Room, type RoomFilter, type RoomInput, type RoomList, type RoomRow, type RoomState, type RoomType, type Stay, type StayPage, type StayRow, type StayView, type StayIdNumbers } from './frontOffice';
/** Mock-only values (not exported). Real ones come from getOptions() and getCheckoutDefaults(). */
let readCount = 0;
const DEMO_READINGS: IdReading[] = [
  { outcome: 'read', fields: { guestName: 'Rahul Mehta', idProofType: 'Aadhaar', idProofNumber: '2345 6789 0123', dateOfBirth: '1988-04-17', address: '12 Station Road', city: 'Rajkot', nationality: 'Indian' }, unread: [], retake: null, others: [{ fullName: 'Kavita Mehta', idType: 'Aadhaar', idNumber: '3456 7890 1234' }] },
  { outcome: 'read', fields: { guestName: 'Sneha Patel', idProofType: 'Driving licence', idProofNumber: 'GJ03 20190012345', dateOfBirth: '1993-11-02', nationality: 'Indian' }, unread: ['address', 'city'], retake: null },
  { outcome: 'read', fields: { guestName: 'Arjun Nair', idProofType: 'Passport', idProofNumber: 'Z1234567', dateOfBirth: '1985-07-29', nationality: 'Indian' }, unread: ['address', 'city'], retake: null },
];
const idProofTypes = ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'PAN card', 'Visa'];
const paymentModes = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque', 'Debit (bill to company)'];
const defaultGstPercent = 5;

let store: FrontOfficeStore | null = null;

function db(): FrontOfficeStore {
  if (!store) store = seed();
  return store;
}

/** Start from rows of your own instead of the made-up ones (the dev preview's `?data=s08`). */
export function loadFrontOfficeStore(rows: FrontOfficeStore): void {
  store = rows;
}

/** Start the mock data again (tests, dev preview). */
/** The mock's ID image ids per stay id (made-up names; no pictures). */
const mockPhotos = new Map<string, string[]>();

export function resetFrontOfficeMock(): void {
  mockPhotos.clear();
  store = null;
}

function nextId(prefix: string): string {
  const s = db();
  s.seq += 1;
  return `${prefix}-${s.seq}`;
}

/** ISO timestamp for a plain date at an IST hour. */
function istAt(date: string, hh: number, mm = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh, mm) - 330 * 60_000).toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Mock data: Hotel Sunrise, Rajkot                                    */
/* ------------------------------------------------------------------ */

const P = (rupees: number) => rupees * 100;

function seed(): FrontOfficeStore {
  const t = todayIst();
  const roomTypes: RoomType[] = [
    {
      id: 'rt-1',
      name: 'Deluxe',
      plans: [
        { code: 'EP', name: 'Room only', singlePaise: P(2400), doublePaise: P(2800) },
        { code: 'CP', name: 'With breakfast', singlePaise: P(2800), doublePaise: P(3400) },
        { code: 'MAP', name: 'Breakfast and dinner', singlePaise: P(3400), doublePaise: P(4400) },
      ],
    },
    {
      id: 'rt-2',
      name: 'Super Deluxe',
      plans: [
        { code: 'EP', name: 'Room only', singlePaise: P(3200), doublePaise: P(3800) },
        { code: 'CP', name: 'With breakfast', singlePaise: P(3600), doublePaise: P(4400) },
        { code: 'MAP', name: 'Breakfast and dinner', singlePaise: P(4200), doublePaise: P(5400) },
      ],
    },
    {
      id: 'rt-3',
      name: 'Executive Suite',
      plans: [
        { code: 'CP', name: 'With breakfast', singlePaise: P(6200), doublePaise: P(7200) },
        { code: 'AP', name: 'All meals', singlePaise: P(7400), doublePaise: P(9200) },
      ],
    },
  ];

  // A brand-new hotel (mock): only the room-category catalogue (a reservation needs one); no rooms, companies, reservations,
  // advances, stays, charges or bills; bill and receipt numbers start at 0001 and reservation numbers at RES-yy-00001.
  if (mockEmptyHotel()) return { roomTypes, companies: [], rooms: [], reservations: [], advances: [], stays: [], seq: 1000, billSeq: 1, receiptSeq: 1, firstReservationNo: 1 };

  const companies: CompanyOption[] = [
    { id: 'co-1', name: 'Tata Consultancy Services' },
    { id: 'co-2', name: 'Jyoti CNC Automation Ltd' },
    { id: 'co-3', name: 'Atul Auto Ltd' },
    { id: 'co-4', name: 'Gujarat State Fertilizers and Chemicals Limited (Vadodara Corporate Office, Marketing Division)' },
    { id: 'co-5', name: 'Shree Ganesh Tours & Travels' },
  ];

  // 24 rooms on 3 floors.
  const layout: [string, string, string][] = [
    ['101', '1', 'rt-1'], ['102', '1', 'rt-1'], ['103', '1', 'rt-1'], ['104', '1', 'rt-1'],
    ['105', '1', 'rt-1'], ['106', '1', 'rt-1'], ['107', '1', 'rt-1'], ['108', '1', 'rt-1'],
    ['201', '2', 'rt-2'], ['202', '2', 'rt-2'], ['203', '2', 'rt-2'], ['204', '2', 'rt-2'],
    ['205', '2', 'rt-2'], ['206', '2', 'rt-2'], ['207', '2', 'rt-1'], ['208', '2', 'rt-1'],
    ['301', '3', 'rt-3'], ['302', '3', 'rt-3'], ['303', '3', 'rt-3'], ['304', '3', 'rt-3'],
    ['305', '3', 'rt-2'], ['306', '3', 'rt-2'], ['307', '3', 'rt-2'], ['308', '3', 'rt-2'],
  ];
  const notes: Record<string, string> = { '104': 'Near the lift', '301': 'Corner suite, city view', '308': 'Connecting door to 307' };
  const rooms: RoomRow[] = layout.map(([number, floor, type], i) => ({
    id: `rm-${number}`,
    number,
    floor,
    roomTypeId: type,
    notes: notes[number] ?? '',
    hkStatus: number === '106' || number === '205' || number === '306' ? 'dirty' : 'clean',
    outOfOrder: number === '304',
    outOfOrderReason: number === '304' ? 'AC compressor repair' : null,
    sort: i + 1,
  }));

  const rate = (type: string, code: string, adults: number): number => {
    const plan = roomTypes.find((x) => x.id === type)?.plans.find((p) => p.code === code);
    return plan ? planRate(plan, adults) : 0;
  };

  const res = (
    n: number,
    guestName: string,
    o: Partial<ReservationRow> & Pick<ReservationRow, 'roomTypeId' | 'checkIn' | 'checkOut' | 'status'>,
  ): ReservationRow => {
    const adults = o.adults ?? 2;
    const plan = o.plan ?? 'CP';
    return {
      id: `res-${n}`,
      reference: `RES-${t.slice(2, 4)}-${String(n).padStart(5, '0')}`,
      guestName,
      mobile: o.mobile ?? '',
      email: o.email ?? '',
      companyId: o.companyId ?? null,
      rooms: o.rooms ?? 1,
      plan,
      ratePaise: o.ratePaise ?? rate(o.roomTypeId, plan, adults),
      adults,
      children: o.children ?? 0,
      source: o.source ?? 'phone',
      enquiryRef: o.enquiryRef ?? null,
      notes: o.notes ?? '',
      cancelReason: o.cancelReason ?? null,
      createdAt: istAt(addDays(o.checkIn, -7), 11, 20),
      updatedAt: istAt(addDays(o.checkIn, -2), 16, 5),
      roomTypeId: o.roomTypeId,
      checkIn: o.checkIn,
      checkOut: o.checkOut,
      status: o.status,
    };
  };

  const reservations: ReservationRow[] = [
    // In house (linked to stays below)
    res(101, 'Rajesh Mehta', { roomTypeId: 'rt-2', checkIn: addDays(t, -2), checkOut: addDays(t, 1), status: 'checkedIn', mobile: '98250 41236', email: 'rajesh.mehta@pateleng.in', companyId: 'co-1', source: 'company' }),
    res(102, 'Ananya Iyer', { roomTypeId: 'rt-3', checkIn: addDays(t, -1), checkOut: addDays(t, 2), status: 'checkedIn', mobile: '99099 18273', email: 'ananya.iyer@gmail.com', source: 'website', enquiryRef: 'ENQ-26-0311', plan: 'CP' }),
    res(103, 'Harshad Joshi', { roomTypeId: 'rt-1', rooms: 2, checkIn: addDays(t, -3), checkOut: t, status: 'checkedIn', mobile: '94262 77110', adults: 4, ratePaise: P(3400), notes: 'Family function at Race Course. Two rooms side by side.' }),
    // Arriving today and overdue
    res(104, 'Priya Shah', { roomTypeId: 'rt-1', checkIn: t, checkOut: addDays(t, 2), status: 'confirmed', mobile: '98795 66021', email: 'priya.shah@outlook.com', source: 'phone', notes: 'Early arrival around 10 am.' }),
    res(105, 'Mohammed Arif Khan', { roomTypeId: 'rt-2', checkIn: t, checkOut: addDays(t, 1), status: 'confirmed', mobile: '97277 30448', companyId: 'co-3', source: 'company', plan: 'EP', adults: 1 }),
    res(106, 'Venkata Subramanian Ramakrishnan Iyer', { roomTypeId: 'rt-3', checkIn: addDays(t, -1), checkOut: addDays(t, 3), status: 'confirmed', mobile: '94440 12890', email: 'vsr.iyer@tcs.com', source: 'agent', notes: 'Flight delayed; arriving late tonight.' }),
    res(107, 'Kavita Desai', { roomTypeId: 'rt-1', checkIn: t, checkOut: addDays(t, 1), status: 'confirmed', mobile: '98980 55120', source: 'walkIn', plan: 'EP', ratePaise: 0, notes: 'Complimentary: owner guest.' }),
    // Upcoming
    res(108, 'Amit Patel', { roomTypeId: 'rt-2', rooms: 3, checkIn: addDays(t, 2), checkOut: addDays(t, 5), status: 'confirmed', mobile: '98241 00321', email: 'amit@saurashtraceramics.com', companyId: 'co-2', source: 'company', adults: 6, ratePaise: P(4000) }),
    res(109, 'Sneha Kulkarni', { roomTypeId: 'rt-1', checkIn: addDays(t, 3), checkOut: addDays(t, 4), status: 'confirmed', mobile: '90990 44112', source: 'website', enquiryRef: 'ENQ-26-0330' }),
    res(110, 'Dr. Nirav Trivedi', { roomTypeId: 'rt-3', checkIn: addDays(t, 6), checkOut: addDays(t, 9), status: 'confirmed', mobile: '98250 99881', email: 'nirav.trivedi@gmail.com', plan: 'AP', children: 1 }),
    res(111, 'Gujarat Pharma Distributors (team)', { roomTypeId: 'rt-1', rooms: 4, checkIn: addDays(t, 10), checkOut: addDays(t, 12), status: 'confirmed', mobile: '79 2658 1100', companyId: 'co-4', source: 'company', adults: 8, plan: 'MAP' }),
    res(112, 'Rohan Bhatt', { roomTypeId: 'rt-2', checkIn: addDays(t, 1), checkOut: addDays(t, 3), status: 'confirmed', mobile: '99250 61234', source: 'agent' }),
    // Past
    res(113, 'Meera Nair', { roomTypeId: 'rt-1', checkIn: addDays(t, -6), checkOut: addDays(t, -3), status: 'checkedOut', mobile: '98470 33221', source: 'website' }),
    res(114, 'Suresh Chauhan', { roomTypeId: 'rt-2', checkIn: addDays(t, -9), checkOut: addDays(t, -7), status: 'checkedOut', mobile: '97129 88001', companyId: 'co-5', source: 'company' }),
    // Cancelled / no show
    res(115, 'Farhan Qureshi', { roomTypeId: 'rt-1', checkIn: addDays(t, 4), checkOut: addDays(t, 6), status: 'cancelled', mobile: '98980 11223', cancelReason: 'Trip postponed by the guest.' }),
    res(116, 'Pooja Rathod', { roomTypeId: 'rt-2', checkIn: addDays(t, -2), checkOut: addDays(t, -1), status: 'noShow', mobile: '90331 20456', cancelReason: 'Did not arrive' }),
    // More rows so every tab looks filled (added after the originals; ids continue from 117).
    // In house (linked to stays st-16 and st-17 below)
    res(117, 'Nilesh Thakkar', { roomTypeId: 'rt-1', checkIn: addDays(t, -1), checkOut: addDays(t, 2), status: 'checkedIn', mobile: '98252 47719', email: 'nilesh.thakkar@jyoti.co.in', companyId: 'co-2', source: 'company', plan: 'MAP', adults: 1, notes: 'Plant audit at Metoda GIDC. Bill to company.' }),
    res(118, 'Dhruv Kothari', { roomTypeId: 'rt-2', checkIn: addDays(t, -2), checkOut: t, status: 'checkedIn', mobile: '99790 12458', email: 'dhruv.kothari@yahoo.in', source: 'phone' }),
    // Arriving today
    res(119, 'Bhavik Shah', { roomTypeId: 'rt-2', checkIn: t, checkOut: addDays(t, 2), status: 'confirmed', mobile: '98984 30127', email: 'bhavik.shah@gmail.com', source: 'website', enquiryRef: 'ENQ-26-0342', notes: 'Wants a higher floor, non-smoking.' }),
    res(120, 'Sunita Chawla', { roomTypeId: 'rt-1', checkIn: t, checkOut: addDays(t, 1), status: 'confirmed', mobile: '87580 64412', source: 'phone', plan: 'EP', adults: 1 }),
    // Past (linked to checked-out stays st-15, st-18 and st-19 below)
    res(121, 'Jignesh Thakkar', { roomTypeId: 'rt-1', checkIn: addDays(t, -5), checkOut: addDays(t, -3), status: 'checkedOut', mobile: '94282 11906', source: 'phone' }),
    res(122, 'Shilpa Reddy', { roomTypeId: 'rt-2', checkIn: addDays(t, -8), checkOut: addDays(t, -5), status: 'checkedOut', mobile: '96760 45210', email: 'shilpa.reddy@outlook.com', source: 'website', plan: 'EP', adults: 1 }),
    res(123, 'Manoj Kumar Pandey', { roomTypeId: 'rt-3', checkIn: addDays(t, -4), checkOut: addDays(t, -2), status: 'checkedOut', mobile: '70161 38842', source: 'agent', notes: 'Booked by Shree Ganesh Tours.' }),
    // Cancelled / no show
    res(124, 'Rahul Ghosh', { roomTypeId: 'rt-3', checkIn: addDays(t, 5), checkOut: addDays(t, 7), status: 'cancelled', mobile: '98300 72115', email: 'rahul.ghosh@gmail.com', source: 'website', cancelReason: 'Conference moved to Ahmedabad. Advance refunded.' }),
    res(125, 'Kishan Bhimani', { roomTypeId: 'rt-1', checkIn: addDays(t, 2), checkOut: addDays(t, 3), status: 'cancelled', mobile: '97370 28561', source: 'phone', cancelReason: 'Booked elsewhere closer to the venue.' }),
    res(126, 'Tejal Pandya', { roomTypeId: 'rt-1', checkIn: addDays(t, -3), checkOut: addDays(t, -2), status: 'noShow', mobile: '81402 99317', source: 'phone', cancelReason: 'Did not arrive, phone switched off' }),
  ];

  const advances: AdvanceRow[] = [
    { id: 'adv-1', reservationId: 'res-101', receiptNumber: '0141', paymentDate: addDays(t, -9), hotelPaise: P(5000), foodPaise: 0, hotelMode: 'UPI', foodMode: '', instruction: '', balancePaise: P(5000), refunded: false },
    { id: 'adv-2', reservationId: 'res-102', receiptNumber: '0148', paymentDate: addDays(t, -5), hotelPaise: P(7200), foodPaise: P(1500), hotelMode: 'Card', foodMode: 'Card', instruction: 'Website booking deposit', balancePaise: P(8700), refunded: false },
    { id: 'adv-3', reservationId: 'res-104', receiptNumber: '0150', paymentDate: addDays(t, -3), hotelPaise: P(3400), foodPaise: 0, hotelMode: 'Cash', foodMode: '', instruction: '', balancePaise: P(3400), refunded: false },
    { id: 'adv-4', reservationId: 'res-108', receiptNumber: '0152', paymentDate: addDays(t, -1), hotelPaise: P(25000), foodPaise: 0, hotelMode: 'Bank transfer', foodMode: '', instruction: 'NEFT from Saurashtra Ceramics', balancePaise: P(25000), refunded: false },
    { id: 'adv-5', reservationId: 'res-115', receiptNumber: '0144', paymentDate: addDays(t, -8), hotelPaise: P(2800), foodPaise: 0, hotelMode: 'UPI', foodMode: '', instruction: '', balancePaise: P(2800), refunded: false },
    { id: 'adv-6', reservationId: 'res-113', receiptNumber: '0131', paymentDate: addDays(t, -12), hotelPaise: P(4000), foodPaise: 0, hotelMode: 'UPI', foodMode: '', instruction: '', balancePaise: 0, refunded: false },
    { id: 'adv-7', reservationId: 'res-118', receiptNumber: '0149', paymentDate: addDays(t, -4), hotelPaise: P(4400), foodPaise: 0, hotelMode: 'UPI', foodMode: '', instruction: 'One night advance', balancePaise: P(4400), refunded: false },
    { id: 'adv-8', reservationId: 'res-119', receiptNumber: '0151', paymentDate: addDays(t, -2), hotelPaise: P(3800), foodPaise: 0, hotelMode: 'Card', foodMode: '', instruction: 'Website booking deposit', balancePaise: P(3800), refunded: false },
    { id: 'adv-9', reservationId: 'res-121', receiptNumber: '0146', paymentDate: addDays(t, -7), hotelPaise: P(2000), foodPaise: 0, hotelMode: 'Cash', foodMode: '', instruction: '', balancePaise: 0, refunded: false },
    { id: 'adv-10', reservationId: 'res-123', receiptNumber: '0139', paymentDate: addDays(t, -10), hotelPaise: P(7200), foodPaise: 0, hotelMode: 'Bank transfer', foodMode: '', instruction: 'NEFT from Shree Ganesh Tours', balancePaise: 0, refunded: false },
    { id: 'adv-11', reservationId: 'res-124', receiptNumber: '0137', paymentDate: addDays(t, -11), hotelPaise: P(6000), foodPaise: 0, hotelMode: 'UPI', foodMode: '', instruction: 'Refunded by UPI on cancellation', balancePaise: 0, refunded: true },
  ];

  const ch = (id: string, category: ChargeCategory, description: string, date: string, quantity: number, unitRupees: number): Charge => ({
    id,
    category,
    side: chargeCategories[category].side,
    description,
    chargeDate: date,
    quantity,
    unitPricePaise: P(unitRupees),
    amountPaise: Math.round(quantity * P(unitRupees)),
  });

  const stay = (
    n: number,
    roomNumber: string,
    guestName: string,
    o: Partial<StayRow> & { inDays: number; outDays: number },
  ): StayRow => ({
    id: `st-${n}`,
    reservationId: o.reservationId ?? null,
    roomId: `rm-${roomNumber}`,
    grNumber: o.grNumber ?? String(2400 + n),
    guestName,
    mobile: o.mobile ?? '',
    email: o.email ?? '',
    address: o.address ?? '',
    city: o.city ?? '',
    nationality: o.nationality ?? 'Indian',
    idProofType: o.idProofType ?? 'Aadhaar',
    idProofNumber: o.idProofNumber ?? '',
    companyId: o.companyId ?? null,
    guestGstin: o.guestGstin ?? '',
    adults: o.adults ?? 2,
    children: o.children ?? 0,
    plan: o.plan ?? 'CP',
    ratePaise: o.ratePaise ?? P(3400),
    checkInAt: istAt(addDays(t, o.inDays), 13, 40),
    expectedCheckOut: addDays(t, o.outDays),
    checkOutAt: o.checkOutAt ?? null,
    status: o.status ?? 'inHouse',
    notes: o.notes ?? '',
    charges: o.charges ?? [],
    bill: o.bill ?? null,
  });

  const stays: StayRow[] = [
    stay(1, '203', 'Rajesh Mehta', { inDays: -2, outDays: 1, reservationId: 'res-101', mobile: '98250 41236', email: 'rajesh.mehta@pateleng.in', address: '14, Shanti Nagar, Kalawad Road', city: 'Rajkot', idProofNumber: '4821', companyId: 'co-1', guestGstin: '24AABCP1234F1Z5', adults: 1, ratePaise: P(3600),
      charges: [ch('c-1', 'food', 'Dinner', addDays(t, -2), 1, 640), ch('c-2', 'laundry', 'Shirts pressed', addDays(t, -1), 4, 40), ch('c-3', 'roomService', 'Tea and snacks', addDays(t, -1), 2, 120)] }),
    stay(2, '302', 'Ananya Iyer', { inDays: -1, outDays: 2, reservationId: 'res-102', mobile: '99099 18273', email: 'ananya.iyer@gmail.com', city: 'Bengaluru', idProofType: 'Passport', idProofNumber: '7Z31', ratePaise: P(7200),
      charges: [ch('c-4', 'food', 'Lunch for two', addDays(t, -1), 1, 1180)] }),
    stay(3, '101', 'Harshad Joshi', { inDays: -3, outDays: 0, reservationId: 'res-103', mobile: '94262 77110', city: 'Ahmedabad', idProofType: 'Driving licence', idProofNumber: '0912', ratePaise: P(3400), notes: 'Family function at Race Course.',
      charges: [ch('c-5', 'extraBed', 'Extra bed', addDays(t, -3), 3, 600)] }),
    stay(4, '102', 'Bhavna Joshi', { inDays: -3, outDays: 0, reservationId: 'res-103', mobile: '94262 77111', city: 'Ahmedabad', idProofNumber: '3307', ratePaise: P(3400) }),
    stay(5, '201', 'Karan Malhotra', { inDays: -4, outDays: -1, mobile: '98111 22334', city: 'New Delhi', idProofNumber: '5520', ratePaise: P(4400), notes: 'Asked to stay one more night; confirm at the desk.',
      charges: [ch('c-6', 'food', 'Breakfast extra guest', addDays(t, -3), 2, 350), ch('c-7', 'other', 'Airport drop', addDays(t, -1), 1, 900)] }),
    stay(6, '105', 'Nisha Parmar', { inDays: 0, outDays: 1, mobile: '90990 77881', city: 'Jamnagar', idProofType: 'Voter ID', idProofNumber: '8834', plan: 'EP', ratePaise: P(2800) }),
    stay(7, '206', 'Sanjay Vaghela', { inDays: -1, outDays: 3, mobile: '97250 30090', city: 'Gondal', idProofNumber: '1199', companyId: 'co-3', guestGstin: '24AAFCR5678K1Z2', adults: 1, plan: 'EP', ratePaise: P(3200) }),
    stay(8, '301', 'Col. Vikram Singh Rathore (Retd.)', { inDays: -2, outDays: 4, mobile: '94140 55667', city: 'Jaipur', idProofNumber: '6610', plan: 'AP', ratePaise: P(9200),
      charges: [ch('c-8', 'roomService', 'Room service dinner', addDays(t, -1), 1, 1450), ch('c-9', 'laundry', 'Laundry bag', addDays(t, -1), 1, 380)] }),
    stay(9, '207', 'Ritu Agarwal', { inDays: 0, outDays: 2, mobile: '98290 41020', city: 'Surat', idProofNumber: '2048', ratePaise: P(3400) }),
    stay(10, '305', 'Imran Sheikh', { inDays: -1, outDays: 1, mobile: '99789 00213', city: 'Morbi', idProofNumber: '7765', adults: 2, children: 2, ratePaise: P(4400) }),
    stay(11, '108', 'Hotel staff guest', { inDays: -1, outDays: 1, mobile: '98250 00000', idProofNumber: '0001', plan: 'EP', ratePaise: 0, notes: 'Complimentary room.' }),
    // Checked out
    stay(12, '104', 'Meera Nair', { inDays: -6, outDays: -3, reservationId: 'res-113', mobile: '98470 33221', city: 'Kochi', idProofNumber: '4410', status: 'checkedOut', checkOutAt: istAt(addDays(t, -3), 11, 5), ratePaise: P(3400),
      bill: { billNumber: '0408', billDate: addDays(t, -3), hotelGstPercent: 5, foodGstPercent: 5, totals: { roomPaise: P(10200), hotelExtrasPaise: 0, hotelPaise: P(10200), foodPaise: P(820), subtotalPaise: P(11020), hotelGstPaise: P(510), foodGstPaise: P(41), grandTotalPaise: P(11571), advancePaise: P(4000), payablePaise: P(7571) } },
      charges: [ch('c-10', 'food', 'Dinner', addDays(t, -5), 1, 820)] }),
    stay(13, '202', 'Suresh Chauhan', { inDays: -9, outDays: -7, reservationId: 'res-114', mobile: '97129 88001', idProofNumber: '9021', companyId: 'co-5', status: 'checkedOut', checkOutAt: istAt(addDays(t, -7), 10, 30), ratePaise: P(4400),
      bill: { billNumber: '0399', billDate: addDays(t, -7), hotelGstPercent: 5, foodGstPercent: 5, totals: { roomPaise: P(8800), hotelExtrasPaise: 0, hotelPaise: P(8800), foodPaise: 0, subtotalPaise: P(8800), hotelGstPaise: P(440), foodGstPaise: 0, grandTotalPaise: P(9240), advancePaise: 0, payablePaise: P(9240) } } }),
    stay(14, '106', 'Deepak Soni', { inDays: -2, outDays: 0, mobile: '98989 12121', idProofNumber: '3434', status: 'checkedOut', checkOutAt: istAt(t, 9, 45), plan: 'EP', ratePaise: P(2800),
      bill: { billNumber: '0411', billDate: t, hotelGstPercent: 5, foodGstPercent: 5, totals: { roomPaise: P(5600), hotelExtrasPaise: 0, hotelPaise: P(5600), foodPaise: 0, subtotalPaise: P(5600), hotelGstPaise: P(280), foodGstPaise: 0, grandTotalPaise: P(5880), advancePaise: 0, payablePaise: P(5880) } } }),
    // More rows (added after the originals; ids continue from 15)
    stay(15, '107', 'Jignesh Thakkar', { inDays: -5, outDays: -3, reservationId: 'res-121', mobile: '94282 11906', address: '7, Nehru Nagar, Upleta Road', city: 'Dhoraji', idProofNumber: '6152', status: 'checkedOut', checkOutAt: istAt(addDays(t, -3), 10, 40), ratePaise: P(3400),
      bill: { billNumber: '0407', billDate: addDays(t, -3), hotelGstPercent: 5, foodGstPercent: 5, totals: { roomPaise: P(6800), hotelExtrasPaise: 0, hotelPaise: P(6800), foodPaise: P(760), subtotalPaise: P(7560), hotelGstPaise: P(340), foodGstPaise: P(38), grandTotalPaise: P(7938), advancePaise: P(2000), payablePaise: P(5938) } },
      charges: [ch('c-11', 'food', 'Dinner', addDays(t, -4), 1, 760)] }),
    stay(16, '103', 'Nilesh Thakkar', { inDays: -1, outDays: 2, reservationId: 'res-117', mobile: '98252 47719', email: 'nilesh.thakkar@jyoti.co.in', address: 'B-12, Alkapuri Society, Race Course Road', city: 'Vadodara', idProofNumber: '2736', companyId: 'co-2', guestGstin: '24AABCJ4521M1Z8', adults: 1, plan: 'MAP', ratePaise: P(3400),
      charges: [ch('c-12', 'roomService', 'Tea and snacks', addDays(t, -1), 2, 90), ch('c-13', 'laundry', 'Shirts pressed', t, 3, 40)] }),
    stay(17, '204', 'Dhruv Kothari', { inDays: -2, outDays: 0, reservationId: 'res-118', mobile: '99790 12458', email: 'dhruv.kothari@yahoo.in', address: '403, Sea Breeze Apartments, Andheri West', city: 'Mumbai', idProofType: 'PAN card', idProofNumber: '9P4K', ratePaise: P(4400),
      charges: [ch('c-14', 'food', 'Dinner for two', addDays(t, -2), 1, 1260), ch('c-15', 'laundry', 'Laundry bag', addDays(t, -1), 1, 320), ch('c-16', 'other', 'Taxi to Hirasar airport', t, 1, 1100)] }),
    stay(18, '204', 'Shilpa Reddy', { inDays: -8, outDays: -5, reservationId: 'res-122', mobile: '96760 45210', email: 'shilpa.reddy@outlook.com', city: 'Hyderabad', idProofType: 'Driving licence', idProofNumber: '5081', status: 'checkedOut', checkOutAt: istAt(addDays(t, -5), 11, 15), adults: 1, plan: 'EP', ratePaise: P(3200),
      bill: { billNumber: '0405', billDate: addDays(t, -5), hotelGstPercent: 5, foodGstPercent: 5, totals: { roomPaise: P(9600), hotelExtrasPaise: P(250), hotelPaise: P(9850), foodPaise: 0, subtotalPaise: P(9850), hotelGstPaise: 49250, foodGstPaise: 0, grandTotalPaise: 1034250, advancePaise: 0, payablePaise: 1034250 } },
      charges: [ch('c-17', 'laundry', 'Laundry', addDays(t, -6), 1, 250)] }),
    stay(19, '303', 'Manoj Kumar Pandey', { inDays: -4, outDays: -2, reservationId: 'res-123', mobile: '70161 38842', address: '18, Ashok Vihar Colony', city: 'Varanasi', idProofNumber: '3920', status: 'checkedOut', checkOutAt: istAt(addDays(t, -2), 9, 50), ratePaise: P(7200),
      bill: { billNumber: '0409', billDate: addDays(t, -2), hotelGstPercent: 5, foodGstPercent: 5, totals: { roomPaise: P(14400), hotelExtrasPaise: 0, hotelPaise: P(14400), foodPaise: P(1710), subtotalPaise: P(16110), hotelGstPaise: P(720), foodGstPaise: 8550, grandTotalPaise: 1691550, advancePaise: P(7200), payablePaise: 971550 } },
      charges: [ch('c-18', 'food', 'Lunch', addDays(t, -3), 1, 1350), ch('c-19', 'roomService', 'Coffee and cookies', addDays(t, -3), 2, 180)] }),
    stay(20, '208', 'Alpesh Dave', { inDays: -2, outDays: -1, mobile: '90162 55438', city: 'Junagadh', idProofNumber: '7408', status: 'checkedOut', checkOutAt: istAt(addDays(t, -1), 8, 30), plan: 'EP', ratePaise: P(2800),
      bill: { billNumber: '0410', billDate: addDays(t, -1), hotelGstPercent: 5, foodGstPercent: 5, totals: { roomPaise: P(2800), hotelExtrasPaise: 0, hotelPaise: P(2800), foodPaise: 0, subtotalPaise: P(2800), hotelGstPaise: P(140), foodGstPaise: 0, grandTotalPaise: P(2940), advancePaise: 0, payablePaise: P(2940) } } }),
  ];

  return { roomTypes, companies, rooms, reservations, advances, stays, seq: 1000, billSeq: 412, receiptSeq: 153 };
}

/* ------------------------------------------------------------------ */
/* Views from rows                                                     */
/* ------------------------------------------------------------------ */

function typeName(id: string | null): string | null {
  if (!id) return null;
  return db().roomTypes.find((x) => x.id === id)?.name ?? null;
}

function companyName(id: string | null): string | null {
  if (!id) return null;
  return db().companies.find((x) => x.id === id)?.name ?? null;
}

function currentStayRow(roomId: string): StayRow | undefined {
  return db().stays.find((s) => s.roomId === roomId && s.status === 'inHouse');
}

function roomState(r: RoomRow): RoomState {
  if (currentStayRow(r.id)) return 'occupied';
  if (r.outOfOrder) return 'outOfOrder';
  if (r.hkStatus === 'dirty') return 'dirty';
  return 'vacant';
}

function toRoom(r: RoomRow): Room {
  const cur = currentStayRow(r.id);
  return {
    id: r.id,
    number: r.number,
    floor: r.floor,
    roomTypeId: r.roomTypeId,
    roomTypeName: typeName(r.roomTypeId),
    notes: r.notes,
    hkStatus: r.hkStatus,
    outOfOrder: r.outOfOrder,
    outOfOrderReason: r.outOfOrderReason,
    hasHistory: db().stays.some((s) => s.roomId === r.id),
    currentStay: cur ? { id: cur.id, guestName: cur.guestName, expectedCheckOut: cur.expectedCheckOut } : null,
    state: roomState(r),
  };
}

function sortedRooms(): RoomRow[] {
  return [...db().rooms].sort((a, b) => a.sort - b.sort || a.number.localeCompare(b.number, 'en', { numeric: true }));
}

function resNights(r: Pick<ReservationRow, 'checkIn' | 'checkOut'>): number {
  return Math.max(1, daysBetween(r.checkIn, r.checkOut));
}

function toReservation(r: ReservationRow): Reservation {
  const s = db();
  const advances: Advance[] = s.advances
    .filter((a) => a.reservationId === r.id)
    .map((a) => ({
      id: a.id, receiptNumber: a.receiptNumber, paymentDate: a.paymentDate, hotelPaise: a.hotelPaise, foodPaise: a.foodPaise,
      hotelMode: a.hotelMode, foodMode: a.foodMode, instruction: a.instruction, balancePaise: a.balancePaise, refunded: a.refunded,
    }));
  const nights = resNights(r);
  return {
    id: r.id,
    version: r.version ?? 1,
    reference: r.reference,
    guestName: r.guestName,
    mobile: r.mobile,
    email: r.email,
    companyId: r.companyId,
    companyName: companyName(r.companyId),
    roomTypeId: r.roomTypeId,
    roomTypeName: typeName(r.roomTypeId) ?? '-',
    rooms: r.rooms,
    plan: r.plan,
    ratePaise: r.ratePaise,
    adults: r.adults,
    children: r.children,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    nights,
    roomTotalPaise: nights * r.rooms * r.ratePaise,
    source: r.source,
    enquiryRef: r.enquiryRef,
    notes: r.notes,
    status: r.status,
    cancelReason: r.cancelReason,
    advances,
    advancePaidPaise: advances.reduce((n, a) => n + a.hotelPaise + a.foodPaise, 0),
    advanceBalancePaise: advances.reduce((n, a) => n + a.balancePaise, 0),
    stays: s.stays
      .filter((x) => x.reservationId === r.id)
      .map((x) => ({ id: x.id, guestName: x.guestName, roomNumber: roomNumber(x.roomId), status: x.status })),
    createdAt: r.createdAt,
  };
}

function roomNumber(roomId: string): string {
  return db().rooms.find((r) => r.id === roomId)?.number ?? '-';
}

function stayNights(s: StayRow): number {
  const end = s.checkOutAt ? istDate(s.checkOutAt) : todayIst();
  return Math.max(1, daysBetween(istDate(s.checkInAt), end));
}

/** Unused advance of the stay's reservation, taken off once: only on the first stay of it still open. */
function stayAdvance(s: StayRow): number {
  if (!s.reservationId) return 0;
  return db()
    .advances.filter((a) => a.reservationId === s.reservationId)
    .reduce((n, a) => n + a.balancePaise, 0);
}

/** The register fields a row carries ("" for the rest). */
function registerFieldsOf(src: Partial<GuestRegisterFields>): GuestRegisterFields {
  const out = { ...EMPTY_REGISTER_FIELDS };
  for (const k of Object.keys(out) as (keyof GuestRegisterFields)[]) out[k] = (src[k] ?? '').trim();
  return out;
}

function toStay(s: StayRow): Stay {
  const room = db().rooms.find((r) => r.id === s.roomId);
  const nights = stayNights(s);
  const roomChargePaise = nights * s.ratePaise;
  const hotelExtrasPaise = s.charges.filter((c) => c.side === 'hotel').reduce((n, c) => n + c.amountPaise, 0);
  const foodPaise = s.charges.filter((c) => c.side === 'food').reduce((n, c) => n + c.amountPaise, 0);
  const reservation = s.reservationId ? db().reservations.find((r) => r.id === s.reservationId) : undefined;
  return {
    id: s.id,
    version: s.version ?? 1,
    reservationId: s.reservationId,
    reservationRef: reservation?.reference ?? null,
    roomId: s.roomId,
    roomNumber: room?.number ?? '-',
    roomTypeId: room?.roomTypeId ?? null,
    roomTypeName: typeName(room?.roomTypeId ?? null),
    grNumber: s.grNumber,
    guestName: s.guestName,
    mobile: s.mobile,
    email: s.email,
    address: s.address,
    city: s.city,
    nationality: s.nationality,
    idProofType: s.idProofType,
    idProofNumber: s.idProofNumber,
    companyId: s.companyId,
    companyName: companyName(s.companyId),
    guestGstin: s.guestGstin,
    adults: s.adults,
    children: s.children,
    plan: s.plan,
    ratePaise: s.ratePaise,
    checkInAt: s.checkInAt,
    checkInDate: istDate(s.checkInAt),
    expectedCheckOut: s.expectedCheckOut,
    checkOutAt: s.checkOutAt,
    status: s.status,
    notes: s.notes,
    ...EMPTY_REGISTER_FIELDS,
    ...registerFieldsOf(s),
    members: (s.members ?? []).map((m) => ({ ...m })),
    hasIdPhoto: s.hasIdPhoto ?? false,
    charges: [...s.charges].sort((a, b) => a.chargeDate.localeCompare(b.chargeDate)),
    nights,
    roomChargePaise,
    hotelExtrasPaise,
    foodPaise,
    totalSoFarPaise: roomChargePaise + hotelExtrasPaise + foodPaise,
    advancePaise: s.status === 'inHouse' ? stayAdvance(s) : s.bill?.totals.advancePaise ?? 0,
    bill: s.bill,
  };
}

/** Free rooms to give: the category first, clean before dirty, then by order. */
function roomsToGive(roomTypeId: string | null, exceptRoomId?: string): Room[] {
  return sortedRooms()
    .filter((r) => !r.outOfOrder && !currentStayRow(r.id) && r.id !== exceptRoomId)
    .sort((a, b) => {
      const ta = a.roomTypeId === roomTypeId ? 0 : 1;
      const tb = b.roomTypeId === roomTypeId ? 0 : 1;
      if (ta !== tb) return ta - tb;
      const ca = a.hkStatus === 'clean' ? 0 : 1;
      const cb = b.hkStatus === 'clean' ? 0 : 1;
      return ca - cb || a.sort - b.sort;
    })
    .map(toRoom);
}

/** Rooms of a category free on every night of the dates, after holding reservations. */
function freeFor(roomTypeId: string, checkIn: string, checkOut: string, ignoreId?: string): number {
  const s = db();
  const inService = s.rooms.filter((r) => r.roomTypeId === roomTypeId && !r.outOfOrder).length;
  let maxHeld = 0;
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
    const held = s.reservations
      .filter((r) => r.id !== ignoreId && r.roomTypeId === roomTypeId && (r.status === 'confirmed' || r.status === 'checkedIn') && r.checkIn <= d && r.checkOut > d)
      .reduce((n, r) => n + r.rooms, 0);
    // Walk-ins in this category also hold a room that night.
    const walkIns = s.stays.filter((st) => st.status === 'inHouse' && !st.reservationId && s.rooms.find((r) => r.id === st.roomId)?.roomTypeId === roomTypeId && istDate(st.checkInAt) <= d && st.expectedCheckOut > d).length;
    maxHeld = Math.max(maxHeld, held + walkIns);
  }
  return Math.max(0, inService - maxHeld);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

type Fields = Record<string, string>;
const req = frontOfficeCopy.common.required;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRoom(input: RoomInput, ignoreId?: string): Fields {
  const f: Fields = {};
  const number = input.number.trim();
  if (!number) f.number = req;
  else if (number.length > 20) f.number = 'Use 20 characters or fewer.';
  else if (db().rooms.some((r) => r.number.toLowerCase() === number.toLowerCase() && r.id !== ignoreId)) f.number = 'There is already a room with that number.';
  if (input.floor.trim().length > 20) f.floor = 'Use 20 characters or fewer.';
  if (input.notes.length > 255) f.notes = 'Use 255 characters or fewer.';
  return f;
}

function validateReservation(input: ReservationInput): Fields {
  const f: Fields = {};
  if (!input.guestName.trim()) f.guestName = req;
  if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) f.email = frontOfficeCopy.common.invalidEmail;
  if (!isPlainDate(input.checkIn)) f.checkIn = frontOfficeCopy.common.invalidDate;
  if (!isPlainDate(input.checkOut)) f.checkOut = frontOfficeCopy.common.invalidDate;
  else if (isPlainDate(input.checkIn) && input.checkOut <= input.checkIn) f.checkOut = 'Check-out must be after check-in.';
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 99) f.adults = 'Enter 1 to 99.';
  if (!Number.isInteger(input.children) || input.children < 0 || input.children > 99) f.children = 'Enter 0 to 99.';
  if (!input.roomTypeId) f.roomTypeId = 'Choose a room category.';
  if (!Number.isInteger(input.rooms) || input.rooms < 1 || input.rooms > 50) f.rooms = 'Enter 1 to 50.';
  if (input.ratePaise !== null && input.ratePaise < 0) f.ratePaise = 'The rate cannot be negative.';
  return f;
}

function noRoom(input: ReservationInput, ignoreId?: string): string | null {
  const free = freeFor(input.roomTypeId, input.checkIn, input.checkOut, ignoreId);
  if (free >= input.rooms) return null;
  const name = typeName(input.roomTypeId) ?? 'that category';
  return free === 0
    ? `No ${name} room is free for every night of those dates.`
    : `Only ${free} ${name} ${free === 1 ? 'room is' : 'rooms are'} free for every night of those dates.`;
}

/** Today's front desk figures from the rows the room board reads, so the Overview mock (overview.mock.ts) shows the same counts. */
export function mockFrontDeskToday(): { arrivals: number; departures: number; inHouse: number; roomsToClean: number; roomsReady: number } {
  const t = todayIst();
  const rooms = sortedRooms().map(toRoom);
  return {
    arrivals: db().reservations.filter((r) => r.status === 'confirmed' && r.checkIn <= t).length,
    departures: db().stays.filter((s) => s.status === 'inHouse' && s.expectedCheckOut <= t).length,
    inHouse: db().stays.filter((s) => s.status === 'inHouse').length,
    roomsToClean: rooms.filter((r) => r.state === 'dirty').length,
    roomsReady: rooms.filter((r) => r.state === 'vacant').length,
  };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export function createFrontOfficeApi(clock?: MockClock) {
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  /** The mock's ID images per stay: made-up ids only (a stay that has a main photo starts with one). */
  const photoIds = (s: { id: string; hasIdPhoto?: boolean; version?: number }): string[] => {
    let ids = mockPhotos.get(s.id);
    if (!ids) {
      ids = s.hasIdPhoto ? [`id-${'0'.repeat(23)}1.jpg`] : [];
      mockPhotos.set(s.id, ids);
    }
    return ids;
  };
  const photoList = (s: { id: string; hasIdPhoto?: boolean; version?: number }): IdPhotoList => ({ version: s.version ?? 1, photos: photoIds(s).map((id) => ({ id })), storeMax: 12 });

  const findRoom = (id: string) => db().rooms.find((r) => r.id === id);
  const findRes = (id: string) => db().reservations.find((r) => r.id === id);
  const findStay = (id: string) => db().stays.find((s) => s.id === id);

  /** "Someone else changed this" (MJ #14): a stale version gets CONFLICT with details.currentVersion. */
  const stale = (row: { version?: number }, version?: number) =>
    version !== undefined && version !== (row.version ?? 1)
      ? mockError('CONFLICT', undefined, { currentVersion: row.version ?? 1 })
      : null;
  const bump = (row: { version?: number }) => {
    row.version = (row.version ?? 1) + 1;
  };

  // G2: guest requests, kept for this page only (not in the tab store); two waiting, one closed
  const requests: GuestRequestRow[] = (() => {
    const [s1, s2] = db().stays;
    const row = (id: string, s: StayRow | undefined, kind: GuestRequestRow['kind'], note: string | null, minutesAgo: number, closed?: { status: 'done' | 'declined'; reply: string | null; by: string }): GuestRequestRow => ({
      id, kind, note, status: closed?.status ?? 'open', reply: closed?.reply ?? null, at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), doneAt: closed ? new Date(Date.now() - (minutesAgo - 5) * 60_000).toISOString() : null,
      stayId: s?.id ?? 'stay-x', roomNumber: s ? (findRoom(s.roomId)?.number ?? '') : '', guestName: s?.guestName ?? 'Guest', doneBy: closed?.by ?? null,
    });
    return [row('gr-1', s1, 'towels', null, 22), row('gr-2', s2, 'late_checkout', 'Flight is at 6 pm, could we keep the room till 2?', 48), row('gr-3', s1, 'water', null, 180, { status: 'done', reply: 'Sent up', by: 'Pooja Desai' })];
  })();

  return {
    /** G2: the guests' requests (waiting oldest first, closed newest first) and closing one. */
    listRequests: (q: { tab?: string; page?: number; pageSize?: number } = {}) =>
      call<{ page: Page<GuestRequestRow>; counts: { open: number } }>(() => {
        const open = q.tab !== 'closed';
        const rows = requests.filter((r) => (r.status === 'open') === open).sort((a, b) => (open ? a.at.localeCompare(b.at) : (b.doneAt ?? '').localeCompare(a.doneAt ?? '')));
        const pageSize = q.pageSize ?? 25;
        const page = q.page ?? 1;
        return ok({ page: { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }, counts: { open: requests.filter((r) => r.status === 'open').length } });
      }),
    closeRequest: (id: string, body: { status: 'done' | 'declined'; reply: string }) =>
      call<GuestRequestRow>(() => {
        const r = requests.find((x) => x.id === id);
        if (!r) return mockError('NOT_FOUND');
        if (r.status !== 'open') return mockError('CONFLICT', undefined, { message: 'This request is already closed.' });
        Object.assign(r, { status: body.status, reply: body.reply.trim() || null, doneAt: new Date().toISOString(), doneBy: 'Mihir' });
        return ok({ ...r });
      }),

    /** Lists for forms (room categories, companies, ID types, payment modes). */
    getOptions: () =>
      call<FrontOfficeOptions>(() =>
        ok({ roomTypes: db().roomTypes, companies: db().companies, idTypes: idProofTypes, paymentModes }),
      ),

    /* ---- Board ---- */
    getBoard: () =>
      call<Board>(() => {
        const t = todayIst();
        const rooms = sortedRooms().map(toRoom);
        const floors: Board['floors'] = [];
        for (const r of rooms) {
          const key = r.floor || 'Rooms';
          const f = floors.find((x) => x.floor === key);
          if (f) f.rooms.push(r);
          else floors.push({ floor: key, rooms: [r] });
        }
        const count = (st: RoomState) => rooms.filter((r) => r.state === st).length;
        const inService = rooms.filter((r) => !r.outOfOrder).length;
        const occupied = count('occupied');
        return ok({
          floors,
          stats: {
            rooms: rooms.length,
            occupied,
            vacant: count('vacant'),
            dirty: count('dirty'),
            outOfOrder: count('outOfOrder'),
            occupancy: inService ? Math.round((occupied * 100) / inService) : 0,
          },
          arrivals: db()
            .reservations.filter((r) => r.status === 'confirmed' && r.checkIn <= t)
            .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.guestName.localeCompare(b.guestName))
            .map(toReservation),
          departures: db()
            .stays.filter((s) => s.status === 'inHouse' && s.expectedCheckOut <= t)
            .sort((a, b) => a.expectedCheckOut.localeCompare(b.expectedCheckOut))
            .map(toStay),
          inHouse: db().stays.filter((s) => s.status === 'inHouse').length,
        });
      }),

    /* ---- Rooms ---- */
    listRooms: (q: ListQuery = {}) =>
      call<RoomList>(() => {
        const all = sortedRooms().map(toRoom);
        const tab = (q.tab ?? 'all') as RoomFilter;
        const counts: Record<RoomFilter, number> = { all: all.length, vacant: 0, occupied: 0, dirty: 0, outOfOrder: 0 };
        for (const r of all) counts[r.state] += 1;
        const rows = tab === 'all' ? all : all.filter((r) => r.state === tab);
        const page = pageOf(rows, { pageSize: 100, ...q }, (r, s) =>
          [r.number, r.floor ?? '', r.roomTypeName ?? '', r.currentStay?.guestName ?? '', r.notes].some((x) => x.toLowerCase().includes(s)),
        );
        return ok({ ...page, counts });
      }),

    createRoom: (input: RoomInput) =>
      call<Room>(() => {
        const f = validateRoom(input);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const s = db();
        const row: RoomRow = {
          id: nextId('rm'),
          number: input.number.trim(),
          floor: input.floor.trim() || null,
          roomTypeId: input.roomTypeId || null,
          notes: input.notes.trim(),
          hkStatus: 'clean',
          outOfOrder: false,
          outOfOrderReason: null,
          sort: Math.max(0, ...s.rooms.map((r) => r.sort)) + 1,
        };
        s.rooms.push(row);
        return ok(toRoom(row));
      }),

    bulkAddRooms: (input: BulkRoomsInput) =>
      call<BulkRoomsResult>(() => {
        if (!input.numbers.trim()) return mockError('VALIDATION_FAILED', { numbers: req });
        if (input.numbers.length > 500) return mockError('VALIDATION_FAILED', { numbers: 'Use 500 characters or fewer.' });
        const s = db();
        const numbers = parseRoomNumbers(input.numbers);
        const skipped = numbers.filter((n) => s.rooms.some((r) => r.number === n));
        let sort = Math.max(0, ...s.rooms.map((r) => r.sort));
        let added = 0;
        for (const n of numbers) {
          if (skipped.includes(n)) continue;
          sort += 1;
          added += 1;
          s.rooms.push({ id: nextId('rm'), number: n, floor: input.floor.trim() || null, roomTypeId: input.roomTypeId || null, notes: '', hkStatus: 'clean', outOfOrder: false, outOfOrderReason: null, sort });
        }
        if (!added) return mockError('VALIDATION_FAILED', { numbers: 'Those rooms are all already there.' });
        return ok({ added, skipped });
      }),

    updateRoom: (id: string, input: RoomInput) =>
      call<Room>(() => {
        const row = findRoom(id);
        if (!row) return mockError('NOT_FOUND');
        const f = validateRoom(input, id);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        row.number = input.number.trim();
        row.floor = input.floor.trim() || null;
        row.roomTypeId = input.roomTypeId || null;
        row.notes = input.notes.trim();
        return ok(toRoom(row));
      }),

    deleteRoom: (id: string) =>
      call<{ number: string }>(() => {
        const s = db();
        const row = findRoom(id);
        if (!row) return mockError('NOT_FOUND');
        if (s.stays.some((x) => x.roomId === id)) {
          return mockError('VALIDATION_FAILED', { room: `Room ${row.number} has guests on record. Mark it out of order instead.` });
        }
        s.rooms = s.rooms.filter((r) => r.id !== id);
        return ok({ number: row.number });
      }),

    /**
     * Housekeeping: SET the status (request 2: two clerks toggling at once would cancel each other out).
     * Server: PUT /rooms/{id}/housekeeping { hkStatus }.
     */
    setHousekeeping: (id: string, hkStatus: HkStatus) =>
      call<Room>(() => {
        const row = findRoom(id);
        if (!row) return mockError('NOT_FOUND');
        row.hkStatus = hkStatus;
        return ok(toRoom(row));
      }),

    /** SET out of order (with a reason) or back in service. Server: PUT /rooms/{id}/service { outOfOrder, reason }. */
    setService: (id: string, outOfOrder: boolean, reason = '') =>
      call<Room>(() => {
        const row = findRoom(id);
        if (!row) return mockError('NOT_FOUND');
        if (outOfOrder && currentStayRow(id)) {
          return mockError('VALIDATION_FAILED', { room: `Room ${row.number} has a guest in it. Check them out or move them first.` });
        }
        row.outOfOrder = outOfOrder;
        row.outOfOrderReason = outOfOrder ? reason.trim().slice(0, 255) || null : null;
        return ok(toRoom(row));
      }),

    /* ---- Reservations ---- */
    listReservations: (q: ListQuery = {}) =>
      call<ReservationPage>(() => {
        const t = todayIst();
        const all = db().reservations;
        const pick: Record<ReservationView, (r: ReservationRow) => boolean> = {
          upcoming: (r) => r.status === 'confirmed',
          today: (r) => r.status === 'confirmed' && r.checkIn <= t,
          inHouse: (r) => r.status === 'checkedIn',
          past: (r) => r.status === 'checkedOut',
          cancelled: (r) => r.status === 'cancelled' || r.status === 'noShow',
          all: () => true,
        };
        const view = (reservationViews.some((v) => v.id === q.tab) ? q.tab : 'upcoming') as ReservationView;
        const counts = Object.fromEntries(reservationViews.map((v) => [v.id, all.filter(pick[v.id]).length])) as Record<ReservationView, number>;
        const order: Record<ReservationView, (a: ReservationRow, b: ReservationRow) => number> = {
          upcoming: (a, b) => a.checkIn.localeCompare(b.checkIn),
          today: (a, b) => a.checkIn.localeCompare(b.checkIn),
          inHouse: (a, b) => a.checkOut.localeCompare(b.checkOut),
          past: (a, b) => b.checkOut.localeCompare(a.checkOut),
          cancelled: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
          all: (a, b) => b.checkIn.localeCompare(a.checkIn),
        };
        // Pallav: the view's own order, then the newest registration first (orderByDesc('id')).
        const num = (r: ReservationRow) => Number(r.id.replace(/\D/g, '')) || 0;
        const rows = all.filter(pick[view]).sort((a, b) => order[view](a, b) || num(b) - num(a)).map(toReservation);
        const page = pageOf(rows, { pageSize: 10, ...q }, (r, s) =>
          [r.guestName, r.mobile, r.reference].some((x) => x.toLowerCase().includes(s)),
        );
        return ok({ ...page, counts });
      }),

    getReservation: (id: string) =>
      call<Reservation>(() => {
        const r = findRes(id);
        return r ? ok(toReservation(r)) : mockError('NOT_FOUND');
      }),

    createReservation: (input: ReservationInput) =>
      call<Reservation>(() => {
        const f = validateReservation(input);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const why = noRoom(input);
        if (why) return mockError('VALIDATION_FAILED', { roomTypeId: why });
        const s = db();
        const n = s.reservations.length + (s.firstReservationNo ?? 101);
        const now = nowIso();
        const row: ReservationRow = {
          id: nextId('res'),
          reference: `RES-${todayIst().slice(2, 4)}-${String(n).padStart(5, '0')}`,
          guestName: input.guestName.trim(),
          mobile: input.mobile.trim(),
          email: input.email.trim(),
          companyId: input.companyId || null,
          roomTypeId: input.roomTypeId,
          rooms: input.rooms,
          plan: input.plan,
          ratePaise: input.ratePaise ?? 0,
          adults: input.adults,
          children: input.children,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          source: input.source,
          enquiryRef: null,
          notes: input.notes.trim(),
          status: 'confirmed',
          cancelReason: null,
          createdAt: now,
          updatedAt: now,
        };
        s.reservations.push(row);
        return ok(toReservation(row));
      }),

    updateReservation: (id: string, input: ReservationInput) =>
      call<Reservation>(() => {
        const row = findRes(id);
        if (!row) return mockError('NOT_FOUND');
        const old = stale(row, input.version);
        if (old) return old;
        if (row.status !== 'confirmed' && row.status !== 'checkedIn') {
          return mockError('VALIDATION_FAILED', { form: frontOfficeCopy.reservation.locked });
        }
        const f = validateReservation(input);
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const why = noRoom(input, id);
        if (why) return mockError('VALIDATION_FAILED', { roomTypeId: why });
        Object.assign(row, {
          guestName: input.guestName.trim(),
          mobile: input.mobile.trim(),
          email: input.email.trim(),
          companyId: input.companyId || null,
          roomTypeId: input.roomTypeId,
          rooms: input.rooms,
          plan: input.plan,
          ratePaise: input.ratePaise ?? 0,
          adults: input.adults,
          children: input.children,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          source: input.source,
          notes: input.notes.trim(),
          updatedAt: nowIso(),
        });
        bump(row);
        return ok(toReservation(row));
      }),

    /**
     * Cancel with a reason, or mark a no-show. The rooms are free again. Returns the reservation and
     * Pallav's notice about an advance still held (request 4). Send the version the user saw.
     */
    cancelReservation: (id: string, input: { noShow: boolean; reason: string; version?: number }) =>
      call<CancelResult>(() => {
        const row = findRes(id);
        if (!row) return mockError('NOT_FOUND');
        const old = stale(row, input.version);
        if (old) return old;
        if (row.status !== 'confirmed') return mockError('VALIDATION_FAILED', { reason: 'Only a reservation not yet checked in can be cancelled.' });
        const reason = input.reason.trim();
        if (!input.noShow && !reason) return mockError('VALIDATION_FAILED', { reason: 'Please give a reason for cancelling.' });
        row.status = input.noShow ? 'noShow' : 'cancelled';
        row.cancelReason = (reason || 'Did not arrive').slice(0, 255);
        row.updatedAt = nowIso();
        bump(row);
        const held = db().advances.filter((a) => a.reservationId === row.id).reduce((n, a) => n + a.balancePaise, 0);
        const notice = held > 0 ? 'An advance is still held for this reservation. Refund it or keep it for a later stay in Guest Advances.' : null;
        return ok({ reservation: toReservation(row), notice });
      }),

    /** Check-out form defaults: the hotel's GST default (the room slab of the stay named) and the next bill number (request 3 and 5). */
    getCheckoutDefaults: (stayId?: string) =>
      call<CheckoutDefaults>(() => {
        const stay = stayId ? findStay(stayId) : undefined;
        if (stayId && !stay) return mockError('NOT_FOUND');
        return ok({ hotelGstPercent: stay ? gstSlabPercent(stay.ratePaise) : defaultGstPercent, foodGstPercent: defaultGstPercent, suggestedBillNumber: String(db().billSeq).padStart(4, '0') });
      }),

    /** The next free receipt number, to fill the advance form. Server: GET /reservations/receipt-number. */
    suggestReceiptNumber: () => call<string>(() => ok(String(db().receiptSeq).padStart(4, '0'))),

    addAdvance: (reservationId: string, input: AdvanceInput) =>
      call<Reservation>(() => {
        const s = db();
        const row = findRes(reservationId);
        if (!row) return mockError('NOT_FOUND');
        const f: Fields = {};
        const receipt = input.receiptNumber.trim();
        if (!receipt) f.receiptNumber = req;
        else if (s.advances.some((a) => a.receiptNumber === receipt)) f.receiptNumber = 'That receipt number is already used.';
        if (!isPlainDate(input.paymentDate)) f.paymentDate = frontOfficeCopy.common.invalidDate;
        const hotel = input.hotelPaise ?? 0;
        const food = input.foodPaise ?? 0;
        if (hotel < 0) f.hotelPaise = 'Cannot be negative.';
        if (food < 0) f.foodPaise = 'Cannot be negative.';
        if (hotel + food <= 0) f.hotelPaise = frontOfficeCopy.reservation.advanceForm.needAmount;
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        s.advances.push({
          id: nextId('adv'),
          reservationId,
          receiptNumber: receipt,
          paymentDate: input.paymentDate,
          hotelPaise: hotel,
          foodPaise: food,
          hotelMode: hotel ? input.hotelMode : '',
          foodMode: food ? input.foodMode : '',
          instruction: input.instruction.trim(),
          balancePaise: hotel + food,
          refunded: false,
        });
        if (/^\d+$/.test(receipt)) s.receiptSeq = Math.max(s.receiptSeq, Number(receipt) + 1);
        return ok(toReservation(row));
      }),

    /* ---- Stays ---- */
    listStays: (q: ListQuery = {}) =>
      call<StayPage>(() => {
        const view: StayView = q.tab === 'past' ? 'past' : 'inHouse';
        const all = db().stays;
        const counts: Record<StayView, number> = {
          inHouse: all.filter((s) => s.status === 'inHouse').length,
          past: all.filter((s) => s.status === 'checkedOut').length,
        };
        const rows = all
          .filter((s) => s.status === (view === 'past' ? 'checkedOut' : 'inHouse'))
          .sort((a, b) => (view === 'past' ? (b.checkOutAt ?? '').localeCompare(a.checkOutAt ?? '') : a.expectedCheckOut.localeCompare(b.expectedCheckOut)))
          .map(toStay);
        const page = pageOf(rows, { pageSize: 10, ...q }, (s, x) =>
          [s.guestName, s.mobile, s.grNumber, s.roomNumber].some((v) => v.toLowerCase().includes(x)),
        );
        return ok({ ...page, counts });
      }),

    getStay: (id: string) =>
      call<Stay>(() => {
        const s = findStay(id);
        return s ? ok(toStay(s)) : mockError('NOT_FOUND');
      }),

    /** Free rooms to move the guest into. */
    roomsToMove: (stayId: string) =>
      call<Room[]>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const typeId = findRoom(s.roomId)?.roomTypeId ?? null;
        return ok(roomsToGive(typeId, s.roomId));
      }),

    /** Next free bill number, to fill the check-out form. */
    suggestBillNumber: () => call<string>(() => ok(String(db().billSeq).padStart(4, '0'))),

    /** What the check-in form needs: the reservation (if any) and the rooms to give. */
    getCheckInPrefill: (reservationId?: string) =>
      call<CheckInPrefill>(() => {
        const row = reservationId ? findRes(reservationId) : undefined;
        if (reservationId && !row) return mockError('NOT_FOUND');
        if (row && row.status !== 'confirmed' && row.status !== 'checkedIn') {
          return mockError('VALIDATION_FAILED', { reservationId: 'This reservation cannot be checked in.' });
        }
        return ok({
          reservation: row ? toReservation(row) : null,
          alreadyIn: row ? db().stays.filter((s) => s.reservationId === row.id && s.status === 'inHouse').length : 0,
          rooms: roomsToGive(row?.roomTypeId ?? null),
          suggestedGrNumber: String(db().stays.reduce((n, s) => Math.max(n, /^\d+$/.test(s.grNumber) ? Number(s.grNumber) : 0), 0) + 1),
        });
      }),

    /** A past guest of this hotel by mobile: stays first (newest first, one row per guest name), then bookings never stayed; at most 5. */
    lookupGuest: (mobile: string, _signal?: AbortSignal) =>
      call<GuestLookupResult>(() => {
        const digits = mobile.replace(/\D/g, '').slice(-10);
        if (digits.length < 10) return ok({ matches: [] });
        const ends = (m: string) => m.replace(/\D/g, '').endsWith(digits);
        const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
        const stays = db().stays.filter((s) => ends(s.mobile)).sort((a, b) => b.checkInAt.localeCompare(a.checkInAt));
        const matches: GuestLookupMatch[] = [];
        for (const s of stays) {
          if (matches.length >= 5) break;
          if (matches.some((m) => same(m.guestName, s.guestName))) continue;
          const mine = stays.filter((x) => same(x.guestName, s.guestName));
          const last = mine.find((x) => x.checkOutAt);
          matches.push({
            guestName: s.guestName, mobile: s.mobile, email: s.email, address: s.address, city: s.city, nationality: s.nationality,
            idProofType: s.idProofType, idProofNumber: s.idProofNumber, dateOfBirth: s.dateOfBirth ?? '', stays: mine.length,
            lastRoomNumber: roomNumber(s.roomId), lastCheckOut: last?.checkOutAt ? istDate(last.checkOutAt) : null, companyId: s.companyId,
          });
        }
        const booked = db().reservations.filter((r) => ends(r.mobile)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        for (const r of booked) {
          if (matches.length >= 5) break;
          if (matches.some((m) => same(m.guestName, r.guestName))) continue;
          matches.push({ guestName: r.guestName, mobile: r.mobile, email: r.email, address: '', city: '', nationality: '', idProofType: '', idProofNumber: '', dateOfBirth: '', stays: 0, lastRoomNumber: null, lastCheckOut: null, companyId: r.companyId });
        }
        return ok({ matches });
      }),

    /** Confirmed reservations that can be checked in (for the reservation picker). */
    listCheckInReservations: () =>
      call<Reservation[]>(() =>
        ok(
          db()
            .reservations.filter((r) => r.status === 'confirmed' || (r.status === 'checkedIn' && db().stays.filter((s) => s.reservationId === r.id && s.status === 'inHouse').length < r.rooms))
            .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
            .map(toReservation),
        ),
      ),

    checkIn: (input: CheckInInput) =>
      call<Stay>(() => {
        const s = db();
        const t = todayIst();
        const f: Fields = {};
        const room = findRoom(input.roomId);
        if (!input.roomId || !room) f.roomId = req;
        if (!isPlainDate(input.expectedCheckOut)) f.expectedCheckOut = frontOfficeCopy.common.invalidDate;
        else if (input.expectedCheckOut <= t) f.expectedCheckOut = 'The check-out date must be after today.';
        if (!input.guestName.trim()) f.guestName = req;
        if (!input.mobile.trim()) f.mobile = req;
        if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) f.email = frontOfficeCopy.common.invalidEmail;
        if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 20) f.adults = 'Enter 1 to 20.';
        if (!Number.isInteger(input.children) || input.children < 0 || input.children > 20) f.children = 'Enter 0 to 20.';
        if (input.ratePaise === null) f.ratePaise = req;
        else if (input.ratePaise < 0) f.ratePaise = 'The rate cannot be negative.';
        if (input.guestGstin.trim() && !isGstin(input.guestGstin)) f.guestGstin = frontOfficeCopy.common.invalidGstin;
        if (input.idProofNumber.trim() && !input.idProofType) f.idProofType = 'Choose the ID type.';
        if (Object.keys(f).length || !room) return mockError('VALIDATION_FAILED', f);
        if (room.outOfOrder || currentStayRow(room.id)) {
          return mockError('VALIDATION_FAILED', { roomId: `Room ${room.number} is not free. Choose another.` });
        }
        const reservation = input.reservationId ? findRes(input.reservationId) : undefined;
        const row: StayRow = {
          id: nextId('st'),
          reservationId: reservation?.id ?? null,
          roomId: room.id,
          grNumber: input.grNumber.trim(),
          guestName: input.guestName.trim(),
          mobile: input.mobile.trim(),
          email: input.email.trim(),
          address: input.address.trim(),
          city: input.city.trim(),
          nationality: input.nationality.trim(),
          idProofType: input.idProofType,
          idProofNumber: input.idProofNumber.trim(),
          companyId: input.companyId || null,
          guestGstin: input.guestGstin.trim().toUpperCase(),
          adults: input.adults,
          children: input.children,
          plan: input.plan.trim(),
          ratePaise: input.ratePaise ?? 0,
          checkInAt: nowIso(),
          expectedCheckOut: input.expectedCheckOut,
          checkOutAt: null,
          status: 'inHouse',
          notes: input.notes.trim(),
          charges: [],
          bill: null,
          ...registerFieldsOf(input),
          members: (input.members ?? []).filter((m) => m.fullName.trim()).map((m) => ({ fullName: m.fullName.trim(), mobile: m.mobile.trim(), idType: m.idType, idNumber: m.idNumber.trim() })),
        };
        s.stays.push(row);
        // Checked in once all its rooms have someone in them.
        if (reservation && s.stays.filter((x) => x.reservationId === reservation.id && x.status === 'inHouse').length >= reservation.rooms) {
          reservation.status = 'checkedIn';
          reservation.updatedAt = nowIso();
        }
        return ok(toStay(row));
      }),

    addCharge: (stayId: string, input: ChargeInput) =>
      call<Stay>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        if (s.status !== 'inHouse') return mockError('VALIDATION_FAILED', { form: 'This guest has checked out; their bill is in Bills.' });
        const f: Fields = {};
        if (!input.description.trim()) f.description = req;
        if (!isPlainDate(input.chargeDate)) f.chargeDate = frontOfficeCopy.common.invalidDate;
        if (!(input.quantity >= 0.01 && input.quantity <= 9999)) f.quantity = 'Enter 0.01 to 9999.';
        else if (Math.round(input.quantity * 100) !== input.quantity * 100) f.quantity = 'Use at most 2 decimal places.';
        if (input.unitPricePaise === null) f.unitPricePaise = req;
        else if (input.unitPricePaise < 0) f.unitPricePaise = 'Cannot be negative.';
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const unit = input.unitPricePaise ?? 0;
        s.charges.push({
          id: nextId('c'),
          category: input.category,
          side: chargeCategories[input.category].side,
          description: input.description.trim(),
          chargeDate: input.chargeDate,
          quantity: Math.round(input.quantity * 100) / 100,
          unitPricePaise: unit,
          amountPaise: Math.round(input.quantity * unit),
        });
        return ok(toStay(s));
      }),

    removeCharge: (stayId: string, chargeId: string) =>
      call<Stay>(() => {
        const s = findStay(stayId);
        if (!s || !s.charges.some((c) => c.id === chargeId)) return mockError('NOT_FOUND');
        if (s.status !== 'inHouse') return mockError('VALIDATION_FAILED', { form: 'This guest has checked out; their bill is in Bills.' });
        s.charges = s.charges.filter((c) => c.id !== chargeId);
        return ok(toStay(s));
      }),

    /** Move to another free room; the one left needs cleaning. Rate null keeps it. */
    moveRoom: (stayId: string, input: { roomId: string; ratePaise: number | null; version?: number }) =>
      call<Stay>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, input.version);
        if (old) return old;
        const to = findRoom(input.roomId);
        if (!to) return mockError('VALIDATION_FAILED', { roomId: req });
        if (s.status !== 'inHouse' || to.outOfOrder || currentStayRow(to.id)) {
          return mockError('VALIDATION_FAILED', { roomId: `Room ${to.number} is not free.` });
        }
        if (input.ratePaise !== null && input.ratePaise < 0) return mockError('VALIDATION_FAILED', { ratePaise: 'Cannot be negative.' });
        const from = findRoom(s.roomId);
        s.roomId = to.id;
        if (input.ratePaise !== null) s.ratePaise = input.ratePaise;
        if (from) from.hkStatus = 'dirty';
        bump(s);
        return ok(toStay(s));
      }),

    /** Stay longer or leave earlier. Send the version the user saw. */
    extendStay: (stayId: string, expectedCheckOut: string, version?: number) =>
      call<Stay>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, version);
        if (old) return old;
        if (s.status !== 'inHouse') return mockError('VALIDATION_FAILED', { expectedCheckOut: 'This guest has already checked out.' });
        if (!isPlainDate(expectedCheckOut)) return mockError('VALIDATION_FAILED', { expectedCheckOut: frontOfficeCopy.common.invalidDate });
        if (expectedCheckOut <= istDate(s.checkInAt)) return mockError('VALIDATION_FAILED', { expectedCheckOut: 'Must be after the arrival date.' });
        s.expectedCheckOut = expectedCheckOut;
        const r = s.reservationId ? findRes(s.reservationId) : undefined;
        if (r) r.checkOut = expectedCheckOut;
        bump(s);
        return ok(toStay(s));
      }),

    /** Store (or replace) the main guest's ID photo. The mock keeps only the fact that there is one. */
    /** Demo reading (dev and demo builds only; never a real guest): a file name with "blur" or "unclear" is rejected, any other gives the next demo guest. */
    readId: async (files: { fileName: string; dataBase64: string } | { fileName: string; dataBase64: string }[], _signal?: AbortSignal): Promise<DashResult<IdReading>> => {
      await new Promise((r) => setTimeout(r, 1800));
      return call<IdReading>(() => {
        const list = Array.isArray(files) ? files : [files];
        if (list.some((f) => !/\.(jpe?g|png)$/i.test(f.fileName))) return mockError('VALIDATION_FAILED', { idPhoto: 'Pick a JPG or PNG image.' });
        if (list.every((f) => /blur|unclear/i.test(f.fileName))) return ok({ outcome: 'unclear', fields: {}, unread: [], retake: 'Retake this card: the number line is blurred. Hold the phone steady and keep the whole card in the picture.' });
        // each further picture is another demo guest, who joins the sheet as one of the others
        const clear = list.filter((f) => !/blur|unclear/i.test(f.fileName));
        const demo = DEMO_READINGS[readCount++ % DEMO_READINGS.length];
        const more = clear.slice(1).map(() => DEMO_READINGS[readCount++ % DEMO_READINGS.length]);
        const others = [...(demo.others ?? []), ...more.map((m) => ({ fullName: m.fields.guestName ?? '', idType: m.fields.idProofType ?? '', idNumber: m.fields.idProofNumber ?? '' }))];
        return ok({ ...demo, ...(others.length ? { others } : {}) });
      });
    },

    putIdPhoto: (stayId: string, file: { fileName: string; dataBase64: string }, version?: number) =>
      call<IdPhotoResult>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, version);
        if (old) return old;
        if (!/\.(jpe?g|png)$/i.test(file.fileName)) return mockError('VALIDATION_FAILED', { idPhoto: 'Pick a JPG, PNG image.' });
        s.hasIdPhoto = true;
        bump(s);
        return ok({ version: s.version ?? 1, hasIdPhoto: true });
      }),

    deleteIdPhoto: (stayId: string, version?: number) =>
      call<IdPhotoResult>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, version);
        if (old) return old;
        s.hasIdPhoto = false;
        bump(s);
        return ok({ version: s.version ?? 1, hasIdPhoto: false });
      }),

    /** All of the stay's ID images (the mock keeps only made-up ids, no pictures): the first is the main one. */
    listIdPhotos: (stayId: string) =>
      call<IdPhotoList>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        return ok(photoList(s));
      }),

    addIdPhoto: (stayId: string, file: { fileName: string; dataBase64: string }, version?: number) =>
      call<IdPhotoList>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, version);
        if (old) return old;
        if (!/\.(jpe?g|png)$/i.test(file.fileName)) return mockError('VALIDATION_FAILED', { idPhoto: 'Pick a JPG, PNG image.' });
        const ids = photoIds(s);
        if (ids.length >= 12) return mockError('VALIDATION_FAILED', { idPhoto: 'At most 12 ID images per stay.' });
        ids.push(`id-${String(Date.now() + ids.length).padStart(24, '0')}.jpg`);
        s.hasIdPhoto = true;
        bump(s);
        return ok(photoList(s));
      }),

    reorderIdPhotos: (stayId: string, order: string[], version?: number) =>
      call<IdPhotoList>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, version);
        if (old) return old;
        const ids = photoIds(s);
        if (order.length !== ids.length || order.some((p) => !ids.includes(p)) || new Set(order).size !== order.length) return mockError('VALIDATION_FAILED', { order: "The order must name each of the stay's ID images once." });
        mockPhotos.set(s.id, [...order]);
        bump(s);
        return ok(photoList(s));
      }),

    removeIdPhotoAt: (stayId: string, photoId: string, version?: number) =>
      call<IdPhotoList>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, version);
        if (old) return old;
        const ids = photoIds(s);
        if (!ids.includes(photoId)) return mockError('NOT_FOUND');
        mockPhotos.set(s.id, ids.filter((p) => p !== photoId));
        s.hasIdPhoto = photoIds(s).length > 0;
        bump(s);
        return ok(photoList(s));
      }),

    /** Show (decision 74): the whole ID numbers of a stay. The mock keeps and lists them whole already, so this only echoes them back. */
    revealStayIdNumbers: (stayId: string) =>
      call<StayIdNumbers>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        if (!s.idProofNumber && !(s.members ?? []).some((m) => m.idNumber)) return mockError('CONFLICT', { idProofNumber: 'No ID number is saved for this stay.' });
        return ok({ idProofNumber: s.idProofNumber, members: (s.members ?? []).map((m) => ({ idNumber: m.idNumber })) });
      }),

    /** Fix the guest details of a stay later (replaces the whole set). Send the version the user saw. */
    updateGuestDetails: (stayId: string, input: GuestDetailsInput, version?: number) =>
      call<Stay>(() => {
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, version);
        if (old) return old;
        const f: Fields = {};
        if (input.dateOfBirth && (!isPlainDate(input.dateOfBirth) || input.dateOfBirth > todayIst())) f.dateOfBirth = 'Date of birth cannot be in the future.';
        const max = Math.min(19, Math.max(0, s.adults + s.children - 1));
        if (input.members.length > max) f.members = `At most ${max} other guests for this room.`;
        input.members.forEach((m, i) => { if (!m.fullName.trim()) f[`members.${i}.fullName`] = req; });
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) f.email = frontOfficeCopy.common.invalidEmail;
        if (input.idProofNumber.trim() && !input.idProofType) f.idProofType = 'Choose the ID type.';
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        Object.assign(s, registerFieldsOf(input));
        s.idProofType = input.idProofType;
        s.idProofNumber = input.idProofNumber.trim();
        s.email = input.email.trim();
        s.address = input.address.trim();
        s.city = input.city.trim();
        s.members = input.members.map((m) => ({ fullName: m.fullName.trim(), mobile: m.mobile.trim(), idType: m.idType, idNumber: m.idNumber.trim() }));
        bump(s);
        return ok(toStay(s));
      }),

    /** Check out into a bill: advance taken off, room left to be cleaned, stay closed. */
    checkOut: (stayId: string, input: CheckOutInput) =>
      call<Stay>(() => {
        const st = db();
        const s = findStay(stayId);
        if (!s) return mockError('NOT_FOUND');
        const old = stale(s, input.version);
        if (old) return old;
        if (s.status !== 'inHouse') return mockError('VALIDATION_FAILED', { form: 'This guest has already checked out.' });
        const f: Fields = {};
        const billNumber = input.billNumber.trim();
        if (!billNumber) f.billNumber = req;
        else if (st.stays.some((x) => x.bill?.billNumber === billNumber)) f.billNumber = 'That bill number is already used.';
        if (!isPlainDate(input.billDate)) f.billDate = frontOfficeCopy.common.invalidDate;
        if (!(input.hotelGstPercent >= 0 && input.hotelGstPercent <= 28)) f.hotelGstPercent = 'Enter 0 to 28.';
        if (!(input.foodGstPercent >= 0 && input.foodGstPercent <= 28)) f.foodGstPercent = 'Enter 0 to 28.';
        if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f);
        const totals = folioTotals(toStay(s), input.hotelGstPercent, input.foodGstPercent);
        s.checkOutAt = nowIso();
        s.status = 'checkedOut';
        s.bill = { billNumber, billDate: input.billDate, hotelGstPercent: input.hotelGstPercent, foodGstPercent: input.foodGstPercent, totals };
        // The advance is used up by this bill.
        if (s.reservationId) for (const a of st.advances) if (a.reservationId === s.reservationId) a.balancePaise = 0;
        const room = findRoom(s.roomId);
        if (room) room.hkStatus = 'dirty';
        const r = s.reservationId ? findRes(s.reservationId) : undefined;
        if (r && !st.stays.some((x) => x.reservationId === r.id && x.status === 'inHouse')) {
          r.status = 'checkedOut';
          const t = todayIst();
          if (t > r.checkIn) r.checkOut = t;
          r.updatedAt = nowIso();
        }
        if (/^\d+$/.test(billNumber)) st.billSeq = Math.max(st.billSeq, Number(billNumber) + 1);
        bump(s);
        return ok(toStay(s));
      }),
  };
}
