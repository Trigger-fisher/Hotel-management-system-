import "server-only";
import type { ListResult, Page } from "./types";

// Customer support requests (hotel migration 0042; guest portal round 3, decision 61, rebuilt on main): a guest's message to the hotel and the front desk's reply. Plain records.

export type SupportStatus = "open" | "answered" | "closed";

export interface SupportRequestRecord {
  id: string;
  number: string;
  customerId: string | null;
  guestName: string;
  subject: string;
  message: string;
  billRef: string | null;
  orderRef: string | null;
  status: SupportStatus;
  reply: string | null;
  repliedAt: Date | null;
  repliedBy: string | null;
  repliedByName: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface SupportRepo {
  create(input: Pick<SupportRequestRecord, "number" | "customerId" | "guestName" | "subject" | "message" | "billRef" | "orderRef" | "createdBy" | "createdAt">): Promise<SupportRequestRecord>;
  get(id: string, options?: { forUpdate?: boolean }): Promise<SupportRequestRecord | null>;
  /** One customer's requests, newest first, at most `limit`. */
  forCustomer(customerId: string, limit: number): Promise<SupportRequestRecord[]>;
  /** How many of this customer's requests are open. */
  openCount(customerId: string): Promise<number>;
  /** The hotel's list: a status or all; `open` oldest first (the desk's queue), the rest newest first; words in the number, guest, subject or message. */
  list(query: { status?: SupportStatus; words?: readonly string[] } & Page): Promise<ListResult<SupportRequestRecord>>;
  respond(id: string, input: { status: SupportStatus; reply: string | null; at: Date; by: { id: string; name: string } }): Promise<SupportRequestRecord | null>;
}
