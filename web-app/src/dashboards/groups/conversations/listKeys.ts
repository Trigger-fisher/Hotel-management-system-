// Pure helpers of the Conversations list (decision 66), kept apart so a test can run them without a browser:
//  - the keyboard of the list (a listbox with one roving tab stop): Up and Down move, Home and End jump, Enter opens the row that has the focus;
//  - the live announcement after a poll: "{n} new message(s) from {name}", the name only, never what the message says.
import { newMessagesAnnouncement, type ConversationRow } from '@shared/dashboards/conversations';
import { formatDate, formatTime, formatWeekdayDate, istWallClock } from '@shared/dashboards/format';

/** The time a list row shows: the clock for today, the weekday within the last week, else the date (IST, through format.ts). */
export function whenLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  if (istWallClock(t).date === istWallClock(now).date) return formatTime(iso);
  if (now - t < 6 * 86_400_000 && t <= now) return formatWeekdayDate(iso).split(',')[0];
  return formatDate(iso);
}

export interface ListKeyResult {
  /** The row that has the focus now. */
  active: number;
  /** Enter: open this row. */
  open: boolean;
}

/** The next focus for a key pressed in the list of `count` rows, or null when the key is not the list's (it then does nothing). */
export function listKeyStep(active: number, count: number, key: string): ListKeyResult | null {
  if (count <= 0) return null;
  const at = Math.min(Math.max(active, 0), count - 1);
  switch (key) {
    case 'ArrowDown':
      return { active: Math.min(count - 1, at + 1), open: false };
    case 'ArrowUp':
      return { active: Math.max(0, at - 1), open: false };
    case 'Home':
      return { active: 0, open: false };
    case 'End':
      return { active: count - 1, open: false };
    case 'Enter':
    case ' ':
      return { active: at, open: true };
    default:
      return null;
  }
}

type RowFacts = Pick<ConversationRow, 'id' | 'name' | 'unread' | 'lastAt' | 'lastDirection'>;

/**
 * What a screen reader hears after a poll brought new messages: one sentence per person whose conversation has more unread messages than before, or a newer
 * message from them. A person seen for the first time counts their unread messages. The name only (the list's name or number), never the text.
 */
export function newInboundAnnouncements(before: readonly RowFacts[], after: readonly RowFacts[]): string[] {
  const old = new Map(before.map((r) => [r.id, r]));
  const out: string[] = [];
  for (const r of after) {
    if (r.lastDirection !== 'in') continue;
    const was = old.get(r.id);
    const added = was ? (r.unread > was.unread ? r.unread - was.unread : r.lastAt > was.lastAt ? 1 : 0) : r.unread;
    if (added > 0) out.push(newMessagesAnnouncement(added, r.name));
  }
  return out;
}

/** Two letters for the avatar: the first letters of the first two words, or "#" for a number. */
export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length || /^\+?[0-9 ]+$/.test(name.trim())) return '#';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`).toUpperCase();
}

/** A calm colour for a person's avatar, the same every time (from the name): light tint behind, dark tone of the same hue on top. */
export function avatarStyle(name: string): { background: string; color: string } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { background: `hsl(${h} 55% 88%)`, color: `hsl(${h} 45% 26%)` };
}

/** "Waiting 2 days for a reply" for a conversation whose newest message is the guest's and older than a day; null when it is not overdue. */
export function overdueText(lastAt: string, now: number): string | null {
  const hours = Math.floor((now - Date.parse(lastAt)) / 3_600_000);
  if (!Number.isFinite(hours) || hours < 24) return null;
  const days = Math.floor(hours / 24);
  return `Waiting ${days} ${days === 1 ? 'day' : 'days'} for a reply`;
}

/** Snooze choices: later today (3 hours), tomorrow 8 am, next Monday 8 am (local time). */
export function snoozeOptions(now: Date): { label: string; at: string }[] {
  const at = (d: Date) => d.toISOString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  monday.setHours(8, 0, 0, 0);
  return [
    { label: 'Later today', at: at(new Date(now.getTime() + 3 * 3_600_000)) },
    { label: 'Tomorrow, 8:00 am', at: at(tomorrow) },
    { label: 'Next week, Monday 8:00 am', at: at(monday) },
  ];
}

/** The current time for the relative labels ("5 min ago", overdue): read here so a screen shows the time of its latest render. */
export const nowMs = (): number => Date.now();
