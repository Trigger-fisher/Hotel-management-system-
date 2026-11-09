// The in-memory mock of corporate.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock } from './common';
import { mockCall, ok, pageOf, mockError } from './common';
import { corporatePortalMock, portalBill } from './corporate.portal.mock';
import { MOCK_TODAY, addDays, billDuePaise, type BillSettlement, type BilledBy, type Business, type CompanyBill, type CompanyProfile, type CorporateApi, type PaymentReceipt } from './corporate';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const rs = (rupees: number) => Math.round(rupees * 100);
const pct = (paise: number, p: number) => Math.round((paise * p) / 100);

const BILLED_BY: BilledBy = {
  name: 'Hotel Sunrise, Rajkot',
  gstin: '24ABCDE1234F1Z5',
  // the hotel's own settings mock (billing.ts billingHotel, admin.ts general.*)
  address: '150 Feet Ring Road, Rajkot, Gujarat 360005',
  phone: '0281 245 6789',
  email: 'accounts@hotelsunrise.in',
};

function seedProfile(): CompanyProfile {
  return {
    // Same company and contact details as companies.ts co-1 (the hotel's Companies master).
    id: 'co-1',
    name: 'Tata Consultancy Services',
    gstin: '24AAACT2727Q1ZV',
    email: 'traveldesk.gnr@tcs.com',
    mobile: '9824012399',
    landline: '079 6678 1234',
    address: 'Garima Park, IT-SEZ, Gandhinagar–Sarkhej Highway',
    city: 'Gandhinagar',
    state: 'Gujarat',
    pincode: '382421',
    country: 'India',
    discountPct: 10,
    gstPct: 12,
    tcsPct: 0,
    tdsPct: 2,
    accountSince: '2024-04-01',
    mainContactName: 'Deepa Iyer',
    billedBy: BILLED_BY,
  };
}

interface BillSeed {
  no: string;
  date: string;
  guest: string;
  mobile: string | null;
  room: string;
  roomType: string;
  plan: string | null;
  nights: number;
  rate: number;
  laundry: number;
  food: number;
  hotelMode: string;
  foodMode: string | null;
  advanceHotel?: number;
  advanceReceipt?: string;
  advanceIsCompanys?: boolean;
  /** 'full' pays the rest of that side. */
  settlements?: { date: string; hotel: number | 'full'; food: number | 'full'; mode: string; reference?: string }[];
  reference?: string;
  note?: string;
}

const ON_ACCOUNT = 'On account';

const BILL_SEEDS: BillSeed[] = [
  { no: 'HS-2041', date: '2026-05-06', guest: 'Rohan Mehta', mobile: '9812345670', room: '204', roomType: 'Deluxe Room', plan: 'CP (with breakfast)', nights: 2, rate: 4500, laundry: 0, food: 1840, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Deepa Iyer', settlements: [{ date: '2026-06-02', hotel: 'full', food: 'full', mode: 'NEFT', reference: 'UTR 6153 2201 8841' }] },
  { no: 'HS-2058', date: '2026-05-19', guest: 'Kavita Nair', mobile: '9846012345', room: '112', roomType: 'Standard Room', plan: 'EP (room only)', nights: 3, rate: 3200, laundry: 450, food: 2620, hotelMode: 'UPI', foodMode: 'UPI', reference: 'Meera Joshi' },
  { no: 'HS-2077', date: '2026-06-03', guest: 'Arjun Reddy', mobile: '9849012345', room: '305', roomType: 'Deluxe Room', plan: 'MAP (breakfast and dinner)', nights: 4, rate: 4500, laundry: 600, food: 6200, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Deepa Iyer', settlements: [{ date: '2026-07-01', hotel: 'full', food: 'full', mode: 'NEFT', reference: 'UTR 6182 0417 2290' }] },
  { no: 'HS-2090', date: '2026-06-17', guest: 'Sneha Kulkarni', mobile: '9822012345', room: '208', roomType: 'Family Suite', plan: 'CP (with breakfast)', nights: 2, rate: 7200, laundry: 0, food: 3100, hotelMode: 'Card', foodMode: 'Card', reference: 'Pooja Desai' },
  { no: 'HS-2112', date: '2026-07-08', guest: 'Rohan Mehta', mobile: '9812345670', room: '204', roomType: 'Deluxe Room', plan: 'CP (with breakfast)', nights: 3, rate: 4500, laundry: 300, food: 2450, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Deepa Iyer', settlements: [{ date: '2026-08-05', hotel: 10000, food: 'full', mode: 'NEFT', reference: 'UTR 6217 3390 1102' }], note: 'Part paid: rest of the hotel side to follow.' },
  { no: 'HS-2125', date: '2026-07-22', guest: 'Imran Shaikh', mobile: '9727012340', room: '110', roomType: 'Standard Room', plan: 'EP (room only)', nights: 1, rate: 3200, laundry: 0, food: 0, hotelMode: ON_ACCOUNT, foodMode: null, reference: 'Meera Joshi', settlements: [{ date: '2026-08-20', hotel: 'full', food: 0, mode: 'Cheque', reference: 'Cheque 004512, HDFC Bank' }] },
  { no: 'HS-2140', date: '2026-08-04', guest: 'Priya Sharma', mobile: '9898012345', room: '301', roomType: 'Deluxe Room', plan: 'CP (with breakfast)', nights: 5, rate: 4500, laundry: 900, food: 7350, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, advanceHotel: 10000, advanceReceipt: 'ADV-0311', advanceIsCompanys: true, reference: 'Deepa Iyer', settlements: [{ date: '2026-09-01', hotel: 'full', food: 4000, mode: 'NEFT', reference: 'UTR 6244 8812 0034' }] },
  { no: 'HS-2156', date: '2026-08-18', guest: 'Aditya Verma', mobile: '9925012345', room: '207', roomType: 'Deluxe Room', plan: null, nights: 2, rate: 4500, laundry: 0, food: 1980, hotelMode: 'Cash', foodMode: 'Cash', advanceHotel: 5000, advanceReceipt: 'R-0877', advanceIsCompanys: false, reference: 'Rajesh Kumar Patel' },
  { no: 'HS-2171', date: '2026-08-29', guest: 'Kavita Nair', mobile: '9846012345', room: '115', roomType: 'Standard Room', plan: 'EP (room only)', nights: 2, rate: 3200, laundry: 0, food: 1450, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Meera Joshi' },
  { no: 'HS-2188', date: '2026-09-09', guest: 'Venkatesh Subramanian Iyer (Client visit, Infosys audit team)', mobile: '9444012345', room: '402', roomType: 'Family Suite', plan: 'AP (all meals)', nights: 4, rate: 7200, laundry: 1200, food: 9800, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Srinivasan Venkataraghavan Subramaniam', settlements: [{ date: '2026-09-30', hotel: 15000, food: 'full', mode: 'RTGS', reference: 'UTR 6273 1188 4521' }] },
  { no: 'HS-2195', date: '2026-09-14', guest: 'Neha Gupta', mobile: '9810012345', room: '209', roomType: 'Deluxe Room', plan: null, nights: 1, rate: 4500, laundry: 0, food: 760, hotelMode: 'UPI', foodMode: 'UPI', reference: 'Pooja Desai' },
  { no: 'HS-2203', date: '2026-09-21', guest: 'Rahul Deshmukh', mobile: '9822345678', room: '118', roomType: 'Standard Room', plan: 'CP (with breakfast)', nights: 3, rate: 3200, laundry: 350, food: 2900, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Meera Joshi' },
  { no: 'HS-2214', date: '2026-09-26', guest: 'Arjun Reddy', mobile: '9849012345', room: '305', roomType: 'Deluxe Room', plan: 'MAP (breakfast and dinner)', nights: 2, rate: 4500, laundry: 0, food: 3600, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Deepa Iyer' },
  { no: 'HS-2226', date: '2026-10-01', guest: 'Priya Sharma', mobile: '9898012345', room: '301', roomType: 'Deluxe Room', plan: 'CP (with breakfast)', nights: 3, rate: 4500, laundry: 450, food: 2240, hotelMode: ON_ACCOUNT, foodMode: ON_ACCOUNT, reference: 'Deepa Iyer' },
  { no: 'HS-2231', date: '2026-10-03', guest: 'Mohammed Faizal Khan', mobile: '9898765432', room: '210', roomType: 'Deluxe Room', plan: null, nights: 1, rate: 4500, laundry: 0, food: 0, hotelMode: 'Card', foodMode: null, reference: 'Pooja Desai' },
  { no: 'HS-2235', date: '2026-10-04', guest: 'Swapnil Kulkarni', mobile: '9822076543', room: '114', roomType: 'Standard Room', plan: 'EP (room only)', nights: 2, rate: 3200, laundry: 0, food: 1320, hotelMode: ON_ACCOUNT, foodMode: 'UPI', reference: 'Meera Joshi', note: 'Food paid by the guest at checkout.' },
];

function buildBill(s: BillSeed, discountPct: number): CompanyBill {
  const tariff = rs(s.rate * s.nights);
  const discount = pct(tariff, discountPct);
  const laundry = rs(s.laundry);
  const hotelGst = pct(tariff - discount + laundry, 12);
  const totalHotel = tariff - discount + laundry + hotelGst;
  const food = rs(s.food);
  const foodGst = pct(food, 5);
  const totalFood = food + foodGst;
  const advanceHotel = rs(s.advanceHotel ?? 0);

  let hotelLeft = s.hotelMode === ON_ACCOUNT ? totalHotel - advanceHotel : 0;
  let foodLeft = s.foodMode === ON_ACCOUNT ? totalFood : 0;
  const settlements: BillSettlement[] = (s.settlements ?? []).map((x) => {
    const h = x.hotel === 'full' ? hotelLeft : Math.min(rs(x.hotel), hotelLeft);
    const f = x.food === 'full' ? foodLeft : Math.min(rs(x.food), foodLeft);
    hotelLeft -= h;
    foodLeft -= f;
    return { date: x.date, hotelPaise: h, foodPaise: f, mode: x.mode, reference: x.reference ?? null };
  });

  return {
    id: `bill-${s.no}`,
    billNumber: s.no,
    billDate: s.date,
    guestName: s.guest,
    guestMobile: s.mobile,
    roomNumber: s.room,
    roomType: s.roomType,
    plan: s.plan,
    checkIn: addDays(s.date, -s.nights),
    nights: s.nights,
    roomTariffPaise: tariff,
    discountPaise: discount,
    laundryPaise: laundry,
    hotelGstPaise: hotelGst,
    totalHotelPaise: totalHotel,
    foodPaise: food,
    foodGstPaise: foodGst,
    totalFoodPaise: totalFood,
    hotelMode: s.hotelMode,
    foodMode: s.foodMode,
    advanceHotelPaise: advanceHotel,
    advanceFoodPaise: 0,
    advanceReceipt: s.advanceReceipt ?? null,
    advanceIsCompanys: s.advanceIsCompanys ?? false,
    settlements,
    balanceHotelPaise: hotelLeft,
    balanceFoodPaise: foodLeft,
    reference: s.reference ?? null,
    note: s.note ?? null,
  };
}

/** Advances the company itself paid (its own ledger lines). */
interface CompanyAdvance {
  id: string;
  receiptNumber: string;
  date: string;
  guest: string | null;
  room: string | null;
  hotelPaise: number;
  foodPaise: number;
  mode: string;
  note: string | null;
  refund: { date: string; paise: number; mode: string; note: string | null } | null;
}

function seedAdvances(): CompanyAdvance[] {
  return [
    { id: 'adv-0311', receiptNumber: 'ADV-0311', date: '2026-08-01', guest: 'Priya Sharma', room: '301', hotelPaise: rs(10000), foodPaise: 0, mode: 'NEFT', note: 'Advance for the August project stay', refund: null },
    { id: 'adv-0356', receiptNumber: 'ADV-0356', date: '2026-09-05', guest: null, room: null, hotelPaise: rs(25000), foodPaise: 0, mode: 'NEFT', note: 'Held for the October client visit', refund: { date: '2026-09-25', paise: rs(5000), mode: 'NEFT', note: 'Visit cut short: part refunded' } },
  ];
}

export function createCorporateApi(clock: MockClock = {}, today: string = MOCK_TODAY): CorporateApi {
  const profile = seedProfile();
  let bills = BILL_SEEDS.map((s) => buildBill(s, profile.discountPct));
  let advances: CompanyAdvance[] = seedAdvances();
  let receiptSeq = 4120;

  const companyView = (): CompanyProfile => ({ ...profile });

  function applyPayment(targets: CompanyBill[], business: Business, nowIso: string): PaymentReceipt | null {
    const key = business === 'hotel' ? 'balanceHotelPaise' : 'balanceFoodPaise';
    const open = targets.filter((b) => b[key] > 0).sort((a, b) => (a.billDate < b.billDate ? -1 : 1));
    if (!open.length) return null;
    const receiptNumber = `PAY-${++receiptSeq}`;
    let amount = 0;
    const touched = new Set(open.map((b) => b.id));
    bills = bills.map((b) => {
      if (!touched.has(b.id)) return b;
      const paise = b[key];
      amount += paise;
      const settlement: BillSettlement = {
        date: today,
        hotelPaise: business === 'hotel' ? paise : 0,
        foodPaise: business === 'food' ? paise : 0,
        mode: 'Online (Razorpay)',
        reference: receiptNumber,
      };
      return { ...b, [key]: 0, settlements: [...b.settlements, settlement] };
    });
    return { id: receiptNumber.toLowerCase(), receiptNumber, business, amountPaise: amount, date: nowIso, billNumbers: open.map((b) => b.billNumber) };
  }

  return {
    // decision 48: the hotels, the calm dashboard, the Accounts pages and the company profile (corporate.portal.mock.ts)
    ...corporatePortalMock(clock),
    getBill: (id) =>
      mockCall(() => {
        const shown = portalBill(id);
        if (shown) return ok({ bill: shown, company: companyView() });
        const bill = bills.find((b) => b.id === id || b.billNumber === id);
        return bill ? ok({ bill, company: companyView() }) : mockError('NOT_FOUND');
      }, clock),

    payDues: (businesses) =>
      mockCall(() => {
        const nowIso = `${today}T06:30:00Z`;
        const receipts = businesses
          .map((biz) => applyPayment(bills, biz, nowIso))
          .filter((r): r is PaymentReceipt => r !== null);
        if (!receipts.length) return mockError('VALIDATION_FAILED', { businesses: 'Nothing is due for the businesses you picked.' });
        return ok(receipts);
      }, clock),

    payBill: (id) =>
      mockCall(() => {
        // the demo bills the lists show: like the real server, which waits for online payment (Razorpay)
        if (portalBill(id)) return mockError('CONFLICT', undefined, { message: 'Online payment is not switched on yet. Please pay the hotel accounts team by bank transfer or at reception.' });
        const bill = bills.find((b) => b.id === id);
        if (!bill) return mockError('NOT_FOUND');
        if (billDuePaise(bill) <= 0) return mockError('CONFLICT');
        const nowIso = `${today}T06:30:00Z`;
        const receipts = (['hotel', 'food'] as Business[])
          .map((biz) => applyPayment([bill], biz, nowIso))
          .filter((r): r is PaymentReceipt => r !== null);
        return ok(receipts);
      }, clock),

  };
}
