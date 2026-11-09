// Guest requests (MJ's plan, G2): what a staying guest can ask the front desk for from the portal home, shared by the guest portal and the hotel's
// Front Office so both name the kinds the same way. The server keeps the same keys (hotel migration 0031, guest_requests.kind).

export type GuestRequestKind = 'towels' | 'water' | 'cleaning' | 'late_checkout' | 'extend_stay' | 'other';
export type GuestRequestStatus = 'open' | 'done' | 'declined';

export const GUEST_REQUEST_KINDS: readonly { id: GuestRequestKind; label: string; icon: string; hint: string }[] = [
  { id: 'towels', label: 'Fresh towels', icon: 'droplet', hint: 'Towels to the room' },
  { id: 'water', label: 'Drinking water', icon: 'cup-straw', hint: 'Bottled water to the room' },
  { id: 'cleaning', label: 'Room cleaning', icon: 'stars', hint: 'Housekeeping to the room' },
  { id: 'late_checkout', label: 'Late check-out', icon: 'clock-history', hint: 'Ask to leave later than the check-out time' },
  { id: 'extend_stay', label: 'Extend my stay', icon: 'calendar-plus', hint: 'Ask for one or more extra nights' },
  { id: 'other', label: 'Something else', icon: 'chat-dots', hint: 'Tell us what you need' },
];

export const guestRequestKindLabel = (kind: GuestRequestKind): string => GUEST_REQUEST_KINDS.find((k) => k.id === kind)?.label ?? kind;

export const GUEST_REQUEST_STATUS: Record<GuestRequestStatus, string> = { open: 'Waiting', done: 'Done', declined: 'Not possible' };

/** One request (the guest's side, GET/POST /guest/requests, was removed on 18 Oct 2026; the front desk keeps the ones already made, GuestRequestRow). */
export interface GuestRequest {
  id: string;
  kind: GuestRequestKind;
  note: string | null;
  status: GuestRequestStatus;
  /** The desk's word back, when any. */
  reply: string | null;
  /** ISO instants. */
  at: string;
  doneAt: string | null;
}

/** One request as the front desk sees it (GET front-office/requests). */
export interface GuestRequestRow extends GuestRequest {
  stayId: string;
  roomNumber: string;
  guestName: string;
  doneBy: string | null;
}

export const guestRequestsCopy = {
  guest: {
    title: 'Need something?',
    sub: 'Tap what you need and the front desk gets it right away.',
    noStay: 'You can ask the front desk for things here once you have checked in.',
    note: 'Anything to add?',
    notePlaceholder: 'Room 204, two extra pillows please',
    send: 'Send to front desk',
    sending: 'Sending…',
    sent: (what: string) => `${what}: sent to the front desk.`,
    yours: 'Your requests',
    none: 'Nothing asked yet.',
    asked: (when: string) => `Asked ${when}`,
    replied: 'Front desk:',
  },
  desk: {
    title: 'Guest requests',
    sub: 'What guests asked for from the portal: towels, water, cleaning, a late check-out, a longer stay. Mark each done, or say why not.',
    tabs: { open: 'Waiting', closed: 'Closed' },
    columns: { since: 'Since', room: 'Room', guest: 'Guest', request: 'Request', note: 'Note', status: 'Status', by: 'Closed by', actions: 'Actions' },
    done: 'Done',
    decline: 'Not possible',
    reply: 'A word back to the guest (optional)',
    replyPlaceholder: 'On its way in 10 minutes',
    closeTitle: (what: string) => `Close: ${what}`,
    closed: (what: string, status: 'done' | 'declined') => `${what}: ${status === 'done' ? 'marked done' : 'marked not possible'}.`,
    empty: { open: 'No request is waiting.', closed: 'Nothing closed yet.' },
    summary: (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`,
  },
} as const;
