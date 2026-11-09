// Unit tests for Hotel settings > Messages' store (ui-shared/dashboards/whatsapp.mock.ts, MJ 5 Nov 2026): the starting values the design shows (six messages in order,
// quiet hours 9 PM to 8 AM, fallback, reminder stop and consent on), a save that sticks and bumps the version, the version check, the field checks and the test send.
// Run with `node --test tests/messagesSettings.mock.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

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

const { createMessagesSettingsMock, SAMPLE_TEMPLATES } = await import("../../common/ui-shared/dashboards/whatsapp.mock");
const { MESSAGES_AUTOMATIC_KEYS, MESSAGES_SERVER_KEY, WHATSAPP_AUTOMATIC_KEYS, checkMessagesSettings, defaultMessagesSettings, messagesSettingsCopy } = await import("../../common/ui-shared/dashboards/whatsapp");

const NOW = Date.parse("2026-11-05T06:00:00.000Z");
const store = (who: string | null = "Mihir Shah") => createMessagesSettingsMock({ latencyMs: 0, now: () => NOW, who: () => who });

describe("the starting values", () => {
  test("six messages in the design's order, quiet hours 21:00 to 08:00, fallback, reminder stop and consent on", async () => {
    const r = await store().getMessagesSettings();
    assert.ok(r.ok);
    const s = r.data;
    assert.equal(s.version, 1);
    assert.deepEqual(s.automatic.map((a) => a.key), [...MESSAGES_AUTOMATIC_KEYS]);
    assert.equal(s.quietFrom, "21:00");
    assert.equal(s.quietTo, "08:00");
    assert.equal(s.fallbackEmail, true);
    assert.equal(s.stopWhenPaid, true);
    assert.equal(s.consentOnly, true);
    assert.equal(s.savedAt, null);
  });

  test("a picked template exists in the sample, and every row with one is a WhatsApp row", async () => {
    const r = await store().getMessagesSettings();
    assert.ok(r.ok);
    for (const a of r.data.automatic) {
      if (!a.templateId) continue;
      assert.ok(SAMPLE_TEMPLATES.some((t) => t.id === a.templateId), a.key);
      assert.notEqual(a.channel, "email", a.key);
    }
  });

  test("every message has a name and a 'when' line, and each server-kept row maps to a WhatsApp switch that exists", () => {
    for (const k of MESSAGES_AUTOMATIC_KEYS) {
      assert.ok(messagesSettingsCopy.names[k], k);
      assert.ok(messagesSettingsCopy.when[k], k);
    }
    for (const [k, wa] of Object.entries(MESSAGES_SERVER_KEY)) {
      assert.ok(MESSAGES_AUTOMATIC_KEYS.includes(k as never), k);
      assert.ok(WHATSAPP_AUTOMATIC_KEYS.includes(wa), wa);
    }
  });
});

describe("saving", () => {
  test("a save sticks, bumps the version, records who and when, and answers a copy", async () => {
    const m = store();
    const first = await m.getMessagesSettings();
    assert.ok(first.ok);
    const input = { ...first.data, quietFrom: "22:00", automatic: first.data.automatic.map((a) => (a.key === "review_ask" ? { ...a, on: true, language: "hi" as const } : a)) };
    const saved = await m.saveMessagesSettings(input);
    assert.ok(saved.ok);
    assert.equal(saved.data.message, messagesSettingsCopy.saved);
    assert.equal(saved.data.settings.version, 2);
    assert.equal(saved.data.settings.savedBy, "Mihir Shah");
    assert.equal(saved.data.settings.savedAt, new Date(NOW).toISOString());
    saved.data.settings.automatic.length = 0;
    const again = await m.getMessagesSettings();
    assert.ok(again.ok);
    assert.equal(again.data.quietFrom, "22:00");
    const review = again.data.automatic.find((a) => a.key === "review_ask");
    assert.equal(review?.on, true);
    assert.equal(review?.language, "hi");
  });

  test("a save with an older version is refused with the version now (the ConflictNote path)", async () => {
    const m = store();
    const first = await m.getMessagesSettings();
    assert.ok(first.ok);
    assert.ok((await m.saveMessagesSettings({ ...first.data })).ok);
    const stale = await m.saveMessagesSettings({ ...first.data, fallbackEmail: false });
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.error.code, "CONFLICT");
      assert.equal(stale.error.details?.currentVersion, 2);
    }
    const kept = await m.getMessagesSettings();
    assert.ok(kept.ok);
    assert.equal(kept.data.fallbackEmail, true);
  });

  test("a bad time, the same two times or a bad number come back as field errors and nothing is saved", async () => {
    const m = store();
    const first = await m.getMessagesSettings();
    assert.ok(first.ok);
    const r = await m.saveMessagesSettings({ ...first.data, quietFrom: "9 PM", testPhone: "abc" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "VALIDATION_FAILED");
      assert.equal(r.error.details?.fields?.quietFrom, messagesSettingsCopy.errors.time);
      assert.equal(r.error.details?.fields?.testPhone, messagesSettingsCopy.errors.phone);
    }
    assert.equal(checkMessagesSettings({ ...defaultMessagesSettings(), quietFrom: "08:00", quietTo: "08:00" }).quietTo, messagesSettingsCopy.errors.sameTime);
    const again = await m.getMessagesSettings();
    assert.ok(again.ok);
    assert.equal(again.data.version, 1);
  });

  test("a list that is not the six messages is refused", () => {
    const d = defaultMessagesSettings();
    assert.equal(checkMessagesSettings({ ...d, automatic: d.automatic.slice(1) }).automatic, messagesSettingsCopy.errors.rows);
    assert.equal(checkMessagesSettings({ ...d, automatic: [...d.automatic, d.automatic[0]] }).automatic, messagesSettingsCopy.errors.rows);
    assert.deepEqual(checkMessagesSettings(d), {});
  });
});

describe("the test send", () => {
  test("goes to a number that reads right and names it; a bad number is refused", async () => {
    const m = store();
    const sent = await m.testSendMessage("+91 98250 00000");
    assert.ok(sent.ok);
    assert.equal(sent.data.message, messagesSettingsCopy.test.sent("+91 98250 00000"));
    const bad = await m.testSendMessage("12");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.details?.fields?.testPhone, messagesSettingsCopy.errors.phone);
  });
});
