// Pure helpers of the filter bar on the Email page and the platform's channel screens, kept apart so a test can run them without a browser (the desk's
// WhatsApp page has its chips, All / Unread / Waiting, answered by the server, and no filter bar; a chat there has no owner):
//  - the option groups the Filters panel offers (who owns it, whose turn it is, the 24-hour window, how old, linked to a booking);
//  - the test that says whether one list row passes the chosen options: any value inside a group, every group together;
//  - the chips of a search text (from:, label:, is:unread ...) and the text left after one of them is removed.
import type { ConversationRow } from '@shared/dashboards/conversations';

export interface FilterOption {
  value: string;
  label: string;
}
export interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
}
/** The chosen values of each group; a missing or empty group does not filter. */
export type FilterSel = Readonly<Record<string, readonly string[]>>;

const DAY = 86_400_000;
/** A WhatsApp window with less than this many minutes left is "closing soon". */
const CLOSING_MINUTES = 180;

const OWNER: FilterGroup = { key: 'owner', label: 'Owner', options: [{ value: 'me', label: 'Me' }, { value: 'others', label: 'Someone else' }, { value: 'unassigned', label: 'Unassigned' }] };
const TURN: FilterGroup = { key: 'turn', label: 'Waiting on', options: [{ value: 'us', label: 'Us' }, { value: 'guest', label: 'The guest' }] };
const WINDOW: FilterGroup = { key: 'window', label: '24-hour window', options: [{ value: 'open', label: 'Open' }, { value: 'closing', label: 'Closing soon' }, { value: 'closed', label: 'Closed' }] };
const WHEN: FilterGroup = { key: 'when', label: 'Last message', options: [{ value: 'today', label: 'Last 24 hours' }, { value: 'week', label: 'This week' }, { value: 'older', label: 'Older' }] };
const LINK: FilterGroup = { key: 'link', label: 'Booking', options: [{ value: 'linked', label: 'Linked' }, { value: 'unlinked', label: 'Not linked' }] };
const SENDER: FilterGroup = { key: 'sender', label: 'Sender', options: [{ value: 'unverified', label: 'Not verified' }] };

export const whatsappFilterGroups: FilterGroup[] = [TURN, WINDOW, WHEN, LINK];
export const emailFilterGroups: FilterGroup[] = [OWNER, TURN, WHEN, LINK, SENDER];

function passes(key: string, value: string, r: ConversationRow, meId: string, now: number): boolean {
  switch (key) {
    case 'owner':
      return value === 'me' ? r.assignedTo?.id === meId : value === 'unassigned' ? !r.assignedTo : !!r.assignedTo && r.assignedTo.id !== meId;
    case 'turn':
      return value === 'us' ? r.waiting : !r.waiting && r.lastDirection === 'out';
    case 'window': {
      const m = r.windowMinutes;
      if (m === null || m === undefined) return false;
      return value === 'closing' ? m > 0 && m < CLOSING_MINUTES : value === 'open' ? m >= CLOSING_MINUTES : m <= 0;
    }
    case 'when': {
      const age = now - Date.parse(r.lastAt);
      return value === 'today' ? age < DAY : value === 'week' ? age < 7 * DAY : age >= 7 * DAY;
    }
    case 'link':
      return value === 'linked' ? r.linked : !r.linked;
    case 'sender':
      return r.unverified;
    default:
      return true;
  }
}

/** True when the row passes every group that has a chosen value (any one value of a group is enough). */
export function matchesFilters(r: ConversationRow, sel: FilterSel, meId: string, now: number): boolean {
  return Object.entries(sel).every(([key, values]) => values.length === 0 || values.some((v) => passes(key, v, r, meId, now)));
}

export function countChosen(sel: FilterSel): number {
  return Object.values(sel).reduce((n, v) => n + v.length, 0);
}

/** The operator words of a search text (those with a colon), each with the search text left after it is taken out. */
export function searchChips(search: string): { token: string; rest: string }[] {
  const tokens = search.trim().split(/\s+/).filter(Boolean);
  return tokens.map((token, i) => ({ token, rest: tokens.filter((_, j) => j !== i).join(' ') })).filter((c) => /^[a-z]+:\S+/i.test(c.token));
}
