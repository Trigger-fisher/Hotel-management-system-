// The hotel selector of the Company and Guest portals (decision 48). A portal login may be linked to several hotels (one company or guest record per hotel).
// The sidebar's selector holds ONE choice for the whole session: "all" (default) or one hotel id. Every portal call carries it as `?hotel=` (the adapters read
// `portalHotelStore`), and the shell re-opens the current page when it changes, so every page reloads for that hotel only.
// Remembered in this tab's sessionStorage (guarded: blocked storage means "all" after a reload); forgotten with `portalHotelStore.reset()` when a session ends.
// The shell also writes it into the page address (`?hotel=<id>`) and an address that names a hotel opens with it.
import { portalHotelFromSearch } from './routes';

export interface PortalHotel {
  hotelId: string;
  name: string;
}

export const PORTAL_ALL_HOTELS = 'all';

const KEY = 'hms-portal-hotel';
const listeners = new Set<() => void>();

function readKept(): string {
  // a link that names a hotel (`?hotel=<id>`, routes.ts) wins over this tab's remembered choice
  const named = typeof window !== 'undefined' ? portalHotelFromSearch(window.location.search) : null;
  if (named) return named;
  try {
    return (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(KEY)) || PORTAL_ALL_HOTELS;
  } catch {
    return PORTAL_ALL_HOTELS;
  }
}

let current = readKept();

export const portalHotelStore = {
  /** "all" or a hotel id. */
  get: (): string => current,
  set: (value: string): void => {
    if (value === current) return;
    current = value;
    try {
      if (value === PORTAL_ALL_HOTELS) sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, value);
    } catch {
      // blocked storage: the choice lasts for this page only
    }
    for (const l of listeners) l();
  },
  reset: (): void => portalHotelStore.set(PORTAL_ALL_HOTELS),
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** The `hotel` query value of the current choice: undefined for "all" (the server's default). */
export const hotelParam = (): string | undefined => (current === PORTAL_ALL_HOTELS ? undefined : current);

export const portalHotelCopy = {
  all: 'All hotels',
  current: 'Showing',
  menuLabel: 'Choose a hotel',
  hint: 'Pick one hotel to see only its bills and stays.',
  rowHotel: 'Hotel',
  /** The Hotel filter chips above a list. */
  filter: 'Hotel',
  /** What the selector row says under a hotel's name: what the company owes it, what it has not read. */
  owes: (due: string): string => `Owes ${due}`,
  unread: (n: number): string => `${n} unread`,
  /** Guest portal: the room of the stay going on at that hotel, and the requests still open there. */
  room: (no: string): string => `Room ${no}`,
  requests: (n: number): string => `${n} open ${n === 1 ? 'request' : 'requests'}`,
  allTotals: (due: string, bills: number): string => `Owes ${due} in ${bills} ${bills === 1 ? 'bill' : 'bills'}`,
  /** A partial answer: a small note, never an error. */
  unavailableTitle: (n: number): string => `${n} ${n === 1 ? 'hotel' : 'hotels'} could not be reached`,
  unavailableBody: (names: string[]): string => `Not included right now: ${names.join(', ')}. Try again in a moment.`,
} as const;
