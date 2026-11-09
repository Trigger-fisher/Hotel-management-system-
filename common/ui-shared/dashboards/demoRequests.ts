// Demo requests (platform 0169): a hotel that asked for a demo on the product website (/contact). The Super Admin sees them in Platform > Hotels > Demo requests
// and marks each one contacted or closed. A prospect's details only: nothing here belongs to a hotel yet.

export const DEMO_REQUEST_STATUSES = ['new', 'contacted', 'closed'] as const;
export type DemoRequestStatus = (typeof DEMO_REQUEST_STATUSES)[number];

/** The limits the form, the server and the table share. */
export const demoRequestLimits = { name: 120, email: 254, phone: 20, hotelName: 160, city: 100, message: 2000, rooms: 5000, properties: 500 } as const;

export interface DemoRequestInput {
  name: string;
  email: string;
  phone?: string | null;
  hotelName: string;
  city?: string | null;
  rooms?: number | null;
  properties?: number | null;
  message?: string | null;
  /** The honeypot: a person never fills it (hidden from view); a bot does, and its request is dropped. */
  website?: string;
}

export interface DemoRequest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  hotelName: string;
  city: string | null;
  rooms: number | null;
  properties: number | null;
  message: string | null;
  status: DemoRequestStatus;
  handledByName: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface DemoRequestPage {
  items: DemoRequest[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<DemoRequestStatus, number>;
}

export const demoRequestCopy = {
  title: 'Demo requests',
  sub: 'Hotels that asked for a demo on the website. Mark each one when you have called it.',
  status: { new: 'New', contacted: 'Contacted', closed: 'Closed' } as Record<DemoRequestStatus, string>,
  markAs: { new: 'Mark as new', contacted: 'Mark as contacted', closed: 'Close' } as Record<DemoRequestStatus, string>,
  empty: { new: 'No new requests', contacted: 'Nobody marked as contacted', closed: 'Nothing closed yet' } as Record<DemoRequestStatus, string>,
  emptyText: 'Requests from the website’s demo form appear here.',
  loadFailed: 'Could not load the demo requests',
  saved: 'Saved',
  columns: { hotel: 'Hotel', person: 'Contact', size: 'Size', message: 'Message', received: 'Received', status: 'Status' },
  rooms: (n: number) => `${n} ${n === 1 ? 'room' : 'rooms'}`,
  properties: (n: number) => `${n} ${n === 1 ? 'property' : 'properties'}`,
} as const;
