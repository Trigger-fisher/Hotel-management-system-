// The four figures on top of the Email and WhatsApp pages: what each counts and which list a tap opens. The server's tab counts carry all but
// "Reply window closing", which is counted from the loaded chats (the 24-hour window ends within 2 hours). WhatsApp is the hotel's one shared desk
// (MJ, 5 Nov 2026): its figures never speak of owners or done chats.
import type { ConversationRow, ConvTab } from '@shared/dashboards/conversations';

export type InboxKind = 'mail' | 'chat';
export type MailKpi = 'unread' | 'waiting' | 'mine' | 'unassigned';
export type ChatKpi = 'all' | 'unread' | 'waiting' | 'closing';
export type InboxKpi = MailKpi | ChatKpi;

export const MAIL_KPIS: readonly MailKpi[] = ['unread', 'waiting', 'mine', 'unassigned'];
export const CHAT_KPIS: readonly ChatKpi[] = ['all', 'unread', 'waiting', 'closing'];
export const CLOSING_MINUTES = 120;

export const KPI_TEXT: Record<InboxKind, Record<string, { label: string; note: string }>> = {
  mail: {
    unread: { label: 'Unread', note: 'Not opened yet' },
    waiting: { label: 'Waiting for a reply', note: 'Guest wrote last' },
    mine: { label: 'Assigned to me', note: 'Open and yours' },
    unassigned: { label: 'Unassigned', note: 'Open, nobody holds it' },
  },
  chat: {
    all: { label: 'All chats', note: 'Shared by the whole team' },
    unread: { label: 'Unread', note: 'Not opened yet' },
    waiting: { label: 'Waiting for a reply', note: 'Guest wrote last' },
    closing: { label: 'Reply window closing', note: 'Under 2 hours left, then a template only' },
  },
};

/** The chat's 24-hour window ends within 2 hours (still open). */
export function closingSoon(r: Pick<ConversationRow, 'windowMinutes'>): boolean {
  const m = r.windowMinutes;
  return typeof m === 'number' && m > 0 && m <= CLOSING_MINUTES;
}

/** Whether a row belongs to the list a figure opens: the same rules as the server's tabs, so the list holds exactly what was counted. A chat is never closed. */
export function inKpi(kind: InboxKind, pick: InboxKpi, r: ConversationRow, me: string): boolean {
  const open = r.box === 'main' && (kind === 'chat' || r.status === 'open');
  if (pick === 'unread') return r.box === 'main' && r.unread > 0;
  if (pick === 'waiting') return open && r.lastDirection === 'in';
  if (pick === 'mine') return r.status === 'open' && r.assignedTo?.id === me;
  if (pick === 'unassigned') return open && !r.assignedTo;
  if (pick === 'closing') return kind === 'chat' && open && closingSoon(r);
  return open;
}

/** The server tab a figure asks for ("closing" reads every chat and keeps the ones whose window ends soon). */
export const kpiTab = (pick: InboxKpi): ConvTab => (pick === 'closing' ? 'all' : pick);

/** The figures: the server's tab counts; "closing" from the chats loaded (null until they have been). */
export function kpiCounts(kind: InboxKind, counts: Partial<Record<ConvTab, number>> | undefined, openRows: readonly ConversationRow[] | null): Record<string, number | null> {
  const n = (t: ConvTab) => (counts ? (counts[t] ?? 0) : null);
  if (kind === 'mail') return { unread: n('unread'), waiting: n('waiting'), mine: n('mine'), unassigned: n('unassigned') };
  return { all: n('all'), unread: n('unread'), waiting: n('waiting'), closing: openRows ? openRows.filter(closingSoon).length : null };
}
