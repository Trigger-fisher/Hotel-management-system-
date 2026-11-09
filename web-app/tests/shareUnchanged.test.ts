// Unit tests for src/components/ui/shareUnchanged.ts: a refresh that brings the same data hands React the SAME objects (R48).
// Run with `node --test tests/shareUnchanged.test.ts` (Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

// The app writes extensionless relative imports (bundler style). Plain Node needs the extension.
type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { shareUnchanged } = await import("../src/components/ui/shareUnchanged");

describe("shareUnchanged", () => {
  test("identical data comes back as the very same object", () => {
    const old = { rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }], total: 2 };
    const next = JSON.parse(JSON.stringify(old)) as typeof old;
    assert.equal(shareUnchanged(old, next), old);
  });

  test("a change in one row keeps the other rows and the untouched fields", () => {
    const old = { rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }], total: 2, note: "x" };
    const next = { rows: [{ id: "a", n: 1 }, { id: "b", n: 3 }], total: 2, note: "x" };
    const out = shareUnchanged(old, next);
    assert.notEqual(out, old);
    assert.equal(out.rows[0], old.rows[0]);
    assert.notEqual(out.rows[1], old.rows[1]);
    assert.equal(out.rows[1].n, 3);
  });

  test("rows are matched by id, so a row that moved keeps its object", () => {
    const old = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
    const next = [{ id: "b", n: 2 }, { id: "a", n: 1 }];
    const out = shareUnchanged(old, next);
    assert.equal(out[0], old[1]);
    assert.equal(out[1], old[0]);
  });

  test("a new row and a removed row are handled", () => {
    const old = [{ id: "a" }, { id: "b" }];
    const out = shareUnchanged(old, [{ id: "a" }, { id: "c" }]);
    assert.equal(out[0], old[0]);
    assert.deepEqual(out[1], { id: "c" });
    assert.equal(shareUnchanged(old, [{ id: "a" }]).length, 1);
  });

  test("values that are not plain data count as changed unless they are the same object", () => {
    const d1 = new Date(0);
    const d2 = new Date(0);
    assert.equal(shareUnchanged({ at: d1 }, { at: d1 }).at, d1);
    assert.equal(shareUnchanged({ at: d1 }, { at: d2 }).at, d2);
  });

  test("a different kind of value is simply the new value", () => {
    assert.equal(shareUnchanged(null, 5), 5);
    assert.deepEqual(shareUnchanged([1], { a: 1 }), { a: 1 });
    assert.equal(shareUnchanged("a", "b"), "b");
  });
});
