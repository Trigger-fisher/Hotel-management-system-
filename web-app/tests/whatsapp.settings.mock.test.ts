// Unit tests for the WhatsApp settings sample (ui-shared/dashboards/whatsapp.mock.ts, decision 66) behind hotel Settings > WhatsApp and the console's WhatsApp card: the connected
// design's shape (number, display name, quality, approved messages with their state, the automatic messages, this month's counts, no message content), a switch that sticks,
// and the dev switch `window.__convWhatsApp = 'off'` answering exactly what the live site answers (WHATSAPP_NOT_CONNECTED, writes refused).
// Run with `node --test tests/*.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, describe, test } from "node:test";

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

const { createWhatsAppSettingsMock } = await import("../../common/ui-shared/dashboards/whatsapp.mock");
const { WHATSAPP_AUTOMATIC_KEYS, WHATSAPP_NOT_CONNECTED, whatsappCopy } = await import("../../common/ui-shared/dashboards/whatsapp");

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.__convWhatsApp;
});

const NOW = Date.parse("2026-10-25T06:00:00.000Z");
const hotel = () => createWhatsAppSettingsMock("hotel", { latencyMs: 0, now: () => NOW });

describe("the connected sample (hotel)", () => {
  test("number, display name, quality and dates are filled in", async () => {
    const r = await hotel().get();
    assert.ok(r.ok);
    const s = r.data;
    assert.equal(s.connected, true);
    assert.equal(s.available, true);
    assert.match(s.number ?? "", /^\+91 [0-9 ]+$/);
    assert.ok(s.displayName);
    assert.ok(s.displayNameStatus && s.displayNameStatus in whatsappCopy.displayNameStatus);
    assert.ok(s.quality && s.quality in whatsappCopy.quality);
    assert.ok(Date.parse(s.connectedAt ?? "") < NOW);
  });

  test("approved messages carry a state, a category and numbered variables matching the text", async () => {
    const r = await hotel().get();
    assert.ok(r.ok);
    assert.ok(r.data.templates.length >= 3);
    assert.ok(r.data.templates.some((t) => t.status === "approved"));
    assert.ok(r.data.templates.some((t) => t.status !== "approved"), "the design shows a message still waiting or rejected");
    for (const t of r.data.templates) {
      assert.ok(t.status in whatsappCopy.template.status, t.id);
      assert.ok(t.category in whatsappCopy.template.category, t.id);
      for (const v of t.variables) assert.ok(t.text.includes(`{{${v.index}}}`), `${t.id} {{${v.index}}}`);
    }
  });

  test("the automatic messages are the known keys, each once, and a template they use exists", async () => {
    const r = await hotel().get();
    assert.ok(r.ok);
    const keys = r.data.automatic.map((a) => a.key);
    assert.deepEqual([...keys].sort(), [...WHATSAPP_AUTOMATIC_KEYS].sort());
    for (const a of r.data.automatic) if (a.templateId) assert.ok(r.data.templates.some((t) => t.id === a.templateId), a.key);
  });

  test("this month's counts are numbers only: no message content anywhere in the settings", async () => {
    const r = await hotel().get();
    assert.ok(r.ok);
    assert.ok(r.data.month);
    for (const n of Object.values(r.data.month)) assert.ok(Number.isInteger(n) && n >= 0);
    const allowed = new Set(["connected", "available", "number", "displayName", "displayNameStatus", "quality", "connectedAt", "lastSentAt", "lastReceivedAt", "templates", "automatic", "month"]);
    for (const k of Object.keys(r.data)) assert.ok(allowed.has(k), k);
  });

  test("a switch sticks, and each answer is a copy (changing it changes nothing in the store)", async () => {
    const m = hotel();
    const r = await m.setAutomatic("bill_link", true);
    assert.ok(r.ok);
    assert.equal(r.data.automatic.find((a) => a.key === "bill_link")?.on, true);
    r.data.automatic.length = 0;
    const again = await m.get();
    assert.ok(again.ok);
    assert.equal(again.data.automatic.find((a) => a.key === "bill_link")?.on, true);
  });

  test("an unknown automatic message is refused in plain words", async () => {
    const r = await hotel().setAutomatic("birthday" as never, true);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "VALIDATION_FAILED");
  });
});

describe("__convWhatsApp = 'off' (the live site today)", () => {
  test("answers exactly WHATSAPP_NOT_CONNECTED: not connected, not available, nothing listed", async () => {
    g.__convWhatsApp = "off";
    const r = await hotel().get();
    assert.ok(r.ok);
    assert.deepEqual(r.data, WHATSAPP_NOT_CONNECTED);
    assert.equal(r.data.available, false);
  });

  test("a switch is refused with the not-connected sentence and the hotels list is empty", async () => {
    g.__convWhatsApp = "off";
    const m = createWhatsAppSettingsMock("platform", { latencyMs: 0, now: () => NOW });
    const r = await m.setAutomatic("bill_link", true);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "CONFLICT");
      assert.equal(r.error.message, whatsappCopy.notAvailableWrite);
    }
    const h = await m.hotels();
    assert.ok(h.ok);
    assert.deepEqual(h.data, []);
  });

  test("switching it back shows the sample again", async () => {
    const m = hotel();
    g.__convWhatsApp = "off";
    assert.equal(((await m.get()) as { ok: true; data: { connected: boolean } }).data.connected, false);
    delete g.__convWhatsApp;
    assert.equal(((await m.get()) as { ok: true; data: { connected: boolean } }).data.connected, true);
  });
});
