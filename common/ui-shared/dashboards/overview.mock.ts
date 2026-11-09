// The in-memory mock of overview.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import { type MockClock, mockCall, mockEmptyHotel, ok, mockError } from './common';
import { formatDate } from './format';
import { mockFrontDeskToday } from './frontOffice.mock';
import { DAY_MS, IST_MS, addDays, addMonths, assembleDashboard, bookTableNames, daysInMonth, fyLabel, fyStartYear, istToday, mealPlanRatePaise, mealPlans, monthOf, removeConfirmText, toUtc, yearTotal, type AccountingYear, type BooksOverview, type CashBookUnit, type CashEntry, type CashEntryKind, type DailyReport, type DashboardScenario, type DayLine, type DayLineKind, type FoodPlanByPlan, type FoodPlanMonthReport, type FoodPlanPart, type FoodPlanRow, type FoodPlanTonight, type HandoverSnapshot, type HotelDashboard, type MealPlan, type OverviewApi, type PayMode, type PayrollSnapshot, assembleOccupancy, assembleGst, type GstBillLine, type GstReport, type HotelAnnouncement, type OccupancyDay, type OccupancyReport } from './overview';

/** Minutes since midnight, IST. */
function istNowMinutes(): number {
  const x = new Date(Date.now() + IST_MS);
  return x.getUTCHours() * 60 + x.getUTCMinutes();
}

/** ISO time for a date at a minute of the IST day. */
function atIst(d: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${d}T${hh}:${mm}:00+05:30`;
}

/* ================================================================== seeded mock helpers */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Rand = () => number;

/** Same seed -> same numbers, so a day or month always shows the same mock figures. */
function seeded(seed: string): Rand {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rand, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
/** Random rupee amount in paise, rounded to `step` rupees. */
const rupees = (r: Rand, min: number, max: number, step = 10) => int(r, Math.ceil(min / step), Math.floor(max / step)) * step * 100;

const GUESTS = [
  'Amit Shah', 'Priya Desai', 'Rahul Mehta', 'Kavita Joshi', 'Suresh Patel', 'Neha Trivedi', 'Vikram Rathod',
  'Anjali Bhatt', 'Harsh Vora', 'Pooja Chauhan', 'Ravi Kumar', 'Sneha Iyer', 'Manish Agarwal', 'Deepa Nair',
  'Kunal Kapoor', 'Meera Pandya', 'Arjun Reddy', 'Farhan Qureshi', 'Jasleen Kaur', 'Rohit Sharma',
  'Venkataraghavan Subramaniam Iyer-Krishnamurthy', 'Bhavna Dave', 'Tejas Upadhyay', 'Ishita Ghosh',
] as const;
const COMPANIES = [
  'Jyoti CNC Automation Ltd', 'Rajkot Engineering Association', 'Tata Consultancy Services', 'Adani Ports and SEZ Ltd',
  'Saurashtra Cement Ltd', 'Gujarat Gas Ltd', 'Atul Auto Ltd',
] as const;
const STAFF = ['Ramesh Solanki', 'Geeta Parmar', 'Bharat Makwana', 'Lalit Chavda', 'Sunita Rana', 'Dinesh Vaghela'] as const;
const DESK = ['Rakesh Solanki', 'Priya Mehta', 'Hardik Joshi', 'Neha Parmar'] as const;
const ROOMS = ['101', '102', '103', '104', '105', '106', '201', '202', '203', '204', '205', '206', '207', '208', '301', '302', '303', '304', '305', '401'] as const;

const HOTEL_HEADS: readonly (readonly [string, string, number, number])[] = [
  ['Housekeeping supplies', 'Phenyl, room fresheners', 300, 2800],
  ['Laundry', 'Linen wash - Sparkle Laundry', 800, 4200],
  ['Electricity and water', 'Water tanker', 600, 1800],
  ['Repairs and maintenance', 'AC service, Room 204', 900, 6500],
  ['Guest amenities', 'Toiletries kit refill', 400, 3200],
  ['Printing and stationery', 'Bill books, register', 150, 1200],
  ['Transport', 'Station pick-up auto', 150, 900],
];
const FOOD_HEADS: readonly (readonly [string, string, number, number])[] = [
  ['Vegetables', 'Market Yard vegetables', 600, 3800],
  ['Dairy', 'Amul milk and paneer', 500, 2600],
  ['Gas cylinders', 'Commercial LPG refill', 1700, 3600],
  ['Groceries', 'Dal, rice, oil - Patel Kirana', 900, 5400],
  ['Kitchen staff tea', 'Tea and snacks', 120, 450],
];

/* ------------------------------------------------------------------ named rows (match the other mocks)
 * Real guests, bills and companies from billing.ts (advances 2026 / 809-819, bills 2026 / 1170-1198), corporate.ts (TCS bills HS-22xx)
 * and guest.ts (Amit Joshi, Room 204, HS-0412). They are added ON TOP of the seeded rows (no random number is used, so the seeded rows
 * stay exactly as before) and every total is still worked out from the lines, so each day still balances.
 * Written as if today were 2026-10-10 and moved with the real today, the same way billing.ts moves its seed. */
const NAMED_SEED_TODAY = '2026-10-10';
const TCS = 'Tata Consultancy Services';
const JYOTI = 'Jyoti CNC Automation Ltd';
const ATUL = 'Atul Auto Ltd';
const GSFC = 'Gujarat State Fertilizers and Chemicals Limited (Vadodara Corporate Office, Marketing Division)';
const GANESH = 'Shree Ganesh Tours & Travels';
const REA = 'Rajkot Engineering Association';
const SPARC = 'Sun Pharma Advanced Research Company';
const PATEL_BROS = 'Patel Brothers Events';
const BALAJI = 'Balaji Wafers Pvt Ltd';
const SIEMENS = 'Siemens Healthineers India';

/** Days the named rows move by (0 when today is 2026-10-10). */
function namedShift(): number {
  return Math.round((toUtc(istToday()) - toUtc(NAMED_SEED_TODAY)) / DAY_MS);
}

type NamedSheet = 'cashIn' | 'cashOut' | 'banked' | 'debit' | 'complimentary';
interface NamedLine {
  s: NamedSheet;
  kind: 'Bill' | 'Advance' | 'Refund' | 'Collection';
  mode: 'Cash' | 'UPI' | 'Card' | 'Bank transfer' | 'Credit';
  room: string;
  ref: string;
  who: string;
  note: string;
  party?: string;
  amt: number;
  fromAdv?: number;
}

/** Day sheet lines by (seed) date. Amounts in paise, GST as billing.ts works it (5%) or corporate.ts (10% off, 12% GST). */
const NAMED_DAY: Record<string, NamedLine[]> = {
  '2026-09-19': [
    { s: 'banked', kind: 'Bill', mode: 'Card', room: '307', ref: '2026 / 1198', who: 'Nitin Bhardwaj', note: 'Hotel and food', amt: 714000 },
  ],
  '2026-09-21': [
    { s: 'banked', kind: 'Bill', mode: 'UPI', room: '308', ref: '2026 / 1194', who: 'Hiral Bhuva', note: 'Hotel and food', amt: 850500 },
  ],
  '2026-09-26': [
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '302', ref: '2026 / 1191', who: 'Dr. Swati Kelkar', note: 'Hotel and food', party: SPARC, amt: 855750 },
  ],
  '2026-09-29': [
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '303', ref: '2026 / 1195', who: 'Ketan Ramani', note: 'Hotel and food', party: BALAJI, amt: 682500 },
  ],
  '2026-09-28': [
    { s: 'banked', kind: 'Advance', mode: 'UPI', room: '204', ref: 'HS-0412', who: 'Amit Joshi', note: 'Advance received, hotel (UPI 427781903312)', amt: 500000 },
  ],
  '2026-10-01': [
    { s: 'cashIn', kind: 'Advance', mode: 'Cash', room: '103', ref: '2026 / 809', who: 'Kavita Nair', note: 'Advance received, hotel', amt: 250000 },
    { s: 'banked', kind: 'Bill', mode: 'Card', room: '107', ref: '2026 / 1179', who: 'Ritu Agarwal', note: 'Hotel and food', amt: 861000 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '301', ref: 'HS-2226', who: 'Priya Sharma', note: 'Hotel and food', party: TCS, amt: 1646400 },
  ],
  '2026-10-02': [
    { s: 'banked', kind: 'Advance', mode: 'Bank transfer', room: '302', ref: '2026 / 810', who: 'Arjun Malhotra', note: 'Advance received, hotel and food', amt: 750000 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '306', ref: '2026 / 1193', who: 'Chirag Sojitra', note: 'Hotel and food', party: PATEL_BROS, amt: 1155000 },
  ],
  '2026-10-03': [
    { s: 'banked', kind: 'Advance', mode: 'UPI', room: '106', ref: '2026 / 811', who: 'Neha Gupta', note: 'Advance received, hotel', amt: 100000 },
    { s: 'banked', kind: 'Bill', mode: 'UPI', room: '106', ref: '2026 / 1180', who: 'Neha Gupta', note: 'Hotel, after the ₹1,000 advance', amt: 173000 },
    { s: 'banked', kind: 'Bill', mode: 'Card', room: '210', ref: 'HS-2231', who: 'Mohammed Faizal Khan', note: 'Hotel', amt: 453600 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '303', ref: '2026 / 1181', who: 'Karan Shah', note: 'Hotel and food', party: GSFC, amt: 719250 },
  ],
  '2026-10-04': [
    { s: 'cashIn', kind: 'Bill', mode: 'Cash', room: '209', ref: '2026 / 1183', who: 'Sneha Kulkarni', note: 'Hotel and food', amt: 1265250 },
    { s: 'banked', kind: 'Advance', mode: 'Card', room: '205', ref: '2026 / 812', who: 'Rohan Bhatt', note: 'Advance received, hotel', amt: 350000 },
    { s: 'banked', kind: 'Collection', mode: 'UPI', room: '304', ref: '2026 / 1182', who: 'Deepak Chauhan', note: 'Part payment of the debit bill, hotel', amt: 400000 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '304', ref: '2026 / 1182', who: 'Deepak Chauhan', note: 'Hotel and food', party: GANESH, amt: 1302000 },
  ],
  '2026-10-05': [
    { s: 'cashIn', kind: 'Advance', mode: 'Cash', room: '110', ref: '2026 / 813', who: 'Farhan Qureshi', note: 'Advance received, hotel', amt: 50000 },
    { s: 'banked', kind: 'Bill', mode: 'Bank transfer', room: '108', ref: '2026 / 1184', who: 'Manoj Verma', note: 'Hotel', amt: 306600 },
    { s: 'banked', kind: 'Collection', mode: 'Bank transfer', room: '304', ref: '2026 / 1182', who: 'Deepak Chauhan', note: 'Debit bill payment, hotel and food', amt: 620500 },
    { s: 'banked', kind: 'Collection', mode: 'Bank transfer', room: '304', ref: '2026 / 1182', who: 'Deepak Chauhan', note: 'Debit bill payment by cheque, hotel', amt: 281500 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '203', ref: '2026 / 1185', who: 'Priya Raval', note: 'Hotel and food', party: TCS, amt: 707700 },
  ],
  '2026-10-06': [
    { s: 'banked', kind: 'Advance', mode: 'Card', room: '305', ref: '2026 / 814', who: 'Bhavin Thakkar', note: 'Advance received, hotel', amt: 500000 },
    { s: 'banked', kind: 'Collection', mode: 'Bank transfer', room: '302', ref: '2026 / 1191', who: 'Dr. Swati Kelkar', note: 'Debit bill payment, NEFT SPARC0610442', amt: 855750 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '208', ref: '2026 / 1196', who: 'Jagruti Kakadiya', note: 'Hotel and food', party: BALAJI, amt: 643650 },
  ],
  '2026-10-07': [
    { s: 'cashIn', kind: 'Bill', mode: 'Cash', room: '305', ref: '2026 / 1186', who: 'Bhavin Thakkar', note: 'Settled from advance', amt: 0, fromAdv: 383250 },
    { s: 'banked', kind: 'Advance', mode: 'UPI', room: '104', ref: '2026 / 815', who: 'Hetal Parmar', note: 'Advance received, hotel and food', amt: 250000 },
  ],
  '2026-10-08': [
    { s: 'cashIn', kind: 'Advance', mode: 'Cash', room: '306', ref: '2026 / 816', who: 'Jayesh Solanki', note: 'Advance received, hotel (group of 6)', amt: 300000 },
    { s: 'cashIn', kind: 'Bill', mode: 'Cash', room: '201', ref: '2026 / 1187', who: 'Kinjal Dave', note: 'Hotel', amt: 315000 },
    { s: 'banked', kind: 'Bill', mode: 'UPI', room: '201', ref: '2026 / 1187', who: 'Kinjal Dave', note: 'Food', amt: 89250 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '308', ref: '2026 / 1189', who: 'Prakash Rana', note: 'Hotel and food', party: GSFC, amt: 362250 },
    { s: 'banked', kind: 'Advance', mode: 'Bank transfer', room: '306', ref: '2026 / 819', who: 'Rahul Deshpande', note: 'Advance received, hotel', amt: 300000 },
    { s: 'banked', kind: 'Collection', mode: 'Bank transfer', room: '303', ref: '2026 / 1195', who: 'Ketan Ramani', note: 'Debit bill payment by cheque, hotel and food', amt: 682500 },
  ],
  '2026-10-09': [
    { s: 'cashIn', kind: 'Advance', mode: 'Cash', room: '202', ref: '2026 / 818', who: 'Dhruvi Vaghela', note: 'Advance received, hotel', amt: 150000 },
    { s: 'cashOut', kind: 'Refund', mode: 'Cash', room: '306', ref: '2026 / 816', who: 'Jayesh Solanki', note: 'Advance refunded, hotel (tour postponed)', amt: 300000 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '307', ref: '2026 / 1188', who: 'Nilesh Bhalodiya', note: 'Hotel and food', party: ATUL, amt: 808500 },
  ],
  '2026-10-10': [
    { s: 'banked', kind: 'Bill', mode: 'UPI', room: '102', ref: '2026 / 1190', who: 'Ramesh Makwana', note: 'Hotel and food', amt: 338100 },
    { s: 'banked', kind: 'Collection', mode: 'Bank transfer', room: '308', ref: '2026 / 1189', who: 'Prakash Rana', note: 'Debit bill payment, RTGS GSFC0091123', amt: 362250 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '306', ref: '2026 / 1192', who: 'Rahul Deshpande', note: 'Hotel and food, after the ₹3,000 advance', party: SPARC, amt: 613500 },
    { s: 'debit', kind: 'Bill', mode: 'Credit', room: '205', ref: '2026 / 1197', who: 'Arvind Menon', note: 'Hotel and food, PO 7100453', party: SIEMENS, amt: 1525500 },
  ],
};

/** Named lines of one day sheet, by sheet. */
function namedLinesFor(date: string): Record<NamedSheet, DayLine[]> {
  const out: Record<NamedSheet, DayLine[]> = { cashIn: [], cashOut: [], banked: [], debit: [], complimentary: [] };
  (NAMED_DAY[addDays(date, -namedShift())] ?? []).forEach((x, i) => {
    out[x.s].push({
      id: `${date}-n${i + 1}`, kind: x.kind, mode: x.mode, room: x.room, ref: x.ref, particulars: x.who, note: x.note,
      party: x.party ?? null, amountPaise: x.amt, fromAdvancePaise: x.fromAdv ?? 0,
    });
  });
  return out;
}

type NamedStay = [id: string, guest: string, company: string | null, room: string, bill: string, parts: [from: string, to: string, plan: 'CP' | 'MAP' | 'AP', persons: number][]];

/** Meal-plan stays from the bills above (seed dates; checkout day not counted). */
const NAMED_STAYS: NamedStay[] = [
  ['st-n-1170', 'Rakesh Patel', TCS, '204', '2026 / 1170', [['2026-08-28', '2026-08-30', 'CP', 1]]],
  ['st-n-1173', 'Vikram Singh Rathore', JYOTI, '301', '2026 / 1173', [['2026-09-10', '2026-09-12', 'MAP', 2]]],
  ['st-n-1174', 'Amit Trivedi', ATUL, '206', '2026 / 1174', [['2026-09-14', '2026-09-16', 'CP', 1]]],
  ['st-n-1175', 'Suresh Iyer', ATUL, '207', '2026 / 1175', [['2026-09-18', '2026-09-20', 'CP', 1]]],
  ['st-n-1176', 'Dr. Harshvardhan Chandrashekhar Venkataraman', REA, '401', '2026 / 1176', [['2026-09-21', '2026-09-24', 'MAP', 3]]],
  ['st-n-1198', 'Nitin Bhardwaj', SIEMENS, '307', '2026 / 1198', [['2026-09-17', '2026-09-19', 'CP', 1]]],
  ['st-n-1194', 'Hiral Bhuva', PATEL_BROS, '308', '2026 / 1194', [['2026-09-19', '2026-09-21', 'CP', 2]]],
  ['st-n-1191', 'Dr. Swati Kelkar', SPARC, '302', '2026 / 1191', [['2026-09-24', '2026-09-26', 'CP', 1]]],
  // corporate.ts bill dates are the checkout day (HS-2214: 2 nights to 26 Sep; HS-2226: 3 nights to 01 Oct, booking BK-1040).
  ['st-n-2214', 'Arjun Reddy', TCS, '305', 'HS-2214', [['2026-09-24', '2026-09-26', 'MAP', 1]]],
  ['st-n-1195', 'Ketan Ramani', BALAJI, '303', '2026 / 1195', [['2026-09-27', '2026-09-29', 'CP', 1]]],
  ['st-n-1179', 'Ritu Agarwal', null, '107', '2026 / 1179', [['2026-09-29', '2026-10-01', 'CP', 2]]],
  ['st-n-1181', 'Karan Shah', GSFC, '303', '2026 / 1181', [['2026-10-01', '2026-10-03', 'CP', 1]]],
  ['st-n-1182', 'Deepak Chauhan', GANESH, '304', '2026 / 1182', [['2026-10-01', '2026-10-04', 'CP', 2]]],
  ['st-n-1183', 'Sneha Kulkarni', null, '209', '2026 / 1183', [['2026-10-01', '2026-10-02', 'CP', 2], ['2026-10-02', '2026-10-04', 'MAP', 3]]],
  ['st-n-2226', 'Priya Sharma', TCS, '301', 'HS-2226', [['2026-09-28', '2026-10-01', 'CP', 1]]],
  ['st-n-1185', 'Priya Raval', TCS, '203', '2026 / 1185', [['2026-10-03', '2026-10-05', 'CP', 1]]],
  ['st-n-1186', 'Bhavin Thakkar', JYOTI, '305', '2026 / 1186', [['2026-10-06', '2026-10-07', 'CP', 1]]],
  ['st-n-1188', 'Nilesh Bhalodiya', ATUL, '307', '2026 / 1188', [['2026-10-07', '2026-10-09', 'MAP', 1]]],
  ['st-n-1189', 'Prakash Rana', GSFC, '308', '2026 / 1189', [['2026-10-07', '2026-10-08', 'CP', 1]]],
  ['st-n-1197', 'Arvind Menon', SIEMENS, '205', '2026 / 1197', [['2026-10-06', '2026-10-10', 'CP', 1]]],
  ['st-n-1192', 'Rahul Deshpande', SPARC, '306', '2026 / 1192', [['2026-10-08', '2026-10-10', 'MAP', 1]]],
];

/** Every movement of one day in both books. `upToMinute` hides entries not made yet (today). */
function entriesFor(date: string, upToMinute: number | null): CashEntry[] {
  const out: CashEntry[] = [];
  const add = (r: Rand, unit: CashBookUnit, kind: CashEntryKind, head: string | null, who: string, amountPaise: number) => {
    const minute = int(r, 7 * 60, 22 * 60 + 30);
    const prefix = { Deposit: 'DEP', Withdrawal: 'WDL', Expense: 'EXP', 'Staff advance': 'ADV' }[kind];
    out.push({
      id: `${date}-${unit}-${out.length}`,
      unit,
      direction: kind === 'Deposit' ? 'in' : 'out',
      kind,
      head,
      who,
      entryNo: `${prefix}-${String(int(r, 1000, 9999))}`,
      by: pick(r, DESK),
      amountPaise,
      at: atIst(date, minute),
    });
  };

  const r = seeded(`entries:${date}`);
  // Hotel book
  for (let i = int(r, 2, 4); i > 0; i--) add(r, 'hotel', 'Deposit', null, `Room ${pick(r, ROOMS)} - ${pick(r, GUESTS)}`, rupees(r, 1500, 18500));
  for (let i = int(r, 1, 3); i > 0; i--) {
    const [head, name, min, max] = pick(r, HOTEL_HEADS);
    add(r, 'hotel', 'Expense', head, name, rupees(r, min, max));
  }
  if (r() < 0.35) add(r, 'hotel', 'Withdrawal', 'Cash withdrawals', 'Deposited to HDFC Bank', rupees(r, 10000, 30000, 1000));
  if (r() < 0.2) add(r, 'hotel', 'Staff advance', 'Staff advances', pick(r, STAFF), rupees(r, 1000, 5000, 500));
  // Food book
  for (let i = int(r, 2, 3); i > 0; i--) add(r, 'food', 'Deposit', null, pick(r, ['Restaurant counter', 'Room service', 'Banquet - birthday party', 'Parcel orders']), rupees(r, 1200, 12500));
  for (let i = int(r, 1, 3); i > 0; i--) {
    const [head, name, min, max] = pick(r, FOOD_HEADS);
    add(r, 'food', 'Expense', head, name, rupees(r, min, max));
  }
  if (r() < 0.12) add(r, 'food', 'Staff advance', 'Staff advances', pick(r, STAFF), rupees(r, 500, 3000, 500));

  const cut = upToMinute === null ? null : atIst(date, upToMinute);
  return (cut ? out.filter((e) => e.at <= cut) : out).sort((a, b) => (a.at < b.at ? -1 : 1));
}

function buildDashboard(scenario: DashboardScenario): HotelDashboard {
  const today = istToday();
  const nowMin = istNowMinutes();
  const month = monthOf(today);
  const lastMonthStart = `${addMonths(month, -1)}-01`;
  const trendStart = addDays(today, -29);
  const from = trendStart < lastMonthStart ? trendStart : lastMonthStart;

  const all: CashEntry[] = [];
  if (scenario !== 'empty') {
    for (let d = from; d <= today; d = addDays(d, 1)) all.push(...entriesFor(d, d === today ? Math.max(nowMin, scenario === 'allClear' ? 12 * 60 : 0) : null));
  }

  // Shift handover: Night closes 7 am, Morning 3 pm, Evening 11 pm.
  const shifts: [string, number][] = [['Night', 7 * 60], ['Morning', 15 * 60], ['Evening', 23 * 60]];
  const doneToday = scenario === 'empty' ? [] : shifts.filter(([, m]) => m <= (scenario === 'allClear' ? Math.max(nowMin, 7 * 60) : nowMin));
  const hr = seeded(`handover:${today}`);
  const todayCashPaise = doneToday.reduce((s) => s + rupees(hr, 9000, 42000, 50), 0);
  const lastDone = doneToday[doneToday.length - 1];
  const latest = scenario === 'empty'
    ? null
    : lastDone
      ? { shift: lastDone[0], at: atIst(today, lastDone[1] + 4), by: pick(hr, DESK) }
      : { shift: 'Evening', at: atIst(addDays(today, -1), 23 * 60 + 6), by: pick(hr, DESK) };
  const dayOfMonth = Number(today.slice(8, 10));
  const handovers: HandoverSnapshot = {
    today: doneToday.length,
    todayCashPaise,
    month: scenario === 'empty' ? 0 : Math.max(0, (dayOfMonth - 1) * 3 - 2) + doneToday.length,
    latest,
  };

  const advancesThisMonth = all.filter((e) => e.kind === 'Staff advance' && e.at.slice(0, 7) === month);
  const payroll: PayrollSnapshot = scenario === 'empty'
    ? { activeStaff: 0, joinedThisMonth: 0, openCount: 0, openAmountPaise: 0, openSince: null, advancesPaise: 0, advanceCount: 0, paidPaise: 0, paidCount: 0 }
    : {
      activeStaff: 38,
      joinedThisMonth: 2,
      openCount: scenario === 'allClear' ? 0 : 3,
      openAmountPaise: scenario === 'allClear' ? 0 : 6145000,
      openSince: scenario === 'allClear' ? null : addMonths(month, -2),
      advancesPaise: advancesThisMonth.reduce((s, e) => s + e.amountPaise, 0),
      advanceCount: advancesThisMonth.length,
      paidPaise: 48230000,
      paidCount: 35,
    };

  // the front desk's day: the room board's own rows (frontOffice.mock.ts), nothing for a brand-new or empty hotel
  const frontDesk = scenario === 'empty' ? { arrivals: 0, departures: 0, inHouse: 0, roomsToClean: 0, roomsReady: 23 } : mockFrontDeskToday();
  return { ...assembleDashboard(today, all, handovers, payroll), frontDesk };
}

interface Stay {
  id: string;
  guest: string;
  company: string | null;
  room: string;
  bill: string;
  /** Each part: arrival `from`, checkout `to` (exclusive). */
  parts: { from: string; to: string; plan: MealPlan; persons: number }[];
}

/** A made-up bill number; it never lands on billing.ts's real bills 2026 / 1170-1198 (same draw, moved past them). */
const billRef = (r: Rand, d: string) => {
  const n = int(r, 120, 1890);
  return `SR/${fyLabel(fyStartYear(d)).slice(2)}/${String(n >= 1170 && n <= 1198 ? n + 30 : n).padStart(4, '0')}`;
};

const stayCache = new Map<string, Stay[]>();

/** Stays arriving in one month (seeded). */
function arrivalsIn(month: string): Stay[] {
  const hit = stayCache.get(month);
  if (hit) return hit;
  const r = seeded(`stays:${month}`);
  const list: Stay[] = [];
  const n = int(r, 12, 20);
  for (let i = 0; i < n; i++) {
    const arrival = `${month}-${String(int(r, 1, daysInMonth(month))).padStart(2, '0')}`;
    const nights = int(r, 1, 6);
    const plan = pick(r, ['CP', 'CP', 'MAP', 'MAP', 'AP'] as const);
    const persons = int(r, 1, 3);
    const departure = addDays(arrival, nights);
    const parts: Stay['parts'] = [];
    if (nights >= 3 && r() < 0.25) {
      // Plan or guests changed in the middle of the stay.
      const cut = addDays(arrival, int(r, 1, nights - 1));
      parts.push({ from: arrival, to: cut, plan, persons });
      parts.push({ from: cut, to: departure, plan: plan === 'AP' ? 'MAP' : 'AP', persons: r() < 0.5 ? persons : persons + 1 });
    } else {
      parts.push({ from: arrival, to: departure, plan, persons });
    }
    list.push({
      id: `st-${month}-${i}`,
      guest: pick(r, GUESTS),
      company: r() < 0.35 ? pick(r, COMPANIES) : null,
      room: pick(r, ROOMS),
      bill: billRef(r, arrival),
      parts,
    });
  }
  // Named stays (billing.ts / corporate.ts guests) arriving this month, after the seeded ones.
  const shift = namedShift();
  const named: Stay[] = NAMED_STAYS.map(([id, guest, company, room, bill, ps]) => ({
    id, guest, company, room, bill,
    parts: ps.map(([from, to, plan, persons]) => ({ from: addDays(from, shift), to: addDays(to, shift), plan, persons })),
  }));
  // A seeded stay never shares a room with a named one on the same night (one room, one guest).
  const span = (s: Stay) => ({ from: s.parts[0]?.from ?? '', to: s.parts[s.parts.length - 1]?.to ?? '' });
  const clashes = (s: Stay) => named.some((n) => n.room === s.room && span(n).from < span(s).to && span(s).from < span(n).to);
  const out = [...list.filter((s) => !clashes(s)), ...named.filter((n) => monthOf(n.parts[0]?.from ?? '') === month)];
  stayCache.set(month, out);
  return out;
}

/** Stays with at least one night in the month (arrivals this month + stays running in from last month). */
function staysTouching(month: string, today: string): Stay[] {
  const start = `${month}-01`;
  const prev = arrivalsIn(addMonths(month, -1)).filter((s) => (s.parts[s.parts.length - 1]?.to ?? start) > start);
  return [...prev, ...arrivalsIn(month)].filter((s) => (s.parts[0]?.from ?? today) <= today);
}

interface Night { date: string; plan: MealPlan; persons: number; ratePaise: number; amountPaise: number }

function nightsOf(stay: Stay): Night[] {
  const out: Night[] = [];
  for (const p of stay.parts) {
    for (let d = p.from; d < p.to; d = addDays(d, 1)) {
      const rate = mealPlanRatePaise[p.plan];
      out.push({ date: d, plan: p.plan, persons: p.persons, ratePaise: rate, amountPaise: rate * p.persons });
    }
  }
  return out;
}

const uniq = <T>(list: T[]): T[] => [...new Set(list)];

function buildFoodPlanMonth(month: string, plan: MealPlan | null): FoodPlanMonthReport {
  const today = istToday();
  const rows: FoodPlanRow[] = [];
  for (const stay of staysTouching(month, today)) {
    const all = nightsOf(stay);
    const nights = all.filter((n) => monthOf(n.date) === month);
    if (!nights.length) continue;
    const parts: FoodPlanPart[] = [];
    for (const n of nights) {
      const last = parts[parts.length - 1];
      if (last && last.plan === n.plan && last.persons === n.persons && addDays(last.to, 1) === n.date) {
        last.to = n.date;
        last.nights += 1;
        last.amountPaise += n.amountPaise;
      } else {
        parts.push({ from: n.date, to: n.date, plan: n.plan, persons: n.persons, ratePaise: n.ratePaise, nights: 1, amountPaise: n.amountPaise });
      }
    }
    rows.push({
      id: stay.id,
      guest: stay.guest,
      company: stay.company,
      room: stay.room,
      bill: stay.bill,
      arrival: stay.parts[0]?.from ?? '',
      departure: stay.parts[stay.parts.length - 1]?.to ?? '',
      plans: uniq(nights.map((n) => n.plan)),
      persons: uniq(nights.map((n) => n.persons)),
      ratesPaise: uniq(nights.map((n) => n.ratePaise)),
      nightCount: nights.length,
      personNights: nights.reduce((s, n) => s + n.persons, 0),
      amountPaise: nights.reduce((s, n) => s + n.amountPaise, 0),
      outside: all.length - nights.length,
      parts,
    });
  }
  const filtered = (plan ? rows.filter((r) => r.plans.includes(plan)) : rows).sort((a, b) => (a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 : a.room.localeCompare(b.room)));

  const byPlan: FoodPlanByPlan[] = [];
  for (const p of mealPlans) {
    const ps = filtered.flatMap((r) => r.parts).filter((x) => x.plan === p);
    if (!ps.length) continue;
    byPlan.push({
      plan: p,
      personNights: ps.reduce((s, x) => s + x.persons * x.nights, 0),
      ratesPaise: uniq(ps.map((x) => x.ratePaise)),
      amountPaise: ps.reduce((s, x) => s + x.amountPaise, 0),
    });
  }
  return {
    month,
    plan,
    plans: mealPlans,
    rows: filtered,
    byPlan,
    totals: {
      guests: filtered.length,
      nights: filtered.reduce((s, r) => s + r.nightCount, 0),
      personNights: filtered.reduce((s, r) => s + r.personNights, 0),
      amountPaise: filtered.reduce((s, r) => s + r.amountPaise, 0),
    },
  };
}

/** Guests on a meal plan tonight: the same stays the Food Plan Report reads. */
function foodPlanTonight(date: string): FoodPlanTonight[] {
  const list: FoodPlanTonight[] = [];
  for (const stay of staysTouching(monthOf(date), date)) {
    const n = nightsOf(stay).find((x) => x.date === date);
    if (!n) continue;
    list.push({ id: `${stay.id}-${date}`, room: stay.room, bill: stay.bill, guest: stay.guest, company: stay.company, plan: n.plan, persons: n.persons, ratePaise: n.ratePaise, amountPaise: n.amountPaise });
  }
  return list.sort((a, b) => a.room.localeCompare(b.room, 'en', { numeric: true }));
}

/** Cash brought forward into each accounting year (Books screen shows the open year's). */
const OPENING_CASH_PAISE = 2500000;

const dayCache = new Map<string, DailyReport>();

function buildDay(date: string, openingPaise: number): DailyReport {
  const r = seeded(`day:${date}`);
  let n = 0;
  const line = (kind: DayLineKind, mode: PayMode, p: Partial<DayLine> & { particulars: string; amountPaise: number }): DayLine => ({
    id: `${date}-${++n}`, kind, mode, room: null, ref: null, note: null, party: null, fromAdvancePaise: 0, ...p,
  });

  const cashIn: DayLine[] = [];
  for (let i = int(r, 1, 4); i > 0; i--) {
    if (r() < 0.18) {
      cashIn.push(line('Bill', 'Cash', { room: pick(r, ROOMS), ref: billRef(r, date), particulars: pick(r, GUESTS), note: 'Settled from advance', amountPaise: 0, fromAdvancePaise: rupees(r, 3000, 8000, 100) }));
    } else {
      cashIn.push(line('Bill', 'Cash', { room: pick(r, ROOMS), ref: billRef(r, date), particulars: pick(r, GUESTS), note: pick(r, ['Hotel and food', 'Hotel', 'Food']), amountPaise: rupees(r, 1200, 14500) }));
    }
  }
  for (let i = int(r, 0, 2); i > 0; i--) {
    cashIn.push(line('Advance', 'Cash', { room: pick(r, ROOMS), ref: `ADV-${int(r, 300, 990)}`, particulars: pick(r, GUESTS), note: 'Advance received, hotel', amountPaise: rupees(r, 2000, 10000, 500) }));
  }
  for (let i = int(r, 1, 2); i > 0; i--) {
    cashIn.push(line('Collection', 'Cash', { particulars: pick(r, ['Restaurant counter', 'Room service', 'Laundry counter', 'Banquet booking']), note: 'Food book', amountPaise: rupees(r, 800, 9500) }));
  }

  const cashOut: DayLine[] = [];
  for (let i = int(r, 2, 5); i > 0; i--) {
    const [head, name, min, max] = pick(r, r() < 0.6 ? HOTEL_HEADS : FOOD_HEADS);
    cashOut.push(line('Expense', 'Cash', { ref: `EXP-${int(r, 1000, 9999)}`, particulars: name, note: head, amountPaise: rupees(r, min, max) }));
  }
  if (r() < 0.3) cashOut.push(line('Staff advance', 'Cash', { ref: `ADV-${int(r, 100, 299)}`, particulars: pick(r, STAFF), note: 'Staff advance', amountPaise: rupees(r, 1000, 5000, 500) }));
  if (r() < 0.15) cashOut.push(line('Refund', 'Cash', { room: pick(r, ROOMS), ref: `ADV-${int(r, 300, 990)}`, particulars: pick(r, GUESTS), note: 'Advance refunded, hotel', amountPaise: rupees(r, 500, 3000, 100) }));
  // Named lines (billing / corporate / guest mocks) go in before any total is taken, so the sheet still balances.
  const named = namedLinesFor(date);
  cashIn.push(...named.cashIn);
  cashOut.push(...named.cashOut);

  const foodPlan = foodPlanTonight(date);
  const sum = (l: { amountPaise: number }[]) => l.reduce((s, x) => s + x.amountPaise, 0);
  const foodPlanPaise = sum(foodPlan);
  const cashInPaise = sum(cashIn);

  // Keep the drawer sensible: extra cash goes to the bank.
  const left = openingPaise + cashInPaise - sum(cashOut) - foodPlanPaise;
  if (left > 4500000) {
    const amount = Math.floor((left - rupees(r, 15000, 25000)) / 100000) * 100000;
    if (amount > 0) cashOut.push(line('Withdrawal', 'Cash', { ref: `WDL-${int(r, 100, 999)}`, particulars: 'Cash deposited to HDFC Bank', note: 'Bank deposit', amountPaise: amount }));
  }
  const cashOutPaise = sum(cashOut);

  const banked: DayLine[] = [];
  for (let i = int(r, 2, 6); i > 0; i--) {
    const mode = pick(r, ['UPI', 'UPI', 'Card', 'OTA', 'Bank transfer'] as const);
    banked.push(mode === 'OTA'
      ? line('Bill', mode, { room: pick(r, ROOMS), ref: billRef(r, date), particulars: pick(r, GUESTS), note: pick(r, ['MakeMyTrip', 'Booking.com', 'Goibibo', 'Agoda']), amountPaise: rupees(r, 2400, 16800) })
      : line(r() < 0.75 ? 'Bill' : 'Advance', mode, { room: pick(r, ROOMS), ref: billRef(r, date), particulars: pick(r, GUESTS), note: null, amountPaise: rupees(r, 1800, 22000) }));
  }

  const debit: DayLine[] = [];
  for (let i = int(r, 0, 3); i > 0; i--) {
    debit.push(line('Bill', 'Credit', { room: pick(r, ROOMS), ref: billRef(r, date), particulars: pick(r, GUESTS), party: pick(r, COMPANIES), note: 'Hotel and food', amountPaise: rupees(r, 4500, 38000) }));
  }

  const complimentary: DayLine[] = [];
  if (r() < 0.2) complimentary.push(line('Bill', 'Complimentary', { room: pick(r, ROOMS), ref: billRef(r, date), particulars: pick(r, GUESTS), note: "Owner's guest", amountPaise: rupees(r, 1800, 4500, 100) }));
  banked.push(...named.banked);
  debit.push(...named.debit);
  complimentary.push(...named.complimentary);

  const bankedInPaise = sum(banked);
  const debitPaise = sum(debit);
  const revenuePaise = cashInPaise + bankedInPaise + debitPaise;
  const paidOutPaise = cashOutPaise + foodPlanPaise;
  return {
    date,
    cashIn,
    cashOut,
    banked,
    debit,
    complimentary,
    foodPlan,
    totals: {
      openingPaise,
      cashInPaise,
      cashOutPaise,
      cashOnHandPaise: openingPaise + cashInPaise,
      foodPlanPaise,
      carryForwardPaise: openingPaise + cashInPaise - cashOutPaise - foodPlanPaise,
      bankedInPaise,
      debitPaise,
      complimentaryPaise: sum(complimentary),
      revenuePaise,
      paidOutPaise,
      netPaise: revenuePaise - paidOutPaise,
      entries: cashIn.length + cashOut.length + banked.length + debit.length + complimentary.length,
    },
  };
}

/** Day sheets chain: each day's carry forward is the next day's opening, from 1 April. */
function dailyReport(date: string): DailyReport {
  const hit = dayCache.get(date);
  if (hit) return hit;
  let d = `${fyStartYear(date)}-04-01`;
  let opening = OPENING_CASH_PAISE;
  let rep: DailyReport | undefined;
  while (d <= date) {
    rep = dayCache.get(d) ?? buildDay(d, opening);
    dayCache.set(d, rep);
    opening = rep.totals.carryForwardPaise;
    d = addDays(d, 1);
  }
  return rep ?? buildDay(date, opening);
}

function makeYear(startYear: number, open: boolean): AccountingYear {
  const r = seeded(`fy:${startYear}`);
  const scale = open ? 0.5 : 1;
  const c = (min: number, max: number) => Math.round(int(r, min, max) * scale);
  const n: Record<string, number> = {
    hotel_cash_deposits: c(900, 1300), food_cash_deposits: c(700, 1000), hotel_cash_withdrawals: c(90, 140), food_cash_withdrawals: c(10, 30),
    hotel_misc_expenses: c(600, 900), food_misc_expenses: c(700, 1100), shift_handovers: c(1060, 1095), bill_master_bills: c(2400, 3600),
    bill_master_advances: c(300, 520), staff_advances: c(60, 110), payroll_advances: c(20, 45), bonus_incentives: c(8, 30),
    employee_meal_periods: c(30, 60), salary_processings: c(400, 460), attendance_months: open ? 6 : 12,
  };
  return {
    id: `fy-${startYear}`,
    label: fyLabel(startYear),
    startsOn: `${startYear}-04-01`,
    endsOn: `${startYear + 1}-03-31`,
    current: open,
    closedAt: open ? null : `${startYear + 1}-04-0${int(r, 1, 3)}T10:00:00.000Z`,
    counts: Object.entries(n).map(([key, count]) => ({ key, name: bookTableNames[key] ?? key, count })),
  };
}

/** A believable month: 23 rooms, weekends fuller, a steady rate around 2,500 to 3,400. Deterministic per month. */
/** A month of made-up bills for the GST summary: a bill every second day, every third one B2B, a 12% hotel GST and 5% food GST. */
function mockGst(month: string): GstReport {
  const today = istToday();
  if (mockEmptyHotel() || month > today.slice(0, 7)) return assembleGst(month, []);
  const [y, m] = month.split('-').map(Number);
  const inMonth = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
  const last = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : inMonth;
  const guests = ['Rakesh Patel', 'Meera Shah', 'Infosys Rajkot', 'Anil Joshi', 'Tata Consultancy Services', 'Priya Nair'];
  const bills: GstBillLine[] = [];
  for (let d = 1; d <= last; d += 2) {
    const i = (d >> 1) % guests.length;
    const b2b = i === 2 || i === 4;
    const hotel = 450000 + ((d * 7919) % 9) * 50000;
    const food = d % 3 === 0 ? 0 : 60000 + ((d * 104729) % 5) * 15000;
    bills.push({
      id: `gst-${month}-${d}`,
      date: `${month}-${String(d).padStart(2, '0')}`,
      billNumber: `2026 / ${1100 + d}`,
      guest: guests[i] ?? 'Guest',
      gstin: b2b ? (i === 2 ? '24AAACI1681G1ZL' : '27AAACR4849R1ZL') : null,
      company: b2b ? (guests[i] ?? null) : null,
      hotelTaxablePaise: hotel,
      hotelGstPaise: Math.round(hotel * 0.12),
      hotelGstPercent: '12',
      foodTaxablePaise: food,
      foodGstPaise: Math.round(food * 0.05),
      foodGstPercent: food ? '5' : null,
      totalPaise: hotel + Math.round(hotel * 0.12) + food + Math.round(food * 0.05),
    });
  }
  return assembleGst(month, bills);
}

function mockOccupancy(month: string, _clock: MockClock): OccupancyReport {
  void _clock;
  const today = istToday();
  const rooms = mockEmptyHotel() ? 0 : 23;
  const [y, m] = month.split('-').map(Number);
  const inMonth = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
  const last = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : month < today.slice(0, 7) ? inMonth : 0;
  const days: OccupancyDay[] = [];
  let seed = (y ?? 0) * 12 + (m ?? 0);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let d = 1; d <= last; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const weekend = [5, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    const sold = rooms === 0 ? 0 : Math.min(rooms, Math.round(rooms * (weekend ? 0.78 : 0.52) + rnd() * 5 - 2));
    const rate = 250000 + Math.round(rnd() * 90000);
    days.push({ date, roomsSold: sold, roomRevenuePaise: sold * rate, arrivals: Math.round(sold * 0.35), departures: Math.round(sold * 0.3), occupancyPct: rooms ? Math.round((sold / rooms) * 1000) / 10 : 0 });
  }
  return assembleOccupancy(month, rooms, days);
}

/** The platform's announcements the demo shows once (dismissed ones are forgotten on reload). */
const mockAnnouncements: HotelAnnouncement[] = [
  { id: 'ann-1', title: 'Maintenance on Sunday night', body: 'EasyHotelSolutions will be unavailable on Sunday from 1:00 to 1:30 am IST for a database upgrade. Nothing you have to do; bills and check-ins made before will be there after.', important: true, at: '2026-10-12T09:00:00.000Z' },
  { id: 'ann-2', title: 'New: print a guest folio as PDF', body: 'Open any bill and press Print to save the folio as a PDF with your hotel header. Older bills can be printed the same way.', important: false, at: '2026-10-13T09:00:00.000Z' },
];
const dismissed = new Set<string>();

export function createOverviewApi(clock: MockClock = {}): OverviewApi {
  // In-memory books store, so start / remove visibly work during a session.
  const years: AccountingYear[] = [makeYear(2023, false), makeYear(2024, false), makeYear(2025, false), makeYear(2026, true)];

  const current = () => years[years.length - 1] as AccountingYear;

  const cannotStart = (): string | null => {
    const cur = current();
    if (istToday() <= cur.endsOn) {
      return `${cur.label} runs until ${formatDate(cur.endsOn)}. The next year can be started from ${formatDate(addDays(cur.endsOn, 1))}.`;
    }
    return null;
  };

  const cannotRemove = (): string | null => (years.length < 2 ? 'This is the only year. There is no earlier year to go back to.' : null);

  const overview = (): BooksOverview => {
    const cur = current();
    const nextStart = Number(cur.startsOn.slice(0, 4)) + 1;
    const first = cur.id === years[0]?.id;
    const none = { count: 0, amountPaise: 0 };
    return {
      years: [...years].reverse(),
      next: { label: fyLabel(nextStart), startsOn: `${nextStart}-04-01`, endsOn: `${nextStart + 1}-03-31` },
      cannotStart: cannotStart(),
      cannotRemove: cannotRemove(),
      carried: {
        cashPaise: first ? null : OPENING_CASH_PAISE,
        bills: first ? none : { count: 4, amountPaise: 3856000 },
        advances: first ? none : { count: 2, amountPaise: 1200000 },
        payroll: first ? none : { count: 3, amountPaise: 950000 },
        salaries: none,
      },
    };
  };

  return {
    // a brand-new mock hotel (Pooja Shah's Hotel Pearl) has nothing yet: no front desk day, no payroll, no cash
    getDashboard: (opts = {}) => mockCall(() => ok(buildDashboard(opts.scenario ?? (mockEmptyHotel() ? 'empty' : 'normal'))), clock),

    getDailyReport: (date) => mockCall(() => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return mockError('VALIDATION_FAILED', { date: 'Pick a valid day.' });
      if (date > istToday()) return mockError('VALIDATION_FAILED', { date: 'Today is as far forward as you can go.' });
      return ok(dailyReport(date));
    }, clock),

    getOccupancy: (month) => mockCall(() => ok(mockOccupancy(month, clock)), clock),
    getGst: (month) => mockCall(() => ok(mockGst(month)), clock),
    getAnnouncements: () => mockCall(() => ok(mockEmptyHotel() ? [] : mockAnnouncements.filter((a) => !dismissed.has(a.id))), clock),
    dismissAnnouncement: (id) => mockCall(() => {
      if (!mockAnnouncements.some((a) => a.id === id)) return mockError('NOT_FOUND');
      dismissed.add(id);
      return ok({ dismissed: true as const });
    }, clock),
    getAttention: () => mockCall(() => {
      // the brand-new hotel has nothing to attend to yet
      const items = [...buildDashboard(mockEmptyHotel() ? 'empty' : 'normal').attention];
      if (!mockEmptyHotel()) {
        const fd = mockFrontDeskToday();
        if (fd.departures > 0) items.unshift({ id: 'departures', tone: 'warning', text: `${fd.departures} ${fd.departures === 1 ? 'guest is' : 'guests are'} due to leave today`, action: 'In house', viewId: 'hotel.fo.inHouse' });
        if (fd.roomsToClean > 0) items.push({ id: 'rooms', tone: 'info', text: `${fd.roomsToClean} ${fd.roomsToClean === 1 ? 'room needs' : 'rooms need'} cleaning`, action: 'Rooms', viewId: 'hotel.fo.rooms' });
      }
      return ok({ items, at: new Date().toISOString() });
    }, clock),
    getFoodPlan: (month, plan) => mockCall(() => {
      if (!/^\d{4}-\d{2}$/.test(month)) return mockError('VALIDATION_FAILED', { month: 'Pick a valid month.' });
      if (month > monthOf(istToday())) return mockError('VALIDATION_FAILED', { month: 'The current month is as far forward as you can go.' });
      return ok(buildFoodPlanMonth(month, plan));
    }, clock),

    getBooks: () => mockCall(() => ok(overview()), clock),

    startNextYear: () => mockCall(() => {
      const why = cannotStart();
      if (why) return mockError('CONFLICT', { year: why });
      const cur = current();
      cur.current = false;
      cur.closedAt = new Date().toISOString();
      const start = Number(cur.startsOn.slice(0, 4)) + 1;
      const year: AccountingYear = {
        id: `fy-${start}`, label: fyLabel(start), startsOn: `${start}-04-01`, endsOn: `${start + 1}-03-31`,
        current: true, closedAt: null, counts: [],
      };
      years.push(year);
      return ok({ year, message: `Accounting year ${year.label} has started. ${formatDate(year.startsOn)} onwards is open; earlier years are now read-only.` });
    }, clock),

    removeLatestYear: (confirm) => mockCall(() => {
      const why = cannotRemove();
      if (why) return mockError('CONFLICT', { year: why });
      const cur = current();
      if (confirm.trim() !== removeConfirmText(cur.label)) {
        return mockError('VALIDATION_FAILED', { confirm: `Type ${removeConfirmText(cur.label)} exactly to remove the year.` });
      }
      years.pop();
      const reopened = current();
      reopened.current = true;
      reopened.closedAt = null;
      const removed = Object.fromEntries(cur.counts.map((x) => [x.key, x.count]));
      return ok({ removed, message: `Accounting year ${cur.label} was removed with its ${yearTotal(cur)} entries. ${reopened.label} is open again.` });
    }, clock),
  };
}
