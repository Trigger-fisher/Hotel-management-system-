import "server-only";
import type { SystemLogRepo } from "./cashSupport";
import type { Unit } from "./types";

// The hotel side of problems with online payments (disputes): one razorpay_records row of kind dispute each. The payments, events, refunds and orders themselves are kept by the Razorpay
// screen's repository (repos/admin.ts, RazorpayRepo) in the same table. Amounts are whole paise. The PostgreSQL implementation is repos/postgres/razorpay.ts.

export type RazorpayBusiness = "hotel" | "food";

/** A payment as a guest or company sees it. */
export interface RazorpayPaymentRecord {
  id: string;
  business: RazorpayBusiness;
  paymentId: string;
  status: string;
  method: string | null;
  amountPaise: number;
  amountRefundedPaise: number;
  description: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface RazorpayPaymentQuery {
  status?: string;
  page: number;
  pageSize: number;
}
export type DisputeKind = "dispute" | "refund_request" | "question";
export type DisputeStatus = "open" | "answered" | "closed" | "withdrawn";

/** A guest's or company's problem with ONE online payment (a razorpay_records row of kind dispute). */
export interface RazorpayDisputeRecord {
  id: string;
  number: string;
  business: RazorpayBusiness;
  paymentId: string;
  kind: DisputeKind;
  status: DisputeStatus;
  title: string;
  message: string;
  amountPaise: number | null;
  customerId: string | null;
  companyId: string | null;
  reply: string | null;
  repliedAt: Date | null;
  repliedByName: string | null;
  createdAt: Date;
}

export interface RazorpayDisputeQuery {
  status?: DisputeStatus | "all";
  paymentId?: string;
  page: number;
  pageSize: number;
}

export interface RazorpayDisputeRepo {
  /** The payment the person may raise a problem about, or null: it must be theirs (the row-level security of a guest or company account shows only their own) and a paid one. */
  paymentOf(business: RazorpayBusiness, paymentId: string): Promise<RazorpayPaymentRecord | null>;
  create(input: { business: RazorpayBusiness; payment: RazorpayPaymentRecord; kind: DisputeKind; title: string; message: string; amountPaise: number | null; customerId: string | null; companyId: string | null; byUserId: string }): Promise<RazorpayDisputeRecord>;
  get(id: string, opts?: { forUpdate?: boolean }): Promise<RazorpayDisputeRecord | null>;
  list(query: RazorpayDisputeQuery): Promise<{ items: RazorpayDisputeRecord[]; total: number }>;
  /** Answers or closes a dispute that is not yet closed or withdrawn. */
  respond(id: string, input: { status: "answered" | "closed"; reply: string | null; at: Date; by: { id: string; name: string } }): Promise<RazorpayDisputeRecord | null>;
  withdraw(id: string): Promise<RazorpayDisputeRecord | null>;
  /** The hotel's own name (Settings, general site name), for the words of a mail. */
  hotelName(): Promise<string>;
  /** The addresses to tell when a problem is answered: the guest's email, or the company's email and its contacts' (no more than three; nobody who opted out of mail). */
  addresseesOf(dispute: { customerId: string | null; companyId: string | null }): Promise<{ email: string; name: string }[]>;
  /** The payments of the signed-in guest or company (what row-level security lets through), newest first. */
  listPayments(query: RazorpayPaymentQuery): Promise<{ items: RazorpayPaymentRecord[]; total: number }>;
}

/** What the dispute service needs inside one hotel: the disputes, and the system log. */
export interface RazorpayRepos {
  disputes: RazorpayDisputeRepo;
  systemLogs: SystemLogRepo;
}

export type RazorpayUnit = Unit<RazorpayRepos>;