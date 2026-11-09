import "server-only";
import type { Paise } from "../money/paise";
import type { AdvanceRecord, BillingRepos, BillRecord } from "./billing";
import type { IdProofTypeRepo, SettingsRepo } from "./frontOffice";
import type { ListResult, Page, VersionedResult } from "./types";

// Companies (Pallav "Company Profiles", Customers), Email Marketing (HMS) and the Company Ledger, in the hotel's own database (company_profiles,
// customers, mail_campaigns, mail_campaign_recipients, mail_optouts). The ledger has NO table: it is derived from Bill Master's live bills and
// advances (Support/CompanyLedger.php), so its source rows come through the billing repositories of the SAME unit (CompaniesRepos extends
// BillingRepos). Plain records, no SQL. Rules every implementation keeps: company profiles are soft-deleted (recycle bin) with the name unique
// among LIVE rows; customers are hard-deleted (Pallav has no recycle bin for them); a customer's mobile is unique; a campaign's recipients go
// with it; an opt-out address is unique without regard to case; none of these carry a version (not in MJ's version list). Spec: docs/specs/companies.md.

/* ---------------------------------------------------------------- company profiles */

export interface CompanyContactRecord {
  role: string;
  name: string;
  email: string;
  mobile: string;
}

export interface CompanyFields {
  name: string;
  email: string | null;
  mobileNumber: string | null;
  phoneNumber: string | null;
  country: string | null;
  nationality: string | null;
  pincode: string | null;
  gstNumber: string | null;
  address: string | null;
  /** decimal(5,2) as text ("12.50"); display only (no computation uses them, B1 finding). */
  discountPercentage: string | null;
  gstPercentage: string | null;
  tcsPercentage: string | null;
  tdsPercentage: string | null;
  instruction: string | null;
  contacts: CompanyContactRecord[];
}
export interface CompanyRecord extends CompanyFields {
  id: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyRepo {
  get(id: string, options?: { deleted?: boolean }): Promise<CompanyRecord | null>;
  /** Newest first (created_at desc, id desc, CompanyProfileController.php:19); every word (or "quoted phrase") in any field or the contacts. */
  list(query: { words?: readonly string[]; deleted?: "no" | "only" } & Page): Promise<ListResult<CompanyRecord>>;
  /** Live companies matching the words, by name (the ledger overview's list, CompanyLedgerController.php:45-53). Capped at `limit`. */
  byName(query: { words?: readonly string[]; limit: number }): Promise<CompanyRecord[]>;
  /** The numbers on top (:25-30): total, with a GST number, contact people, added since `monthFrom`. Live rows. */
  stats(monthFrom: Date): Promise<{ total: number; withGst: number; contacts: number; month: number }>;
  /** The live company with exactly this GST number (another company's, when `except` is given). */
  withGstNumber(gstNumber: string, except?: string): Promise<CompanyRecord | null>;
  /** Live name taken (the functional unique index; Pallav's collation is case-insensitive). */
  nameTaken(name: string, except?: string): Promise<boolean>;
  /** The typeahead: live names starting with `prefix` (case-insensitive), by name, at most `limit` (≤ 50). */
  lookup(prefix: string, limit: number): Promise<{ id: string; name: string; gstNumber: string | null }[]>;
  create(input: CompanyFields & { createdBy: string }): Promise<CompanyRecord>;
  update(id: string, patch: Partial<CompanyFields>, actorId: string): Promise<CompanyRecord | null>;
  softDelete(id: string, actorId: string): Promise<boolean>;
  restore(id: string, actorId: string): Promise<CompanyRecord | null>;
  purge(id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- customers */

export interface CustomerFields {
  name: string;
  /** Digits only, 10-15, unique (CustomerController.php:48, :67-70). */
  mobile: string;
  email: string | null;
  address: string | null;
  city: string | null;
  idProofType: string | null;
  /** Plain text (no encryption: Pallav shows it in full). */
  idProofNumber: string | null;
  notes: string | null;
  isActive: boolean;
  source: "admin" | "self";
}
export interface CustomerRecord extends CustomerFields {
  id: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CustomerRepo {
  get(id: string): Promise<CustomerRecord | null>;
  getMany(ids: readonly string[]): Promise<Map<string, CustomerRecord>>;
  /** Newest first; every word in name, mobile, email, address, city, ID type or notes (never the ID number, :24-42). */
  list(query: { words?: readonly string[]; active?: boolean } & Page): Promise<ListResult<CustomerRecord>>;
  counts(words?: readonly string[]): Promise<{ all: number; active: number; off: number }>;
  stats(monthFrom: Date): Promise<{ total: number; selfSignup: number; withEmail: number; month: number }>;
  byMobile(mobile: string): Promise<CustomerRecord | null>;
  lookup(prefix: string, limit: number): Promise<{ id: string; name: string; mobile: string }[]>;
  /** Mobile taken -> RepoError "unique" "customers_mobile". */
  create(input: CustomerFields & { createdBy: string }): Promise<CustomerRecord>;
  update(id: string, patch: Partial<CustomerFields>, actorId: string): Promise<CustomerRecord | null>;
  /** Hard delete. */
  delete(id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- email marketing */

export type CampaignAudience = "customers" | "companies" | "guests" | "all";

export interface CampaignFields {
  subject: string;
  body: string;
  audience: CampaignAudience;
}
/** draft -> sending <-> paused -> sent (every recipient queued and none waiting) or cancelled (hotel migration 0044). */
export type CampaignStatus = "draft" | "sending" | "paused" | "sent" | "cancelled";
export interface CampaignRecord extends CampaignFields {
  id: string;
  status: CampaignStatus;
  recipients: number;
  /** Recipients the feeder has moved into the outbox. */
  queued: number;
  /** Addresses left out: on the platform's suppression list when it began, or unsubscribed or suppressed while it was being sent. */
  leftOut: number;
  /** When sending began (every status but draft). */
  sentAt: Date | null;
  pausedAt: Date | null;
  /** When the last mail was queued and none was waiting (sent), or when it was cancelled. */
  finishedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
/** One address of an audience: the person's name (for the greeting) and their email, lower case. */
export interface Addressee {
  email: string;
  name: string;
}

interface MarketingRepo {
  get(id: string, options?: { forUpdate?: boolean }): Promise<CampaignRecord | null>;
  /** Newest first, at most `limit`. */
  list(limit: number): Promise<CampaignRecord[]>;
  create(input: CampaignFields & { createdBy: string }): Promise<CampaignRecord>;
  /** Drafts only (the caller checks the status under the lock). */
  update(id: string, patch: Partial<CampaignFields>, actorId: string): Promise<CampaignRecord | null>;
  delete(id: string): Promise<boolean>;
  /** Starts sending a draft: status sending, its recipients kept with it (none queued yet), `leftOut` addresses counted as left out. */
  begin(id: string, recipients: readonly Addressee[], leftOut: number, at: Date, actorId: string): Promise<CampaignRecord | null>;
  /** sending <-> paused, or the end: sent (finished) or cancelled. The caller checks the status under the lock. */
  setStatus(id: string, status: Exclude<CampaignStatus, "draft">, at: Date, actorId: string | null): Promise<CampaignRecord | null>;
  /** The next recipients not yet queued nor skipped, in the order they were kept. */
  nextRecipients(campaignId: string, limit: number): Promise<(Addressee & { id: string })[]>;
  /** These recipients went into the outbox: queued_at set, the campaign's queued count raised. */
  markQueued(campaignId: string, recipientIds: readonly string[], at: Date): Promise<void>;
  /** These recipients will not get the mail (opted out or suppressed meanwhile, or the campaign was cancelled): counted as left out unless cancelled. */
  markSkipped(campaignId: string, recipientIds: readonly string[], why: "opted_out" | "suppressed" | "cancelled"): Promise<void>;
  /** Which of these (lower-case) addresses unsubscribed from this hotel. */
  optedOutAmong(emails: readonly string[]): Promise<Set<string>>;
  recipients(campaignId: string): Promise<Addressee[]>;
  /**
   * The live addresses of an audience, each once (lower case; the first name seen wins), opt-outs already left out: customers = active customers
   * with an email; companies = live company profiles' own address and their contacts'; guests = the stays' guests (pms_stays) with an email;
   * all = the three together.
   */
  audience(kind: CampaignAudience): Promise<Addressee[]>;
  /** How many addresses each audience reaches (the same rule as `audience`, counted). */
  audienceCounts(): Promise<Record<CampaignAudience, number>>;
  optOut(email: string): Promise<void>;
  optOuts(): Promise<number>;
}

/* ---------------------------------------------------------------- the ledger's source (Bill Master, read-only from here) */

/** One company's figures for the ledger OVERVIEW, aggregated without building its lines (ruled: scale). Equal to totals(build()) (property-tested). */
export interface LedgerSummaryRow {
  companyId: string;
  billedPaise: Paise;
  receivedPaise: Paise;
  refundedPaise: Paise;
  /** billed + refunded − received */
  balancePaise: Paise;
  monthBilledPaise: Paise;
  monthReceivedPaise: Paise;
  /** How many ledger lines the account has. */
  lines: number;
  /** The date of its last line (YYYY-MM-DD), or null. */
  lastDate: string | null;
  bills: number;
  /** Bills with something still owed (balance hotel + food > 0). */
  openBills: number;
}

/** The live bills and advances that touch companies, for the ledger (CompanyLedger::lines / ::summaries). */
interface LedgerSourceRepo {
  /** One company's live bills, with the company of the advance each one used (the "own advance" test, CompanyLedger.php:163). */
  forCompany(companyId: string): Promise<{ bills: (BillRecord & { advanceCompanyId: string | null })[]; advances: AdvanceRecord[] }>;
  /**
   * Every company's figures at once, for the OVERVIEW (CompanyLedger::summaries :59-80), computed by the real repository in SQL with
   * GROUP BY company_id over bill_master_bills and bill_master_advances (indexes (company_id, bill_date) and (company_id, payment_date));
   * `monthFrom` = the first day of this month (IST). Never builds the lines.
   */
  summaryByCompany(monthFrom: string): Promise<LedgerSummaryRow[]>;
  /** Every live bill of a company with money still due (balance > 0), for the ageing report: no lines are built. */
  openBills(): Promise<OpenBillRow[]>;
}
export interface OpenBillRow {
  companyId: string;
  billDate: string;
  balancePaise: Paise;
}

/** What a companies service gets inside a unit (billing's repositories included: the ledger reads them). */
export interface CompaniesRepos extends BillingRepos {
  companyProfiles: CompanyRepo;
  customers: CustomerRepo;
  marketing: MarketingRepo;
  /** The hotel settings (email marketing reads whether the mail server is set up). */
  settings: SettingsRepo;
  ledgerSource: LedgerSourceRepo;
  /** id_proof_types (read-only; the same list the front office offers). */
  idProofTypes: IdProofTypeRepo;
}

export type { VersionedResult };
