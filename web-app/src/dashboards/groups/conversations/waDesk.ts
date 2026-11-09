// Pure helpers of the WhatsApp page: the filter chips, day chips, first bubble of a run, search inside a chat, the media / documents / links of a chat, and the
// drafts kept per chat in this browser (never a text that holds an ID number).
import type { ConvTab } from '@shared/dashboards/conversations';
import { formatDate } from '@shared/dashboards/format';
import type { WhatsAppMessage } from '@shared/dashboards/whatsapp';

/** The chips of the chat list: one shared desk (MJ, 5 Nov 2026), so nothing about owners or done chats. */
export const DESK_FILTERS = ['all', 'unread', 'waiting'] as const satisfies readonly ConvTab[];

const DAY = 86_400_000;
const DRAFT_DAYS = 7;
const DRAFT_PREFIX = 'hms.wa.draft:';

/** "Today", "Yesterday" or "05 Nov 2026" (India time, like every date in HMS). */
export function dayLabel(iso: string, now: number): 'Today' | 'Yesterday' | string {
  const day = formatDate(iso);
  if (day === formatDate(new Date(now).toISOString())) return 'Today';
  if (day === formatDate(new Date(now - DAY).toISOString())) return 'Yesterday';
  return day;
}

/** The first bubble of a run from one side draws the tail. */
export function startsRun(prev: WhatsAppMessage | undefined, m: WhatsAppMessage): boolean {
  if (!prev || prev.sentFrom === 'auto' || prev.direction !== m.direction) return true;
  return formatDate(prev.at) !== formatDate(m.at);
}

/** The words a chat search looks through. */
export function searchText(m: WhatsAppMessage): string {
  return [m.text, m.media?.caption, m.media?.name, m.template?.text, m.location?.label, ...(m.contacts ?? []).map((c) => c.name)].filter(Boolean).join(' ');
}

/** The messages that hold the searched words (two letters at least), oldest first. */
export function chatHits(messages: readonly WhatsAppMessage[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return messages.filter((m) => searchText(m).toLowerCase().includes(q)).map((m) => m.id);
}

/** A text cut into plain parts and the parts that match the search (for <mark>). */
export function splitHits(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (q.length < 2 || !text) return [{ text, hit: false }];
  const low = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + needle.length)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false });
    out.push({ text: text.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

export interface ChatLink {
  id: string;
  url: string;
  at: string;
}

/** The photos and videos, the documents and the links of the loaded chat, newest first. */
export function chatFiles(messages: readonly WhatsAppMessage[]): { media: WhatsAppMessage[]; docs: WhatsAppMessage[]; links: ChatLink[] } {
  const newest = [...messages].reverse();
  const links: ChatLink[] = [];
  for (const m of newest) for (const url of `${m.text ?? ''} ${m.media?.caption ?? ''}`.match(URL_RE) ?? []) links.push({ id: m.id, url: url.replace(/[.,;:!?]+$/, ''), at: m.at });
  return {
    media: newest.filter((m) => m.type === 'image' || m.type === 'video' || m.type === 'sticker'),
    docs: newest.filter((m) => m.type === 'document' || m.type === 'audio'),
    links,
  };
}

const ID_PATTERNS: readonly RegExp[] = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /\d{12,}/,
  /\b[A-Z]{5}\d{4}[A-Z]\b/i,
  /\b[A-Z]{3}\d{7}\b/i,
  /\b[A-Z]\d{7}\b/i,
  /\b[A-Z]{2}\d{2}[\s-]?\d{11}\b/i,
];

/** True when a text looks like it holds an ID number (Aadhaar, PAN, passport, voter or driving licence): such a draft is never kept. */
export const holdsIdNumber = (text: string): boolean => ID_PATTERNS.some((re) => re.test(text));

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function store(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const draftKey = (scope: string, id: string) => `${DRAFT_PREFIX}${scope}:${id}`;

export function readDraft(scope: string, id: string, now: number = Date.now(), s: Store | null = store()): string {
  if (!s) return '';
  try {
    const raw = s.getItem(draftKey(scope, id));
    if (!raw) return '';
    const v = JSON.parse(raw) as { text?: unknown; at?: unknown };
    if (typeof v.text !== 'string' || typeof v.at !== 'number' || now - v.at > DRAFT_DAYS * DAY || holdsIdNumber(v.text)) {
      s.removeItem(draftKey(scope, id));
      return '';
    }
    return v.text;
  } catch {
    return '';
  }
}

/** Keeps the draft (an empty text or one with an ID number removes it). */
export function writeDraft(scope: string, id: string, text: string, now: number = Date.now(), s: Store | null = store()): void {
  if (!s) return;
  try {
    if (!text.trim() || holdsIdNumber(text)) s.removeItem(draftKey(scope, id));
    else s.setItem(draftKey(scope, id), JSON.stringify({ text, at: now }));
  } catch {
    /* storage full or blocked: the draft is only a convenience */
  }
}
