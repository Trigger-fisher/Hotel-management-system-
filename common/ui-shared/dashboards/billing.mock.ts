// The in-memory mock of billing.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock, DashResult, Kpi } from './common';
import { mockCall, ok, mockError, pageOf, mockEmptyHotel } from './common';
import { formatINR, amountInWords } from './format';
import { advanceLeft, advanceModes, advanceStatus, advanceTaken, billBalance, billModes, billStatus, isPartPaid, billTotal, billingCopy, billingHotel, canChangeAdvance, currentYear, emptyFood, emptyHotel, foodTaxable, foodTotal, GST_SAC, hotelPlanLabel, hotelPlans, hotelTaxable, hotelTotal, istToIso, paymentModes, planRatePaise, priceStay, settlementReceived, todayIst, typedGstRate, validateAdvance, validateBill, validateRefund, validateSettle, type Advance, type AdvanceTab, type AppliedAdvance, type Bill, type BillInput, type BillTab, type BillingApi, type BillingCompany, type BillingFixtures, type FilterOptions, type FoodCharges, type HotelCharges, type HotelPlan, type PaymentMode, type RefundInput, type SettleInput, type StaySegment } from './billing';

/* ------------------------------------------------------------------ */
/* Mock store                                                          */
/* ------------------------------------------------------------------ */

const companies: BillingCompany[] = [
  // Same ids, names and GSTINs as the Companies mock (companies.ts), so a company picked in one module reads the same in all.
  { id: 'co-1', name: 'Tata Consultancy Services', gstin: '24AAACT2727Q1ZV' },
  { id: 'co-2', name: 'Jyoti CNC Automation Ltd', gstin: '24AABCJ4521M1Z8' },
  { id: 'co-3', name: 'Atul Auto Ltd', gstin: '24AAACA6713K1Z3' },
  { id: 'co-4', name: 'Gujarat State Fertilizers and Chemicals Limited (Vadodara Corporate Office, Marketing Division)', gstin: '24AAACG7393C1ZB' },
  { id: 'co-5', name: 'Shree Ganesh Tours & Travels', gstin: '24BKZPS4410R1Z6' },
  { id: 'co-6', name: 'Rajkot Engineering Association', gstin: '' },
  { id: 'co-7', name: 'Sun Pharma Advanced Research Company', gstin: '24AAKCS1234D1Z1' },
  { id: 'co-8', name: 'Patel Brothers Events', gstin: '24AAJFP8899L1ZQ' },
  { id: 'co-9', name: 'Infosys BPM Ltd', gstin: '24AABCP9411L1ZD' },
  { id: 'co-10', name: 'Balaji Wafers Pvt Ltd', gstin: '24AABCB2299E1Z0' },
  { id: 'co-11', name: 'Siemens Healthineers India', gstin: '24AAECS5698N1ZT' },
];
/** The demo hotel's companies; the brand-new mock hotel starts with none (companies belong to the hotel). */
const DEMO_COMPANIES: BillingCompany[] = [...companies];

interface Store {
  advances: Advance[];
  bills: Bill[];
  seq: number;
  /** Seeded recycle bin (mock only): advances that start out deleted. */
  bin?: Advance[];
}

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const r = (rupees: number): number => Math.round(rupees * 100);
const companyName = (id: string | null): string | null => companies.find((c) => c.id === id)?.name ?? null;

function stamp(date: string, hhmm = '10:30'): string {
  return istToIso(date, hhmm);
}

function newAdvance(store: Store, a: Omit<Advance, 'id' | 'version' | 'entryNo' | 'companyName' | 'hotelBalancePaise' | 'foodBalancePaise' | 'refund' | 'usedOn' | 'createdAt' | 'fromBillNo'> & { fromBillNo?: string | null; createdAt?: string }): Advance {
  const adv: Advance = {
    ...a,
    id: `adv-${++store.seq}`,
    version: 1,
    entryNo: store.advances.length + 1,
    companyName: companyName(a.companyId),
    hotelBalancePaise: a.hotelPaise,
    foodBalancePaise: a.foodPaise,
    refund: null,
    usedOn: [],
    fromBillNo: a.fromBillNo ?? null,
    createdAt: a.createdAt ?? stamp(a.paymentDate),
  };
  store.advances.push(adv);
  return adv;
}

function buildBill(store: Store, input: BillInput, billNo: string, id: string, createdAt: string, prev: Bill | null): Bill {
  const ht = hotelTotal(input.hotel);
  const ft = foodTotal(input.food);
  const stay = priceStay(input.stay);
  let applied: AppliedAdvance | null = prev ? prev.advance : null;
  if (!prev && input.advanceId) {
    const adv = store.advances.find((x) => x.id === input.advanceId);
    if (adv) {
      const h = Math.min(adv.hotelBalancePaise, ht);
      const f = Math.min(adv.foodBalancePaise, ft);
      adv.hotelBalancePaise -= h;
      adv.foodBalancePaise -= f;
      adv.usedOn.push(billNo);
      applied = { advanceId: adv.id, receiptNo: adv.receiptNo, guestName: adv.guestName, hotelPaise: h, foodPaise: f };
    }
  }
  // Improved over Pallav: what is owed on debit is the total less the advance already taken off.
  const balanceHotelPaise = input.hotel.mode === 'Debit' ? Math.max(0, ht - (applied?.hotelPaise ?? 0)) : 0;
  const balanceFoodPaise = input.food.mode === 'Debit' ? Math.max(0, ft - (applied?.foodPaise ?? 0)) : 0;
  return {
    id,
    billNo,
    billDate: input.billDate,
    grNo: input.grNo.trim(),
    guestName: input.guestName.trim(),
    mobile: input.mobile.trim(),
    address: input.address.trim(),
    gstin: input.gstin.trim().toUpperCase(),
    companyId: input.companyId,
    companyName: companyName(input.companyId),
    roomNo: input.roomNo.trim(),
    persons: input.persons,
    arrivalAt: input.arrivalAt,
    departureAt: input.departureAt,
    hotel: { ...input.hotel },
    food: { ...input.food },
    // the mock hotel's GST default is 5% on both sides
    hotelGstPercent: typedGstRate(hotelTaxable(input.hotel), input.hotel.gstPaise, [prev?.hotelGstPercent ?? null, 5]),
    foodGstPercent: typedGstRate(foodTaxable(input.food), input.food.gstPaise, [prev?.foodGstPercent ?? null, 5]),
    hotelSac: prev?.hotelSac ?? GST_SAC.hotel,
    foodSac: prev?.foodSac ?? GST_SAC.food,
    hotelTotalPaise: ht,
    foodTotalPaise: ft,
    advance: applied,
    balanceHotelPaise,
    balanceFoodPaise,
    stay: stay.segments,
    planFoodOwedPaise: stay.totalPaise,
    referenceName: input.referenceName.trim(),
    referenceMobile: input.referenceMobile.trim(),
    instruction: input.instruction.trim(),
    settlement: null,
    createdAt,
    version: prev ? prev.version + 1 : 1,
    entryNo: prev ? prev.entryNo : store.bills.length + 1,
  };
}

function settle(store: Store, bill: Bill, input: SettleInput, recordedAt: string): void {
  const paidH = input.installments.reduce((n, i) => n + i.hotelPaise, 0);
  const paidF = input.installments.reduce((n, i) => n + i.foodPaise, 0);
  const leftH = bill.balanceHotelPaise - paidH;
  const leftF = bill.balanceFoodPaise - paidF;
  let excessReceiptNo: string | null = null;
  const exH = Math.max(0, -leftH);
  const exF = Math.max(0, -leftF);
  if (exH > 0 || exF > 0) {
    excessReceiptNo = `Excessive / ${bill.billNo}`;
    const last = input.installments[input.installments.length - 1];
    newAdvance(store, {
      receiptNo: excessReceiptNo,
      paymentDate: last?.date ?? todayIst(),
      guestName: bill.guestName,
      mobile: bill.mobile,
      companyId: bill.companyId,
      roomNo: bill.roomNo,
      hotelPaise: exH,
      foodPaise: exF,
      hotelMode: exH > 0 ? (last?.hotelMode ?? null) : null,
      foodMode: exF > 0 ? (last?.foodMode ?? null) : null,
      referenceName: input.referenceName,
      referenceMobile: input.referenceMobile,
      instruction: `Overpaid on bill ${bill.billNo}`,
      fromBillNo: bill.billNo,
      createdAt: recordedAt,
    });
  }
  bill.balanceHotelPaise = Math.max(0, leftH);
  bill.balanceFoodPaise = Math.max(0, leftF);
  // a further payment (H6) keeps the earlier instalments and the reference unless a new one is typed
  const before = bill.settlement;
  bill.settlement = {
    installments: [...(before?.installments ?? []), ...input.installments.map((i) => ({ ...i }))],
    referenceName: input.referenceName.trim() || (before?.referenceName ?? ''),
    referenceMobile: input.referenceMobile.trim() || (before?.referenceMobile ?? ''),
    instruction: input.instruction.trim() || (before?.instruction ?? ''),
    excessReceiptNo: excessReceiptNo ?? before?.excessReceiptNo ?? null,
    recordedAt,
  };
}

function refund(a: Advance, input: RefundInput): void {
  const h = input.hotelPaise ?? 0;
  const f = input.foodPaise ?? 0;
  a.hotelBalancePaise -= h;
  a.foodBalancePaise -= f;
  a.refund = {
    date: input.date,
    hotelPaise: h,
    foodPaise: f,
    hotelMode: h > 0 ? input.hotelMode : null,
    foodMode: f > 0 ? input.foodMode : null,
    toName: input.toName.trim(),
    toMobile: input.toMobile.trim(),
    note: input.note.trim(),
  };
}

interface SeedBill {
  no: number;
  date: string;
  gr?: string;
  guest: string;
  mobile?: string;
  address?: string;
  gstin?: string;
  co?: string;
  room?: string;
  persons?: number;
  in?: [string, string];
  out?: [string, string];
  plan?: HotelPlan;
  room$?: number;
  plan$?: number;
  bed$?: number;
  laundry$?: number;
  vpo$?: number;
  hMode?: PaymentMode;
  food$?: number;
  fPlan$?: number;
  fLaundry$?: number;
  fMode?: PaymentMode;
  adv?: string;
  ref?: [string, string];
  note?: string;
  stay?: StaySegment[];
  settle?: SettleInput;
}

function seedBill(store: Store, s: SeedBill, advIds: Record<string, string>): void {
  const hotel: HotelCharges = {
    ...emptyHotel(),
    plan: s.plan ?? null,
    roomPaise: r(s.room$ ?? 0),
    planPaise: r(s.plan$ ?? 0),
    extraBedPaise: r(s.bed$ ?? 0),
    laundryPaise: r(s.laundry$ ?? 0),
    vpoPaise: r(s.vpo$ ?? 0),
    mode: s.hMode ?? null,
  };
  // Mock GST: 5% on the room side and the food side (illustration only).
  hotel.gstPaise = Math.round((hotel.roomPaise + hotel.planPaise + hotel.extraBedPaise + hotel.laundryPaise) * 0.05);
  const food: FoodCharges = { ...emptyFood(), foodPaise: r(s.food$ ?? 0), planPaise: r(s.fPlan$ ?? 0), laundryPaise: r(s.fLaundry$ ?? 0), mode: s.fMode ?? null };
  food.gstPaise = Math.round((food.foodPaise + food.planPaise + food.laundryPaise) * 0.05);
  const input: BillInput = {
    billNo: String(s.no),
    billDate: s.date,
    grNo: s.gr ?? '',
    advanceId: s.adv ? (advIds[s.adv] ?? null) : null,
    guestName: s.guest,
    mobile: s.mobile ?? '',
    address: s.address ?? '',
    gstin: s.gstin ?? '',
    companyId: s.co ?? null,
    roomNo: s.room ?? '',
    persons: s.persons ?? null,
    arrivalAt: s.in ? istToIso(s.in[0], s.in[1]) : null,
    departureAt: s.out ? istToIso(s.out[0], s.out[1]) : null,
    hotel,
    food,
    stay: s.stay ?? (s.in && s.out && s.plan ? [{ from: s.in[0], to: s.out[0], plan: s.plan, persons: s.persons ?? 1 }] : []),
    referenceName: s.ref?.[0] ?? '',
    referenceMobile: s.ref?.[1] ?? '',
    instruction: s.note ?? '',
  };
  const billNo = `2026 / ${s.no}`;
  const bill = buildBill(store, input, billNo, `bill-${++store.seq}`, stamp(s.date, '11:45'), null);
  store.bills.push(bill);
  if (s.settle) {
    const last = s.settle.installments[s.settle.installments.length - 1];
    settle(store, bill, s.settle, stamp(last?.date ?? s.date, '16:10'));
  }
}

function seed(): Store {
  // A brand-new hotel (mock): no advances, bills, recycle bin or companies; entry numbers start at 1.
  companies.splice(0, companies.length, ...(mockEmptyHotel() ? [] : DEMO_COMPANIES));
  if (mockEmptyHotel()) return { advances: [], bills: [], seq: 0, bin: [] };
  const store: Store = { advances: [], bills: [], seq: 0 };
  const ids: Record<string, string> = {};
  const add = (key: string, a: Parameters<typeof newAdvance>[1]): void => {
    ids[key] = newAdvance(store, a).id;
  };
  const base = { referenceName: '', referenceMobile: '', instruction: '' };

  add('A1', { ...base, receiptNo: '2026 / 801', paymentDate: '2026-08-28', guestName: 'Rakesh Patel', mobile: '9824012345', companyId: 'co-1', roomNo: '204', hotelPaise: r(5000), foodPaise: 0, hotelMode: 'Cash', foodMode: null, referenceName: 'Hitesh Vora (Admin)', referenceMobile: '9825098250' });
  add('A2', { ...base, receiptNo: '2026 / 802', paymentDate: '2026-09-02', guestName: 'Meera Joshi', mobile: '9898123456', companyId: null, roomNo: '105', hotelPaise: r(3000), foodPaise: r(1000), hotelMode: 'UPI', foodMode: 'UPI' });
  add('A3', { ...base, receiptNo: '2026 / 803', paymentDate: '2026-09-10', guestName: 'Vikram Singh Rathore', mobile: '9414077777', companyId: 'co-2', roomNo: '301', hotelPaise: r(10000), foodPaise: 0, hotelMode: 'Bank Transfer', foodMode: null, instruction: 'Company to clear the rest on checkout.' });
  add('A4', { ...base, receiptNo: '2026 / 804', paymentDate: '2026-09-14', guestName: 'Anjali Mehta', mobile: '9925011122', companyId: null, roomNo: '102', hotelPaise: r(2000), foodPaise: 0, hotelMode: 'Cash', foodMode: null });
  add('A5', { ...base, receiptNo: '2026 / 805', paymentDate: '2026-09-18', guestName: 'Suresh Iyer', mobile: '9443210987', companyId: 'co-3', roomNo: '207', hotelPaise: r(8000), foodPaise: r(2000), hotelMode: 'Card', foodMode: 'Card' });
  add('A6', { ...base, receiptNo: '2026 / 806', paymentDate: '2026-09-22', guestName: 'Dr. Harshvardhan Chandrashekhar Venkataraman', mobile: '9840098400', companyId: 'co-6', roomNo: '401', hotelPaise: r(15000), foodPaise: 0, hotelMode: 'Cheque', foodMode: null, referenceName: 'Purchase Dept.', referenceMobile: '07926541234', instruction: 'Cheque no. 004512, HDFC Bank, Ahmedabad.' });
  add('A7', { ...base, receiptNo: '2026 / 807', paymentDate: '2026-09-26', guestName: 'Pooja Desai', mobile: '9879012345', companyId: null, roomNo: '', hotelPaise: 0, foodPaise: r(1500), hotelMode: null, foodMode: 'Cash', instruction: 'Birthday dinner booking, 12 people.' });
  add('A8', { ...base, receiptNo: '2026 / 808', paymentDate: '2026-09-29', guestName: 'Imran Shaikh', mobile: '9601234567', companyId: 'co-4', roomNo: '208', hotelPaise: r(4000), foodPaise: 0, hotelMode: 'UPI', foodMode: null });
  add('A9', { ...base, receiptNo: '2026 / 809', paymentDate: '2026-10-01', guestName: 'Kavita Nair', mobile: '9846012345', companyId: null, roomNo: '103', hotelPaise: r(2500), foodPaise: 0, hotelMode: 'Cash', foodMode: null });
  add('A10', { ...base, receiptNo: '2026 / 810', paymentDate: '2026-10-02', guestName: 'Arjun Malhotra', mobile: '9811012345', companyId: 'co-5', roomNo: '302', hotelPaise: r(6000), foodPaise: r(1500), hotelMode: 'Bank Transfer', foodMode: 'Bank Transfer' });
  add('A11', { ...base, receiptNo: '2026 / 811', paymentDate: '2026-10-03', guestName: 'Neha Gupta', mobile: '9930012345', companyId: null, roomNo: '106', hotelPaise: r(1000), foodPaise: 0, hotelMode: 'UPI', foodMode: null });
  add('A12', { ...base, receiptNo: '2026 / 812', paymentDate: '2026-10-04', guestName: 'Rohan Bhatt', mobile: '9727012345', companyId: 'co-1', roomNo: '205', hotelPaise: r(3500), foodPaise: 0, hotelMode: 'Card', foodMode: null });
  add('A13', { ...base, receiptNo: '2026 / 813', paymentDate: '2026-10-05', guestName: 'Farhan Qureshi', mobile: '9898765432', companyId: null, roomNo: '110', hotelPaise: r(500), foodPaise: 0, hotelMode: 'Cash', foodMode: null });
  add('A14', { ...base, receiptNo: '2026 / 814', paymentDate: '2026-10-06', guestName: 'Bhavin Thakkar', mobile: '9824456789', companyId: 'co-2', roomNo: '305', hotelPaise: r(4000), foodPaise: r(1000), hotelMode: 'Card', foodMode: 'Card', referenceName: 'Kalpesh Ghetiya (HR)', referenceMobile: '9879456123', instruction: 'Rest to be used on his next visit this month.' });
  add('A15', { ...base, receiptNo: '2026 / 815', paymentDate: '2026-10-07', guestName: 'Hetal Parmar', mobile: '8866012345', companyId: null, roomNo: '104', hotelPaise: r(2000), foodPaise: r(500), hotelMode: 'UPI', foodMode: 'UPI' });
  add('A16', { ...base, receiptNo: '2026 / 816', paymentDate: '2026-10-08', guestName: 'Jayesh Solanki', mobile: '7990123456', companyId: 'co-5', roomNo: '306', hotelPaise: r(3000), foodPaise: 0, hotelMode: 'Cash', foodMode: null, instruction: 'Group of 6, Dwarka-Somnath tour.' });
  add('A17', { ...base, receiptNo: '2026 / 817', paymentDate: '2026-10-09', guestName: 'Dhruv Vaghela', mobile: '9375012345', companyId: null, roomNo: '202', hotelPaise: r(1500), foodPaise: 0, hotelMode: 'Cash', foodMode: null, instruction: 'Wrong guest name; entered again as 818.' });
  add('A18', { ...base, receiptNo: '2026 / 818', paymentDate: '2026-10-09', guestName: 'Dhruvi Vaghela', mobile: '9375012345', companyId: null, roomNo: '202', hotelPaise: r(1500), foodPaise: 0, hotelMode: 'Cash', foodMode: null });
  add('A19', { ...base, receiptNo: '2026 / 819', paymentDate: '2026-10-08', guestName: 'Rahul Deshpande', mobile: '9890456712', companyId: 'co-7', roomNo: '306', hotelPaise: r(3000), foodPaise: 0, hotelMode: 'Bank Transfer', foodMode: null, referenceName: 'Farhan Shaikh (Travel desk)', referenceMobile: '9099054321', instruction: 'SPARC advance for a 2-night stay; balance on the monthly debit.' });

  const bills: SeedBill[] = [
    { no: 1170, date: '2026-08-30', gr: 'GR-3301', guest: 'Rakesh Patel', mobile: '9824012345', address: 'Morbi, Gujarat', co: 'co-1', gstin: '24AAKCS4821M1Z2', room: '204', persons: 1, in: ['2026-08-28', '14:00'], out: ['2026-08-30', '11:00'], plan: 'CP', room$: 6000, plan$: 1000, laundry$: 200, hMode: 'Debit', food$: 1200, fMode: 'Debit', adv: 'A1',
      settle: { installments: [{ date: '2026-09-10', hotelPaise: r(1000), hotelMode: 'Bank Transfer', foodPaise: r(1260), foodMode: 'Bank Transfer' }, { date: '2026-09-15', hotelPaise: r(1560), hotelMode: 'Cheque', foodPaise: 0, foodMode: null }], referenceName: 'Hitesh Vora', referenceMobile: '9825098250', instruction: 'NEFT ref. N2589631 and cheque 118845.' } },
    { no: 1171, date: '2026-09-03', gr: 'GR-3315', guest: 'Meera Joshi', mobile: '9898123456', address: 'Jamnagar', room: '105', persons: 2, in: ['2026-09-01', '13:00'], out: ['2026-09-03', '10:30'], plan: 'EP', room$: 5000, hMode: 'Cash', food$: 1800, fMode: 'UPI', adv: 'A2' },
    { no: 1172, date: '2026-09-08', gr: 'GR-3322', guest: 'Sanjay Kothari', mobile: '9909012345', address: 'Surat', room: '109', persons: 1, in: ['2026-09-07', '20:00'], out: ['2026-09-08', '09:00'], plan: 'EP', room$: 2800, hMode: 'UPI' },
    { no: 1173, date: '2026-09-12', gr: 'GR-3330', guest: 'Vikram Singh Rathore', mobile: '9414077777', address: 'Jaipur, Rajasthan', co: 'co-2', gstin: '24AAFFK7310P1Z9', room: '301', persons: 2, in: ['2026-09-10', '12:00'], out: ['2026-09-12', '11:00'], plan: 'MAP', room$: 9000, plan$: 2400, laundry$: 350, vpo$: 600, hMode: 'Debit', food$: 2200, fMode: 'Cash', adv: 'A3', ref: ['Mr. Bhavesh Doshi', '9879098790'], note: 'Company PO 4500127 to be quoted on the debit bill.' },
    { no: 1174, date: '2026-09-16', gr: 'GR-3338', guest: 'Amit Trivedi', mobile: '9825501234', address: 'Veraval', co: 'co-3', gstin: '24AAJFG2290Q1Z4', room: '206', persons: 1, in: ['2026-09-14', '15:00'], out: ['2026-09-16', '10:00'], plan: 'CP', room$: 5200, plan$: 500, hMode: 'Debit', food$: 900, fMode: 'Debit',
      settle: { installments: [{ date: '2026-09-28', hotelPaise: r(7000), hotelMode: 'Bank Transfer', foodPaise: r(945), foodMode: 'Bank Transfer' }], referenceName: 'Accounts, Gir Agro', referenceMobile: '9825011223', instruction: 'Paid ₹1,015 extra by mistake. Kept as advance for next stay.' } },
    { no: 1175, date: '2026-09-20', gr: 'GR-3344', guest: 'Suresh Iyer', mobile: '9443210987', address: 'Chennai, Tamil Nadu', co: 'co-3', room: '207', persons: 1, in: ['2026-09-18', '18:00'], out: ['2026-09-20', '11:00'], plan: 'CP', room$: 5400, plan$: 500, hMode: 'Card', food$: 1100, fMode: 'Card', adv: 'A5' },
    { no: 1176, date: '2026-09-24', gr: 'GR-3351', guest: 'Dr. Harshvardhan Chandrashekhar Venkataraman', mobile: '9840098400', address: 'Plot 22, GIDC Phase II, Vatva, Ahmedabad, Gujarat 382445', co: 'co-6', gstin: '24AACCW9052H1Z6', room: '401', persons: 3, in: ['2026-09-21', '12:00'], out: ['2026-09-24', '12:00'], plan: 'MAP', room$: 18000, plan$: 5400, bed$: 2400, laundry$: 800, vpo$: 1250, hMode: 'Debit', food$: 3600, fLaundry$: 0, fMode: 'Debit', adv: 'A6', ref: ['Purchase Dept.', '07926541234'], note: 'Send the debit bill with GST copy to purchase@wgpls.example.' },
    { no: 1177, date: '2026-09-27', guest: 'Pooja Desai', mobile: '9879012345', food$: 6800, fMode: 'Cash', adv: 'A7', note: 'Birthday dinner, 12 people.' },
    { no: 1178, date: '2026-09-30', gr: 'GR-3360', guest: 'Mahesh Pandya', mobile: '9824598245', address: 'Rajkot', room: '101', persons: 2, in: ['2026-09-29', '14:00'], out: ['2026-09-30', '11:00'], plan: 'EP', hMode: 'Complimentary', note: 'Owner guest. No charge.' },
    { no: 1179, date: '2026-10-01', gr: 'GR-3366', guest: 'Ritu Agarwal', mobile: '9830012345', address: 'Kolkata, West Bengal', room: '107', persons: 2, in: ['2026-09-29', '13:30'], out: ['2026-10-01', '11:00'], plan: 'CP', room$: 5600, plan$: 1000, laundry$: 150, hMode: 'Card', food$: 1450, fMode: 'Card' },
    { no: 1180, date: '2026-10-03', gr: 'GR-3371', guest: 'Neha Gupta', mobile: '9930012345', address: 'Mumbai, Maharashtra', room: '106', persons: 1, in: ['2026-10-02', '16:00'], out: ['2026-10-03', '10:00'], plan: 'EP', room$: 2600, hMode: 'UPI', adv: 'A11' },
    { no: 1181, date: '2026-10-03', gr: 'GR-3373', guest: 'Karan Shah', mobile: '9898012345', address: 'Rajkot', co: 'co-4', gstin: '24AADCR6604L1Z7', room: '303', persons: 1, in: ['2026-10-01', '12:00'], out: ['2026-10-03', '11:00'], plan: 'CP', room$: 5600, plan$: 500, hMode: 'Debit', food$: 750, fMode: 'Debit' },
    { no: 1182, date: '2026-10-04', gr: 'GR-3378', guest: 'Deepak Chauhan', mobile: '9727098765', address: 'Surat', co: 'co-5', gstin: '24ABQPB1187K1Z1', room: '304', persons: 2, in: ['2026-10-01', '12:00'], out: ['2026-10-04', '11:00'], plan: 'CP', room$: 8400, plan$: 1500, laundry$: 400, hMode: 'Debit', food$: 2100, fMode: 'Debit',
      settle: { installments: [
        { date: '2026-10-04', hotelPaise: r(4000), hotelMode: 'UPI', foodPaise: 0, foodMode: null },
        { date: '2026-10-05', hotelPaise: r(4000), hotelMode: 'Bank Transfer', foodPaise: r(2205), foodMode: 'Bank Transfer' },
        { date: '2026-10-05', hotelPaise: r(2815), hotelMode: 'Cheque', foodPaise: 0, foodMode: null },
      ], referenceName: 'Jignesh Patel', referenceMobile: '9825712345', instruction: '' } },
    { no: 1183, date: '2026-10-04', gr: 'GR-3380', guest: 'Sneha Kulkarni', mobile: '9822012345', address: 'Pune, Maharashtra', room: '209', persons: 2, in: ['2026-10-01', '13:00'], out: ['2026-10-04', '10:00'], plan: 'MAP', room$: 8100, plan$: 3000, hMode: 'Cash', food$: 950, fMode: 'Cash',
      stay: [{ from: '2026-10-01', to: '2026-10-02', plan: 'CP', persons: 2 }, { from: '2026-10-02', to: '2026-10-04', plan: 'MAP', persons: 3 }], note: 'Plan changed from CP to MAP on the second night; a third person joined.' },
    { no: 1184, date: '2026-10-05', gr: 'GR-3384', guest: 'Manoj Verma', mobile: '9811098110', address: 'New Delhi', room: '108', persons: 1, in: ['2026-10-04', '11:00'], out: ['2026-10-05', '09:30'], plan: 'EP', room$: 2800, laundry$: 120, hMode: 'Bank Transfer' },
    { no: 1185, date: '2026-10-05', gr: 'GR-3386', guest: 'Priya Raval', mobile: '9909098765', address: 'Morbi', co: 'co-1', gstin: '24AAKCS4821M1Z2', room: '203', persons: 1, in: ['2026-10-03', '12:00'], out: ['2026-10-05', '11:00'], plan: 'CP', room$: 5600, plan$: 500, hMode: 'Debit', food$: 640, fMode: 'Debit' },
    { no: 1186, date: '2026-10-07', gr: 'GR-3391', guest: 'Bhavin Thakkar', mobile: '9824456789', address: 'Metoda GIDC, Rajkot', co: 'co-2', gstin: '24AABCJ4521M1Z8', room: '305', persons: 1, in: ['2026-10-06', '13:00'], out: ['2026-10-07', '11:00'], plan: 'CP', room$: 2800, plan$: 250, hMode: 'Cash', food$: 600, fMode: 'Cash', adv: 'A14' },
    { no: 1187, date: '2026-10-08', gr: 'GR-3394', guest: 'Kinjal Dave', mobile: '8780012345', address: 'Bhavnagar', room: '201', persons: 2, in: ['2026-10-07', '12:30'], out: ['2026-10-08', '10:00'], plan: 'EP', room$: 3000, hMode: 'Cash', food$: 850, fMode: 'UPI' },
    { no: 1188, date: '2026-10-09', gr: 'GR-3397', guest: 'Nilesh Bhalodiya', mobile: '9426012345', address: 'Shapar-Veraval, Rajkot', co: 'co-3', gstin: '24AAACA6713K1Z3', room: '307', persons: 1, in: ['2026-10-07', '12:00'], out: ['2026-10-09', '11:00'], plan: 'MAP', room$: 5600, plan$: 1200, hMode: 'Debit', food$: 900, fMode: 'Debit', ref: ['Accounts, Atul Auto', '9825034567'], note: 'Monthly debit; send with the October statement.' },
    { no: 1189, date: '2026-10-08', gr: 'GR-3395', guest: 'Prakash Rana', mobile: '9898845612', address: 'Vadodara', co: 'co-4', gstin: '24AAACG7393C1ZB', room: '308', persons: 1, in: ['2026-10-07', '15:00'], out: ['2026-10-08', '11:00'], plan: 'CP', room$: 2800, plan$: 250, hMode: 'Debit', food$: 400, fMode: 'Debit',
      settle: { installments: [{ date: '2026-10-10', hotelPaise: r(3202.5), hotelMode: 'Bank Transfer', foodPaise: r(420), foodMode: 'Bank Transfer' }], referenceName: 'GSFC Accounts', referenceMobile: '9824076543', instruction: 'RTGS ref. GSFC0091123.' } },
    { no: 1190, date: '2026-10-10', gr: 'GR-3399', guest: 'Ramesh Makwana', mobile: '7046012345', address: 'Gondal', room: '102', persons: 2, in: ['2026-10-09', '18:00'], out: ['2026-10-10', '10:30'], plan: 'EP', room$: 2600, laundry$: 100, hMode: 'UPI', food$: 520, fMode: 'UPI' },
    // Ledgers for the companies added later (co-7, co-8, co-10, co-11): one paid and one on debit each where it fits.
    { no: 1191, date: '2026-09-26', gr: 'GR-3349', guest: 'Dr. Swati Kelkar', mobile: '9822345610', address: 'Tandalja, Vadodara', co: 'co-7', gstin: '24AAKCS1234D1Z1', room: '302', persons: 1, in: ['2026-09-24', '13:00'], out: ['2026-09-26', '11:00'], plan: 'CP', room$: 5600, plan$: 1000, laundry$: 250, hMode: 'Debit', food$: 1300, fMode: 'Debit',
      settle: { installments: [{ date: '2026-10-06', hotelPaise: r(7192.5), hotelMode: 'Bank Transfer', foodPaise: r(1365), foodMode: 'Bank Transfer' }], referenceName: 'Farhan Shaikh (Travel desk)', referenceMobile: '9099054321', instruction: 'NEFT ref. SPARC0610442.' } },
    { no: 1192, date: '2026-10-10', gr: 'GR-3398', guest: 'Rahul Deshpande', mobile: '9890456712', address: 'Pune, Maharashtra', co: 'co-7', gstin: '24AAKCS1234D1Z1', room: '306', persons: 1, in: ['2026-10-08', '13:00'], out: ['2026-10-10', '09:30'], plan: 'MAP', room$: 5600, plan$: 2400, hMode: 'Debit', food$: 700, fMode: 'Debit', adv: 'A19', ref: ['Farhan Shaikh (Travel desk)', '9099054321'], note: 'Balance on the monthly SPARC debit statement.' },
    { no: 1193, date: '2026-10-02', gr: 'GR-3368', guest: 'Chirag Sojitra', mobile: '9879345120', address: 'Kalawad Road, Rajkot', co: 'co-8', gstin: '24AAJFP8899L1ZQ', room: '306', persons: 2, in: ['2026-09-30', '12:00'], out: ['2026-10-02', '11:00'], plan: 'EP', room$: 6000, bed$: 800, hMode: 'Debit', food$: 4200, fMode: 'Debit', ref: ['Dhaval Patel', '9925099250'], note: 'Wedding décor crew; extra bed both nights.' },
    { no: 1194, date: '2026-09-21', gr: 'GR-3346', guest: 'Hiral Bhuva', mobile: '9727456781', address: 'Mavdi, Rajkot', co: 'co-8', gstin: '24AAJFP8899L1ZQ', room: '308', persons: 2, in: ['2026-09-19', '12:00'], out: ['2026-09-21', '11:00'], plan: 'CP', room$: 5600, plan$: 1000, hMode: 'UPI', food$: 1500, fMode: 'UPI' },
    { no: 1195, date: '2026-09-29', gr: 'GR-3358', guest: 'Ketan Ramani', mobile: '9824789012', address: 'Vajdi Virda, Rajkot', co: 'co-10', gstin: '24AABCB2299E1Z0', room: '303', persons: 1, in: ['2026-09-27', '15:00'], out: ['2026-09-29', '11:00'], plan: 'CP', room$: 5200, plan$: 500, hMode: 'Debit', food$: 800, fMode: 'Debit',
      settle: { installments: [{ date: '2026-10-08', hotelPaise: r(5985), hotelMode: 'Cheque', foodPaise: r(840), foodMode: 'Cheque' }], referenceName: 'Mukesh Kotecha (Accounts)', referenceMobile: '9824567890', instruction: 'Cheque no. 231407, Bank of Baroda, Rajkot.' } },
    { no: 1196, date: '2026-10-06', gr: 'GR-3389', guest: 'Jagruti Kakadiya', mobile: '9913456702', address: 'Upleta', co: 'co-10', gstin: '24AABCB2299E1Z0', room: '208', persons: 1, in: ['2026-10-04', '13:00'], out: ['2026-10-06', '10:30'], plan: 'EP', room$: 5000, laundry$: 180, hMode: 'Debit', food$: 950, fMode: 'Debit', ref: ['Mukesh Kotecha (Accounts)', '9824567890'] },
    { no: 1197, date: '2026-10-10', gr: 'GR-3388', guest: 'Arvind Menon', mobile: '9167234589', address: 'Andheri East, Mumbai, Maharashtra', co: 'co-11', gstin: '24AAECS5698N1ZT', room: '205', persons: 1, in: ['2026-10-06', '14:00'], out: ['2026-10-10', '10:00'], plan: 'CP', room$: 11200, plan$: 1000, laundry$: 300, vpo$: 450, hMode: 'Debit', food$: 1600, fMode: 'Debit', ref: ['Rohit Malhotra (Travel desk)', '9167054321'], note: 'Civil Hospital MRI install. Quote PO 7100453 on the debit bill.' },
    { no: 1198, date: '2026-09-19', gr: 'GR-3341', guest: 'Nitin Bhardwaj', mobile: '9810345678', address: 'Gurugram, Haryana', co: 'co-11', gstin: '24AAECS5698N1ZT', room: '307', persons: 1, in: ['2026-09-17', '13:00'], out: ['2026-09-19', '11:00'], plan: 'CP', room$: 5600, plan$: 500, hMode: 'Card', food$: 700, fMode: 'Card' },
  ];
  for (const b of bills) seedBill(store, b, ids);

  const a4 = store.advances.find((a) => a.id === ids.A4);
  if (a4) refund(a4, { date: '2026-09-15', hotelPaise: r(2000), foodPaise: null, hotelMode: 'Cash', foodMode: null, toName: 'Anjali Mehta', toMobile: '9925011122', note: 'Stay cancelled. Full refund.' });
  const a8 = store.advances.find((a) => a.id === ids.A8);
  if (a8) refund(a8, { date: '2026-10-01', hotelPaise: r(1500), foodPaise: null, hotelMode: 'UPI', foodMode: null, toName: 'Imran Shaikh', toMobile: '9601234567', note: 'Left one night early.' });
  const a16 = store.advances.find((a) => a.id === ids.A16);
  if (a16) refund(a16, { date: '2026-10-09', hotelPaise: r(3000), foodPaise: null, hotelMode: 'Cash', foodMode: null, toName: 'Jayesh Solanki', toMobile: '7990123456', note: 'Group tour postponed. Full refund.' });
  // One advance starts in the recycle bin (deleted by mistake-entry, can be restored).
  const a17 = store.advances.find((a) => a.id === ids.A17);
  if (a17) {
    store.advances = store.advances.filter((a) => a !== a17);
    store.bin = [a17];
  }
  shiftSeed(store);
  clampSeedTimes(store);
  return store;
}

/**
 * Seed times written for "today" (e.g. 16:10) can still be ahead of the real clock; any stamp later than now
 * is pulled back to now − (k+1)·5 min (k = 0 for the latest), so stamps stay distinct, in order and not in the future.
 */
function clampSeedTimes(store: Store): void {
  const now = Date.now();
  const slots: { get: () => string; set: (v: string) => void }[] = [];
  for (const a of [...store.advances, ...(store.bin ?? [])]) slots.push({ get: () => a.createdAt, set: (v) => { a.createdAt = v; } });
  for (const b of store.bills) {
    slots.push({ get: () => b.createdAt, set: (v) => { b.createdAt = v; } });
    const st = b.settlement;
    if (st) slots.push({ get: () => st.recordedAt, set: (v) => { st.recordedAt = v; } });
  }
  slots
    .filter((s) => Date.parse(s.get()) > now)
    .sort((x, y) => Date.parse(y.get()) - Date.parse(x.get()))
    .forEach((s, k) => s.set(new Date(now - (k + 1) * 5 * 60_000).toISOString()));
}

/** The seed is written as if today were this day; every seed date moves with the real today so month/week filters and KPIs stay filled. */
const SEED_TODAY = '2026-10-10';

function shiftSeed(store: Store): void {
  const ms = Math.round((Date.parse(todayIst()) - Date.parse(SEED_TODAY)) / 86_400_000) * 86_400_000;
  if (!ms) return;
  const d = (s: string): string => new Date(Date.parse(s) + ms).toISOString().slice(0, 10);
  const t = (s: string): string => new Date(Date.parse(s) + ms).toISOString();
  for (const a of [...store.advances, ...(store.bin ?? [])]) {
    a.paymentDate = d(a.paymentDate);
    a.createdAt = t(a.createdAt);
    if (a.refund) a.refund.date = d(a.refund.date);
  }
  for (const b of store.bills) {
    b.billDate = d(b.billDate);
    b.createdAt = t(b.createdAt);
    if (b.arrivalAt) b.arrivalAt = t(b.arrivalAt);
    if (b.departureAt) b.departureAt = t(b.departureAt);
    for (const s of b.stay) { s.from = d(s.from); s.to = d(s.to); }
    if (b.settlement) {
      b.settlement.recordedAt = t(b.settlement.recordedAt);
      for (const i of b.settlement.installments) i.date = d(i.date);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Lists, filters, KPIs                                                */
/* ------------------------------------------------------------------ */

function matchFilters(modes: string[], companyId: string | null, date: string, q: { mode?: string; companyId?: string; month?: string }): boolean {
  if (q.mode && !modes.includes(q.mode)) return false;
  if (q.companyId && (q.companyId === 'walkin' ? companyId !== null : companyId !== q.companyId)) return false;
  if (q.month && !date.startsWith(q.month)) return false;
  return true;
}

function optionsFrom(rows: { modes: string[]; companyId: string | null; companyName: string | null; date: string }[]): FilterOptions {
  const modes = new Set<string>();
  const cos = new Map<string, string>();
  const months = new Set<string>();
  const counts = { modes: {} as Record<string, number>, companies: {} as Record<string, number>, months: {} as Record<string, number> };
  for (const x of rows) {
    x.modes.forEach((m) => { modes.add(m); counts.modes[m] = (counts.modes[m] ?? 0) + 1; });
    if (x.companyId && x.companyName) cos.set(x.companyId, x.companyName);
    const co = x.companyId ?? 'walkin';
    counts.companies[co] = (counts.companies[co] ?? 0) + 1;
    months.add(x.date.slice(0, 7));
    counts.months[x.date.slice(0, 7)] = (counts.months[x.date.slice(0, 7)] ?? 0) + 1;
  }
  return {
    modes: [...modes].sort(),
    companies: [...cos].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    months: [...months].sort().reverse(),
    counts,
  };
}

function newestFirst<T extends { createdAt: string }>(date: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => date(b).localeCompare(date(a)) || b.createdAt.localeCompare(a.createdAt);
}

function sum<T>(rows: T[], f: (x: T) => number): number {
  return rows.reduce((n, x) => n + f(x), 0);
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function storeFromFixtures(f: BillingFixtures): Store {
  companies.splice(0, companies.length, ...f.companies.map((c) => ({ id: String(c.id), name: c.name, gstin: c.gst_number ?? '' })));
  const at = (stamp: string): string => istToIso(stamp.slice(0, 10), stamp.slice(11, 16) || '00:00');
  const p = (n: number | null | undefined): number => r(n ?? 0);
  const co = (id: number | null): string | null => (id === null ? null : String(id));
  const store: Store = { advances: [], bills: [], seq: 0 };
  for (const a of f.advances) {
    store.advances.push({
      id: `adv-${a.id}`, version: 1, entryNo: a.entry_no, receiptNo: a.receipt_number, paymentDate: a.payment_date.slice(0, 10), guestName: a.guest_name,
      mobile: a.mobile_number ?? '', companyId: co(a.company_id), companyName: companyName(co(a.company_id)), roomNo: a.room_number ?? '',
      hotelPaise: p(a.hotel_amount), foodPaise: p(a.food_amount), hotelMode: a.hotel_mode, foodMode: a.food_mode,
      hotelBalancePaise: p(a.hotel_balance), foodBalancePaise: p(a.food_balance), referenceName: a.reference_name ?? '', referenceMobile: a.reference_mobile_number ?? '',
      instruction: a.instruction ?? '', refund: null, usedOn: f.bills.filter((b) => b.advance_id === a.id).map((b) => b.bill_number), fromBillNo: null, createdAt: at(a.created_at),
    });
    store.seq = Math.max(store.seq, a.id);
  }
  for (const b of f.bills) {
    store.bills.push({
      id: `bill-${b.id}`, version: 1, entryNo: b.entry_no, billNo: b.bill_number, billDate: b.bill_date.slice(0, 10), grNo: '', guestName: b.guest_name, mobile: b.mobile_number ?? '',
      address: '', gstin: '', companyId: co(b.company_id), companyName: companyName(co(b.company_id)), roomNo: b.room_number ?? '', persons: null, arrivalAt: null, departureAt: null,
      hotel: { plan: b.hotel_plan ? b.hotel_plan.replace(/ Plan$/, '') : null, roomPaise: p(b.hotel_amount), planPaise: p(b.hotel_plan_amount), extraBedPaise: 0, laundryPaise: p(b.hotel_laundry_amount), vpoPaise: 0, gstPaise: p(b.hotel_gst), mode: b.hotel_mode_of_payment ?? null },
      food: { foodPaise: p(b.food_amount), planPaise: p(b.food_plan_amount), laundryPaise: p(b.food_laundry_amount), gstPaise: p(b.food_gst), mode: b.food_mode_of_payment ?? null },
      hotelGstPercent: null, foodGstPercent: null,
      hotelTotalPaise: p(b.total_hotel_amount), foodTotalPaise: p(b.total_food_amount),
      advance: b.advance_id ? { advanceId: `adv-${b.advance_id}`, receiptNo: b.advance_receipt_number ?? '', guestName: b.advance_guest_name ?? '', hotelPaise: p(b.advance_hotel_amount), foodPaise: p(b.advance_food_amount) } : null,
      balanceHotelPaise: p(b.balance_hotel_amount), balanceFoodPaise: p(b.balance_food_amount), stay: [], planFoodOwedPaise: 0,
      referenceName: b.reference_name ?? '', referenceMobile: b.reference_mobile_number ?? '', instruction: b.instruction ?? '', settlement: null, createdAt: at(b.created_at),
    });
    store.seq = Math.max(store.seq, b.id);
  }
  return store;
}

function mockInvoiceMail(mobile: string | null | undefined, to: string | undefined): DashResult<{ queued: boolean; to: string }> {
  const typed = to?.trim();
  if (typed) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) ? ok({ queued: true, to: typed }) : mockError('VALIDATION_FAILED', { to: 'Enter a valid email address.' });
  const last = Number((mobile ?? '').replace(/\D/g, '').slice(-1));
  return last % 2 === 1 ? ok({ queued: true, to: 'guest@example.test' }) : mockError('VALIDATION_FAILED', { to: 'We have no email address for this guest. Type one.' });
}

export function createBillingApi(clock: MockClock = {}, fixtures?: BillingFixtures): BillingApi {
  const store = fixtures ? storeFromFixtures(fixtures) : seed();
  const call = <T>(fn: () => DashResult<T>): Promise<DashResult<T>> => mockCall(() => {
    const res = fn();
    return res.ok ? ok(clone(res.data)) : res;
  }, clock);
  const findAdv = (id: string): Advance | undefined => store.advances.find((a) => a.id === id);
  /** The recycle bin: deleted advances wait here until restored or deleted for ever. */
  const bin: Advance[] = store.bin ?? [];
  const stale = (a: Advance, version?: number) =>
    version !== undefined && version !== a.version ? mockError('CONFLICT', undefined, { currentVersion: a.version }) : null;
  const findBill = (id: string): Bill | undefined => store.bills.find((b) => b.id === id);
  const staleBill = (b: Bill, version?: number) =>
    version !== undefined && version !== b.version ? mockError('CONFLICT', undefined, { currentVersion: b.version }) : null;

  return {
    listCompanies: () => call(() => ok(companies)),

    listAdvances: (q) => call(() => {
      const month = todayIst().slice(0, 7);
      const all = [...(q.deleted === 'only' ? bin : store.advances)].sort(newestFirst((a) => a.paymentDate));
      const filtered = all.filter((a) => matchFilters(advanceModes(a), a.companyId, a.paymentDate, q));
      const counts: Record<AdvanceTab, number> = { all: filtered.length, unused: 0, partly: 0, used: 0, refunded: 0 };
      filtered.forEach((a) => { counts[advanceStatus(a)] += 1; });
      const tab = q.tab ?? 'all';
      const inTab = tab === 'all' ? filtered : filtered.filter((a) => advanceStatus(a) === tab);
      const page = pageOf(inTab, q, (a, s) => [a.receiptNo, a.guestName, a.mobile, a.roomNo, a.companyName ?? 'walk-in', advanceModes(a).join(' '), (advanceTaken(a) / 100).toFixed(2)]
        .join(' ').toLowerCase().includes(s));
      const thisMonth = all.filter((a) => a.paymentDate.startsWith(month));
      const refunded = all.filter((a) => a.refund);
      const kpis: Kpi[] = [
        { id: 'month', label: billingCopy.advances.kpi.month, value: sum(thisMonth, advanceTaken), kind: 'money', trend: null, tone: 'graphite', icon: 'wallet', hint: `${thisMonth.length} ${thisMonth.length === 1 ? 'advance' : 'advances'} · ${MONTH_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` },
        { id: 'held', label: billingCopy.advances.kpi.held, value: sum(all.filter((a) => !a.refund), advanceLeft), kind: 'money', trend: null, tone: 'success', icon: 'lock', hint: 'Not yet used on a bill' },
        { id: 'unused', label: billingCopy.advances.kpi.unused, value: all.filter((a) => advanceStatus(a) === 'unused').length, kind: 'count', trend: null, tone: 'warning', icon: 'clock', hint: 'Not linked to any bill yet' },
        { id: 'refunded', label: billingCopy.advances.kpi.refunded, value: sum(refunded, (a) => (a.refund ? a.refund.hotelPaise + a.refund.foodPaise : 0)), kind: 'money', trend: null, tone: 'danger', icon: 'arrowUp', hint: `${refunded.length} ${refunded.length === 1 ? 'advance' : 'advances'}` },
      ];
      const options = optionsFrom(all.map((a) => ({ modes: advanceModes(a), companyId: a.companyId, companyName: a.companyName, date: a.paymentDate })));
      return ok({ page, counts, kpis, options, all: all.length });
    }),

    getAdvance: (id) => call(() => {
      const a = findAdv(id);
      return a ? ok(a) : mockError('NOT_FOUND');
    }),

    listOpenAdvances: () => call(() => ok(store.advances.filter((a) => !a.refund && advanceLeft(a) > 0)
      .sort((a, b) => a.guestName.localeCompare(b.guestName)))),

    createAdvance: (input) => call(() => {
      const errors = validateAdvance(input, true);
      const receiptNo = `${currentYear()} / ${input.receiptNo.trim()}`;
      if (!errors.receiptNo && store.advances.some((a) => a.receiptNo === receiptNo)) errors.receiptNo = 'This receipt number is already used.';
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const hotelPaise = input.covers === 'food' ? 0 : (input.hotelPaise ?? 0);
      const foodPaise = input.covers === 'hotel' ? 0 : (input.foodPaise ?? 0);
      return ok(newAdvance(store, {
        receiptNo,
        paymentDate: input.paymentDate,
        guestName: input.guestName.trim(),
        mobile: input.mobile.trim(),
        companyId: input.companyId,
        roomNo: input.roomNo.trim(),
        hotelPaise,
        foodPaise,
        hotelMode: hotelPaise > 0 ? input.hotelMode : null,
        foodMode: foodPaise > 0 ? input.foodMode : null,
        referenceName: input.referenceName.trim(),
        referenceMobile: input.referenceMobile.trim(),
        instruction: input.instruction.trim(),
        createdAt: new Date().toISOString(),
      }));
    }),

    updateAdvance: (id, input) => call(() => {
      const a = findAdv(id);
      if (!a) return mockError('NOT_FOUND');
      const old = stale(a, input.version);
      if (old) return old;
      if (!canChangeAdvance(a)) return mockError('CONFLICT');
      const errors = validateAdvance(input, false);
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const hotelPaise = input.covers === 'food' ? 0 : (input.hotelPaise ?? 0);
      const foodPaise = input.covers === 'hotel' ? 0 : (input.foodPaise ?? 0);
      Object.assign(a, {
        paymentDate: input.paymentDate,
        guestName: input.guestName.trim(),
        mobile: input.mobile.trim(),
        companyId: input.companyId,
        companyName: companyName(input.companyId),
        roomNo: input.roomNo.trim(),
        hotelPaise,
        foodPaise,
        hotelBalancePaise: hotelPaise,
        foodBalancePaise: foodPaise,
        hotelMode: hotelPaise > 0 ? input.hotelMode : null,
        foodMode: foodPaise > 0 ? input.foodMode : null,
        referenceName: input.referenceName.trim(),
        referenceMobile: input.referenceMobile.trim(),
        instruction: input.instruction.trim(),
      });
      a.version += 1;
      return ok(a);
    }),

    deleteAdvance: (id, version) => call(() => {
      const a = findAdv(id);
      if (!a) return mockError('NOT_FOUND');
      const old = stale(a, version);
      if (old) return old;
      if (!canChangeAdvance(a)) return mockError('CONFLICT');
      store.advances = store.advances.filter((x) => x.id !== id);
      bin.push(a);
      return ok({ id });
    }),

    restoreAdvance: (id) => call(() => {
      const a = bin.find((x) => x.id === id);
      if (!a) return mockError('NOT_FOUND');
      bin.splice(bin.indexOf(a), 1);
      a.version += 1;
      store.advances.push(a);
      return ok(a);
    }),

    purgeAdvance: (id) => call(() => {
      const i = bin.findIndex((x) => x.id === id);
      if (i < 0) return mockError('NOT_FOUND');
      bin.splice(i, 1);
      return ok({ id });
    }),

    refundAdvance: (id, input) => call(() => {
      const a = findAdv(id);
      if (!a) return mockError('NOT_FOUND');
      const old = stale(a, input.version);
      if (old) return old;
      if (a.refund) return mockError('CONFLICT');
      const errors = validateRefund(input, a);
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      refund(a, input);
      a.version += 1;
      return ok(a);
    }),

    undoRefund: (id, version) => call(() => {
      const a = findAdv(id);
      if (!a) return mockError('NOT_FOUND');
      const old = stale(a, version);
      if (old) return old;
      if (!a.refund) return mockError('CONFLICT');
      a.hotelBalancePaise += a.refund.hotelPaise;
      a.foodBalancePaise += a.refund.foodPaise;
      a.refund = null;
      a.version += 1;
      return ok(a);
    }),

    listBills: (q) => call(() => {
      const month = todayIst().slice(0, 7);
      const all = [...store.bills].sort(newestFirst((b) => b.billDate));
      const filtered = all.filter((b) => matchFilters(billModes(b), b.companyId, b.billDate, q));
      const counts: Record<BillTab, number> = { all: filtered.length, paid: 0, due: 0, settled: 0 };
      filtered.forEach((b) => { counts[billStatus(b)] += 1; });
      const tab = q.tab ?? 'all';
      const inTab = tab === 'all' ? filtered : filtered.filter((b) => billStatus(b) === tab);
      const page = pageOf(inTab, q, (b, s) => [b.billNo, b.grNo, b.guestName, b.mobile, b.roomNo, b.companyName ?? 'walk-in', billModes(b).join(' '), (billTotal(b) / 100).toFixed(2)]
        .join(' ').toLowerCase().includes(s));
      const thisMonth = all.filter((b) => b.billDate.startsWith(month));
      const due = all.filter((b) => billStatus(b) === 'due');
      const settled = all.filter((b) => billStatus(b) === 'settled');
      const kpis: Kpi[] = [
        { id: 'count', label: billingCopy.bills.kpi.count, value: thisMonth.length, kind: 'count', trend: null, tone: 'graphite', icon: 'receipt', hint: `${all.length} in all` },
        { id: 'billed', label: billingCopy.bills.kpi.billed, value: sum(thisMonth, billTotal), kind: 'money', trend: null, tone: 'success', icon: 'chart', hint: `Hotel ${formatINR(sum(thisMonth, (b) => b.hotelTotalPaise))} · Food ${formatINR(sum(thisMonth, (b) => b.foodTotalPaise))}` },
        { id: 'due', label: billingCopy.bills.kpi.due, value: sum(due, billBalance), kind: 'money', trend: null, tone: 'warning', icon: 'clock', hint: `${due.length} ${due.length === 1 ? 'bill' : 'bills'} to settle` },
        { id: 'settled', label: billingCopy.bills.kpi.settled, value: sum(settled, (b) => settlementReceived(b.settlement)), kind: 'money', trend: null, tone: 'info', icon: 'check', hint: `Collected on ${settled.length} ${settled.length === 1 ? 'bill' : 'bills'}` },
      ];
      const options = optionsFrom(all.map((b) => ({ modes: billModes(b), companyId: b.companyId, companyName: b.companyName, date: b.billDate })));
      return ok({ page, counts, kpis, options, all: all.length });
    }),

    getBill: (id) => call(() => {
      const b = findBill(id);
      return b ? ok(b) : mockError('NOT_FOUND');
    }),

    createBill: (input) => call(() => {
      const errors = validateBill(input, true);
      const billNo = `${currentYear()} / ${input.billNo.trim()}`;
      if (!errors.billNo && store.bills.some((b) => b.billNo === billNo)) errors.billNo = 'This bill number is already used.';
      if (input.advanceId) {
        const adv = findAdv(input.advanceId);
        if (!adv || adv.refund || advanceLeft(adv) <= 0) errors.advanceId = 'This advance has nothing left to take off.';
      }
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const bill = buildBill(store, input, billNo, `bill-${++store.seq}`, new Date().toISOString(), null);
      store.bills.push(bill);
      return ok(bill);
    }),

    updateBill: (id, input) => call(() => {
      const prev = findBill(id);
      if (!prev) return mockError('NOT_FOUND');
      const old = staleBill(prev, input.version);
      if (old) return old;
      if (prev.settlement) return mockError('CONFLICT');
      const errors = validateBill(input, false);
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const next = buildBill(store, input, prev.billNo, prev.id, prev.createdAt, prev);
      store.bills = store.bills.map((b) => (b.id === id ? next : b));
      return ok(next);
    }),

    deleteBill: (id, version) => call(() => {
      const b = findBill(id);
      if (!b) return mockError('NOT_FOUND');
      const old = staleBill(b, version);
      if (old) return old;
      if (b.settlement) return mockError('CONFLICT');
      if (b.advance) {
        const adv = findAdv(b.advance.advanceId);
        if (adv) {
          adv.hotelBalancePaise += b.advance.hotelPaise;
          adv.foodBalancePaise += b.advance.foodPaise;
          adv.usedOn = adv.usedOn.filter((n) => n !== b.billNo);
        }
      }
      store.bills = store.bills.filter((x) => x.id !== id);
      return ok({ id });
    }),

    settleBill: (id, input) => call(() => {
      const b = findBill(id);
      if (!b) return mockError('NOT_FOUND');
      const old = staleBill(b, input.version);
      if (old) return old;
      // H6: a bill that still owes after a settlement takes more payments; one with nothing owed is done
      if (billStatus(b) !== 'due' && !isPartPaid(b)) return mockError('CONFLICT');
      const errors = validateSettle(input, { alreadyRecorded: b.settlement?.installments.length ?? 0 });
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      settle(store, b, input, new Date().toISOString());
      b.version += 1;
      return ok(b);
    }),

    reverseSettlement: (id, version) => call(() => {
      const b = findBill(id);
      if (!b) return mockError('NOT_FOUND');
      const old = staleBill(b, version);
      if (old) return old;
      if (!b.settlement) return mockError('CONFLICT');
      b.version += 1;
      const excess = b.settlement.excessReceiptNo;
      if (excess) store.advances = store.advances.filter((a) => a.receiptNo !== excess);
      b.settlement = null;
      b.balanceHotelPaise = b.hotel.mode === 'Debit' ? Math.max(0, b.hotelTotalPaise - (b.advance?.hotelPaise ?? 0)) : 0;
      b.balanceFoodPaise = b.food.mode === 'Debit' ? Math.max(0, b.foodTotalPaise - (b.advance?.foodPaise ?? 0)) : 0;
      return ok(b);
    }),

    getBillingOptions: () => call(() => ok({
      plans: hotelPlans.map((code) => ({ code, label: hotelPlanLabel[code], ratePaise: planRatePaise[code] })),
      paymentModes: [...paymentModes],
    })),

    // Email an invoice: the mock knows an address for a guest whose mobile ends in an odd digit; any other guest needs one typed (the real server answers 422 on `to` the same way).
    emailBill: (id, to) => call(() => {
      const b = findBill(id);
      if (!b) return mockError('NOT_FOUND');
      return mockInvoiceMail(b.mobile, to);
    }),
    emailAdvance: (id, to) => call(() => {
      const a = findAdv(id);
      if (!a) return mockError('NOT_FOUND');
      return mockInvoiceMail(a.mobile, to);
    }),

    getAdvancePreview: (id) => call(() => {
      const a = findAdv(id);
      if (!a) return mockError('NOT_FOUND');
      return ok({
        header: { name: billingHotel.name, foodName: billingHotel.foodName, address: billingHotel.address, phone: billingHotel.phone, gstin: billingHotel.gstin || null, foodGstin: billingHotel.gstin || null },
        advance: a,
        amountWords: amountInWords(a.hotelPaise + a.foodPaise),
      });
    }),

    getBillPreview: (id) => call(() => {
      const b = findBill(id);
      if (!b) return mockError('NOT_FOUND');
      return ok({
        header: { name: billingHotel.name, foodName: billingHotel.foodName, address: billingHotel.address, phone: billingHotel.phone, gstin: billingHotel.gstin || null, foodGstin: billingHotel.gstin || null },
        bill: b,
        hotelWords: amountInWords(b.hotelTotalPaise),
        foodWords: amountInWords(b.foodTotalPaise),
      });
    }),
  };
}
