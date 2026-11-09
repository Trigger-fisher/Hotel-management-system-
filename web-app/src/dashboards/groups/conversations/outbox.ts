'use client';

// A message shows the moment Send is pressed (MJ, 5 Nov 2026): it waits here with a clock tick while the server takes it, then the server's own copy takes its place and its
// ticks move live. A send that fails stays in place, marked, with Try again. Kept in the tab's memory per conversation, so it survives switching chats while it goes.
import { useSyncExternalStore } from 'react';

import type { DashError, DashResult } from '@shared/dashboards/common';
import type { ConversationsApi, ConvMessage, ReplyInput } from '@shared/dashboards/conversations';

import { cachedThread, storeThread } from './convCache';

export interface PendingSend {
  tempId: string;
  /** The message as drawn while it goes (status pending, or failed). */
  message: ConvMessage;
  input: ReplyInput;
  error: DashError | null;
}

type Owner = Pick<ConversationsApi, 'sendReply'>;
const NONE: readonly PendingSend[] = [];
const boxes = new WeakMap<Owner, Map<string, readonly PendingSend[]>>();
const subs = new Set<() => void>();
let seq = 0;

const listOf = (api: Owner, threadId: string): readonly PendingSend[] => boxes.get(api)?.get(threadId) ?? NONE;
function setList(api: Owner, threadId: string, next: readonly PendingSend[]): void {
  let m = boxes.get(api);
  if (!m) boxes.set(api, (m = new Map()));
  if (next.length) m.set(threadId, next);
  else m.delete(threadId);
  for (const fn of [...subs]) fn();
}

export const newTempId = (): string => `tmp-${Date.now().toString(36)}-${++seq}`;

/** Puts a message on screen as waiting (nothing is sent yet). */
export function stagePending(api: Owner, threadId: string, message: ConvMessage, input: ReplyInput): string {
  setList(api, threadId, [...listOf(api, threadId), { tempId: message.id, message: { ...message, status: 'pending' }, input, error: null }]);
  return message.id;
}

/** Takes a waiting message off the screen (Undo). */
export function dropPending(api: Owner, threadId: string, tempId: string): void {
  setList(api, threadId, listOf(api, threadId).filter((p) => p.tempId !== tempId));
}

/** Sends a waiting message: the server's copy replaces it in the thread; a failure keeps it, marked, for Try again. */
export async function runPending(api: Owner, threadId: string, tempId: string): Promise<DashResult<ConvMessage> | null> {
  const p = listOf(api, threadId).find((x) => x.tempId === tempId);
  if (!p) return null;
  setList(api, threadId, listOf(api, threadId).map((x) => (x.tempId === tempId ? { ...x, error: null, message: { ...x.message, status: 'pending' } } : x)));
  const r = await api.sendReply(threadId, p.input);
  if (r.ok) {
    const t = cachedThread(api, threadId);
    if (t && !t.messages.some((m) => m.id === r.data.id)) storeThread(api, { ...t, messages: [...t.messages, r.data] });
    dropPending(api, threadId, tempId);
  } else {
    setList(api, threadId, listOf(api, threadId).map((x) => (x.tempId === tempId ? { ...x, error: r.error, message: { ...x.message, status: 'failed' } } : x)));
  }
  return r;
}

/** Stage and send at once (a WhatsApp message). */
export function sendNow(api: Owner, threadId: string, message: ConvMessage, input: ReplyInput): Promise<DashResult<ConvMessage> | null> {
  return runPending(api, threadId, stagePending(api, threadId, message, input));
}

export function usePending(api: Owner, threadId: string): readonly PendingSend[] {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    () => listOf(api, threadId),
    () => NONE,
  );
}

const textOf = (m: ConvMessage): string => (m.kind === 'whatsapp' ? (m.text ?? m.template?.text ?? '') : m.preview).trim();

/**
 * The thread as drawn: the server's messages, then the ones still waiting. A waiting one whose copy the server already shows (the live read came before the send's own answer:
 * an outgoing message with the same words, sent from its time on) is left out, so it never shows twice.
 */
export function withPending(messages: readonly ConvMessage[], pending: readonly PendingSend[]): ConvMessage[] {
  if (!pending.length) return [...messages];
  const used = new Set<string>();
  const shown = pending.filter((p) => {
    if (p.error) return true;
    const at = Date.parse(p.message.at) - 5_000;
    const twin = messages.find((m) => !used.has(m.id) && m.direction === 'out' && m.kind === p.message.kind && Date.parse(m.at) >= at && textOf(m) === textOf(p.message));
    if (twin) used.add(twin.id);
    return !twin;
  });
  return [...messages, ...shown.map((p) => p.message)];
}
