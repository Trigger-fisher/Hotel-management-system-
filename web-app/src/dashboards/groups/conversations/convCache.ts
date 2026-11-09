'use client';

// What the Email and WhatsApp pages have already seen in this tab (MJ, 5 Nov 2026: "no refresh"): the lists by their query, the threads by id, and the few things a page
// needs once (staff, quick replies, WhatsApp settings, the person's own address). A page shows what is here at once and reads it again behind the scenes. Kept in the tab's
// memory only (never in storage) and for one person: another sign-in empties it.
import type { DashResult } from '@shared/dashboards/common';
import type { ConversationList, ConversationThread } from '@shared/dashboards/conversations';

const LISTS_MAX = 40;
const THREADS_MAX = 60;

type Owner = object;
interface Store {
  lists: Map<string, ConversationList>;
  threads: Map<string, ConversationThread>;
  once: Map<string, Promise<unknown> | { value: unknown }>;
}
let stores = new WeakMap<Owner, Store>();
let person: string | null = null;
const threadSubs = new Map<string, Set<() => void>>();
const ownerIds = new WeakMap<Owner, number>();
let nextOwner = 1;

const ownerKey = (o: Owner): number => {
  let n = ownerIds.get(o);
  if (n === undefined) ownerIds.set(o, (n = nextOwner++));
  return n;
};
const storeOf = (o: Owner): Store => {
  let s = stores.get(o);
  if (!s) stores.set(o, (s = { lists: new Map(), threads: new Map(), once: new Map() }));
  return s;
};
/** Newest last: a Map keeps the order of insertion, so the oldest goes first when full. */
function put<V>(m: Map<string, V>, key: string, value: V, max: number): void {
  m.delete(key);
  m.set(key, value);
  while (m.size > max) {
    const first = m.keys().next().value;
    if (first === undefined) break;
    m.delete(first);
  }
}

/** The signed-in person: a different one empties everything first. */
export function claimConvCache(userId: string): void {
  if (person === userId) return;
  person = userId;
  stores = new WeakMap();
}

export const cachedList = (api: Owner, key: string): ConversationList | null => stores.get(api)?.lists.get(key) ?? null;
export const storeList = (api: Owner, key: string, list: ConversationList): void => put(storeOf(api).lists, key, list, LISTS_MAX);

export const cachedThread = (api: Owner, id: string): ConversationThread | null => stores.get(api)?.threads.get(id) ?? null;

export function storeThread(api: Owner, thread: ConversationThread): void {
  put(storeOf(api).threads, thread.id, thread, THREADS_MAX);
  for (const fn of [...(threadSubs.get(`${ownerKey(api)}|${thread.id}`) ?? [])]) fn();
}

/** Told whenever this thread is stored again (by the page, a send, a live read). */
export function onThreadStored(api: Owner, id: string, fn: () => void): () => void {
  const key = `${ownerKey(api)}|${id}`;
  let set = threadSubs.get(key);
  if (!set) threadSubs.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) threadSubs.delete(key);
  };
}

/** A value read once per tab and person (staff, quick replies, settings, the address); a failed read is tried again next time. */
/** The opened emails of a thread (their bodies), so a thread opened again shows them at once. */
export function cachedBodies<B>(api: Owner, threadId: string): Record<string, B> {
  const all = stores.get(api)?.once.get(`bodies:${threadId}`);
  return all && 'value' in all ? { ...(all.value as Record<string, B>) } : {};
}
export function storeBodies<B>(api: Owner, threadId: string, bodies: Record<string, B>): void {
  storeOf(api).once.set(`bodies:${threadId}`, { value: bodies });
}

export function readOnce<T>(api: Owner, name: string, load: () => Promise<DashResult<T>>): Promise<DashResult<T>> {
  const s = storeOf(api);
  const had = s.once.get(name);
  if (had && 'value' in had) return Promise.resolve({ ok: true, data: had.value as T });
  if (had) return had as Promise<DashResult<T>>;
  const p = load().then((r) => {
    if (stores.get(api) !== s) return r;
    if (r.ok) s.once.set(name, { value: r.data });
    else s.once.delete(name);
    return r;
  });
  s.once.set(name, p);
  return p;
}

/** What readOnce holds, without asking (null when not read yet). */
export function onceValue<T>(api: Owner, name: string): T | null {
  const had = stores.get(api)?.once.get(name);
  return had && 'value' in had ? (had.value as T) : null;
}

/** A value changed on the page (quick replies edited): the next readOnce answers it. */
export function setOnce<T>(api: Owner, name: string, value: T): void {
  storeOf(api).once.set(name, { value });
}
