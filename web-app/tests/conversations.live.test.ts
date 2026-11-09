// Live Email and WhatsApp on the page (MJ, 5 Nov 2026: "SPA and two-way talking live"): the shell keeps ONE Email or WhatsApp page while a thread opens, switches, closes, or
// the box changes (pageKey.ts); the bus and the stream reader (live.ts, liveConnection.ts); what the tab has seen (convCache.ts); a message on screen the moment Send is pressed
// and its reconciling with the server's copy (outbox.ts); and the demo's own changes on the same bus.
// Run: npx tsx --test tests/conversations.live.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ConversationThread, ConvMessage } from "@shared/dashboards/conversations";
import { createConversationsMock } from "@shared/dashboards/conversations.mock";
import type { WhatsAppMessage } from "@shared/dashboards/whatsapp";

import { cachedList, cachedThread, claimConvCache, onceValue, onThreadStored, readOnce, storeList, storeThread } from "../src/dashboards/groups/conversations/convCache";
import { emitConvLive, eventOfWire, everyMs, onConvLive, splitSse, touches, type ConvLiveEvent } from "../src/dashboards/groups/conversations/live";
import { connectConvStream } from "../src/dashboards/groups/conversations/liveConnection";
import { dropPending, runPending, stagePending, withPending } from "../src/dashboards/groups/conversations/outbox";
import { liveFamilyOf, pageKeyOf } from "../src/dashboards/shell/pageKey";

const view = (viewId: string, reset?: number) => ({ viewId, ...(reset === undefined ? {} : { reset }) });

describe("the shell keeps one Email or WhatsApp page (no remount, no skeleton)", () => {
  test("a list and its threads are one page; other pages keep their own key", () => {
    assert.equal(liveFamilyOf("hotel.emailThread"), "hotel.email");
    assert.equal(liveFamilyOf("platform.whatsappThread"), "platform.whatsapp");
    assert.equal(liveFamilyOf("group.myMailboxThread"), "group.myMailbox");
    assert.equal(liveFamilyOf("hotel.conversation"), "hotel.conversations");
    assert.equal(liveFamilyOf("hotel.fo.stay"), null);
    assert.equal(liveFamilyOf("hotel.emailSettings"), null);
  });
  test("opening a thread, switching it ten times, going back, switching the box and tapping the menu again keep the same key", () => {
    const list = [view("hotel.email")];
    const key = pageKeyOf(list);
    let stack = [...list];
    for (let i = 0; i < 10; i += 1) {
      stack = [...stack, view("hotel.emailThread")];
      assert.equal(pageKeyOf(stack), key, `thread ${i + 1}`);
    }
    assert.equal(pageKeyOf([view("hotel.email", 3)]), key, "the box switch and a second tap on the menu entry (reset counted up)");
    assert.equal(pageKeyOf([view("hotel.whatsapp"), view("hotel.whatsappThread")]), pageKeyOf([view("hotel.whatsapp")]));
  });
  test("a page under something else, and every other page, are drawn anew as before", () => {
    assert.notEqual(pageKeyOf([view("hotel.today"), view("hotel.email")]), pageKeyOf([view("hotel.email")]));
    assert.equal(pageKeyOf([view("hotel.fo.inHouse"), view("hotel.fo.stay")]), "hotel.fo.stay:2:0");
    assert.equal(pageKeyOf([view("hotel.fo.inHouse", 2)]), "hotel.fo.inHouse:1:2");
    assert.notEqual(pageKeyOf([view("hotel.email")]), pageKeyOf([view("hotel.whatsapp")]));
  });
});

describe("the bus", () => {
  test("an event reaches the page it names, and a thread only when its id is named (or the whole box)", () => {
    const e = (scope: ConvLiveEvent["scope"], ids: string[]): ConvLiveEvent => ({ scope, ids });
    assert.equal(touches(e("hotel", ["c1"]), "hotel"), true);
    assert.equal(touches(e("hotel", ["c1"]), "platform"), false);
    assert.equal(touches(e("hotel", ["c1"]), "hotel", "c1"), true);
    assert.equal(touches(e("hotel", ["c1"]), "hotel", "c2"), false);
    assert.equal(touches(e("hotel", []), "hotel", "c2"), true);
    assert.equal(touches(e("all", []), "personal", "c9"), true);
    const got: ConvLiveEvent[] = [];
    const off = onConvLive((x) => got.push(x));
    emitConvLive(e("group", ["g1"]));
    off();
    emitConvLive(e("group", ["g2"]));
    assert.deepEqual(got, [e("group", ["g1"])]);
  });
  test("the stream's lines: whole events only, comments skipped, only our own shape kept", () => {
    const { events, rest } = splitSse('retry: 3000\nevent: ready\ndata: {"transport":"sse"}\n\n: beat\n\ndata: {"s":"hotel","ids":["c1"],"w":"message"}\n\ndata: {"s":"hot');
    assert.deepEqual(events, [{ event: "ready", data: '{"transport":"sse"}' }, { event: "message", data: '{"s":"hotel","ids":["c1"],"w":"message"}' }]);
    assert.equal(rest, 'data: {"s":"hot');
    assert.deepEqual(eventOfWire('{"s":"personal","ids":["a","b"],"w":"read"}'), { scope: "personal", ids: ["a", "b"], what: "read" });
    assert.equal(eventOfWire('{"s":"bank","ids":[]}'), null);
    assert.equal(eventOfWire("nope"), null);
  });
  test("the pages ask by themselves every minute while the bus is live, as before (20 s list, 10 s thread) when it is not", () => {
    assert.deepEqual([everyMs("list", true), everyMs("thread", true), everyMs("list", false), everyMs("thread", false)], [60_000, 60_000, 20_000, 10_000]);
  });
});

/** A fake fetch whose answers the test hands out one by one. */
function streamWorld(answers: (() => Response)[]) {
  const timers: { fn: () => void; ms: number }[] = [];
  let calls = 0;
  const deps = {
    fetchFn: (async () => {
      calls += 1;
      const next = answers.shift();
      if (!next) throw new Error("offline");
      return next();
    }) as unknown as typeof fetch,
    setTimeoutFn: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    clearTimeoutFn: () => undefined,
    isVisible: () => true,
    onVisibility: () => () => undefined,
  };
  return { deps, timers, calls: () => calls };
}
const sse = (text: string) => () => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("the stream reader", () => {
  test("every event of the stream goes on the bus; a closed stream is opened again and what changed meanwhile is read once", async () => {
    const w = streamWorld([sse('event: ready\ndata: {}\n\ndata: {"s":"hotel","ids":["c1"],"w":"message"}\n\n'), sse("event: ready\ndata: {}\n\n")]);
    const got: ConvLiveEvent[] = [];
    const off = onConvLive((e) => got.push(e));
    const stop = connectConvStream(w.deps, () => assert.fail("not off"));
    await settle();
    assert.deepEqual(got, [{ scope: "hotel", ids: ["c1"], what: "message" }]);
    assert.equal(w.timers.length, 1, "the server closed it: opened again");
    w.timers.shift()!.fn();
    await settle();
    assert.deepEqual(got.at(-1), { scope: "all", ids: [] }, "back after a gap: every page reads once");
    stop();
    off();
  });
  test("a server without a stream (409) is not asked again; a lost connection waits longer each time", async () => {
    let off = 0;
    const none = streamWorld([() => new Response("{}", { status: 409, headers: { "content-type": "application/json" } })]);
    const stop = connectConvStream(none.deps, () => (off += 1));
    await settle();
    assert.equal(off, 1);
    assert.equal(none.timers.length, 0);
    stop();
    const lost = streamWorld([]);
    const stop2 = connectConvStream(lost.deps, () => undefined);
    await settle();
    assert.equal(lost.timers[0]?.ms, 2000);
    lost.timers.shift()!.fn();
    await settle();
    assert.equal(lost.timers[0]?.ms, 4000);
    stop2();
  });
});

const thread = (id: string, messages: ConvMessage[] = []): ConversationThread =>
  ({ id, contact: { name: "Asha", handles: [], muted: false }, links: [], status: "open", box: "main", assignedTo: null, unread: 0, messages, hasOlder: false, notes: [], window: null, replyChannels: [], defaultChannel: "whatsapp", access: { canEdit: true, readOnlyReason: null, canSeeStay: false, canSeeBills: false, canLink: [] }, replyTo: null }) as ConversationThread;
const wa = (id: string, text: string, at: string, status: WhatsAppMessage["status"] = "sent"): WhatsAppMessage => ({ kind: "whatsapp", id, direction: "out", status, at, sentBy: { id: "u1", name: "Me" }, sentFrom: "hms", type: "text", text });

describe("what the tab has seen", () => {
  test("lists and threads come back at once; another person's sign-in empties everything", async () => {
    const api = {};
    claimConvCache("u1");
    storeList(api, "q1", { items: [] } as never);
    storeThread(api, thread("c1"));
    assert.ok(cachedList(api, "q1"));
    assert.equal(cachedThread(api, "c1")?.id, "c1");
    let told = 0;
    const off = onThreadStored(api, "c1", () => (told += 1));
    storeThread(api, thread("c1"));
    off();
    assert.equal(told, 1);
    let asked = 0;
    const load = async () => ((asked += 1), { ok: true as const, data: ["Neha"] });
    await readOnce(api, "staff", load);
    await readOnce(api, "staff", load);
    assert.equal(asked, 1, "read once per tab");
    assert.deepEqual(onceValue(api, "staff"), ["Neha"]);
    claimConvCache("u2");
    assert.equal(cachedList(api, "q1"), null);
    assert.equal(cachedThread(api, "c1"), null);
    assert.equal(onceValue(api, "staff"), null);
  });
  test("the same person visiting another hotel starts empty (the shell claims person, console and visit)", () => {
    const api = {};
    claimConvCache("p1|hotel|hotel-a");
    storeThread(api, thread("a-thread"));
    claimConvCache("p1|hotel|hotel-a");
    assert.equal(cachedThread(api, "a-thread")?.id, "a-thread", "the same visit keeps what it saw");
    claimConvCache("p1|hotel|hotel-b");
    assert.equal(cachedThread(api, "a-thread"), null, "hotel A's mail never shows in hotel B");
  });
});

describe("a message on screen the moment Send is pressed", () => {
  test("it waits with a clock tick, then the server's copy takes its place (never twice, even when the live read came first)", async () => {
    claimConvCache("u-send");
    let answer: (m: ConvMessage) => void = () => undefined;
    const api = { sendReply: () => new Promise<{ ok: true; data: ConvMessage }>((res) => (answer = (m) => res({ ok: true, data: m }))) };
    storeThread(api, thread("c1", [wa("m0", "Hello", "2026-11-05T10:00:00Z")]));
    const temp = wa("tmp-1", "Your room is ready", "2026-11-05T10:05:00Z", "pending");
    stagePending(api, "c1", temp, { channel: "whatsapp", text: "Your room is ready" });
    const going = runPending(api, "c1", "tmp-1");
    const drawn = withPending(cachedThread(api, "c1")!.messages, [{ tempId: "tmp-1", message: temp, input: { channel: "whatsapp", text: "x" }, error: null }]);
    assert.deepEqual(drawn.map((m) => [m.id, m.status]), [["m0", "sent"], ["tmp-1", "pending"]]);
    // the live read brings the server's copy before the send's own answer: the waiting one is not drawn twice
    const real = wa("m1", "Your room is ready", "2026-11-05T10:05:01Z", "sent");
    assert.deepEqual(withPending([...cachedThread(api, "c1")!.messages, real], [{ tempId: "tmp-1", message: temp, input: { channel: "whatsapp", text: "x" }, error: null }]).map((m) => m.id), ["m0", "m1"]);
    answer(real);
    const r = await going;
    assert.equal(r?.ok, true);
    assert.deepEqual(cachedThread(api, "c1")!.messages.map((m) => m.id), ["m0", "m1"], "the server's copy is in the thread");
  });
  test("a send that fails stays, marked, for Try again; Try again sends it; Remove takes it away", async () => {
    claimConvCache("u-fail");
    let fail = true;
    const api = { sendReply: async () => (fail ? { ok: false as const, error: { code: "SERVER_ERROR" as const, message: "x", traceId: "t" } } : { ok: true as const, data: wa("m9", "Hi", "2026-11-05T11:00:00Z") }) };
    storeThread(api, thread("c2"));
    stagePending(api, "c2", wa("tmp-2", "Hi", "2026-11-05T11:00:00Z", "pending"), { channel: "whatsapp", text: "Hi" });
    const r = await runPending(api, "c2", "tmp-2");
    assert.equal(r?.ok, false);
    const failedOne = { tempId: "tmp-2", message: wa("tmp-2", "Hi", "2026-11-05T11:00:00Z", "failed"), input: { channel: "whatsapp" as const, text: "Hi" }, error: { code: "SERVER_ERROR" as const, message: "x", traceId: "t" } };
    assert.deepEqual(withPending([wa("m9", "Hi", "2026-11-05T11:00:00Z")], [failedOne]).map((m) => m.id), ["m9", "tmp-2"], "a failed one is never hidden");
    fail = false;
    const again = await runPending(api, "c2", "tmp-2");
    assert.equal(again?.ok, true);
    assert.deepEqual(cachedThread(api, "c2")!.messages.map((m) => m.id), ["m9"]);
    stagePending(api, "c2", wa("tmp-3", "Bye", "2026-11-05T11:01:00Z"), { channel: "whatsapp", text: "Bye" });
    dropPending(api, "c2", "tmp-3");
    assert.equal(await runPending(api, "c2", "tmp-3"), null, "Undo / Remove: nothing is sent");
  });
});

describe("the demo's own changes go on the same bus", () => {
  test("a guest writing by themselves and a WhatsApp tick moving tell the page the conversation's id", async () => {
    const told: string[][] = [];
    const ticks: (() => void)[] = [];
    const g = globalThis as unknown as { setTimeout: (fn: () => void, ms?: number) => unknown };
    const real = g.setTimeout;
    // the tick delays (600 ms and up) are held for the test; the mock's own short waits run as usual
    g.setTimeout = (fn: () => void, ms?: number) => ((ms ?? 0) >= 500 ? (ticks.push(fn), 0) : real(fn, ms));
    try {
      const mock = createConversationsMock({ scope: "hotel", latencyMs: 0, onChange: (ids) => told.push(ids) });
      mock.setActor({ id: "u1", name: "Me", role: "hotel_admin" });
      const list = await mock.list({ channel: "whatsapp", tab: "all", page: 1, size: 25 });
      assert.ok(list.ok);
      const row = list.ok ? list.data.items[0] : null;
      assert.ok(row);
      mock.simulateInbound(row.id, { channel: "whatsapp", text: "Is breakfast included?" });
      assert.deepEqual(told.at(-1), [row.id]);
      const sent = await mock.sendReply(row.id, { channel: "whatsapp", text: "Yes, 7 to 10 am." });
      assert.ok(sent.ok);
      for (const t of ticks.splice(0)) t();
      assert.ok(told.filter((ids) => ids[0] === row.id).length >= 2, "the ticks told the page too");
    } finally {
      g.setTimeout = real;
    }
  });
});
