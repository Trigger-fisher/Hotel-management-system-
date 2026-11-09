// The tab's own screen lock (src/lib/auth/screenLock.ts): a reload of a locked tab must come back locked, in mock mode too.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { setTabLocked, tabLocked, withLock } from "../src/lib/auth/screenLock.ts";

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const session = { user: { id: "u1" }, client: "web", expiresAt: "2026-11-05T12:00:00.000Z", token: null } as never;

describe("tab screen lock", () => {
  test("a locked tab marks the restored session locked; unlocking forgets it", () => {
    const s = memoryStore();
    assert.equal(tabLocked(s), false);
    setTabLocked(true, s);
    const r = withLock({ ok: true, data: session }, s);
    assert.equal(r.ok && r.data.locked, true);
    setTabLocked(false, s);
    const back = withLock({ ok: true, data: session }, s);
    assert.equal(back.ok && back.data.locked, undefined);
  });
  test("the server's lock counts even when the tab has none, and storage that throws is ignored", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    setTabLocked(true, broken);
    assert.equal(tabLocked(broken), false);
    const r = withLock({ ok: true, data: { ...(session as object), locked: true } as never }, broken);
    assert.equal(r.ok && r.data.locked, true);
  });
});
