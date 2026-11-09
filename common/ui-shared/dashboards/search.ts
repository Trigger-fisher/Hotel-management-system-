// The global search of the top bar. Server contract: GET /api/v1/search?q= (signed in; each source by its own module) ->
// { query, hits: [{ kind, id, title, subtitle, companyId? }], counts }, kinds bill, advance, company, customer, staff, reservation, stay, enquiry;
// at most 50 hits and 8 per kind; empty under 2 characters; 429 over about 20 a minute ("Too many searches, wait a moment").
// Screens are not on the server: the page finds them in the role's own menu, so they work offline and cost no request.
import type { DashResult } from './common';

// The dev mock also finds rooms, room types and user accounts (room, roomType, user): not on the server yet, so real mode never returns them.
export type SearchKind = 'bill' | 'advance' | 'company' | 'customer' | 'staff' | 'reservation' | 'stay' | 'room' | 'roomType' | 'enquiry' | 'user';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  companyId?: string;
  /** The words carried into the list when the hit has no page of its own (the bill number without "Bill", the room number). */
  find?: string;
  /** A page that shows this record itself (a room with a guest in it opens the stay). */
  open?: { viewId: string; id: string };
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  counts: Record<SearchKind, number>;
}

export interface SearchApi {
  search(q: string): Promise<DashResult<SearchResult>>;
}

export const SEARCH_MIN = 2;
export const SEARCH_PER_KIND = 8;
export const SEARCH_TOTAL = 50;
export const SEARCH_PER_MINUTE = 20;
export const SEARCH_DEBOUNCE_MS = 150;

/** The groups in the order they are shown. */
export const searchKinds: { kind: SearchKind; label: string; icon: string }[] = [
  { kind: 'bill', label: 'Bills', icon: 'receipt' },
  { kind: 'advance', label: 'Guest advances', icon: 'wallet2' },
  { kind: 'company', label: 'Companies', icon: 'building' },
  { kind: 'customer', label: 'Customers', icon: 'people' },
  { kind: 'staff', label: 'Staff', icon: 'person-badge' },
  { kind: 'reservation', label: 'Reservations', icon: 'calendar-plus' },
  { kind: 'stay', label: 'Guests in house', icon: 'person-check' },
  { kind: 'room', label: 'Rooms', icon: 'door-open' },
  { kind: 'roomType', label: 'Room types', icon: 'grid-3x3-gap' },
  { kind: 'enquiry', label: 'Enquiries', icon: 'inbox' },
  { kind: 'user', label: 'User accounts', icon: 'person-gear' },
];

/**
 * Enough typed to search records: 2 characters. `oneDigit` (the dev mock only) also lets a single number through (bill or room number "7");
 * the real server answers empty under 2 characters (MIN_QUERY = 2), so the real client must not spend one of its 20 searches a minute on it.
 */
export function searchable(q: string, oneDigit = false): boolean {
  const t = q.trim();
  return t.length >= SEARCH_MIN || (oneDigit && /^\d+$/.test(t));
}

/**
 * Keeps at most `total` hits without letting the first kinds crowd out the last: each kind (already at most `perKind`, best first) gets a
 * fair share, taken one round at a time, and a kind that has fewer leaves its room to the others. The result is in `searchKinds` order.
 */
export function capHits(hits: SearchHit[], total = SEARCH_TOTAL, perKind = SEARCH_PER_KIND): SearchHit[] {
  const lists = searchKinds.map(({ kind }) => hits.filter((h) => h.kind === kind).slice(0, perKind));
  const take = lists.map(() => 0);
  let left = total;
  let more = true;
  while (left > 0 && more) {
    more = false;
    for (let i = 0; i < lists.length && left > 0; i += 1) {
      if ((take[i] ?? 0) < (lists[i]?.length ?? 0)) {
        take[i] = (take[i] ?? 0) + 1;
        left -= 1;
        more = true;
      }
    }
  }
  return lists.flatMap((l, i) => l.slice(0, take[i] ?? 0));
}

export const searchCopy = {
  placeholder: 'Search screens, bills, rooms, companies, customers, staff…',
  button: 'Search',
  tooMany: 'Too many searches, wait a moment',
  failed: 'The search could not be reached. Try again.',
  recent: 'Recent searches',
  clear: 'Clear',
  screens: 'Screens',
  none: (q: string) => `Nothing matches “${q}”. Try fewer words, or part of a name, number or amount.`,
  hint: 'Type at least 2 letters',
  /** Words inside the hit subtitles of the dev mock (rooms, room types). */
  floor: (f: string) => `Floor ${f}`,
  plans: (codes: string) => `Plans ${codes}`,
  rooms: (n: number) => `${n} ${n === 1 ? 'room' : 'rooms'}`,
} as const;

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export interface SearchScreen {
  id: string;
  label: string;
  /** The menu section it sits in ("Daily Cash"). */
  section: string;
  icon: string;
  /** Extra words that find it ("deposit" finds Revenue). */
  keywords?: string;
}

/** Words a person might type for a screen that its title does not contain. */
const screenWords: Record<string, string> = {
  'hotel.cash.revenue': 'deposit deposits cash in collection income',
  'hotel.cash.expenses': 'expense withdrawal staff advance petty cash out spend',
  'hotel.cash.handover': 'shift handover till notes instructions',
  'hotel.billing.bills': 'bill invoice guest billing debit settle',
  'hotel.billing.advances': 'advance receipt refund deposit paid ahead',
  'hotel.fo.board': 'front desk rooms arrivals departures check in check out',
  'hotel.fo.reservations': 'reservation booking book room',
  'hotel.fo.inHouse': 'in house guests stay',
  'hotel.fo.rooms': 'rooms housekeeping clean dirty out of order',
  'hotel.payroll.home': 'payroll salary staff companies',
};

/** Fuzzy on the title, the section and the keywords: every word typed must start a word of one of them. Equal scores: the most recently opened first (`lastUsed`: screen id -> time). */
export function searchScreens(items: SearchScreen[], q: string, limit = 5, lastUsed: Record<string, number> = {}): SearchScreen[] {
  const words = norm(q).split(' ').filter(Boolean);
  if (words.join('').length < SEARCH_MIN) return [];
  const scored: { item: SearchScreen; score: number }[] = [];
  for (const item of items) {
    const title = norm(item.label);
    const hay = norm(`${item.label} ${item.section} ${item.keywords ?? ''} ${screenWords[item.id] ?? ''}`).split(' ');
    let score = 0;
    let all = true;
    for (const w of words) {
      if (title.startsWith(w)) score += 4;
      else if (title.split(' ').some((t) => t.startsWith(w))) score += 3;
      else if (hay.some((h) => h.startsWith(w))) score += 2;
      else if (title.includes(w)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || (lastUsed[b.item.id] ?? 0) - (lastUsed[a.item.id] ?? 0) || a.item.label.localeCompare(b.item.label)).slice(0, limit).map((x) => x.item);
}

export type SearchSource = (q: string, perKind: number) => Promise<SearchHit[]>;
