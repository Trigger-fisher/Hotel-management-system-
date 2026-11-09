// Unit tests for the Email and WhatsApp pages' connection pill (src/dashboards/groups/conversations/connection.ts).
// Run with `node --test tests/conversations.connection.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
const shared = new URL("../../common/ui-shared/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@shared/")) return next(new URL(`${specifier.slice("@shared/".length)}.ts`, shared).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { emailConnection, whatsappConnection } = await import("../src/dashboards/groups/conversations/connection.ts");

describe("the Email pill", () => {
  test("a working mailbox is Connected and names the address", () => {
    const c = emailConnection({ state: "ok", checkedAt: null, address: "front@pallav.in" });
    assert.equal(c.tone, "ok");
    assert.equal(c.label, "Connected");
    assert.match(c.message, /front@pallav\.in/);
  });

  test("no Google inbox but Amazon SES receiving: Connected, naming the address mail arrives at and replies go out from", () => {
  const c = emailConnection({ state: "not_available", reason: "send_only", checkedAt: null, address: null, receivingAddress: "demohotelanand@easyhotelsolutions.in" });
  assert.equal(c.label, "Connected");
  assert.equal(c.tone, "ok");
  assert.match(c.message, /demohotelanand@easyhotelsolutions\.in arrives here through Amazon SES/);
});

test("send-only and platform mail say mail still goes out; not set says who connects it; an error keeps the server's words", () => {
    assert.equal(emailConnection({ state: "not_available", reason: "send_only", checkedAt: null, address: null }).label, "Sending only");
    assert.equal(emailConnection({ state: "not_available", reason: "platform_mail", checkedAt: null, address: null }).label, "Sending only");
    const off = emailConnection({ state: "off", reason: "not_set", checkedAt: null, address: null });
    assert.equal(off.label, "Not connected");
    assert.match(off.message, /platform administrator/);
    const bad = emailConnection({ state: "error", checkedAt: null, address: null, message: "Login refused" });
    assert.equal(bad.tone, "bad");
    assert.match(bad.message, /Login refused/);
    assert.equal(emailConnection({ state: "off", reason: "password_unreadable", checkedAt: null, address: null }).label, "Needs attention");
    assert.equal(emailConnection(undefined).label, "Checking");
  });
});

describe("the WhatsApp pill", () => {
  test("connected names the number; available but not connected points to Settings; not available says to ask the platform", () => {
    const on = whatsappConnection({ connected: true, available: true, number: "+91 98765 43210" });
    assert.equal(on.label, "Connected");
    assert.match(on.message, /\+91 98765 43210/);
    const off = whatsappConnection({ connected: false, available: true });
    assert.equal(off.label, "Not connected");
    assert.match(off.message, /Settings, WhatsApp/);
    assert.equal(whatsappConnection({ connected: false, available: false }).label, "Not available");
  });
});
