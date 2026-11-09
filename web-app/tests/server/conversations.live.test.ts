// Live Email and WhatsApp (MJ, 5 Nov 2026): the one "conversations changed" event. Who hears which box (the mail ping's rules), that a browser gets ids and nothing else, that
// every write of a hub publishes after it was saved (mail and WhatsApp taken in, a reply, read, assign, done, notes, the WhatsApp ticks and sends) and a failed one publishes
// nothing, how NOTIFY / LISTEN and the local hub share the work, and the stream route: 401 without a session, 403 for a guest, a company login or an API key, 409 on a
// serverless host, and a hotel's page never hears another hotel.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/conversations.live.test.ts
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { GET as liveRoute } from "../../src/app/api/v1/live/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureConvLive, liveBoxesOf, liveGroupUnit, livePersonUnit, livePlatformUnit } from "../../src/server/compose/convLive";
import type { ConversationsRepo } from "../../src/server/repos/conversations";
import type { Unit } from "../../src/server/repos/types";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { boxesForSession, createConvLive, createLiveHub, decodeNotify, encodeNotify, mergeChanges, PLATFORM_BOX, wireOf, type ConvChange, type LiveWire } from "../../src/server/live/convLive";
import { liveSendStore, liveWaInbox } from "../../src/server/live/liveStores";
import { liveUnit } from "../../src/server/live/liveUnit";
import { createLogger } from "../../src/server/logger";
import type { WaInboxStore } from "../../src/server/whatsapp/inbound";
import type { WaSendStore } from "../../src/server/whatsapp/sendPorts";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const A = { kind: "hotel" as const, id: HOTEL_A };
const B = { kind: "hotel" as const, id: HOTEL_B };
const META = { traceId: "t", ip: null };

describe("who hears which box", () => {
  const base = { userId: "u1", hotelId: HOTEL_A, client: "web" };
  test("staff hear their own mailbox; their hotel (with the right), the platform desks or their group; nobody else's", () => {
    assert.deepEqual(boxesForSession({ ...base, accountRole: "hotel_admin" }), [{ kind: "person", id: "u1" }, A]);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "hotel_user" }, { hotelInbox: false }), [{ kind: "person", id: "u1" }], "a hotel user without Email or WhatsApp");
    assert.deepEqual(boxesForSession({ ...base, accountRole: "platform_admin", hotelId: "" }), [{ kind: "person", id: "u1" }, PLATFORM_BOX]);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "super_admin", hotelId: "" }), [{ kind: "person", id: "u1" }, PLATFORM_BOX]);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "group_hotel_admin", hotelId: "" }, { groupId: "g1" }), [{ kind: "person", id: "u1" }, { kind: "group", id: "g1" }]);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "group_hotel_admin", hotelId: "" }), [{ kind: "person", id: "u1" }], "no group found: own mailbox only");
  });
  test("a guest, a company login, an API key and a visit hear nothing of a hotel", () => {
    assert.deepEqual(boxesForSession({ ...base, accountRole: "guest_user" }), []);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "corporate_user" }), []);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "hotel_admin", client: "token" }), []);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "hotel_admin", token: { id: "k" } }), []);
    assert.deepEqual(boxesForSession({ ...base, accountRole: "super_admin", visit: { id: "v1" } }), [{ kind: "person", id: "u1" }]);
  });
});

describe("the event itself", () => {
  test("a browser is sent the page, the ids and the kind: never the box's id, a name or words", () => {
    const w = wireOf({ box: A, ids: ["c1", "c2"], what: "message" });
    assert.deepEqual(w, { s: "hotel", ids: ["c1", "c2"], w: "message" });
    assert.deepEqual(Object.keys(w).sort(), ["ids", "s", "w"]);
    assert.equal(JSON.stringify(w).includes(HOTEL_A), false);
    assert.deepEqual(wireOf({ box: { kind: "person", id: "u1" }, ids: [], what: "read" }), { s: "personal", ids: [], w: "read" });
    assert.deepEqual(wireOf({ box: A, ids: ["ok", "bad id with spaces"], what: "meta" }).ids, ["ok"], "anything not shaped like an id is dropped");
  });
  test("changes of one box are merged (ids joined, an empty list means the whole box, the strongest kind kept); too many ids become the whole box", () => {
    const merged = mergeChanges([{ box: A, ids: ["c1"], what: "read" }, { box: A, ids: ["c2", "c1"], what: "message" }, { box: B, ids: ["x"], what: "meta" }]);
    assert.deepEqual(merged, [{ box: A, ids: ["c1", "c2"], what: "message" }, { box: B, ids: ["x"], what: "meta" }]);
    assert.deepEqual(mergeChanges([{ box: A, ids: ["c1"], what: "meta" }, { box: A, ids: [], what: "meta" }])[0].ids, []);
    const many = Array.from({ length: 60 }, (_, i) => `c${i}`);
    assert.deepEqual(mergeChanges([{ box: A, ids: many.slice(0, 30), what: "meta" }, { box: A, ids: many.slice(30), what: "meta" }])[0].ids, []);
  });
  test("NOTIFY payloads go and come back; anything else is dropped", () => {
    const c: ConvChange = { box: A, ids: ["c1"], what: "status" };
    assert.deepEqual(decodeNotify(encodeNotify(c)), c);
    assert.equal(decodeNotify("not json"), null);
    assert.equal(decodeNotify(JSON.stringify({ k: "bank", i: "x", c: [], w: "message" })), null);
    assert.equal(decodeNotify(JSON.stringify({ k: "hotel", i: "x y", c: [], w: "message" })), null);
    assert.equal(decodeNotify(JSON.stringify({ k: "hotel", i: HOTEL_A, c: [], w: "shout" })), null);
  });
});

describe("the hub", () => {
  test("a change reaches only the pages of its box; a page that left hears nothing", () => {
    const hub = createLiveHub();
    const a: LiveWire[] = [];
    const b: LiveWire[] = [];
    const offA = hub.subscribe([A, { kind: "person", id: "u1" }], (w) => a.push(w));
    hub.subscribe([B], (w) => b.push(w));
    hub.deliver({ box: A, ids: ["c1"], what: "message" });
    hub.deliver({ box: B, ids: ["c9"], what: "message" });
    hub.deliver({ box: { kind: "person", id: "u2" }, ids: ["p1"], what: "message" });
    assert.deepEqual(a.map((w) => w.ids), [["c1"]]);
    assert.deepEqual(b.map((w) => w.ids), [["c9"]]);
    assert.equal(hub.size(), 2);
    offA();
    hub.deliver({ box: A, ids: ["c2"], what: "message" });
    assert.equal(a.length, 1);
    assert.equal(hub.size(), 1);
  });
  test("publish: without a database the hub is told at once; with one, NOTIFY carries it (and the hub too while this process's LISTEN is down)", async () => {
    const plain = createConvLive();
    const got: LiveWire[] = [];
    plain.hub.subscribe([A], (w) => got.push(w));
    plain.publish([{ box: A, ids: ["c1"], what: "message" }]);
    assert.equal(got.length, 1);

    const sent: string[] = [];
    let onPayload: ((p: string) => void) | null = null;
    let onState: ((up: boolean) => void) | null = null;
    const db = createConvLive({ notify: async (p) => void sent.push(p), listen: (fn, st) => ((onPayload = fn), (onState = st), { close: async () => undefined }), later: (work) => void work() });
    const heard: LiveWire[] = [];
    const opened = db.stream([A], undefined, { heartbeatMs: 60_000, lifetimeMs: 60_000 }).getReader();
    db.hub.subscribe([A], (w) => heard.push(w));
    db.publish([{ box: A, ids: ["c1"], what: "message" }]);
    assert.equal(sent.length, 1);
    assert.equal(heard.length, 1, "LISTEN not up yet: told here");
    onState!(true);
    db.publish([{ box: A, ids: ["c2"], what: "status" }]);
    assert.equal(sent.length, 2);
    assert.equal(heard.length, 1, "LISTEN up: it comes back through NOTIFY");
    onPayload!(sent[1]);
    assert.deepEqual(heard[1], { s: "hotel", ids: ["c2"], w: "status" });
    await opened.cancel();
  });
  test("the serverless ping is sent for every box that changed", async () => {
    const pinged: string[] = [];
    const live = createConvLive({ signal: async (box) => void pinged.push(`${box.kind}:${box.id}`), later: (work) => void work() });
    live.publish([{ box: A, ids: ["c1"], what: "message" }, { box: PLATFORM_BOX, ids: [], what: "read" }]);
    assert.deepEqual(pinged, [`hotel:${HOTEL_A}`, "platform:desks"]);
    assert.equal(createConvLive({ serverless: true }).transport(), "off");
    assert.equal(createConvLive().transport(), "sse");
  });
});

describe("every write of a hub publishes once it is saved", () => {
  const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
  const setup = () => {
    const out: ConvChange[] = [];
    const w = hotelWorld({ wrapUnit: (unit) => liveUnit(unit, (s) => ({ kind: "hotel", id: s.hotelId }), (c) => void out.push(...c)) });
    return { w, out };
  };

  test("mail taken in, a reply, read and unread, assign, done, star and labels, a note: each with its conversation's id and nothing else", async () => {
    const { w, out } = setup();
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(admin, {});
    const id = w.data().convConversations[0].id;
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "message" }, "the mail check took it in");
    out.length = 0;
    await w.service.list(admin, { page: 1, pageSize: 25 } as never);
    await w.service.thread(admin, id);
    assert.equal(out.length, 0, "reading publishes nothing");

    await w.service.reply(admin, id, { channel: "email", text: "Your room is ready." }, META);
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "message" });
    await w.service.setRead(admin, id, false);
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "read" });
    await w.service.setRead(admin, id, true);
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "read" });
    await w.service.patch(admin, id, { assignedTo: STAFF.neha }, META);
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "meta" });
    await w.service.patch(admin, id, { status: "done" }, META);
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "meta" });
    await w.service.patch(admin, id, { starred: true, labels: ["VIP"] }, META);
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "meta" });
    await w.service.addNote(admin, id, "Called the guest.", META);
    assert.deepEqual(out.at(-1), { box: A, ids: [id], what: "meta" });
    for (const c of out) assert.deepEqual(Object.keys(c).sort(), ["box", "ids", "what"]);
  });

  test("a write that fails publishes nothing", async () => {
    const { w, out } = setup();
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(admin, {});
    const id = w.data().convConversations[0].id;
    out.length = 0;
    const viewer = makeSession({ userId: STAFF.viewer, accountRole: "hotel_user", roleKey: "viewer", roleLevel: 1, grants: [grant("conversations", "view")] });
    await assert.rejects(w.service.patch(viewer, id, { status: "done" }, META));
    await assert.rejects(w.service.reply(admin, id, { channel: "email", text: "" }, META));
    assert.equal(out.length, 0);
  });

  test("WhatsApp: a guest's message, a reaction and a kept file from Meta; a reply waiting, then sent, then its ticks", async () => {
    const out: ConvChange[] = [];
    const publish = (c: ConvChange[]) => void out.push(...c);
    const inbox = liveWaInbox(
      {
        saveInbound: async () => ({ created: true, conversationIds: ["w1"] }),
        applyReaction: async () => true,
        attachMedia: async () => undefined,
      } as unknown as WaInboxStore,
      publish,
    );
    await inbox.saveInbound({ kind: "hotel", hotelId: HOTEL_A }, {} as never, "line");
    await inbox.applyReaction({ kind: "platform" }, { targetWamid: "x", emoji: "" });
    await inbox.attachMedia!({ kind: "hotel", hotelId: HOTEL_A }, "x", {});
    assert.deepEqual(out, [
      { box: A, ids: ["w1"], what: "message" },
      { box: PLATFORM_BOX, ids: [], what: "meta" },
      { box: A, ids: [], what: "meta" },
    ]);
    const again = liveWaInbox({ saveInbound: async () => ({ created: false }), applyReaction: async () => false } as unknown as WaInboxStore, publish);
    out.length = 0;
    await again.saveInbound({ kind: "hotel", hotelId: HOTEL_A }, {} as never, "line");
    await again.applyReaction({ kind: "hotel", hotelId: HOTEL_A }, { targetWamid: "x", emoji: "" });
    assert.equal(out.length, 0, "a repeated webhook and a reaction to nothing publish nothing");

    const store = liveSendStore({ insertPending: async () => ({ created: true }), updateMessage: async () => undefined } as unknown as WaSendStore, publish);
    await store.insertPending({ id: "m1", scope: { kind: "hotel", hotelId: HOTEL_B }, lineId: "l", to: "91", kind: "text", body: "hi", templateName: null, sentBy: "u", createdAt: new Date() });
    await store.updateMessage({ kind: "hotel", hotelId: HOTEL_B }, "m1", { status: "sent" });
    assert.deepEqual(out, [
      { box: B, ids: [], what: "message" },
      { box: B, ids: [], what: "status" },
    ]);
  });
});

describe("GET /api/v1/live (the page's stream)", () => {
  const sessions = new Map<string, VerifiedSession>();
  sessions.set("adminA", makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 }));
  sessions.set("adminB", makeSession({ userId: STAFF.neha, hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 }));
  sessions.set("guest", makeSession({ userId: "g1", accountRole: "guest_user", roleKey: "guest", roleLevel: 1 }));
  sessions.set("company", makeSession({ userId: "c1", accountRole: "corporate_user", roleKey: "corporate", roleLevel: 1 }));
  sessions.set("key", { ...makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 }), client: "token", token: { id: "k1", name: "Load test", level: "full", scope: "all", testMode: false, callsPerMinute: 600, ip: null, newIp: false } } as VerifiedSession);
  const req = (who: string | null, signal?: AbortSignal): Request => new Request("https://hms.test/api/v1/live", { headers: { host: "hms.test", ...(who ? { "x-test-session": who } : {}) }, signal });
  let live = createConvLive();

  beforeEach(() => {
    live = createConvLive();
    configureConvLive(live);
    configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  });
  afterEach(() => configureConvLive(null));

  test("401 without a session; 403 for a guest, a company login and an API key", async () => {
    assert.equal((await liveRoute(req(null))).status, 401);
    assert.equal((await liveRoute(req("guest"))).status, 403);
    assert.equal((await liveRoute(req("company"))).status, 403);
    assert.equal((await liveRoute(req("key"))).status, 403);
  });

  test("409 where the host cannot hold a stream (the page uses the ping)", async () => {
    configureConvLive(createConvLive({ serverless: true }));
    assert.equal((await liveRoute(req("adminA"))).status, 409);
  });

  test("a hotel's page hears its own hotel's changes, never another hotel's, as text/event-stream that nothing on the way may buffer", async () => {
    const stop = new AbortController();
    const r = await liveRoute(req("adminA", stop.signal));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.match(r.headers.get("cache-control") ?? "", /no-transform/);
    assert.equal(r.headers.get("x-accel-buffering"), "no");
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    const first = dec.decode((await reader.read()).value);
    assert.match(first, /event: ready/);
    live.publish([{ box: B, ids: ["other-hotel-conv"], what: "message" }]);
    live.publish([{ box: A, ids: ["own-conv"], what: "message" }]);
    const next = dec.decode((await reader.read()).value);
    assert.equal(next.includes("other-hotel-conv"), false);
    assert.match(next, /^data: \{"s":"hotel","ids":\["own-conv"\],"w":"message"\}/);
    assert.equal(next.includes(HOTEL_A), false, "the hotel's id never goes to the browser");
    assert.equal(live.hub.size(), 1);
    stop.abort();
    await reader.cancel();
    assert.equal(live.hub.size(), 0, "a page that left is let go");
  });
});

describe("review: the server decides the boxes, not the page", () => {
  test("a hotel user hears their hotel only with Email or WhatsApp View; a visit never hears the hotel", async () => {
    const none = makeSession({ userId: "u-none", accountRole: "hotel_user", roleKey: "frontdesk", roleLevel: 2, grants: [] });
    assert.deepEqual(await liveBoxesOf(none), [{ kind: "person", id: "u-none" }], "no right: own mailbox only");
    const mail = makeSession({ userId: "u-mail", accountRole: "hotel_user", roleKey: "frontdesk", roleLevel: 2, grants: [grant("conversations", "view")] });
    assert.deepEqual(await liveBoxesOf(mail), [{ kind: "person", id: "u-mail" }, A]);
    const chat = makeSession({ userId: "u-wa", hotelId: HOTEL_B, accountRole: "hotel_user", roleKey: "frontdesk", roleLevel: 2, grants: [grant("whatsapp", "view")] });
    assert.deepEqual(await liveBoxesOf(chat), [{ kind: "person", id: "u-wa" }, B], "WhatsApp alone is enough, and only for their own hotel");
    const visit = { ...makeSession({ userId: "p1", accountRole: "platform_admin", roleKey: "platform_admin", roleLevel: 5 }), visit: { id: "v1", by: "platform_admin" } } as unknown as VerifiedSession;
    assert.equal((await liveBoxesOf(visit)).some((b) => b.kind === "hotel"), false);
  });

  test("the group, person and platform units publish to their own box (the group's id, the login's id, the desks)", async () => {
    const live = createConvLive();
    configureConvLive(live);
    try {
      const heard: string[] = [];
      live.hub.subscribe([{ kind: "group", id: "g1" }, { kind: "person", id: "login-1" }, PLATFORM_BOX, A], (w) => heard.push(`${w.s}:${w.ids.join(",")}`));
      const repo = { markRead: async () => true } as unknown as ConversationsRepo;
      const unit = { run: async <T>(_s: unknown, work: (r: { conversations: ConversationsRepo }) => Promise<T>) => work({ conversations: repo }) } as unknown as Unit<{ conversations: ConversationsRepo }>;
      await liveGroupUnit(unit).run(makeSession({ userId: "ga", hotelId: "g1", accountRole: "group_hotel_admin" }), (r) => r.conversations.markRead("gc1"));
      await livePersonUnit(unit).run(makeSession({ userId: "login-1", hotelId: "login-1" }), (r) => r.conversations.markRead("pc1"));
      const platform = livePlatformUnit<{ conversations: ConversationsRepo }, { run<T>(work: (r: { conversations: ConversationsRepo }) => Promise<T>): Promise<T> }>({ run: (work) => work({ conversations: repo }) });
      await platform.run((r) => r.conversations.markRead("dc1"));
      assert.deepEqual(heard, ["group:gc1", "personal:pc1", "platform:dc1"], "and never the hotel's box");
    } finally {
      configureConvLive(null);
    }
  });
});
