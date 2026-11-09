// Unit tests for src/lib/auth/navigation.ts (browser history rules, S02 agreement section 9; steps from S05).
// Run with `npm test` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";
import type { PallavAuthState, PallavAuthStep } from "../../common/ui-shared/auth-pallav/flow";
import type { Session } from "../../common/ui-shared/auth-pallav/types";

// The app writes extensionless relative imports (bundler style). Plain Node needs the
// extension, so retry unresolved relative imports with ".ts". Type-only imports are erased.
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

const { decidePop, SAFE_STEPS, urlFor } = await import("../src/lib/auth/navigation");
const { initialPallavAuthState } = await import("../../common/ui-shared/auth-pallav/flow");
type PopDecision = ReturnType<typeof decidePop>;

const session: Session = {
  user: {
    id: "u-1",
    displayName: "Test User",
    email: "test@demo.hms",
    username: "test",
    role: "hotel_user",
    hotel: null,
    group: null,
  },
  client: "web",
  expiresAt: "2026-10-05T12:00:00.000Z",
  token: null,
};

const at = (step: PallavAuthStep, extra: Partial<PallavAuthState> = {}): PallavAuthState => ({ ...initialPallavAuthState, step, ...extra });

const ALL_STEPS: PallavAuthStep[] = [
  "signIn", "emailCode", "changePassword", "forgotPassword", "resetPassword", "resetDone",
  "locked", "blocked", "sessionEnded", "screenLocked", "signedIn",
];
const PINNED: PallavAuthStep[] = ["signedIn", "screenLocked"];
const SAFE: PallavAuthStep[] = ["signIn", "forgotPassword", "emailCode", "resetPassword"];
const UNSAFE_TARGETS = ALL_STEPS.filter((s) => !SAFE.includes(s));

describe("safe steps", () => {
  test("only the steps that hold no session, password or code are kept for Back", () => {
    assert.deepEqual([...SAFE_STEPS].sort(), [...SAFE].sort());
  });
});

describe("decidePop", () => {
  describe("pinned steps: Back does nothing", () => {
    for (const step of PINNED) {
      const current = at(step, { session });
      test(`${step} stays for a safe target`, () => {
        assert.deepEqual(decidePop(current, at("signIn")), { kind: "stay" });
        assert.deepEqual(decidePop(current, at("emailCode", { challengeId: "ch2-1" })), { kind: "stay" });
      });
      test(`${step} stays for an unsafe or unknown target`, () => {
        assert.deepEqual(decidePop(current, at("resetDone")), { kind: "stay" });
        assert.deepEqual(decidePop(current, undefined), { kind: "stay" });
      });
    }
  });

  describe("safe targets are restored with their saved state", () => {
    const from: PallavAuthStep[] = ["forgotPassword", "resetPassword", "resetDone", "locked", "blocked", "sessionEnded", "signIn"];
    for (const step of from) {
      test(`${step} -> signIn restores the saved signIn (username kept)`, () => {
        const target = at("signIn", { username: "anita" });
        const d = decidePop(at(step), target);
        assert.equal(d.kind, "restore");
        assert.equal((d as Extract<PopDecision, { kind: "restore" }>).state, target, "same object, not a copy");
      });
    }

    test("signIn -> forgotPassword (Forward) restores", () => {
      const target = at("forgotPassword", { username: "anita" });
      assert.deepEqual(decidePop(at("signIn"), target), { kind: "restore", state: target });
    });

    test("emailCode with a challenge is restored", () => {
      const target = at("emailCode", { challengeId: "ch2-1", sentTo: "a****@demo.hms", username: "anita" });
      assert.deepEqual(decidePop(at("signIn"), target), { kind: "restore", state: target });
    });

    test("resetPassword with a challenge is restored", () => {
      const target = at("resetPassword", { challengeId: "rst2-1", username: "anita" });
      assert.deepEqual(decidePop(at("resetDone"), target), { kind: "restore", state: target });
    });
  });

  describe("a saved code step without its challenge goes to signIn", () => {
    for (const step of ["emailCode", "resetPassword"] as const) {
      test(`${step} target, challengeId null`, () => {
        assert.deepEqual(decidePop(at("forgotPassword"), at(step)), { kind: "signIn" });
      });
      test(`${step} target, challengeId empty string`, () => {
        assert.deepEqual(decidePop(at("forgotPassword"), at(step, { challengeId: "" })), { kind: "signIn" });
      });
      test(`${step} target without challenge while already on signIn still answers signIn`, () => {
        assert.deepEqual(decidePop(at("signIn"), at(step)), { kind: "signIn" });
      });
    }
  });

  describe("unsafe or unknown targets", () => {
    for (const target of UNSAFE_TARGETS) {
      test(`${target} target from forgotPassword -> signIn`, () => {
        assert.deepEqual(decidePop(at("forgotPassword"), at(target, { session })), { kind: "signIn" });
      });
    }

    test("undefined target (entry from before a reload, or not ours) -> signIn", () => {
      assert.deepEqual(decidePop(at("resetPassword", { challengeId: "rst2-1" }), undefined), { kind: "signIn" });
      assert.deepEqual(decidePop(at("sessionEnded", { problem: "SESSION_REVOKED" }), undefined), { kind: "signIn" });
      assert.deepEqual(decidePop(at("blocked"), undefined), { kind: "signIn" });
    });

    test("undefined or unsafe target while already on signIn -> adopt (keep the entry)", () => {
      assert.deepEqual(decidePop(at("signIn"), undefined), { kind: "adopt" });
      assert.deepEqual(decidePop(at("signIn"), at("resetDone")), { kind: "adopt" });
    });

    // AuthApp answers "stay" by pushing the current entry again, and "adopt" by keeping the entry
    // the browser moved to. This simulates the browser stack to prove Back always leaves the app
    // from signIn (e.g. signIn -> forgotPassword -> resetPassword -> resetDone -> "Sign in", then Back).
    test("Back from signIn over an unsafe entry eventually leaves the app", () => {
      const EXTERNAL = "external" as const;
      const stack: (PallavAuthState | typeof EXTERNAL)[] = [
        EXTERNAL,
        at("signIn"),
        at("forgotPassword"),
        at("resetPassword", { challengeId: "rst2-1" }),
        at("resetDone"),
        at("signIn"),
      ];
      let index = stack.length - 1;
      let current = stack[index] as PallavAuthState;
      for (let presses = 0; presses < 10; presses++) {
        index -= 1; // browser Back
        const entry = stack[index];
        if (entry === EXTERNAL) return; // left the app: good
        const d = decidePop(current, entry);
        if (d.kind === "stay") {
          stack.splice(index + 1, stack.length, current); // pushState drops forward entries
          index += 1;
        } else if (d.kind !== "adopt") {
          current = d.kind === "restore" ? d.state : at("signIn");
        }
      }
      assert.fail("10 Back presses never left the app");
    });
  });
});

describe("urlFor", () => {
  test("always /login (the sign-in page; / is the website): nothing about the flow stays in the address bar or history", () => {
    for (const step of ALL_STEPS) {
      assert.equal(urlFor(at(step, { challengeId: "ch2-1", username: "anita" })), "/login", step);
      assert.equal(urlFor(at(step)), "/login", step);
    }
  });
});
