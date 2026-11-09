// The in-memory mock of companies.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import { CONFIRM_SHARED_FIELD, sharedFieldsText } from './profileReview';
import type { MockClock, DashResult, LookupQuery, LookupItem, ListQuery, StatementQuery as PeriodQuery, Statement } from './common';
import { mockCall, LOOKUP_LIMIT_MAX, mockEmptyHotel, ok, pageOf, mockError, STATEMENT_MAX_ROWS } from './common';
import { CAMPAIGN_BODY_MAX, CAMPAIGN_SUBJECT_MAX, COMPANIES_MOCK_TODAY, assembleAgeing, campaignAudiences, campaignDuration, companiesCopy, companyRateFields, ledgerKinds, monthStart, periodRange, type Campaign, type CampaignAudience, type CampaignEstimate, type CampaignInput, type CompaniesOptions, type CompaniesSeed, type CompanyInput, type CompanyList, type CompanyProfile, type Customer, type CustomerInput, type CustomerList, type LedgerAgeing, type LedgerKind, type LedgerLine, type LedgerOverview, type LedgerStatement, type LedgerSummary, type MarketingOverview, type ResetLoginResult, type StatementQuery } from './companies';

/** Mock-only (not exported): screens use getOptions(). */
const companyContactRoles = ['Main contact', 'Owner / Director', 'Accounts', 'Travel desk', 'HR / Admin', 'Front office', 'Purchase', 'Other'];

/** Mock-only (not exported): screens use getOptions(). */
const idProofTypes = ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'PAN card', 'Other'];


function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- Mock data

/** An IST wall-clock time stored as UTC ISO. */
function iso(date: string, time = '10:30'): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

const seedCompanies: CompanyProfile[] = [
  {
    id: 'co-1', name: 'Tata Consultancy Services', gstNumber: '24AAACT2727Q1ZV', mobile: '9824012399', phone: '07966781234', email: 'traveldesk.gnr@tcs.com',
    address: 'Garima Park, IT-SEZ, Gandhinagar–Sarkhej Highway, Gandhinagar', country: 'India', pincode: '382421', nationality: 'Indian',
    discountPct: 10, gstPct: 12, tcsPct: null, tdsPct: 2, instruction: 'Bill rooms to the company. Guests pay for food, laundry and minibar at checkout. PO number must be on every bill.',
    contacts: [
      { role: 'Travel desk', name: 'Nikita Desai', email: 'nikita.desai@tcs.com', mobile: '9898012345' },
      { role: 'Accounts', name: 'Rakesh Iyer', email: 'rakesh.iyer@tcs.com', mobile: '9727054321' },
      { role: 'HR / Admin', name: 'Sneha Kulkarni', email: 'sneha.k@tcs.com', mobile: '' },
      // The corporate portal's main contact (corporate.ts seedTeam tm-1).
      { role: 'Main contact', name: 'Deepa Iyer', email: 'deepa.iyer@tcs.com', mobile: '9824012399' },
    ],
    createdAt: iso('2026-04-12', '11:05'), createdBy: 'Mihir Jungi',
    // the ONE common company profile (platform 0132), last changed at another hotel (review M1(a)), so the "Shared profile" note and the last-change line can be seen
    common: true, sharedHotels: 3,
    lastChange: { at: iso('2026-10-15', '16:20'), hotelName: 'Hotel Lakeview', by: 'Sanjay Rao', via: 'desk', fields: ['gstin', 'contacts'] },
  },
  {
    id: 'co-2', name: 'Jyoti CNC Automation Ltd', gstNumber: '24AABCJ4521M1Z8', mobile: '9825098250', phone: '02812387000', email: 'admin@jyoti.co.in',
    address: 'G-506, Lodhika GIDC, Metoda, Rajkot', country: 'India', pincode: '360021', nationality: 'Indian',
    discountPct: 15, gstPct: 12, tcsPct: null, tdsPct: 1, instruction: 'Foreign technicians often stay 2-3 weeks. Keep passport copies on file.',
    contacts: [
      { role: 'Main contact', name: 'Hardik Vaghasiya', email: 'hardik.v@jyoti.co.in', mobile: '9909012121' },
      { role: 'Accounts', name: 'Bhavna Rathod', email: 'accounts@jyoti.co.in', mobile: '9909034343' },
    ],
    createdAt: iso('2026-05-02', '15:20'), createdBy: 'Priya Shah',
  },
  {
    id: 'co-3', name: 'Atul Auto Ltd', gstNumber: '24AAACA6713K1Z3', mobile: '9879587995', phone: '', email: 'purchase@atulauto.co.in',
    address: 'Survey 86, Plot 1-4, Rajkot–Gondal Highway, Shapar', country: 'India', pincode: '360024', nationality: 'Indian',
    discountPct: 8, gstPct: 12, tcsPct: null, tdsPct: null, instruction: '',
    contacts: [{ role: 'Purchase', name: 'Jignesh Chandarana', email: 'jignesh@atulauto.co.in', mobile: '9879512345' }],
    createdAt: iso('2026-06-18', '10:00'), createdBy: 'Mihir Jungi',
  },
  {
    id: 'co-4', name: 'Gujarat State Fertilizers and Chemicals Limited (Vadodara Corporate Office, Marketing Division)', gstNumber: '24AAACG7393C1ZB', mobile: '9426012345', phone: '02652242451', email: 'marketing.travel@gsfcltd.com',
    address: 'Fertilizernagar, PO Box 26, Vadodara', country: 'India', pincode: '391750', nationality: 'Indian',
    discountPct: 12.5, gstPct: 12, tcsPct: 0.1, tdsPct: 2, instruction: 'Government PSU: invoices need the GSTIN of the visiting branch office, not head office.',
    contacts: [
      { role: 'Travel desk', name: 'Ashok Bhai Parmar', email: 'a.parmar@gsfcltd.com', mobile: '9426098765' },
      { role: 'Accounts', name: 'Meena Trivedi', email: 'm.trivedi@gsfcltd.com', mobile: '' },
    ],
    createdAt: iso('2026-03-09', '12:40'), createdBy: 'Mihir Jungi',
  },
  {
    id: 'co-5', name: 'Shree Ganesh Tours & Travels', gstNumber: '24BKZPS4410R1Z6', mobile: '9898123456', phone: '', email: 'shreeganeshtours@gmail.com',
    address: 'Shop 14, Trikon Baug, Rajkot', country: 'India', pincode: '360001', nationality: 'Indian',
    discountPct: 5, gstPct: 12, tcsPct: null, tdsPct: null, instruction: 'Pays advances for group bookings. Refund unused advance within 7 days.',
    contacts: [{ role: 'Owner / Director', name: 'Ganesh Solanki', email: 'shreeganeshtours@gmail.com', mobile: '9898123456' }],
    createdAt: iso('2026-07-01', '17:10'), createdBy: 'Rahul Mehta',
  },
  {
    id: 'co-6', name: 'Rajkot Engineering Association', gstNumber: '', mobile: '9374101010', phone: '02812450123', email: '',
    address: 'Bhaktinagar Industrial Estate, Rajkot', country: 'India', pincode: '360002', nationality: 'Indian',
    discountPct: null, gstPct: null, tcsPct: null, tdsPct: null, instruction: '',
    contacts: [{ role: 'Main contact', name: 'Paresh Gajera', email: '', mobile: '9374101010' }],
    createdAt: iso('2026-10-02', '09:45'), createdBy: 'Kavita Joshi',
  },
  {
    id: 'co-7', name: 'Sun Pharma Advanced Research Company', gstNumber: '24AAKCS1234D1Z1', mobile: '9099012345', phone: '02656615000', email: 'travel@sparc.life',
    address: 'Tandalja Road, Vadodara', country: 'India', pincode: '390012', nationality: 'Indian',
    discountPct: 10, gstPct: 12, tcsPct: null, tdsPct: 2, instruction: '',
    contacts: [
      { role: 'Travel desk', name: 'Farhan Shaikh', email: 'farhan.s@sparc.life', mobile: '9099054321' },
    ],
    createdAt: iso('2026-05-21', '13:15'), createdBy: 'Priya Shah',
  },
  {
    id: 'co-8', name: 'Patel Brothers Events', gstNumber: '24AAJFP8899L1ZQ', mobile: '9925099250', phone: '', email: 'bookings@patelbrosevents.in',
    address: '150 Feet Ring Road, Rajkot', country: 'India', pincode: '360005', nationality: 'Indian',
    discountPct: 7, gstPct: 12, tcsPct: null, tdsPct: null, instruction: 'Wedding planner. Advance is held against the December booking.',
    contacts: [
      { role: 'Owner / Director', name: 'Dhaval Patel', email: 'dhaval@patelbrosevents.in', mobile: '9925099250' },
      { role: 'Owner / Director', name: 'Kunal Patel', email: 'kunal@patelbrosevents.in', mobile: '9925011111' },
    ],
    createdAt: iso('2026-08-14', '16:30'), createdBy: 'Rahul Mehta',
  },
  {
    id: 'co-9', name: 'Infosys BPM Ltd', gstNumber: '24AABCP9411L1ZD', mobile: '', phone: '', email: 'corp.travel@infosys.com',
    address: 'GIFT City, Gandhinagar', country: 'India', pincode: '382355', nationality: 'Indian',
    discountPct: 10, gstPct: 12, tcsPct: null, tdsPct: 2, instruction: '',
    contacts: [{ role: 'Travel desk', name: 'Ananya Rao', email: 'ananya.rao@infosys.com', mobile: '9845012345' }],
    createdAt: iso('2026-10-04', '18:05'), createdBy: 'Mihir Jungi',
  },
  {
    id: 'co-10', name: 'Balaji Wafers Pvt Ltd', gstNumber: '24AABCB2299E1Z0', mobile: '9824598245', phone: '02827287500', email: 'hr@balajiwafers.com',
    address: 'Vajdi (Vad), Kalawad Road, Rajkot', country: 'India', pincode: '360005', nationality: 'Indian',
    discountPct: 10, gstPct: 12, tcsPct: null, tdsPct: 1, instruction: '',
    contacts: [
      { role: 'HR / Admin', name: 'Krupali Virani', email: 'hr@balajiwafers.com', mobile: '9824512345' },
      { role: 'Accounts', name: 'Mukesh Kotecha', email: 'accounts@balajiwafers.com', mobile: '9824567890' },
    ],
    createdAt: iso('2026-02-11', '11:00'), createdBy: 'Mihir Jungi',
  },
  {
    id: 'co-11', name: 'Siemens Healthineers India', gstNumber: '24AAECS5698N1ZT', mobile: '9167012345', phone: '', email: 'india.travel@siemens-healthineers.com',
    address: 'Corporate Road, Prahlad Nagar, Ahmedabad', country: 'India', pincode: '380015', nationality: 'Indian',
    discountPct: 12, gstPct: 12, tcsPct: null, tdsPct: 2, instruction: 'Engineers visit for hospital installs; stays of 1-2 nights.',
    contacts: [{ role: 'Travel desk', name: 'Rohit Malhotra', email: 'rohit.malhotra@siemens-healthineers.com', mobile: '9167054321' }],
    createdAt: iso('2026-06-30', '14:50'), createdBy: 'Kavita Joshi',
  },
];

type RawLine = [date: string, kind: LedgerKind, ref: string, guest: string | null, room: string | null, mode: string | null, note: string | null, debitRupees: number, creditRupees: number];

// Every line is a real bill or receipt of the Billing mock (billing.ts: bills 2026 / 1170-1198, advances 2026 / 801-819),
// same company, guest, room, date and amount (bill total = hotel + food incl. 5% mock GST; payments = its settlement
// instalments; "Paid at checkout" = a side paid by card or cash at checkout). Companies with no bill in Billing have no lines.
const seedLedger: Record<string, RawLine[]> = {
  'co-1': [
    ['2026-08-28', 'advance', 'Receipt 2026 / 801', 'Rakesh Patel', '204', 'Cash', 'Reference: Hitesh Vora (Admin)', 0, 5000],
    ['2026-08-30', 'bill', 'Bill 2026 / 1170', 'Rakesh Patel', '204', 'Debit', 'Advance 2026 / 801 of ₹5,000 taken off', 8820, 0],
    ['2026-09-10', 'settlement', 'Bill 2026 / 1170', 'Rakesh Patel', '204', 'Bank Transfer', 'NEFT ref. N2589631', 0, 2260],
    ['2026-09-15', 'settlement', 'Bill 2026 / 1170', 'Rakesh Patel', '204', 'Cheque', 'Cheque 118845', 0, 1560],
    ['2026-10-04', 'advance', 'Receipt 2026 / 812', 'Rohan Bhatt', '205', 'Card', null, 0, 3500],
    ['2026-10-05', 'bill', 'Bill 2026 / 1185', 'Priya Raval', '203', 'Debit', null, 7077, 0],
  ],
  'co-2': [
    ['2026-09-10', 'advance', 'Receipt 2026 / 803', 'Vikram Singh Rathore', '301', 'Bank Transfer', 'Company to clear the rest on checkout.', 0, 10000],
    ['2026-09-12', 'bill', 'Bill 2026 / 1173', 'Vikram Singh Rathore', '301', 'Debit', 'Company PO 4500127. Advance 2026 / 803 of ₹10,000 taken off', 15247.5, 0],
    ['2026-09-12', 'checkout', 'Bill 2026 / 1173', 'Vikram Singh Rathore', '301', 'Cash', 'Food paid by the guest', 0, 2310],
    ['2026-10-06', 'advance', 'Receipt 2026 / 814', 'Bhavin Thakkar', '305', 'Card', 'Rest to be used on his next visit this month.', 0, 5000],
    ['2026-10-07', 'bill', 'Bill 2026 / 1186', 'Bhavin Thakkar', '305', 'Cash', 'Room and food taken off advance 2026 / 814', 4462.5, 0],
  ],
  'co-3': [
    ['2026-09-16', 'bill', 'Bill 2026 / 1174', 'Amit Trivedi', '206', 'Debit', null, 6930, 0],
    ['2026-09-18', 'advance', 'Receipt 2026 / 805', 'Suresh Iyer', '207', 'Card', null, 0, 10000],
    ['2026-09-20', 'bill', 'Bill 2026 / 1175', 'Suresh Iyer', '207', 'Card', 'Paid from advance 2026 / 805', 7350, 0],
    ['2026-09-28', 'settlement', 'Bill 2026 / 1174', 'Amit Trivedi', '206', 'Bank Transfer', '₹1,015 paid extra, kept as advance (Excessive / 2026 / 1174)', 0, 7945],
    ['2026-10-09', 'bill', 'Bill 2026 / 1188', 'Nilesh Bhalodiya', '307', 'Debit', 'Monthly debit; send with the October statement.', 8085, 0],
  ],
  'co-4': [
    ['2026-09-29', 'advance', 'Receipt 2026 / 808', 'Imran Shaikh', '208', 'UPI', null, 0, 4000],
    ['2026-10-01', 'refund', 'Receipt 2026 / 808', 'Imran Shaikh', '208', 'UPI', 'Left one night early.', 1500, 0],
    ['2026-10-03', 'bill', 'Bill 2026 / 1181', 'Karan Shah', '303', 'Debit', null, 7192.5, 0],
    ['2026-10-08', 'bill', 'Bill 2026 / 1189', 'Prakash Rana', '308', 'Debit', null, 3622.5, 0],
    ['2026-10-10', 'settlement', 'Bill 2026 / 1189', 'Prakash Rana', '308', 'Bank Transfer', 'RTGS ref. GSFC0091123.', 0, 3622.5],
  ],
  'co-5': [
    ['2026-10-02', 'advance', 'Receipt 2026 / 810', 'Arjun Malhotra', '302', 'Bank Transfer', null, 0, 7500],
    ['2026-10-04', 'bill', 'Bill 2026 / 1182', 'Deepak Chauhan', '304', 'Debit', null, 13020, 0],
    ['2026-10-04', 'settlement', 'Bill 2026 / 1182', 'Deepak Chauhan', '304', 'UPI', 'Reference: Jignesh Patel', 0, 4000],
    ['2026-10-05', 'settlement', 'Bill 2026 / 1182', 'Deepak Chauhan', '304', 'Bank Transfer', null, 0, 6205],
    ['2026-10-05', 'settlement', 'Bill 2026 / 1182', 'Deepak Chauhan', '304', 'Cheque', null, 0, 2815],
    ['2026-10-08', 'advance', 'Receipt 2026 / 816', 'Jayesh Solanki', '306', 'Cash', 'Group of 6, Dwarka-Somnath tour.', 0, 3000],
    ['2026-10-09', 'refund', 'Receipt 2026 / 816', 'Jayesh Solanki', '306', 'Cash', 'Group tour postponed. Full refund.', 3000, 0],
  ],
  'co-6': [
    ['2026-09-22', 'advance', 'Receipt 2026 / 806', 'Dr. Harshvardhan Chandrashekhar Venkataraman', '401', 'Cheque', 'Cheque no. 004512, HDFC Bank, Ahmedabad.', 0, 15000],
    ['2026-09-24', 'bill', 'Bill 2026 / 1176', 'Dr. Harshvardhan Chandrashekhar Venkataraman', '401', 'Debit', 'Advance 2026 / 806 of ₹15,000 taken off', 32960, 0],
  ],
  'co-7': [
    ['2026-09-26', 'bill', 'Bill 2026 / 1191', 'Dr. Swati Kelkar', '302', 'Debit', null, 8557.5, 0],
    ['2026-10-06', 'settlement', 'Bill 2026 / 1191', 'Dr. Swati Kelkar', '302', 'Bank Transfer', 'NEFT ref. SPARC0610442.', 0, 8557.5],
    ['2026-10-08', 'advance', 'Receipt 2026 / 819', 'Rahul Deshpande', '306', 'Bank Transfer', 'SPARC advance for a 2-night stay; balance on the monthly debit.', 0, 3000],
    ['2026-10-10', 'bill', 'Bill 2026 / 1192', 'Rahul Deshpande', '306', 'Debit', 'Advance 2026 / 819 of ₹3,000 taken off', 9135, 0],
  ],
  'co-8': [
    ['2026-09-21', 'bill', 'Bill 2026 / 1194', 'Hiral Bhuva', '308', 'UPI', null, 8505, 0],
    ['2026-09-21', 'checkout', 'Bill 2026 / 1194', 'Hiral Bhuva', '308', 'UPI', 'Paid at checkout', 0, 8505],
    ['2026-10-02', 'bill', 'Bill 2026 / 1193', 'Chirag Sojitra', '306', 'Debit', 'Wedding décor crew; extra bed both nights.', 11550, 0],
  ],
  'co-10': [
    ['2026-09-29', 'bill', 'Bill 2026 / 1195', 'Ketan Ramani', '303', 'Debit', null, 6825, 0],
    ['2026-10-06', 'bill', 'Bill 2026 / 1196', 'Jagruti Kakadiya', '208', 'Debit', null, 6436.5, 0],
    ['2026-10-08', 'settlement', 'Bill 2026 / 1195', 'Ketan Ramani', '303', 'Cheque', 'Cheque no. 231407, Bank of Baroda, Rajkot.', 0, 6825],
  ],
  'co-11': [
    ['2026-09-19', 'bill', 'Bill 2026 / 1198', 'Nitin Bhardwaj', '307', 'Card', null, 7140, 0],
    ['2026-09-19', 'checkout', 'Bill 2026 / 1198', 'Nitin Bhardwaj', '307', 'Card', 'Paid at checkout', 0, 7140],
    ['2026-10-10', 'bill', 'Bill 2026 / 1197', 'Arvind Menon', '205', 'Debit', 'Civil Hospital MRI install. Quote PO 7100453 on the debit bill.', 15255, 0],
  ],
};

const seedCustomers: Customer[] = [
  { id: 'cu-1', name: 'Ramesh Patel', mobile: '9824011111', email: 'ramesh.patel@gmail.com', address: '12, Amin Marg', city: 'Rajkot', idProofType: 'Aadhaar', idProofNumber: '4821', notes: 'Prefers a ground floor room.', isActive: true, source: 'admin', lastLoginAt: iso('2026-10-03', '20:14'), createdAt: iso('2026-05-10'), createdBy: 'Priya Shah',
    // the ONE common guest profile (platform 0132), last changed by the guest in the portal (review M1(a))
    common: true, sharedHotels: 3, lastChange: { at: iso('2026-10-12', '09:40'), hotelName: 'Hotel Grand Palace', by: 'Ramesh Patel', via: 'portal', fields: ['email'] } },
  { id: 'cu-2', name: 'Anjali Mehta', mobile: '9925011122', email: 'anjali.mehta@outlook.com', address: '', city: 'Ahmedabad', idProofType: 'Driving licence', idProofNumber: '7710', notes: '', isActive: true, source: 'self', lastLoginAt: iso('2026-10-01', '09:02'), createdAt: iso('2026-06-02'), createdBy: null },
  { id: 'cu-3', name: 'Sanjay Kumar Venkataraman Iyer', mobile: '9840033333', email: 'sanjay.iyer@yahoo.co.in', address: 'Flat 9B, Shanti Residency, Adyar', city: 'Chennai', idProofType: 'Passport', idProofNumber: 'Z412', notes: 'Long name: check printed bills.', isActive: true, source: 'admin', lastLoginAt: null, createdAt: iso('2026-07-11'), createdBy: 'Rahul Mehta' },
  { id: 'cu-4', name: 'Fatima Sheikh', mobile: '9727044444', email: '', address: 'Jamnagar Road', city: 'Rajkot', idProofType: 'Voter ID', idProofNumber: '0093', notes: 'No email yet. Ask at next visit.', isActive: true, source: 'admin', lastLoginAt: null, createdAt: iso('2026-08-21'), createdBy: 'Kavita Joshi' },
  { id: 'cu-5', name: 'Harsh Vora', mobile: '9909055555', email: 'harsh.vora@gmail.com', address: '', city: 'Surat', idProofType: '', idProofNumber: '', notes: '', isActive: false, source: 'self', lastLoginAt: iso('2026-03-15', '13:40'), createdAt: iso('2026-02-27'), createdBy: null },
  { id: 'cu-6', name: 'Neha Kapoor', mobile: '9810066666', email: 'neha.kapoor@sparc.life', address: 'Tandalja Road', city: 'Vadodara', idProofType: 'Aadhaar', idProofNumber: '3307', notes: '', isActive: true, source: 'admin', lastLoginAt: iso('2026-09-30', '18:25'), createdAt: iso('2026-08-18'), createdBy: 'Priya Shah' },
  { id: 'cu-7', name: 'Vikram Singh Rathore', mobile: '9414077777', email: 'vikram.rathore@gmail.com', address: 'Civil Lines', city: 'Jaipur', idProofType: 'PAN card', idProofNumber: '9K2L', notes: 'Regular guest, Diwali every year.', isActive: true, source: 'self', lastLoginAt: iso('2026-10-04', '22:10'), createdAt: iso('2026-01-19'), createdBy: null },
  { id: 'cu-8', name: 'Kiran Desai', mobile: '9825088888', email: 'kiran.desai@hotmail.com', address: '', city: 'Morbi', idProofType: 'Aadhaar', idProofNumber: '1180', notes: '', isActive: true, source: 'admin', lastLoginAt: null, createdAt: iso('2026-10-01'), createdBy: 'Mihir Jungi' },
  { id: 'cu-9', name: 'Pooja Nair', mobile: '9447099999', email: 'pooja.nair@tcs.com', address: '', city: 'Gandhinagar', idProofType: 'Aadhaar', idProofNumber: '6642', notes: 'TCS employee: company bills rooms.', isActive: true, source: 'admin', lastLoginAt: iso('2026-09-02', '08:45'), createdAt: iso('2026-07-08'), createdBy: 'Rahul Mehta' },
  { id: 'cu-10', name: 'Manoj Bhalodia', mobile: '9879010101', email: 'manoj.b@gmail.com', address: 'Kalawad Road', city: 'Rajkot', idProofType: 'Driving licence', idProofNumber: '5521', notes: '', isActive: false, source: 'admin', lastLoginAt: null, createdAt: iso('2026-04-04'), createdBy: 'Kavita Joshi' },
  { id: 'cu-11', name: 'Priyanka Chauhan', mobile: '9712020202', email: 'priyanka.c@gmail.com', address: '', city: 'Junagadh', idProofType: 'Aadhaar', idProofNumber: '2290', notes: '', isActive: true, source: 'self', lastLoginAt: iso('2026-10-02', '11:30'), createdAt: iso('2026-10-02'), createdBy: null },
  { id: 'cu-12', name: 'Dr. Arun Shah', mobile: '9824030303', email: 'dr.arunshah@gmail.com', address: 'Race Course Ring Road', city: 'Rajkot', idProofType: 'Passport', idProofNumber: 'P908', notes: 'Medical conference speaker.', isActive: true, source: 'admin', lastLoginAt: iso('2026-09-12', '07:55'), createdAt: iso('2026-09-10'), createdBy: 'Priya Shah' },
];

/** Demo campaigns: two sent, one draft. */
const seedCampaigns: Campaign[] = [
  { id: 'cp-1', subject: 'Diwali at Hotel Pallav: lamps, sweets and 15% off', body: 'This Diwali, stay with us for the lamps on the lawn, a sweets counter every evening and 15% off every room from 18 to 24 October.\n\nReply to this email or call the front desk to book.', audience: 'all', status: 'sent', recipients: 41, queued: 41, leftOut: 2, delivered: 39, failed: 1, pending: 1, sentAt: iso('2026-10-01', '17:30'), finishedAt: iso('2026-10-01', '17:42'), createdAt: iso('2026-10-01', '16:50'), createdBy: 'Priya Shah' },
  { id: 'cp-2', subject: 'Corporate rates for 2026-27', body: 'Dear {name},\n\nOur corporate rates for the new year are ready: a flat rate on Deluxe rooms, breakfast included, and a monthly statement for your accounts team.\n\nWrite back and we will send the rate card.', audience: 'companies', status: 'sent', recipients: 12, queued: 12, leftOut: 0, delivered: 12, failed: 0, pending: 0, sentAt: iso('2026-09-15', '11:00'), finishedAt: iso('2026-09-15', '11:03'), createdAt: iso('2026-09-15', '10:20'), createdBy: 'Rahul Mehta' },
  { id: 'cp-3', subject: 'New: the garden restaurant is open', body: 'The garden restaurant opens on Saturday with a Kathiyawadi thali every lunch. Guests who stayed with us get the first thali free this month.', audience: 'guests', status: 'draft', recipients: 0, queued: 0, leftOut: 0, delivered: 0, failed: 0, pending: 0, sentAt: null, finishedAt: null, createdAt: iso('2026-10-04', '09:10'), createdBy: 'You' },
];

export function createCompaniesApi(clock: MockClock = {}, seed?: CompaniesSeed) {
  const today = COMPANIES_MOCK_TODAY;
  const thisMonth = monthStart(today);
  let actor = { name: 'You', fullAccess: true };
  let seq = 1000;
  const nextId = (p: string) => `${p}-${++seq}`;
  // a brand-new mock hotel (Pooja Shah's Hotel Pearl) starts with no companies, customers, ledger or campaigns, like the cash and admin mocks
  const empty = !seed && mockEmptyHotel();

  const companies: CompanyProfile[] = (seed ? seed.companies : empty ? [] : seedCompanies).map((c) => ({ ...c, contacts: c.contacts.map((p) => ({ ...p })) }));
  const ledgerLines: Omit<LedgerLine, 'balancePaise'>[] = [];
  let lineNo = 0;
  let entryNo = 2400;
  for (const [companyId, raws] of Object.entries(seed || empty ? {} : seedLedger)) {
    for (const r of raws) {
      ledgerLines.push({
        id: `ln-${++lineNo}`, companyId, kind: r[1], date: r[0], entry: ++entryNo, ref: r[2], guest: r[3], room: r[4], mode: r[5], note: r[6],
        debitPaise: Math.round(r[7] * 100), creditPaise: Math.round(r[8] * 100),
      });
    }
  }
  /** Bills still on account with money due (Bill Master), per company. */
  // Billing bills on Debit with a balance: 1185 (co-1), 1173 (co-2), 1188 (co-3), 1181 (co-4), 1176 (co-6), 1192 (co-7),
  // 1193 (co-8), 1196 (co-10), 1197 (co-11).
  const openBills: Record<string, number> = seed || empty ? {} : { 'co-1': 1, 'co-2': 1, 'co-3': 1, 'co-4': 1, 'co-6': 1, 'co-7': 1, 'co-8': 1, 'co-10': 1, 'co-11': 1 };

  const customers: Customer[] = (empty ? [] : seedCustomers).map((c) => ({ ...c }));
  const campaigns: Campaign[] = (empty ? [] : seedCampaigns).map((c) => ({ ...c }));
  /** Addresses that used the unsubscribe link (the demo starts with two). */
  const optOuts = new Set<string>(empty ? [] : ['manoj.b@gmail.com', 'old.guest@example.com']);

  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);

  // ---- shared profiles (profileReview.ts M1(b)): the form's field -> the word the sentence uses
  const COMPANY_SHARED: Record<string, string> = { name: 'name', gstNumber: 'gstin', mobile: 'mobile', phone: 'landline', email: 'email', address: 'address', pincode: 'pincode', country: 'country', contacts: 'contacts' };
  const CUSTOMER_SHARED: Record<string, string> = { name: 'name', email: 'email', address: 'address', city: 'city' };
  const sharedChanges = (prev: Record<string, unknown>, next: Record<string, unknown>, map: Record<string, string>): { key: string; word: string }[] =>
    Object.entries(map)
      .filter(([k]) => JSON.stringify(prev[k] ?? '') !== JSON.stringify(next[k] ?? ''))
      .map(([key, word]) => ({ key, word }));
  /** The 409 that asks to confirm: the sentence, the marker field, and "Shared with N hotels" for each changing field. */
  const sharedAsk = (changed: { key: string; word: string }[], what: 'guest' | 'company', hotels: number) => {
    const sentence = `This changes ${sharedFieldsText(changed.map((c) => c.word))} for this ${what} at all ${hotels} hotels.`;
    return mockError('CONFLICT', { [CONFIRM_SHARED_FIELD]: sentence }, { message: sentence });
  };
  const nowIso = () => new Date().toISOString();
  const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
  const allWords = (hay: string, s: string) => words(s).every((w) => hay.includes(w));

  // ---- ledger helpers
  const KIND_ORDER: Record<LedgerKind, number> = { advance: 1, bill: 2, adjusted: 3, checkout: 3, settlement: 4, refund: 5 };
  function linesOf(companyId: string): LedgerLine[] {
    let running = 0;
    return ledgerLines
      .filter((l) => l.companyId === companyId)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.entry - b.entry))
      .map((l) => {
        running += l.debitPaise - l.creditPaise;
        return { ...l, balancePaise: running };
      });
  }
  function totals(lines: LedgerLine[]) {
    const billed = lines.filter((l) => l.kind === 'bill').reduce((s, l) => s + l.debitPaise, 0);
    const refunded = lines.filter((l) => l.kind === 'refund').reduce((s, l) => s + l.debitPaise, 0);
    const received = lines.reduce((s, l) => s + l.creditPaise, 0);
    return { billed, refunded, received, balance: billed + refunded - received };
  }
  function summaryOf(c: CompanyProfile): LedgerSummary {
    const lines = linesOf(c.id);
    const t = totals(lines);
    const owed = t.billed + t.refunded;
    const last = lines[lines.length - 1];
    return {
      companyId: c.id, companyName: c.name, gstNumber: c.gstNumber,
      billedPaise: t.billed, receivedPaise: t.received, refundedPaise: t.refunded, balancePaise: t.balance,
      state: t.balance > 0 ? 'owing' : t.balance < 0 ? 'credit' : 'settled',
      paidPercent: lines.length === 0 ? null : owed > 0 ? Math.min(100, Math.floor((t.received / owed) * 100)) : t.received > 0 ? 100 : 0,
      entries: lines.length,
      bills: lines.filter((l) => l.kind === 'bill').length,
      openBills: openBills[c.id] ?? 0,
      lastDate: last ? last.date : null,
    };
  }

  // ---- company validation
  function checkCompany(input: CompanyInput, id: string | null): Record<string, string> | null {
    const f: Record<string, string> = {};
    const name = input.name.trim();
    if (!name) f.name = 'Enter the company name.';
    else if (name.length > 100) f.name = 'Keep the name to 100 characters.';
    else if (companies.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) f.name = 'A company with this name already exists.';
    const gst = input.gstNumber.trim().toUpperCase();
    if (gst && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) f.gstNumber = 'Enter a valid 15-character GSTIN, like 24AAACT2727Q1ZV.';
    else if (gst && companies.some((c) => c.id !== id && c.gstNumber === gst)) f.gstNumber = 'A company with this GST number already exists.';
    if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) f.email = 'Enter a valid email address.';
    if (input.mobile.trim() && !/^\+?[\d\s-]{10,15}$/.test(input.mobile.trim())) f.mobile = 'Enter 10 to 15 digits.';
    if (input.phone.trim() && !/^\+?[\d\s-]{6,15}$/.test(input.phone.trim())) f.phone = 'Enter a valid landline number.';
    if (input.address.length > 100) f.address = 'Keep the address to 100 characters.';
    for (const r of companyRateFields) {
      const v = input[r.key];
      if (v !== null && (Number.isNaN(v) || v < 0 || v > 100)) f[r.key] = 'Enter a rate from 0 to 100.';
    }
    const people = input.contacts.filter((p) => p.name.trim() || p.email.trim() || p.mobile.trim());
    if (people.length === 0) f.contacts = 'Add at least one person to contact.';
    input.contacts.forEach((p, i) => {
      const filled = p.name.trim() || p.email.trim() || p.mobile.trim();
      if ((filled || i === 0) && !p.name.trim()) f[`contacts.${i}.name`] = 'Every contact person needs a name.';
      if (p.email.trim() && !EMAIL_RE.test(p.email.trim())) f[`contacts.${i}.email`] = 'Enter a valid email address.';
    });
    return Object.keys(f).length ? f : null;
  }
  function tidyCompany(input: CompanyInput): CompanyInput {
    return {
      ...input,
      name: input.name.trim(), gstNumber: input.gstNumber.trim().toUpperCase(), mobile: input.mobile.trim(), phone: input.phone.trim(),
      email: input.email.trim(), address: input.address.trim(), country: input.country.trim(), pincode: input.pincode.trim(),
      nationality: input.nationality.trim(), instruction: input.instruction.trim(),
      contacts: input.contacts
        .map((p) => ({ role: p.role.trim(), name: p.name.trim(), email: p.email.trim(), mobile: p.mobile.trim() }))
        .filter((p) => p.name || p.email || p.mobile),
    };
  }

  // ---- customer validation
  function checkCustomer(input: CustomerInput, id: string | null): Record<string, string> | null {
    const f: Record<string, string> = {};
    if (!input.name.trim()) f.name = 'Enter the name.';
    const mobile = input.mobile.replace(/\D+/g, '');
    if (!/^\d{10,15}$/.test(mobile)) f.mobile = 'Enter the mobile number as digits only, 10 to 15 of them.';
    else if (customers.some((c) => c.id !== id && c.mobile === mobile)) f.mobile = 'A customer with this mobile number already exists.';
    if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) f.email = 'Enter a valid email address.';
    const idNo = (input.idProofNumber ?? '').trim();
    if (idNo.length > 50) f.idProofNumber = 'Keep the ID number to 50 characters.';
    if (idNo && !input.idProofType) f.idProofType = 'Choose the ID proof type.';
    if (input.notes.length > 2000) f.notes = 'Keep notes to 2000 characters.';
    return Object.keys(f).length ? f : null;
  }

  function fieldsOf(input: CustomerInput) {
    return {
      name: input.name.trim(), mobile: input.mobile.replace(/\D+/g, ''), email: input.email.trim(), address: input.address.trim(),
      city: input.city.trim(), idProofType: input.idProofType, notes: input.notes.trim(), isActive: input.isActive,
    };
  }
  /** Absent = keep, "" = remove, else the number as typed. */
  function idNumberOf(idNo: string | undefined, keep: string): string {
    return idNo === undefined ? keep : idNo.trim();
  }
  const limitOf = (q: LookupQuery) => Math.min(LOOKUP_LIMIT_MAX, Math.max(1, q.limit ?? LOOKUP_LIMIT_MAX));

  // ---- campaign helpers
  const audienceCounts = (): Record<CampaignAudience, number> => {
    const live = (list: string[]) => new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => e && EMAIL_RE.test(e) && !optOuts.has(e)));
    const cust = live(customers.filter((c) => c.isActive).map((c) => c.email));
    const comp = live(companies.flatMap((c) => [c.email, ...c.contacts.map((p) => p.email)]));
    // past guests: the demo has no stay store here; the figure stands for the bills' guests with an email
    const guests = new Set((empty ? [] : ['ravi.mehta@example.com', 'anita.d@example.com', 'bhavesh.k@example.com', 'meera.p@example.com', 'sunil.r@example.com', 'kiran.j@example.com', 'hetal.s@example.com', 'jay.m@example.com']).filter((e) => !optOuts.has(e)));
    return { customers: cust.size, companies: comp.size, guests: guests.size, all: new Set([...cust, ...comp, ...guests]).size };
  };
  function checkCampaign(input: CampaignInput): Record<string, string> | null {
    const f: Record<string, string> = {};
    if (!input.subject.trim()) f.subject = 'Write a subject.';
    else if (input.subject.trim().length > CAMPAIGN_SUBJECT_MAX) f.subject = `Keep the subject to ${CAMPAIGN_SUBJECT_MAX} characters.`;
    if (!input.body.trim()) f.body = 'Write the message.';
    else if (input.body.length > CAMPAIGN_BODY_MAX) f.body = `Keep the message to ${CAMPAIGN_BODY_MAX} characters.`;
    if (!campaignAudiences.some((a) => a.id === input.audience)) f.audience = 'Choose who gets it.';
    return Object.keys(f).length ? f : null;
  }
  const overview = (): MarketingOverview => ({
    campaigns: campaigns.map((c) => ({ ...c })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id.localeCompare(a.id))),
    audience: audienceCounts(),
    optOuts: optOuts.size,
    mailReady: true,
    myEmail: 'you@hotelpallav.in',
    held: null,
  });

  return {
    /** Name used for "added by" (the signed-in user). */
    setActor(a: { name: string; /** Full Access on Companies (a manager or the owner); false = front desk. Default true. */ fullAccess?: boolean }): void {
      actor = { name: a.name || 'You', fullAccess: a.fullAccess !== false };
    },

    /** The forms' lists (ID types, contact roles). Fetch once and cache. */
    getOptions(): Promise<DashResult<CompaniesOptions>> {
      return call(() => ok({ idTypes: [...idProofTypes], contactRoles: [...companyContactRoles] }));
    },

    // ------------------------------------------------ Company profiles
    /** Picker: companies by name or GST number (hint = GST number), at most 50. Use this, not listCompanies, in pickers. */
    lookupCompanies(q: LookupQuery = {}): Promise<DashResult<LookupItem[]>> {
      return call(() => {
        const s = (q.q ?? '').trim().toLowerCase();
        const found = companies
          .filter((c) => !s || c.name.toLowerCase().includes(s) || c.gstNumber.toLowerCase().includes(s))
          .sort((a, b) => a.name.localeCompare(b.name));
        return ok(found.slice(0, limitOf(q)).map((c) => ({ id: c.id, label: c.name, hint: c.gstNumber || undefined })));
      });
    },
    listCompanies(q: ListQuery = {}): Promise<DashResult<CompanyList>> {
      return call(() => {
        const sorted = [...companies].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const page = pageOf(sorted, q, (c, s) => {
          const hay = [c.name, c.gstNumber, c.email, c.mobile, c.phone, c.address, c.pincode, c.country, c.instruction, ...c.contacts.flatMap((p) => [p.name, p.email, p.mobile, p.role])].join(' ').toLowerCase();
          return allWords(hay, s);
        });
        return ok({
          page,
          stats: {
            total: companies.length,
            withGst: companies.filter((c) => c.gstNumber).length,
            contacts: companies.reduce((n, c) => n + c.contacts.length, 0),
            addedThisMonth: companies.filter((c) => c.createdAt.slice(0, 10) >= thisMonth).length,
          },
        });
      });
    },
    getCompany(id: string): Promise<DashResult<CompanyProfile>> {
      return call(() => {
        const c = companies.find((x) => x.id === id);
        return c ? ok({ ...c, contacts: c.contacts.map((p) => ({ ...p })) }) : mockError('NOT_FOUND');
      });
    },
    createCompany(input: CompanyInput): Promise<DashResult<CompanyProfile>> {
      return call(() => {
        const bad = checkCompany(input, null);
        if (bad) return mockError('VALIDATION_FAILED', bad);
        const c: CompanyProfile = { ...tidyCompany(input), id: nextId('co'), createdAt: nowIso(), createdBy: actor.name };
        companies.push(c);
        return ok(c);
      });
    },
    updateCompany(id: string, input: CompanyInput): Promise<DashResult<CompanyProfile>> {
      return call(() => {
        const i = companies.findIndex((x) => x.id === id);
        const prev = companies[i];
        if (!prev) return mockError('NOT_FOUND');
        const bad = checkCompany(input, id);
        if (bad) return mockError('VALIDATION_FAILED', bad);
        const next = tidyCompany(input);
        // M1(c): the GSTIN and the legal name of a common company: Full Access on Companies only
        if (prev.common && !actor.fullAccess) {
          if (next.gstNumber !== prev.gstNumber) return mockError('FORBIDDEN', undefined, { message: 'Ask a manager to change the GSTIN.' });
          if (next.name !== prev.name) return mockError('FORBIDDEN', undefined, { message: 'Ask a manager to change the company name.' });
        }
        // M1(b): a change of a shared field of a profile at 2+ hotels asks first (resend with confirmShared)
        if (prev.common && (prev.sharedHotels ?? 0) >= 2 && input.confirmShared !== true) {
          const changed = sharedChanges(prev as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, COMPANY_SHARED);
          if (changed.length) return sharedAsk(changed, 'company', prev.sharedHotels ?? 0);
        }
        const c: CompanyProfile = { ...prev, ...next };
        delete (c as { confirmShared?: boolean }).confirmShared;
        companies[i] = c;
        return ok(c);
      });
    },
    deleteCompany(id: string): Promise<DashResult<{ id: string }>> {
      return call(() => {
        const i = companies.findIndex((x) => x.id === id);
        if (i < 0) return mockError('NOT_FOUND');
        companies.splice(i, 1);
        return ok({ id });
      });
    },

    // ------------------------------------------------ Company ledger
    /** q.tab: all | owing | credit | settled. */
    ledgerOverview(q: ListQuery = {}): Promise<DashResult<LedgerOverview>> {
      return call(() => {
        const s = (q.search ?? '').trim();
        const rows = companies
          .filter((c) => !s || allWords([c.name, c.gstNumber, c.email, c.mobile, c.phone].join(' ').toLowerCase(), s))
          .map(summaryOf)
          .sort((a, b) =>
            Number(b.balancePaise > 0) - Number(a.balancePaise > 0)
            || Math.abs(b.balancePaise) - Math.abs(a.balancePaise)
            || Number(b.entries > 0) - Number(a.entries > 0)
            || a.companyName.localeCompare(b.companyName));
        const counts = {
          all: rows.length,
          owing: rows.filter((r) => r.state === 'owing').length,
          credit: rows.filter((r) => r.state === 'credit').length,
          settled: rows.filter((r) => r.state === 'settled').length,
        };
        const tab = q.tab === 'owing' || q.tab === 'credit' || q.tab === 'settled' ? q.tab : 'all';
        const shown = tab === 'all' ? rows : rows.filter((r) => r.state === tab);
        const everyone = companies.map(summaryOf);
        const monthLines = companies.flatMap((c) => linesOf(c.id)).filter((l) => l.date >= thisMonth && l.date <= today);
        return ok({
          page: pageOf(shown, { ...q, search: '' }, () => true),
          all: shown,
          counts,
          stats: {
            owedPaise: everyone.filter((r) => r.balancePaise > 0).reduce((n, r) => n + r.balancePaise, 0),
            owing: everyone.filter((r) => r.balancePaise > 0).length,
            heldPaise: Math.abs(everyone.filter((r) => r.balancePaise < 0).reduce((n, r) => n + r.balancePaise, 0)),
            holding: everyone.filter((r) => r.balancePaise < 0).length,
            monthBilledPaise: monthLines.filter((l) => l.kind === 'bill').reduce((n, l) => n + l.debitPaise, 0),
            monthReceivedPaise: monthLines.reduce((n, l) => n + l.creditPaise, 0),
          },
        });
      });
    },
    ledgerStatement(companyId: string, q: StatementQuery = {}): Promise<DashResult<LedgerStatement>> {
      return call(() => {
        const company = companies.find((c) => c.id === companyId);
        if (!company) return mockError('NOT_FOUND');
        const period = q.period ?? 'all';
        const { from, to } = periodRange(period, today, q.from, q.to);
        const all = linesOf(companyId);
        const before = from ? all.filter((l) => l.date < from) : [];
        const opening = before.length ? before[before.length - 1]?.balancePaise ?? 0 : 0;
        const inPeriod = all.filter((l) => (!from || l.date >= from) && (!to || l.date <= to));
        const closing = inPeriod.length ? inPeriod[inPeriod.length - 1]?.balancePaise ?? opening : opening;
        const t = totals(inPeriod);
        const s = (q.search ?? '').trim().toLowerCase();
        const found = !s ? inPeriod : inPeriod.filter((l) => {
          const [y, m, d] = l.date.split('-');
          const hay = [l.guest, l.room ? `room ${l.room}` : '', l.ref, l.mode, l.note, ledgerKinds[l.kind].label, `#${l.entry}`, `${d}-${m}-${y}`, `${d}/${m}/${y}`, l.date].join(' ').toLowerCase();
          const amount = (l.debitPaise || l.creditPaise) / 100;
          return words(s).every((w) => {
            const num = w.replace(/[,₹#]/g, '');
            return hay.includes(w) || (num !== '' && !Number.isNaN(Number(num)) && (Number(num) === amount || num === String(l.entry)));
          });
        });
        const pageSize = q.pageSize ?? 25;
        const lastPage = Math.max(1, Math.ceil(found.length / pageSize));
        const pageNo = Math.min(Math.max(1, q.page ?? lastPage), lastPage);
        const lastPaid = [...all].reverse().find((l) => l.creditPaise > 0 && l.kind !== 'adjusted') ?? null;
        return ok({
          company: { ...company, contacts: company.contacts.map((p) => ({ ...p })) },
          period, from, to,
          openingPaise: opening, closingPaise: closing,
          billedPaise: t.billed, receivedPaise: t.received, refundedPaise: t.refunded,
          page: { items: found.slice((pageNo - 1) * pageSize, pageNo * pageSize), total: found.length, page: pageNo, pageSize },
          periodLines: inPeriod,
          lastPaid,
          openBills: openBills[companyId] ?? 0,
        });
      });
    },

    /**
     * One call for a whole period (no paging), for the printable statement / export.
     * 422 when to < from, the period is over 3 years, or it has more than 5,000 lines.
     */
    /** Receivables by age: each owing company's balance laid on its newest bills (the older ones count as paid first), by the bill date. */
    ledgerAgeing(): Promise<DashResult<LedgerAgeing>> {
      return call(() => {
        const open: { companyId: string; companyName: string; billDate: string; balancePaise: number }[] = [];
        for (const c of companies) {
          const lines = linesOf(c.id);
          let left = totals(lines).balance;
          for (const l of [...lines].reverse()) {
            if (left <= 0) break;
            if (l.kind !== 'bill' || l.debitPaise <= 0) continue;
            const part = Math.min(left, l.debitPaise);
            open.push({ companyId: c.id, companyName: c.name, billDate: l.date, balancePaise: part });
            left -= part;
          }
        }
        return ok(assembleAgeing(today, open));
      });
    },
    companyStatement(companyId: string, q: PeriodQuery): Promise<DashResult<Statement<LedgerLine>>> {
      return call(() => {
        if (!companies.some((c) => c.id === companyId)) return mockError('NOT_FOUND');
        if (!DATE_RE.test(q.from) || !DATE_RE.test(q.to)) return mockError('VALIDATION_FAILED', { from: 'Choose both dates.' });
        if (q.to < q.from) return mockError('VALIDATION_FAILED', { to: 'The end date must be on or after the start date.' });
        if (q.to > addDays(q.from, 3 * 366)) return mockError('VALIDATION_FAILED', { from: 'Choose a period of 3 years or less.' });
        const all = linesOf(companyId);
        const before = all.filter((l) => l.date < q.from);
        const opening = before[before.length - 1]?.balancePaise ?? 0;
        const rows = all.filter((l) => l.date >= q.from && l.date <= q.to);
        if (rows.length > STATEMENT_MAX_ROWS) {
          return mockError('VALIDATION_FAILED', { from: `This period has more than ${STATEMENT_MAX_ROWS.toLocaleString('en-IN')} entries: choose a shorter period.` });
        }
        return ok({
          openingBalancePaise: opening,
          rows,
          closingBalancePaise: rows[rows.length - 1]?.balancePaise ?? opening,
          totals: { debitPaise: rows.reduce((n, l) => n + l.debitPaise, 0), creditPaise: rows.reduce((n, l) => n + l.creditPaise, 0) },
        });
      });
    },

    // ------------------------------------------------ Customers
    /** q.tab: all | active | off. */
    listCustomers(q: ListQuery = {}): Promise<DashResult<CustomerList>> {
      return call(() => {
        const sorted = [...customers].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const match = (c: Customer, s: string) => allWords([c.name, c.mobile, c.email, c.address, c.city, c.idProofType, c.notes].join(' ').toLowerCase(), s);
        const s = (q.search ?? '').trim().toLowerCase();
        const searched = s ? sorted.filter((c) => match(c, s)) : sorted;
        const tab = q.tab === 'active' || q.tab === 'off' ? q.tab : 'all';
        const shown = tab === 'all' ? searched : searched.filter((c) => (tab === 'active' ? c.isActive : !c.isActive));
        return ok({
          page: pageOf(shown, { ...q, search: '' }, () => true),
          counts: { all: searched.length, active: searched.filter((c) => c.isActive).length, off: searched.filter((c) => !c.isActive).length },
          stats: {
            total: customers.length,
            selfSignup: customers.filter((c) => c.source === 'self').length,
            withEmail: customers.filter((c) => c.email).length,
            addedThisMonth: customers.filter((c) => c.createdAt.slice(0, 10) >= thisMonth).length,
          },
        });
      });
    },
    getCustomer(id: string): Promise<DashResult<Customer>> {
      return call(() => {
        const c = customers.find((x) => x.id === id);
        return c ? ok({ ...c }) : mockError('NOT_FOUND');
      });
    },
    /** Creates the portal login; emailed = an email will be sent (needs an email). */
    createCustomer(input: CustomerInput): Promise<DashResult<{ customer: Customer; emailed: boolean }>> {
      return call(() => {
        const bad = checkCustomer(input, null);
        if (bad) return mockError('VALIDATION_FAILED', bad);
        const c: Customer = {
          ...fieldsOf(input), idProofNumber: idNumberOf(input.idProofNumber, ''), isActive: true,
          id: nextId('cu'), source: 'admin', lastLoginAt: null, createdAt: nowIso(), createdBy: actor.name,
        };
        customers.push(c);
        return ok({ customer: c, emailed: !!c.email });
      });
    },
    updateCustomer(id: string, input: CustomerInput): Promise<DashResult<Customer>> {
      return call(() => {
        const i = customers.findIndex((x) => x.id === id);
        const prev = customers[i];
        if (!prev) return mockError('NOT_FOUND');
        const bad = checkCustomer(input, id);
        if (bad) return mockError('VALIDATION_FAILED', bad);
        if (prev.common && (prev.sharedHotels ?? 0) >= 2 && input.confirmShared !== true) {
          const changed = sharedChanges(prev as unknown as Record<string, unknown>, fieldsOf(input) as unknown as Record<string, unknown>, CUSTOMER_SHARED);
          if (changed.length) return sharedAsk(changed, 'guest', prev.sharedHotels ?? 0);
        }
        const c: Customer = { ...prev, ...fieldsOf(input), idProofNumber: idNumberOf(input.idProofNumber, prev.idProofNumber) };
        customers[i] = c;
        return ok(c);
      });
    },
    deleteCustomer(id: string): Promise<DashResult<{ id: string }>> {
      return call(() => {
        const i = customers.findIndex((x) => x.id === id);
        if (i < 0) return mockError('NOT_FOUND');
        customers.splice(i, 1);
        return ok({ id });
      });
    },
    /** Show (decision 74): the whole ID number. The mock keeps and lists it whole already, so this only echoes it back. */
    revealCustomerIdNumber(id: string): Promise<DashResult<{ idProofNumber: string }>> {
      return call(() => {
        const c = customers.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        if (!c.idProofNumber) return mockError('CONFLICT', { idProofNumber: `${c.name} has no ID number saved.` });
        return ok({ idProofNumber: c.idProofNumber });
      });
    },
    /** New temporary password, emailed. Fails with fields.email when there is no email on file. Show `message` as is. */
    resetCustomerLogin(id: string): Promise<DashResult<ResetLoginResult>> {
      return call(() => {
        const c = customers.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        if (!c.email) return mockError('VALIDATION_FAILED', { email: `Add an email address for ${c.name} first: the new password is sent there.` });
        return ok({ emailed: true, message: `A new login was emailed to ${c.email}.` });
      });
    },
    /** Picker: customers by name or mobile (hint = mobile), at most 50. */
    lookupCustomers(q: LookupQuery = {}): Promise<DashResult<LookupItem[]>> {
      return call(() => {
        const s = (q.q ?? '').trim().toLowerCase();
        const found = customers.filter((c) => !s || c.name.toLowerCase().includes(s) || c.mobile.includes(s.replace(/\D+/g, '') || '\u0000'));
        return ok(found.slice(0, limitOf(q)).map((c) => ({ id: c.id, label: c.name, hint: c.mobile })));
      });
    },

    // ------------------------------------------------ Email marketing
    /** Everything the Email Marketing page shows: the campaigns, the audience sizes, the opt-outs, whether mail can go out. */
    marketing(): Promise<DashResult<MarketingOverview>> {
      return call(() => ok(overview()));
    },
    createCampaign(input: CampaignInput): Promise<DashResult<Campaign>> {
      return call(() => {
        const bad = checkCampaign(input);
        if (bad) return mockError('VALIDATION_FAILED', bad);
        const c: Campaign = { id: nextId('cp'), subject: input.subject.trim(), body: input.body.trim(), audience: input.audience, status: 'draft', recipients: 0, queued: 0, leftOut: 0, delivered: 0, failed: 0, pending: 0, sentAt: null, finishedAt: null, createdAt: nowIso(), createdBy: actor.name };
        campaigns.push(c);
        return ok({ ...c });
      });
    },
    updateCampaign(id: string, input: CampaignInput): Promise<DashResult<Campaign>> {
      return call(() => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        if (c.status !== 'draft') return mockError('CONFLICT', { status: 'A sent campaign cannot be changed.' });
        const bad = checkCampaign(input);
        if (bad) return mockError('VALIDATION_FAILED', bad);
        Object.assign(c, { subject: input.subject.trim(), body: input.body.trim(), audience: input.audience });
        return ok({ ...c });
      });
    },
    /** Drafts only; a sent campaign stays as the record of what went out. */
    deleteCampaign(id: string): Promise<DashResult<{ id: string }>> {
      return call(() => {
        const i = campaigns.findIndex((x) => x.id === id);
        if (i < 0) return mockError('NOT_FOUND');
        if (campaigns[i]?.status !== 'draft') return mockError('CONFLICT', { status: 'A sent campaign cannot be deleted.' });
        campaigns.splice(i, 1);
        return ok({ id });
      });
    },
    /** What sending a draft takes: the addresses it goes to now, those left out, and about how long at the mail service's pace. Shown in the confirmation. */
    estimateCampaign(id: string): Promise<DashResult<CampaignEstimate>> {
      return call(() => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        const n = audienceCounts()[c.audience];
        // the demo hotel sends through Gmail: about 2 a second, 500 a day
        return ok({ recipients: n, leftOut: n > 10 ? 1 : 0, perSecond: 2, perDay: 500, ...campaignDuration(n, 2, 500), held: false });
      });
    },
    /**
     * Starts sending a draft to its audience as it is now (opt-outs and suppressed addresses left out). `expected` is the number the hotel confirmed (estimateCampaign):
     * a different number now answers CONFLICT with the new one, so nobody sends to more people than they agreed to. The mails are fed to the queue a little at a time.
     */
    sendCampaign(id: string, expected: number): Promise<DashResult<Campaign>> {
      return call(() => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        if (c.status !== 'draft') return mockError('CONFLICT', { status: 'This campaign was already sent.' });
        const n = audienceCounts()[c.audience];
        if (n === 0) return mockError('VALIDATION_FAILED', { audience: 'Nobody in this audience has an email address.' });
        if (expected !== n) return mockError('CONFLICT', { expected: companiesCopy.marketing.changed(n) });
        // the demo: about half handed to the queue, a few delivered, the rest still going
        const queued = Math.ceil(n / 2);
        Object.assign(c, { status: 'sending', recipients: n, queued, leftOut: 0, delivered: Math.max(0, queued - 2), failed: 0, pending: Math.min(2, queued), sentAt: nowIso(), finishedAt: null });
        return ok({ ...c });
      });
    },
    /** A sending campaign stops feeding the queue (a few mails already queued may still go). */
    pauseCampaign(id: string): Promise<DashResult<Campaign>> {
      return call(() => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        if (c.status !== 'sending') return mockError('CONFLICT', { status: 'Only a campaign that is sending can be paused.' });
        c.status = 'paused';
        return ok({ ...c });
      });
    },
    resumeCampaign(id: string): Promise<DashResult<Campaign>> {
      return call(() => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        if (c.status !== 'paused') return mockError('CONFLICT', { status: 'Only a paused campaign can be resumed.' });
        c.status = 'sending';
        return ok({ ...c });
      });
    },
    /** Sending or paused: the rest is never sent (mails already sent stay sent). */
    cancelCampaign(id: string): Promise<DashResult<Campaign>> {
      return call(() => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        if (c.status !== 'sending' && c.status !== 'paused') return mockError('CONFLICT', { status: 'Only a campaign that is sending or paused can be cancelled.' });
        Object.assign(c, { status: 'cancelled', pending: 0, finishedAt: nowIso() });
        return ok({ ...c });
      });
    },
    /** One mail of this campaign to the signed-in person (saved first when it is a draft with changes). */
    testCampaign(id: string): Promise<DashResult<{ to: string }>> {
      return call(() => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        return ok({ to: 'you@hotelpallav.in' });
      });
    },
  };
}
