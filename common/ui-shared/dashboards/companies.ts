// Companies module (Hotel dashboard): Company Profiles, Company Ledger, Customers, CRM.
// Source: Hotel Pallav CompanyProfileController, CompanyLedgerController (+ Support/CompanyLedger),
// CustomerController and their models/views, plus Email Marketing (HMS). Frontend-only mock with an in-memory store.
// Money is in paise. Plain dates are "YYYY-MM-DD"; timestamps are ISO UTC.

import type { Page, Tone } from './common';
import type { createCompaniesApi } from './companies.mock';
import type { ProfileLastChange } from './profileReview';

/** The mock's "today" (keeps month/period figures stable in the demo). */
export const COMPANIES_MOCK_TODAY = '2026-11-05';

// ---------------------------------------------------------------- Company profiles

export interface CompanyContact {
  role: string;
  name: string;
  email: string;
  mobile: string;
}

export interface CompanyProfile {
  id: string;
  name: string;
  gstNumber: string;
  mobile: string;
  /** Landline. */
  phone: string;
  email: string;
  address: string;
  country: string;
  pincode: string;
  nationality: string;
  /** Percentages, null = does not apply. */
  discountPct: number | null;
  gstPct: number | null;
  tcsPct: number | null;
  tdsPct: number | null;
  /** Anything the front desk should know. */
  instruction: string;
  /** At least one; the first is the main contact. */
  contacts: CompanyContact[];
  createdAt: string;
  createdBy: string;
  /**
   * The ONE common company profile (platform 0132): true = name, GST number, mobile, phone, email, address, country, pincode and contacts above are the company's one
   * profile, the same the company and every hotel see; a save here changes them for all (the hotel's own copy is kept in step). The percentages, instruction and nationality
   * are always this hotel's. false or absent = this hotel's own record only. Read-only; optional until every server sends it.
   */
  common?: boolean;
  /** When `common`: who last changed the ONE profile, from which hotel, when (profileReview.ts ProfileLastChange; show `lastChangeLine`). Read-only. */
  lastChange?: ProfileLastChange | null;
  /** When `common`: how many hotels share this profile (2 or more = a shared change asks to confirm, profileReview.ts M1(b)). Read-only. */
  sharedHotels?: number;
}

export type CompanyInput = Omit<CompanyProfile, 'id' | 'createdAt' | 'createdBy' | 'common' | 'lastChange' | 'sharedHotels'> & {
  /** M1(b): true = "yes, change it at every hotel" (sent again after the 409 that asked). */
  confirmShared?: boolean;
};

export interface CompanyStats {
  total: number;
  withGst: number;
  contacts: number;
  addedThisMonth: number;
}

export interface CompanyList {
  page: Page<CompanyProfile>;
  stats: CompanyStats;
}

/**
 * The forms' lists, from the hotel's data: GET /companies/options (ID proof types and Master Data
 * "company_contact_role"). Screens use these, never the constants below.
 */
export interface CompaniesOptions {
  idTypes: string[];
  contactRoles: string[];
}

export const companyRateFields = [
  { key: 'discountPct', label: 'Discount' },
  { key: 'gstPct', label: 'GST' },
  { key: 'tcsPct', label: 'TCS' },
  { key: 'tdsPct', label: 'TDS' },
] as const;

export function blankCompany(): CompanyInput {
  return {
    name: '', gstNumber: '', mobile: '', phone: '', email: '', address: '', country: 'India', pincode: '', nationality: 'Indian',
    discountPct: null, gstPct: null, tcsPct: null, tdsPct: null, instruction: '',
    contacts: [{ role: 'Main contact', name: '', email: '', mobile: '' }],
  };
}

// ---------------------------------------------------------------- Company ledger

export type LedgerKind = 'bill' | 'advance' | 'checkout' | 'adjusted' | 'settlement' | 'refund';

export const ledgerKinds: Record<LedgerKind, { label: string; tone: Tone; icon: string }> = {
  bill: { label: 'Bill', tone: 'graphite', icon: 'receipt' },
  advance: { label: 'Advance', tone: 'success', icon: 'wallet' },
  checkout: { label: 'Paid at checkout', tone: 'success', icon: 'card' },
  adjusted: { label: 'Advance used', tone: 'info', icon: 'swap' },
  settlement: { label: 'Payment', tone: 'success', icon: 'card' },
  refund: { label: 'Refund', tone: 'warning', icon: 'arrowUp' },
};

export interface LedgerLine {
  id: string;
  companyId: string;
  kind: LedgerKind;
  /** YYYY-MM-DD */
  date: string;
  /** Entry number in Bill Master. */
  entry: number;
  /** "Bill 2026 / 1170" / "Receipt 2026 / 801" (Bill Master numbers). */
  ref: string;
  guest: string | null;
  room: string | null;
  mode: string | null;
  note: string | null;
  debitPaise: number;
  creditPaise: number;
  /** Running balance after this line (debits - credits). Above zero = company owes. */
  balancePaise: number;
}

export type LedgerState = 'owing' | 'credit' | 'settled';

export interface LedgerSummary {
  companyId: string;
  companyName: string;
  gstNumber: string;
  billedPaise: number;
  receivedPaise: number;
  refundedPaise: number;
  balancePaise: number;
  state: LedgerState;
  /** 0-100: share of what was billed that has been paid. null = no entries. */
  paidPercent: number | null;
  entries: number;
  bills: number;
  /** Bills left on account with money still due. */
  openBills: number;
  lastDate: string | null;
}

export interface LedgerOverview {
  page: Page<LedgerSummary>;
  /** All rows the filter shows (for the summary preview). */
  all: LedgerSummary[];
  counts: Record<'all' | LedgerState, number>;
  stats: {
    owedPaise: number;
    owing: number;
    heldPaise: number;
    holding: number;
    monthBilledPaise: number;
    monthReceivedPaise: number;
  };
}

/** Receivables by age (H8): what each company still owes on its bills, by how long since the bill date (as of today, IST). */
export interface AgeingRow {
  companyId: string;
  companyName: string;
  /** Bills dated within the last 30 days. */
  currentPaise: number;
  days31to60Paise: number;
  days61to90Paise: number;
  over90Paise: number;
  totalPaise: number;
  openBills: number;
}
export interface AgeingTotals {
  currentPaise: number;
  days31to60Paise: number;
  days61to90Paise: number;
  over90Paise: number;
  totalPaise: number;
  openBills: number;
}
export interface LedgerAgeing {
  /** YYYY-MM-DD, the day the ages are counted from. */
  asOf: string;
  /** The companies owing, most owed first. */
  rows: AgeingRow[];
  totals: AgeingTotals;
}
/** The bucket of a bill `age` days old (0 to 30 = current). */
export const ageingBucket = (age: number): keyof Omit<AgeingTotals, 'totalPaise' | 'openBills'> => (age <= 30 ? 'currentPaise' : age <= 60 ? 'days31to60Paise' : age <= 90 ? 'days61to90Paise' : 'over90Paise');
/** Days between two YYYY-MM-DD days (to - from). */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** Adds open bills {companyId, companyName, billDate, balancePaise} up into the ageing report (the mock and the server share it). */
export function assembleAgeing(asOf: string, bills: { companyId: string; companyName: string; billDate: string; balancePaise: number }[]): LedgerAgeing {
  const blank = (): AgeingTotals => ({ currentPaise: 0, days31to60Paise: 0, days61to90Paise: 0, over90Paise: 0, totalPaise: 0, openBills: 0 });
  const rows = new Map<string, AgeingRow>();
  const totals = blank();
  for (const b of bills) {
    if (b.balancePaise <= 0) continue;
    let r = rows.get(b.companyId);
    if (!r) {
      r = { companyId: b.companyId, companyName: b.companyName, ...blank() };
      rows.set(b.companyId, r);
    }
    const bucket = ageingBucket(daysBetween(b.billDate, asOf));
    r[bucket] += b.balancePaise;
    r.totalPaise += b.balancePaise;
    r.openBills += 1;
    totals[bucket] += b.balancePaise;
    totals.totalPaise += b.balancePaise;
    totals.openBills += 1;
  }
  return { asOf, rows: [...rows.values()].sort((a, b) => b.totalPaise - a.totalPaise || a.companyName.localeCompare(b.companyName)), totals };
}

export type LedgerPeriod = 'all' | 'month' | 'last' | 'year' | 'custom';

export const ledgerPeriods: { id: Exclude<LedgerPeriod, 'custom'>; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'month', label: 'This month' },
  { id: 'last', label: 'Last month' },
  { id: 'year', label: 'This year' },
];

export interface StatementQuery {
  period?: LedgerPeriod;
  /** YYYY-MM-DD, used with period "custom". */
  from?: string;
  to?: string;
  search?: string;
  /** Omit to land on the last page (the latest lines), like a book. */
  page?: number;
  pageSize?: number;
}

export interface LedgerStatement {
  company: CompanyProfile;
  period: LedgerPeriod;
  from: string | null;
  to: string | null;
  openingPaise: number;
  closingPaise: number;
  billedPaise: number;
  receivedPaise: number;
  refundedPaise: number;
  /** Lines in the period (search applied), oldest first. */
  page: Page<LedgerLine>;
  /** Every line in the period, for the preview. */
  periodLines: LedgerLine[];
  lastPaid: LedgerLine | null;
  openBills: number;
}

// ---------------------------------------------------------------- Customers

export type CustomerSource = 'self' | 'admin';

export interface Customer {
  id: string;
  name: string;
  /** Digits only, 10-15. Their portal sign-in. */
  mobile: string;
  email: string;
  address: string;
  city: string;
  idProofType: string;
  /** The ID number as the server sends it: only the last 4 characters ("••••9012") when `idProofMasked` is true (decision 74). The whole number comes from `revealCustomerIdNumber`. */
  idProofNumber: string;
  /** True when `idProofNumber` is the shortened form (a real server); absent or false = it is the whole number (the mock). */
  idProofMasked?: boolean;
  notes: string;
  /** Portal sign-in allowed. */
  isActive: boolean;
  source: CustomerSource;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
  /**
   * The ONE common guest profile (platform 0132): true = name, email, address and city above are the guest's one profile, the same the guest and every hotel see; a save here
   * changes them for all (the hotel's own copy is kept in step for search and bills). false or absent = this hotel's own record only. Mobile, ID proof and notes are always
   * this hotel's. Optional until every server sends it.
   */
  common?: boolean;
  /** When `common`: who last changed the ONE profile, from which hotel, when (profileReview.ts ProfileLastChange; show `lastChangeLine`). Read-only. */
  lastChange?: ProfileLastChange | null;
  /** When `common`: how many hotels share this profile (2 or more = a shared change asks to confirm, profileReview.ts M1(b)). Read-only. */
  sharedHotels?: number;
}

export type CustomerInput = Pick<Customer, 'name' | 'mobile' | 'email' | 'address' | 'city' | 'idProofType' | 'notes' | 'isActive'> & {
  /** Max 50. Absent = keep the stored number, "" = remove it. The masked text of the record ("••••9012") sent back unchanged also keeps it. */
  idProofNumber?: string;
  /** M1(b): true = "yes, change it at every hotel" (sent again after the 409 that asked). */
  confirmShared?: boolean;
};

export interface CustomerList {
  page: Page<Customer>;
  counts: Record<'all' | 'active' | 'off', number>;
  stats: { total: number; selfSignup: number; withEmail: number; addedThisMonth: number };
}

export function blankCustomer(): CustomerInput {
  return { name: '', mobile: '', email: '', address: '', city: '', idProofType: '', idProofNumber: '', notes: '', isActive: true };
}

/** Reset-login answer: `emailed` false until the auth module's port can send it; show `message` as is. */
export interface ResetLoginResult {
  emailed: boolean;
  message: string;
}

// ---------------------------------------------------------------- Email marketing

/** Who a campaign goes to: the hotel's customers, its companies (the company's own address and its contacts), its past guests, or everyone. */
export type CampaignAudience = 'customers' | 'companies' | 'guests' | 'all';

export const campaignAudiences: { id: CampaignAudience; label: string; hint: string; icon: string }[] = [
  { id: 'customers', label: 'Customers', hint: 'Guests with a portal account and an email', icon: 'people' },
  { id: 'companies', label: 'Companies', hint: 'Company profiles and the people on them', icon: 'building' },
  { id: 'guests', label: 'Past guests', hint: 'Everyone who stayed and left an email', icon: 'door-open' },
  { id: 'all', label: 'Everyone', hint: 'All of the above, each address once', icon: 'globe' },
];

export function campaignAudienceOf(id: CampaignAudience): { id: CampaignAudience; label: string; hint: string; icon: string } {
  return campaignAudiences.find((a) => a.id === id) ?? { id, label: id, hint: '', icon: 'envelope' };
}

export interface Campaign {
  id: string;
  subject: string;
  /** Plain text. `{name}` is replaced by each person's name. */
  body: string;
  audience: CampaignAudience;
  /** draft -> sending <-> paused -> sent (all mails went or failed) or cancelled (the rest never goes). Hotel migration 0044. */
  status: CampaignStatus;
  /** How many addresses it goes to (0 while a draft). */
  recipients: number;
  /** How many of them have been handed to the mail queue so far (it is fed a little at a time, within what the mail service allows a day). */
  queued: number;
  /** Addresses left out: they bounced before, marked an earlier mail as spam, or unsubscribed (also while it was being sent). */
  leftOut: number;
  /** From the mail queue: delivered, failed for good, still waiting. */
  delivered: number;
  failed: number;
  pending: number;
  /** When sending began. */
  sentAt: string | null;
  /** When it finished (sent) or was cancelled. */
  finishedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export type CampaignStatus = 'draft' | 'sending' | 'paused' | 'sent' | 'cancelled';

/** What sending a campaign will take, shown before the hotel confirms ("This will send 50,000 mails, over about 3 days"). */
export interface CampaignEstimate {
  /** Addresses it will go to now (opt-outs and suppressed addresses already left out). Send with this number as the confirmation. */
  recipients: number;
  /** Addresses of the audience left out (bounced before, marked as spam, or unsubscribed through the mail service). */
  leftOut: number;
  /** What the hotel's mail service allows: mails a second and a day; null = no fixed limit. */
  perSecond: number | null;
  perDay: number | null;
  /** About how long it takes: minutes when it fits in one day, else days. */
  minutes: number;
  days: number;
  /** The platform has put this hotel's campaign mail on hold (too many bounces or complaints): it will not go until the Super Admin releases it. */
  held: boolean;
}

export type CampaignInput = Pick<Campaign, 'subject' | 'body' | 'audience'>;

export interface MarketingOverview {
  campaigns: Campaign[];
  /** How many addresses each audience reaches right now (opt-outs already left out). */
  audience: Record<CampaignAudience, number>;
  optOuts: number;
  /** The hotel's own mail server is set up (Settings > Email); without it nothing can be sent. */
  mailReady: boolean;
  /** The signed-in person's address, where a test mail goes (null when the account has none). */
  myEmail: string | null;
  /** Why the platform holds this hotel's campaign mail (too many bounces or complaints), or null when it does not. */
  held: string | null;
}

/** About how long a campaign of `n` mails takes at this pace (the worker sends about 5 a second when the service sets no rate). */
export function campaignDuration(n: number, perSecond: number | null, perDay: number | null): { minutes: number; days: number } {
  const rate = perSecond && perSecond > 0 ? perSecond : 5;
  const days = perDay && perDay > 0 ? Math.ceil(n / perDay) : 1;
  const today = perDay && perDay > 0 ? Math.min(n, perDay) : n;
  return { minutes: Math.max(1, Math.ceil(today / rate / 60)), days };
}

export const CAMPAIGN_SUBJECT_MAX = 150;
export const CAMPAIGN_BODY_MAX = 5000;

export function blankCampaign(): CampaignInput {
  return { subject: '', body: '', audience: 'customers' };
}

/** A message that opens with its own greeting ("Dear {name},", "Hi", "Namaste") gets no second one. */
const OWN_GREETING = /^(dear|hello|hi|hey|namaste|namaskar|respected|greetings)\b/i;

/** The mail as a person receives it: the greeting (unless the message has its own), the message with `{name}` filled in, the hotel's sign-off. Pure; the server renders the same. */
export function campaignText(body: string, name: string, hotelName: string): string {
  const who = name.trim() || 'Guest';
  const text = body.replace(/\{name\}/g, who).trim();
  return `${OWN_GREETING.test(text) ? '' : `Hello ${who},\n\n`}${text}\n\nWarm regards,\n${hotelName}`;
}

// ---------------------------------------------------------------- Copy

export const companiesCopy = {
  profiles: {
    title: 'Companies',
    subtitle: 'The companies you bill, with their tax details and the people to contact.',
    add: 'Add company',
    searchPlaceholder: 'Search name, GST, contact, city',
    kpi: { total: 'Companies', withGst: 'With a GST number', contacts: 'People on file', month: 'Added this month' },
    columns: { company: 'Company', where: 'Where', contact: 'Contact', people: 'People', rates: 'Rates' },
    empty: { title: 'No companies added yet', body: 'Add a company to keep its GST number, billing rates and contacts in one place.' },
    noMatch: { title: 'No companies match your search', body: 'Try part of the name, the GST number or a contact.' },
    formNew: 'Add company',
    formEdit: 'Edit company',
    sections: { about: 'About the company', reach: 'How to reach them', people: 'People to contact', rates: 'Rates on their bills', where: 'Where they are', instruction: 'Instruction' },
    hints: {
      reach: "The company's own number and email.",
      people: 'The main contact is always kept. Add as many more as you need.',
      rates: 'Leave a rate empty if it does not apply.',
      instruction: 'Optional. Anything the front desk should know.',
    },
    addPerson: 'Add another person',
    removePerson: 'Remove',
    create: 'Create company',
    save: 'Save changes',
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: 'This company profile will be removed and cannot be restored. Its ledger history stays in the ledger.',
    created: (name: string) => `${name} added to Company Profiles.`,
    updated: (name: string) => `${name} updated.`,
    deleted: (name: string) => `${name} deleted.`,
    preview: 'Preview',
    previewTitle: 'Company profile',
    noRates: 'No rates set.',
    nobody: 'Nobody on file.',
  },
  ledger: {
    title: 'Ledger',
    subtitle: 'What each company has been billed, what it has paid, and what it still owes.',
    searchPlaceholder: 'Search company, GST or phone',
    tabs: { all: 'All', owing: 'Owing', credit: 'In credit', settled: 'Settled' },
    kpi: { owed: 'Owed to us', held: 'Held in advance', monthBilled: 'Billed this month', monthReceived: 'Received this month' },
    columns: { company: 'Company', billed: 'Billed', received: 'Received', paid: 'Paid off', balance: 'Balance', status: 'Status' },
    state: { owing: 'Owes', credit: 'In credit', settled: 'Settled' } as Record<LedgerState, string>,
    empty: { title: 'No companies yet', body: 'Add a company in Company Profiles. Its bills and advances will build its ledger here.' },
    noMatch: { title: 'No company matches', body: 'Try part of the name, the GST number or a phone number, or show all companies.' },
    summaryPreview: 'Summary preview',
    summaryTitle: 'Company ledger summary',
    ageing: {
      title: 'Receivables by age',
      hint: 'Bills still on account, by how long since the bill date.',
      columns: { company: 'Company', current: '0 to 30 days', d31: '31 to 60', d61: '61 to 90', over90: 'Over 90', total: 'Total due', bills: 'Bills' },
      totals: 'All companies',
      csv: 'CSV',
      empty: 'No bill is on account right now.',
      asOf: 'As of',
    },
    goProfiles: 'Companies',
  },
  statement: {
    title: 'Ledger statement',
    full: 'Full statement',
    searchPlaceholder: 'Search guest, room, bill, mode, amount',
    kpi: { opening: 'Opening balance', billed: 'Billed', received: 'Received', closing: 'Closing balance' },
    columns: { date: 'Date', entry: 'Entry', guest: 'Guest / room', mode: 'Mode', debit: 'Debit', credit: 'Credit', balance: 'Balance' },
    empty: { title: 'No entries in this period', body: 'Bills, advances and payments for this company will show here.' },
    noMatch: { title: 'Nothing matches your search', body: 'Try a guest name, room, bill number or an amount.' },
    from: 'From',
    to: 'To',
    preview: 'Statement preview',
    lastPaid: 'Last payment',
    openBills: 'Bills on account',
    never: 'No payment yet',
  },
  customers: {
    title: 'Customers',
    subtitle: 'Guests with a portal account: added here, or signed up by themselves.',
    add: 'Add customer',
    searchPlaceholder: 'Search name, mobile, email, city',
    tabs: { all: 'All', active: 'Portal on', off: 'Portal off' },
    kpi: { total: 'Customers', self: 'Signed up themselves', email: 'With an email', month: 'Added this month' },
    columns: { customer: 'Customer', mobile: 'Mobile', email: 'Email', city: 'City', idProof: 'ID proof', portal: 'Portal' },
    empty: { title: 'No customers yet', body: 'Add a guest, or let them make their own account on the portal sign-up page.' },
    noMatch: { title: 'No customers match', body: 'Try part of the name, the mobile number or the city.' },
    formNew: 'Add customer',
    formEdit: 'Edit customer',
    formAbout: 'Name and mobile number are needed; the mobile number is their portal sign-in.',
    newLoginNote: 'Their login is made for them and emailed. They choose their own password on first sign-in.',
    emailHint: 'The login details and statements are sent here.',
    idHint: 'The ID number is stored as entered. Printed copies show only the last 4 digits.',
    idNumber: 'ID number',
    idReplace: 'Replace ID number',
    idStored: (masked: string) => `Stored: ${masked}. Leave empty to keep it.`,
    idSealed: 'The full ID number is stored as typed.',
    activeLabel: 'Portal sign-in allowed',
    activeHint: 'Turn off to stop them signing in without deleting them.',
    create: 'Add customer',
    save: 'Save changes',
    resetLogin: 'Reset login',
    resetTitle: (name: string) => `Reset login for ${name}?`,
    resetBody: 'A new temporary password will be made, and an email will be sent with it. They choose their own password at the next sign-in.',
    resetDone: (email: string) => `Login reset. An email will be sent to ${email}.`,
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: 'Their portal account will be removed and they will no longer be able to sign in. This cannot be undone.',
    created: (name: string, emailed: boolean) => (emailed ? `${name} added. An email with the login will be sent.` : `${name} added. No email on file, so use Reset login once one is added.`),
    updated: (name: string) => `${name} updated.`,
    deleted: (name: string) => `${name} deleted.`,
    previewTitle: 'Customer record',
    selfSignup: 'Signed up themselves',
    addedByStaff: 'Added by staff',
  },
  marketing: {
    title: 'Email campaigns',
    subtitle: 'News and offers to your guests and companies, sent from your own mail server.',
    add: 'New campaign',
    kpi: { sent: 'Campaigns sent', emails: 'Emails delivered', reach: 'People you can reach', optOuts: 'Unsubscribed' },
    columns: { campaign: 'Campaign', audience: 'Audience', sent: 'Sent', reached: 'Reached' },
    status: { draft: 'Draft', sending: 'Sending', paused: 'Paused', sent: 'Sent', cancelled: 'Cancelled' } as Record<CampaignStatus, string>,
    pause: 'Pause',
    resume: 'Resume',
    cancelSend: 'Cancel sending',
    paused: 'Paused. Nothing more goes out until you resume.',
    resumed: 'Sending again.',
    cancelTitle: 'Cancel this campaign?',
    cancelBody: 'Mails already sent cannot be recalled; the rest will never be sent. This cannot be undone.',
    cancelConfirm: 'Cancel the campaign',
    cancelKeep: 'Keep sending',
    cancelled: 'Campaign cancelled. The rest will not be sent.',
    progress: (queued: number, total: number) => `${queued} of ${total} handed to the mail queue`,
    leftOut: (n: number) => `${n} left out (bounced, spam or unsubscribed)`,
    estimating: 'Working out how long it takes…',
    duration: (e: { minutes: number; days: number; perDay: number | null }) =>
      e.days > 1 ? `It goes out over about ${e.days} days (${e.perDay} a day, the limit of your mail service).` : `It takes about ${e.minutes} ${e.minutes === 1 ? 'minute' : 'minutes'}.`,
    heldNote: (why: string) => `The platform has paused your campaign mail: ${why}. Bills, receipts and other mail still go. Contact EasyHotelSolutions support to have it released.`,
    changed: (n: number) => `The audience changed: it is ${n} now. Check and send again.`,
    empty: { title: 'No campaigns yet', body: 'Write a campaign to tell your guests about an offer, a festival menu or what is new at the hotel.' },
    formNew: 'New campaign',
    formEdit: 'Edit campaign',
    subject: 'Subject',
    subjectHint: 'What the person sees first. Keep it short and honest.',
    audience: 'Who gets it',
    audienceHint: 'Each address is counted once. People who unsubscribed are never included.',
    message: 'Message',
    messageHint: 'Plain text, as a personal email. Write {name} where the person\'s name should go. The greeting, your hotel name and an unsubscribe line are added for you.',
    preview: 'How it will read',
    previewFor: 'Preview for',
    sampleName: 'Priya',
    saveDraft: 'Save draft',
    sendTest: 'Send a test to me',
    sendTo: (n: number) => `Send to ${n} ${n === 1 ? 'person' : 'people'}`,
    nobody: 'Nobody to send to',
    confirmTitle: (n: number) => `Send this to ${n} ${n === 1 ? 'person' : 'people'}?`,
    confirmBody: 'The mails go out from your mail server at the pace it allows. You can pause or cancel while it is sending; a mail already sent cannot be recalled.',
    confirm: 'Send now',
    saved: 'Draft saved.',
    created: 'Draft saved. Send a test to yourself before you send it to everyone.',
    sent: (n: number) => `Sending to ${n} ${n === 1 ? 'person' : 'people'}.`,
    tested: (to: string) => `A test was sent to ${to}.`,
    noMyEmail: 'Your account has no email address, so a test cannot be sent to you.',
    mailNotReady: 'Set up your mail server under Settings > Email before sending a campaign.',
    deleteTitle: 'Delete this draft?',
    deleteBody: 'The draft is removed. Sent campaigns are kept.',
    deleted: 'Draft deleted.',
    edit: 'Edit',
    send: 'Send',
    delete: 'Delete',
    recipients: (n: number) => `${n} ${n === 1 ? 'address' : 'addresses'}`,
    delivered: 'delivered',
    failed: 'failed',
    pending: 'waiting',
    unsubscribeLine: 'You get this email because you stayed with us or have an account with us. To stop these emails, open:',
  },
  common: {
    edit: 'Edit',
    delete: 'Delete',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    print: 'Print',
    none: '—',
    notGiven: 'Not given',
    clearSearch: 'Clear search',
    showAll: 'Show all',
    pdfNote: 'Preview only. The PDF download comes with the live system.',
    name: 'Name',
    companyName: 'Company name',
    gstin: 'GSTIN',
    gstNumber: 'GST number (GSTIN)',
    gstHint: '15 characters, like 24AAACT2727Q1ZV',
    noGst: 'No GST number',
    mobile: 'Mobile',
    landline: 'Landline',
    email: 'Email',
    address: 'Address',
    addressHint: 'Up to 100 characters.',
    country: 'Country',
    pincode: 'Pincode',
    nationality: 'Nationality',
    role: 'Role',
    theirRole: 'Their role',
    chooseRole: 'Choose a role',
    fullName: 'Full name',
    mainContact: 'Main contact',
    person: (n: number) => `Person ${n}`,
    notes: 'Notes',
    printed: 'Printed',
    asOn: (d: string) => `As on ${d}`,
    addedBy: (when: string, who: string) => `Added ${when} by ${who}.`,
    companiesCount: (n: number) => `${n} ${n === 1 ? 'company' : 'companies'}`,
    drcrNote: "Dr = the company owes the hotel. Cr = the hotel holds the company's money.",
    start: 'Start',
    today: 'today',
    allTime: 'All time',
    choose: 'Choose',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    source: 'Source',
    logType: 'Type',
    custom: 'Custom',
    signInAllowed: 'Sign-in allowed',
    signInOff: 'Sign-in turned off',
    lastSignIn: 'Last sign-in',
    never: 'Never',
    instructionPlaceholder: 'For example: bill rooms to the company, guests pay for food.',
    rateLabel: (label: string) => `${label} %`,
    plural: (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`,
  },
} as const;

// ---------------------------------------------------------------- Helpers (pure)

/** "Tata Consultancy Services" -> "TC". */
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
}

/** "12.5" -> "12.5%", 10 -> "10%". */
export function formatPercent(v: number): string {
  return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}%`;
}

export function companyRates(c: Pick<CompanyProfile, 'discountPct' | 'gstPct' | 'tcsPct' | 'tdsPct'>): { label: string; value: number }[] {
  return companyRateFields.filter((f) => (c[f.key] ?? 0) > 0).map((f) => ({ label: f.label, value: c[f.key] ?? 0 }));
}

export function companyPlace(c: Pick<CompanyProfile, 'address' | 'pincode' | 'country'>): string {
  return [c.address, c.pincode, c.country].filter(Boolean).join(', ');
}

export function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function lastDayOf(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
  return `${yyyyMm}-${String(d).padStart(2, '0')}`;
}

function prevMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const yy = (m ?? 1) === 1 ? (y ?? 2026) - 1 : y ?? 2026;
  const mm = (m ?? 1) === 1 ? 12 : (m ?? 1) - 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/** The From/To of a ledger period (null = open). */
export function periodRange(period: LedgerPeriod, today: string = COMPANIES_MOCK_TODAY, from?: string, to?: string): { from: string | null; to: string | null } {
  const ym = today.slice(0, 7);
  switch (period) {
    case 'month': return { from: monthStart(today), to: lastDayOf(ym) };
    case 'last': { const p = prevMonth(ym); return { from: `${p}-01`, to: lastDayOf(p) }; }
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'custom': {
      let f = from || null;
      let t = to || null;
      if (f && t && t < f) [f, t] = [t, f];
      return { from: f, to: t };
    }
    default: return { from: null, to: null };
  }
}

// ---------------------------------------------------------------- API

export type CompaniesApi = ReturnType<typeof createCompaniesApi>;

/**
 * Starting company profiles instead of the mock's own (dev preview `?data=s08`, see companies.fixtures.ts). The mock's made-up ledger lines and
 * open-bill counts belong to its own companies, so with a seed the ledger starts empty. Customers and CRM keep their own rows (no fixtures exist).
 */
export interface CompaniesSeed {
  companies: CompanyProfile[];
}
