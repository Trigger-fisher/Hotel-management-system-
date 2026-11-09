// Pure helpers of the email thread shown as a chat (kept apart so a test can run them without a browser): who is in the conversation (the contact, the people on the
// To line and every person who was only ever Cc'd), who "Reply all" fills in, the addresses the Cc box suggests, and the delivery tick of one of our own emails.
// Nothing here reads a mail body; only the addresses already in the thread list.
import { CONV_CC_MAX, type ConvMessage, type ConvMessageStatus, type EmailEntry } from '@shared/dashboards/conversations';

/** "Rohan Sharma <rohan@abc.com>" gives "rohan@abc.com"; a bare address is kept. Lower case, for comparing. */
export const addressOf = (raw: string): string => (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase();

/** The display name of "Rohan Sharma <rohan@abc.com>"; for a bare address the address itself. */
export const nameOf = (raw: string): string => raw.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || raw.trim();

export interface ThreadPerson {
  address: string;
  name: string;
  /** The person the conversation is with (one of the contact's addresses). */
  contact: boolean;
  /** Only ever on a Cc line of this thread: never wrote, never on a To line. */
  ccOnly: boolean;
}

/** Splits what a person typed or pasted into the Cc box: commas, semicolons and spaces separate; the address inside "Name <a@b>" is kept. Empty pieces and repeats are dropped. */
export function splitAddresses(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/[,;\s]+/)) {
    const a = piece.replace(/^<|>$/g, '').trim();
    if (a && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  }
  return out;
}

/** Whether the text is shaped like one address (the server checks again; this only decides when a typed chip is kept). */
export const looksLikeAddress = (a: string): boolean => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(a);

const emails = (messages: readonly ConvMessage[]): EmailEntry[] => messages.filter((m): m is EmailEntry => m.kind === 'email');

/**
 * The addresses that are the hotel's own mailbox in this thread: who our outgoing emails came from, and the first To of an incoming email (the mailbox it reached).
 * They are not shown as people in the conversation and never put into a Reply all.
 */
export function ownAddresses(messages: readonly ConvMessage[]): Set<string> {
  const own = new Set<string>();
  for (const m of emails(messages)) {
    if (m.direction === 'out') own.add(addressOf(m.from));
    else if (m.to[0]) own.add(addressOf(m.to[0]));
  }
  return own;
}

/** Everyone in the conversation: the contact first, then the others in the order they first appear. The hotel's own mailbox is left out. */
export function threadParticipants(messages: readonly ConvMessage[], contactHandles: readonly string[]): ThreadPerson[] {
  const own = ownAddresses(messages);
  const handles = new Set(contactHandles.map((h) => h.trim().toLowerCase()));
  const people = new Map<string, ThreadPerson>();
  const see = (raw: string, onCc: boolean) => {
    const address = addressOf(raw);
    if (!address || own.has(address)) return;
    const name = nameOf(raw);
    const known = people.get(address);
    if (known) {
      if (!onCc) known.ccOnly = false;
      if (known.name === known.address && name !== address) known.name = name;
      return;
    }
    people.set(address, { address, name: name.toLowerCase() === address ? address : name, contact: handles.has(address), ccOnly: onCc });
  };
  for (const m of emails(messages)) {
    if (m.direction === 'in') see(m.from, false);
    m.to.forEach((t, i) => {
      if (m.direction === 'in' && i === 0) return; // the mailbox
      see(t, false);
    });
    m.cc.forEach((c) => see(c, true));
  }
  return [...people.values()].sort((a, b) => Number(b.contact) - Number(a.contact));
}

/**
 * Reply all: the newest email's Cc and its other To people (the first To is the mailbox itself on an incoming email), without the person the reply already goes to,
 * the hotel's own mailbox and repeats. At most CONV_CC_MAX (the server's limit).
 */
export function replyAllRecipients(last: EmailEntry | undefined, target: string | null, messages: readonly ConvMessage[]): string[] {
  if (!last) return [];
  const own = ownAddresses(messages);
  const skip = new Set([...own, (target ?? '').toLowerCase()]);
  const out: string[] = [];
  for (const raw of [...last.cc, ...last.to.slice(1)]) {
    const a = addressOf(raw);
    if (a && !skip.has(a) && !out.includes(a)) out.push(a);
  }
  return out.slice(0, CONV_CC_MAX);
}

/** What the Cc box offers while a person types: the thread's people first, then the hotel's known contacts, minus those already chosen and the reply's own To. */
export function ccSuggestions(typed: string, chosen: readonly string[], people: readonly ThreadPerson[], known: readonly string[], target: string | null): { address: string; name: string }[] {
  const taken = new Set([...chosen.map((c) => c.toLowerCase()), (target ?? '').toLowerCase()]);
  const needle = typed.trim().toLowerCase();
  const pool = [...people.map((p) => ({ address: p.address, name: p.name })), ...known.map((k) => ({ address: addressOf(k), name: nameOf(k) }))];
  const seen = new Set<string>();
  const out: { address: string; name: string }[] = [];
  for (const p of pool) {
    if (!p.address || taken.has(p.address) || seen.has(p.address)) continue;
    seen.add(p.address);
    if (needle && !p.address.includes(needle) && !p.name.toLowerCase().includes(needle)) continue;
    out.push(p);
  }
  return out.slice(0, 6);
}

/** The tick under one of our own emails: what the server knows. An email has no read receipt, so the best it shows is delivered. */
export function emailTick(status: ConvMessageStatus): 'pending' | 'sent' | 'delivered' | 'failed' {
  return status === 'failed' ? 'failed' : status === 'pending' ? 'pending' : status === 'delivered' || status === 'read' ? 'delivered' : 'sent';
}
