// Unit tests for the WhatsApp page's pure helpers (src/dashboards/groups/conversations/waDesk.ts): day chips, the tail on the first bubble of a run, search
// inside a chat, the media / documents / links of a chat, and the drafts kept per chat (never one that holds an ID number).
// Run with `node --test tests/conversations.waDesk.test.ts`.
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

const { chatFiles, chatHits, dayLabel, DESK_FILTERS, holdsIdNumber, readDraft, splitHits, startsRun, writeDraft } = await import("../src/dashboards/groups/conversations/waDesk.ts");

describe("the chat list's chips (one shared desk, MJ 5 Nov 2026)", () => {
  test("All, Unread and Waiting only: nothing about owners or done chats", () => {
    assert.deepEqual([...DESK_FILTERS], ["all", "unread", "waiting"]);
  });
});

const NOW = Date.parse("2026-11-05T10:00:00Z");
const msg = (over: Record<string, unknown> = {}) => ({ kind: "whatsapp", id: "m1", direction: "in", status: "received", at: "2026-11-05T09:00:00Z", sentBy: null, sentFrom: "contact", type: "text", text: "Hello", ...over }) as never;

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
}

describe("day chips", () => {
  test("today, yesterday, then the date", () => {
    assert.equal(dayLabel("2026-11-05T04:00:00Z", NOW), "Today");
    assert.equal(dayLabel("2026-11-04T04:00:00Z", NOW), "Yesterday");
    assert.equal(dayLabel("2026-11-01T04:00:00Z", NOW), "01 Nov 2026");
  });
});

describe("tails", () => {
  test("the first bubble of a run, a change of side or of day starts a new run", () => {
    assert.equal(startsRun(undefined, msg()), true);
    assert.equal(startsRun(msg(), msg({ id: "m2" })), false);
    assert.equal(startsRun(msg(), msg({ id: "m2", direction: "out" })), true);
    assert.equal(startsRun(msg({ sentFrom: "auto", direction: "out" }), msg({ id: "m2", direction: "out" })), true);
    assert.equal(startsRun(msg({ at: "2026-11-04T09:00:00Z" }), msg({ id: "m2" })), true);
  });
});

describe("search in a chat", () => {
  test("finds words in text, captions, file names and templates, from two letters", () => {
    const list = [msg({ id: "a", text: "Room 204 is ready" }), msg({ id: "b", type: "image", text: undefined, media: { name: "bill.jpg", size: 1, mime: "image/jpeg", caption: "The ROOM key" } }), msg({ id: "c", type: "template", template: { name: "x", language: "en", text: "Your room awaits", category: "utility" } })];
    assert.deepEqual(chatHits(list, "room"), ["a", "b", "c"]);
    assert.deepEqual(chatHits(list, "bill"), ["b"]);
    assert.deepEqual(chatHits(list, "r"), []);
  });
  test("marks every match, keeping the case of the text", () => {
    assert.deepEqual(splitHits("Room and room", "room"), [{ text: "Room", hit: true }, { text: " and ", hit: false }, { text: "room", hit: true }]);
    assert.deepEqual(splitHits("Hello", "x"), [{ text: "Hello", hit: false }]);
  });
});

describe("media, documents and links", () => {
  test("sorted into three lists, newest first, links without the closing stop", () => {
    const list = [msg({ id: "p", type: "image", media: { name: "a.jpg", size: 1, mime: "image/jpeg" } }), msg({ id: "d", type: "document", media: { name: "bill.pdf", size: 1, mime: "application/pdf" } }), msg({ id: "l", text: "Pay here https://rzp.io/l/abc. Thanks" })];
    const f = chatFiles(list);
    assert.deepEqual(f.media.map((m: { id: string }) => m.id), ["p"]);
    assert.deepEqual(f.docs.map((m: { id: string }) => m.id), ["d"]);
    assert.deepEqual(f.links.map((l: { url: string }) => l.url), ["https://rzp.io/l/abc"]);
  });
});

describe("drafts", () => {
  test("kept per chat and read back", () => {
    const s = memoryStore();
    writeDraft("hotel", "c1", "See you at 6", NOW, s);
    assert.equal(readDraft("hotel", "c1", NOW, s), "See you at 6");
    assert.equal(readDraft("platform", "c1", NOW, s), "");
    writeDraft("hotel", "c1", "  ", NOW, s);
    assert.equal(s.map.size, 0);
  });
  test("never one with an ID number", () => {
    for (const t of ["Aadhaar 1234 5678 9012", "PAN ABCDE1234F", "passport K1234567", "voter ABC1234567", "DL MH12 20110012345", "123456789012"]) {
      assert.equal(holdsIdNumber(t), true, t);
      const s = memoryStore();
      writeDraft("hotel", "c1", t, NOW, s);
      assert.equal(s.map.size, 0, t);
    }
    for (const t of ["Room 204 at 3 pm", "Bill BL-2026-118 is Rs 4,500", "Call +91 98765 43210"]) assert.equal(holdsIdNumber(t), false, t);
  });
  test("an old draft is dropped", () => {
    const s = memoryStore();
    writeDraft("hotel", "c1", "Hi", NOW - 8 * 86_400_000, s);
    assert.equal(readDraft("hotel", "c1", NOW, s), "");
    assert.equal(s.map.size, 0);
  });
});
