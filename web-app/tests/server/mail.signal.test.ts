// The "new mail" ping (MJ, 3 Nov 2026): who listens on which channel, what the server sends (nothing but "ask again"), the browser socket, and the address the page may open.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/mail.signal.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { connectMailSignal, mailSignalLive, onMailSignal, socketUrl } from "@/lib/mailSignal";
import { channelsForSession, sendMailSignal, signalChannel, signalConfig } from "@/server/mail/signal";
import { contentSecurityPolicy, signalOrigins } from "../../security-headers";

const ENV = { MAIL_SIGNAL_URL: "https://abcd.supabase.co/", MAIL_SIGNAL_KEY: "anon-key", HMS_HASH_KEY: "hash-key" };

describe("the settings and the channel names", () => {
  test("the ping is off unless the address, the key and the hash key are all there", () => {
    assert.equal(signalConfig({}), null);
    assert.equal(signalConfig({ ...ENV, MAIL_SIGNAL_KEY: "" }), null);
    assert.equal(signalConfig({ ...ENV, HMS_HASH_KEY: undefined }), null);
    assert.equal(signalConfig({ ...ENV, MAIL_SIGNAL_URL: "http://abcd.supabase.co" }), null, "plain http is refused");
    assert.deepEqual(signalConfig(ENV), { url: "https://abcd.supabase.co", key: "anon-key", secret: "hash-key" });
  });

  test("a channel name is a keyed hash: the same for the same mail, different for another hotel, kind or key, and it never contains the id", () => {
    const a = signalChannel("hotel", "hotel-123", "k1");
    assert.equal(a, signalChannel("hotel", "hotel-123", "k1"));
    assert.notEqual(a, signalChannel("hotel", "hotel-124", "k1"));
    assert.notEqual(a, signalChannel("person", "hotel-123", "k1"));
    assert.notEqual(a, signalChannel("hotel", "hotel-123", "k2"));
    assert.match(a, /^m[A-Za-z0-9_-]{24}$/);
    assert.ok(!a.includes("123"));
  });
});

describe("who listens on what", () => {
  const base = { userId: "u1", hotelId: "h1", client: "web" as const };
  const ch = (kind: Parameters<typeof signalChannel>[0], id: string) => signalChannel(kind, id, "s");

  test("hotel staff hear their own mailbox and their hotel; platform staff their own mailbox and the desks; a group admin only their own mailbox", () => {
    assert.deepEqual(channelsForSession({ ...base, accountRole: "hotel_admin" }, "s"), [ch("person", "u1"), ch("hotel", "h1")]);
    assert.deepEqual(channelsForSession({ ...base, accountRole: "hotel_user" }, "s"), [ch("person", "u1"), ch("hotel", "h1")]);
    assert.deepEqual(channelsForSession({ ...base, accountRole: "platform_admin" }, "s"), [ch("person", "u1"), ch("platform", "desks")]);
    assert.deepEqual(channelsForSession({ ...base, accountRole: "super_admin" }, "s"), [ch("person", "u1"), ch("platform", "desks")]);
    assert.deepEqual(channelsForSession({ ...base, accountRole: "group_hotel_admin" }, "s"), [ch("person", "u1")]);
  });

  test("a guest, a company login and an API key hear nothing; a visitor inside a hotel does not hear that hotel", () => {
    assert.deepEqual(channelsForSession({ ...base, accountRole: "guest_user" }, "s"), []);
    assert.deepEqual(channelsForSession({ ...base, accountRole: "corporate_user" }, "s"), []);
    assert.deepEqual(channelsForSession({ ...base, accountRole: "hotel_admin", client: "token" }, "s"), []);
    const visit = { id: "v", hotelId: "h1", hotelName: "H", expiresAt: new Date(), access: "view" as const, by: "super_admin" as const };
    assert.deepEqual(channelsForSession({ ...base, accountRole: "hotel_admin", visit }, "s"), [ch("person", "u1")]);
  });
});

describe("what the server sends", () => {
  test("nothing without settings; with them, one small request that names the channel and carries no mail", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => (calls.push({ url: String(url), init: init ?? {} }), new Response("{}"))) as typeof fetch;
    await sendMailSignal("hotel", "h1", {}, fake);
    assert.equal(calls.length, 0);
    await sendMailSignal("hotel", "h1", ENV, fake);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://abcd.supabase.co/realtime/v1/api/broadcast");
    const body = JSON.parse(String(calls[0].init.body)) as { messages: { topic: string; event: string; payload: unknown; private: boolean }[] };
    assert.deepEqual(body, { messages: [{ topic: signalChannel("hotel", "h1", "hash-key"), event: "ping", payload: {}, private: false }] });
    assert.equal((calls[0].init.headers as Record<string, string>).apikey, "anon-key");
  });

  test("a failing or slow Supabase never makes a delivery fail", async () => {
    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await assert.doesNotReject(sendMailSignal("person", "u1", ENV, boom));
  });
});

describe("the address the page may open", () => {
  test("the content policy lists the ping's address only when it is set", () => {
    assert.deepEqual(signalOrigins({}), []);
    assert.deepEqual(signalOrigins({ MAIL_SIGNAL_URL: "http://x.supabase.co" }), []);
    assert.deepEqual(signalOrigins(ENV), ["https://abcd.supabase.co", "wss://abcd.supabase.co"]);
    // the Turnstile security check (the sign-in family) is always in the list, the ping's address after it
    assert.match(contentSecurityPolicy(ENV), /connect-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/abcd\.supabase\.co wss:\/\/abcd\.supabase\.co;/);
    assert.match(contentSecurityPolicy({}), /connect-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function harness(visible = true) {
  FakeSocket.all = [];
  const timers = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  let id = 0;
  let isVisible = visible;
  let visCb: () => void = () => undefined;
  const pings: number[] = [];
  const stop = connectMailSignal({ url: "https://abcd.supabase.co", key: "k", channels: ["mAAA", "mBBB"] }, () => pings.push(now), {
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    setTimeoutFn: (fn, ms) => (timers.set(++id, { fn, at: now + ms }), id),
    clearTimeoutFn: (t) => void timers.delete(t as number),
    isVisible: () => isVisible,
    onVisibility: (cb) => ((visCb = cb), () => undefined),
  });
  return {
    stop,
    pings,
    sockets: () => FakeSocket.all,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    setVisible(v: boolean) {
      isVisible = v;
      visCb();
    },
  };
}

describe("the browser socket", () => {
  test("it opens the project's socket, joins each channel, tells the parts on a ping and ignores everything else", () => {
    const h = harness();
    const heard: string[] = [];
    const off = onMailSignal(() => heard.push("x"));
    assert.equal(h.sockets().length, 1);
    assert.equal(h.sockets()[0].url, socketUrl("https://abcd.supabase.co", "k"));
    assert.match(h.sockets()[0].url, /^wss:\/\/abcd\.supabase\.co\/realtime\/v1\/websocket\?apikey=k&vsn=1\.0\.0$/);
    h.sockets()[0].open();
    const joins = h.sockets()[0].sent.map((s) => JSON.parse(s) as { topic: string; event: string });
    assert.deepEqual(joins.map((j) => [j.topic, j.event]), [["realtime:mAAA", "phx_join"], ["realtime:mBBB", "phx_join"]]);
    assert.equal(mailSignalLive(), true);
    h.sockets()[0].say({ event: "phx_reply", payload: { status: "ok" } });
    h.sockets()[0].say({ event: "broadcast", payload: { event: "other" } });
    assert.equal(h.pings.length, 0);
    h.sockets()[0].say({ event: "broadcast", payload: { event: "ping", type: "broadcast", payload: {} } });
    assert.equal(h.pings.length, 1);
    off();
    h.stop();
    assert.equal(mailSignalLive(), false);
  });

  test("a heartbeat goes out every 25 seconds while it is open", () => {
    const h = harness();
    h.sockets()[0].open();
    h.advance(26_000);
    h.advance(25_000);
    const beats = h.sockets()[0].sent.map((s) => JSON.parse(s) as { event: string }).filter((m) => m.event === "heartbeat");
    assert.equal(beats.length, 2);
    h.stop();
  });

  test("a lost socket is reopened after a growing wait, and the reopening asks the page to look again (mail may have landed meanwhile)", () => {
    const h = harness();
    h.sockets()[0].open();
    h.sockets()[0].onclose?.();
    assert.equal(h.sockets().length, 1);
    h.advance(4_001);
    assert.equal(h.sockets().length, 2, "reopened after about 4 seconds");
    h.sockets()[1].open();
    assert.equal(h.pings.length, 1, "one ask on coming back");
    h.stop();
  });

  test("a hidden tab lets go after a minute, and coming back reopens it", () => {
    const h = harness();
    h.sockets()[0].open();
    h.setVisible(false);
    h.advance(61_000);
    assert.equal(h.sockets()[0].readyState, 3);
    assert.equal(mailSignalLive(), false);
    h.setVisible(true);
    assert.equal(h.sockets().length, 2);
    h.sockets()[1].open();
    assert.equal(h.pings.length, 1);
    h.stop();
  });

  test("a tab that starts hidden opens nothing until it is shown", () => {
    const h = harness(false);
    assert.equal(h.sockets().length, 0);
    h.setVisible(true);
    assert.equal(h.sockets().length, 1);
    h.stop();
  });
});
