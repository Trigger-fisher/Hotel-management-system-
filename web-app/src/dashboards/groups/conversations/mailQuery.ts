// Gmail's search box on the Mailbox page, mapped onto what the server answers: is:unread and is:starred pick that folder, label: picks the label, from: and
// subject: become plain words (the server matches them against the name, address and subject), has:attachment is checked on the loaded rows.
import { parseSearch, type ConversationRow } from '@shared/dashboards/conversations';

export type MailFolder = 'inbox' | 'starred' | 'snoozed' | 'sent' | 'drafts' | 'done';
export const MAIL_FOLDERS: readonly MailFolder[] = ['inbox', 'starred', 'snoozed', 'sent', 'drafts', 'done'];
export type ServerFolder = 'inbox' | 'starred' | 'snoozed' | 'sent' | 'drafts' | 'archive' | 'unread';
export const SERVER_FOLDER: Record<MailFolder, ServerFolder> = { inbox: 'inbox', starred: 'starred', snoozed: 'snoozed', sent: 'sent', drafts: 'drafts', done: 'archive' };

export interface MailQuery {
  words: string;
  folder: ServerFolder;
  label: string | null;
  hasAttachment: boolean;
  /** The operators the person typed, each a removable chip. */
  chips: string[];
}

export function mailQuery(text: string, folder: MailFolder, labels: readonly string[]): MailQuery {
  const p = parseSearch(text);
  const chips: string[] = [];
  let server: ServerFolder = SERVER_FOLDER[folder];
  if (p.isStarred) {
    server = 'starred';
    chips.push('is:starred');
  } else if (p.isUnread) {
    server = 'unread';
    chips.push('is:unread');
  }
  const wanted = p.label[0];
  const label = wanted ? (labels.find((l) => l.toLowerCase() === wanted.replace(/-/g, ' ')) ?? null) : null;
  if (label) chips.push(`label:${wanted}`);
  for (const f of p.from) chips.push(`from:${f}`);
  for (const s of p.subject) chips.push(`subject:${s}`);
  if (p.hasAttachment) chips.push('has:attachment');
  return { words: [...p.words, ...p.from, ...p.subject].join(' '), folder: server, label, hasAttachment: p.hasAttachment, chips };
}

/** The search text with one chip taken out. */
export function withoutChip(text: string, chip: string): string {
  return text
    .split(/\s+/)
    .filter((w) => w && w.toLowerCase() !== chip.toLowerCase())
    .join(' ');
}

export function passesLocal(r: ConversationRow, q: MailQuery): boolean {
  return !q.hasAttachment || r.hasAttachments;
}

/** Gmail's snooze choices, worked out from now in the hotel's wall clock (the caller passes IST "now"). */
export function snoozeChoices(now: Date): { key: 'later' | 'tomorrow' | 'weekend' | 'nextWeek'; at: Date }[] {
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  const day = (n: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() + n);
    return x;
  };
  const later = now.getHours() < 18 ? at(now, 18) : at(day(1), 8);
  const toSat = (6 - now.getDay() + 7) % 7 || 7;
  const toMon = (8 - now.getDay()) % 7 || 7;
  return [
    { key: 'later', at: later },
    { key: 'tomorrow', at: at(day(1), 8) },
    { key: 'weekend', at: at(day(toSat), 8) },
    { key: 'nextWeek', at: at(day(toMon), 8) },
  ];
}

/** j / k / x / s / e / r / a / f / c / u / slash / ? on the list and in a thread; null when the key means nothing or the person is typing. */
export type MailKey = 'down' | 'up' | 'open' | 'select' | 'star' | 'done' | 'reply' | 'replyAll' | 'forward' | 'compose' | 'unread' | 'search' | 'help' | 'back';
export function mailKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null }): MailKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName ?? ''))) return null;
  const map: Record<string, MailKey> = { j: 'down', k: 'up', Enter: 'open', o: 'open', x: 'select', s: 'star', e: 'done', r: 'reply', a: 'replyAll', f: 'forward', c: 'compose', u: 'back', '/': 'search', '?': 'help', U: 'unread' };
  return map[e.key] ?? null;
}
