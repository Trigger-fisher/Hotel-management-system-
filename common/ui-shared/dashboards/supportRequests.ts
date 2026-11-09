// Customer support (guest portal round 3 b, decision 61, rebuilt on main 18 Oct 2026; hotel migration 0042). Contract of docs/BACKEND.md "Customer support".
// The guest side (GET/POST /guest/support) was removed on 18 Oct 2026 (MJ: no Customer support in the guest portal); the messages already sent stay readable here.
// HOTEL (Front Office > Guest messages, In House part pms.stays): GET /front-office/support?status=open|answered|closed|all&search=&page=&pageSize= -> DeskSupportPage;
// POST /front-office/support/{id}/respond { status: 'answered'|'closed', reply? } -> DeskSupportRequest (an answer needs a reply; a closed message is final: 409).
import type { createSupportMock } from './supportRequests.mock';

export type SupportStatus = 'open' | 'answered' | 'closed';
export const SUPPORT_MESSAGE_MAX = 2000;

export interface SupportRequestBase {
  id: string;
  /** "S-1A2B3C". */
  number: string;
  subject: string;
  message: string;
  billRef: string | null;
  orderRef: string | null;
  status: SupportStatus;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export interface DeskSupportRequest extends SupportRequestBase {
  guestName: string;
  repliedByName: string | null;
}

export interface DeskSupportPage {
  items: DeskSupportRequest[];
  total: number;
  page: number;
  pageSize: number;
  /** Waiting for an answer (the badge). */
  openCount: number;
}

export const supportCopy = {
  deskStatusLabel: { open: 'Open', answered: 'Answered', closed: 'Closed' } as Record<SupportStatus, string>,
} as const;

export type SupportApi = ReturnType<typeof createSupportMock>;
