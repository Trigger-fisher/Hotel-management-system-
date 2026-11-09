// Pure helper of useAsync (kept apart so it can be tested without React).
/**
 * Keeps what did not change: the new answer reuses the old objects and arrays wherever they hold the same values, so a refresh that brings the same rows
 * hands React the SAME objects (nothing downstream redraws or re-runs an effect) and a change in one row touches only that row. Only plain JSON-like values are
 * compared; anything else (a Date, a Map) counts as changed unless it is the same object. Rows of an array are matched by `id` when they have one, else by position.
 */
export function shareUnchanged<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(next) && Array.isArray(prev)) {
    const byId = new Map<unknown, unknown>();
    for (const p of prev) if (p && typeof p === 'object' && 'id' in p) byId.set((p as { id: unknown }).id, p);
    const out = next.map((n, i) => {
      const hasId = n && typeof n === 'object' && 'id' in n;
      const match = hasId ? byId.get((n as { id: unknown }).id) : prev[i];
      return match === undefined ? n : shareUnchanged(match, n);
    });
    return (out.length === prev.length && out.every((v, i) => v === prev[i]) ? prev : out) as unknown as T;
  }
  const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  if (plain(next) && plain(prev)) {
    const keys = Object.keys(next);
    const out: Record<string, unknown> = {};
    let same = keys.length === Object.keys(prev).length;
    for (const k of keys) {
      out[k] = shareUnchanged(prev[k], next[k]);
      if (out[k] !== prev[k]) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}
