// WhatsApp phase 1, task 8 (MJ, 4 Nov 2026; docs/plans/WHATSAPP-MASTER-PLAN.md parts 12 and 26.4): the Meta client and the send pipeline, run against a fake Meta and an in-memory store.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.send.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createFakeMeta } from "@/server/whatsapp/fakeMeta";
import { createGraphClient } from "@/server/whatsapp/graph";
import { createSender, isLockedRule, resolveRules, type SendRequest } from "@/server/whatsapp/send";
import { createMemorySendStore } from "@/server/whatsapp/sendMemory";
import type { SendLine } from "@/server/whatsapp/sendPorts";

const HOTEL = "hotel-a";
const SCOPE = { kind: "hotel", hotelId: HOTEL } as const;
const GUEST = "919825041236";
const SHARED: SendLine = { id: "line-shared", kind: "shared", phoneNumberId: "1055550001111", wabaId: "2055550002222", status: "active", sealedToken: "sealed" };
const OWN: SendLine = { id: "line-own", kind: "hotel", phoneNumberId: "1055550003333", wabaId: "2055550002222", status: "active", sealedToken: "sealed" };
const MINUTE = 60_000;

function setup(opts: { timeoutMs?: number } = {}) {
  const store = createMemorySendStore();
  const meta = createFakeMeta();
  const graph = createGraphClient({ fetch: meta.fetch, timeoutMs: opts.timeoutMs ?? 1000 });
  const now = new Date("2026-11-04T10:00:00Z");
  const sender = createSender({ store, graph, openToken: () => "tok", now: () => now });
  store.settings.set("whatsapp.enabled", "true");
  store.lines.set(SHARED.id, { ...SHARED });
  store.lines.set(OWN.id, { ...OWN });
  store.current.set(`hotel:${HOTEL}`, SHARED.id);
  store.hotelNames.set(HOTEL, "Hotel Pallav");
  store.stays.add(`${HOTEL}:${GUEST}`);
  store.templates.set(`hotel:${HOTEL}:welcome:en`, { status: "approved", category: "utility" });
  store.templates.set(`hotel:${HOTEL}:promo:en`, { status: "approved", category: "marketing" });
  store.consent.add(`hotel:${HOTEL}:${GUEST}`);
  const openWindow = (lineId: string | null = SHARED.id) => store.windows.set(`hotel:${HOTEL}:${GUEST}`, { closesAt: new Date(now.getTime() + 60 * MINUTE), lastInboundLineId: lineId });
  let n = 0;
  const text = (over: Partial<SendRequest> = {}): SendRequest => ({ id: `m-${++n}`, scope: SCOPE, to: "+91 98250-41236", content: { kind: "text", body: "Your room is ready" }, by: { id: "staff-1" }, ...over });
  const template = (over: Partial<SendRequest> = {}, name = "welcome"): SendRequest => ({ id: `m-${++n}`, scope: SCOPE, to: GUEST, content: { kind: "template", name, language: "en", variables: ["Asha"] }, by: { id: "staff-1" }, ...over });
  return { store, meta, sender, now, openWindow, text, template };
}

describe("whatsapp send pipeline: each check refuses", () => {
  test("kill switch, line status, who may be messaged", async () => {
    const t = setup();
    t.openWindow();
    t.store.settings.set("whatsapp.enabled", "false");
    assert.equal((await t.sender.send(t.text())).code, "kill_switch_off");
    t.store.settings.set("whatsapp.enabled", "true");
    t.store.lines.get(SHARED.id)!.status = "paused";
    assert.equal((await t.sender.send(t.text())).code, "line_not_active");
    t.store.lines.get(SHARED.id)!.status = "active";
    t.store.windows.clear();
    t.store.stays.clear();
    assert.equal((await t.sender.send(t.template())).code, "recipient_not_allowed");
    assert.equal(t.meta.calls.length, 0);
  });

  test("opt-out, platform suppression, consent, window, category, daily cap", async () => {
    const t = setup();
    t.store.optouts.add(`hotel:${HOTEL}:${GUEST}`);
    assert.equal((await t.sender.send(t.template())).code, "opted_out");
    t.store.optouts.clear();
    t.store.suppressed.add(GUEST);
    assert.equal((await t.sender.send(t.template())).code, "suppressed");
    t.store.suppressed.clear();
    t.store.consent.clear();
    assert.equal((await t.sender.send(t.template({ origin: "automatic" }))).code, "consent_missing");
    t.store.consent.add(`hotel:${HOTEL}:${GUEST}`);
    assert.equal((await t.sender.send(t.text())).code, "window_closed");
    assert.equal((await t.sender.send(t.template({}, "missing"))).code, "template_not_approved");
    assert.equal((await t.sender.send(t.template({}, "promo"))).code, "marketing_not_allowed");
    t.store.globalDefault.daily_cap = 2;
    t.store.usage.push({ scope: `hotel:${HOTEL}`, lineId: SHARED.id, category: "utility", started: 2, sent: 2, failed: 0 });
    assert.equal((await t.sender.send(t.template())).code, "daily_cap_reached");
    t.store.globalDefault.daily_cap = 0; // 0 means no cap
    assert.equal((await t.sender.send(t.template())).status, "sent");
    assert.equal(t.meta.sends().length, 1);
  });

  test("switches resolve hotel override, then line profile, then global default; Meta's rule stays locked", async () => {
    const t = setup();
    t.openWindow();
    const layers = { hotelOverride: { daily_cap: 7 }, lineProfile: { daily_cap: 9, marketing_allowed: true }, globalDefault: { daily_cap: 11, marketing_allowed: false, consent_required_for_automatic: false } };
    const r = resolveRules(layers);
    assert.equal(r.daily_cap, 7);
    assert.equal(r.marketing_allowed, true);
    assert.equal(r.consent_required_for_automatic, false);
    assert.equal(r.recipients_stay_guests_only, true); // nothing set: built-in
    assert.equal(resolveRules({ ...layers, hotelOverride: { templates_only_for_new_messages: false } }).templates_only_for_new_messages, true);
    assert.equal(isLockedRule("templates_only_for_new_messages"), true);
    // the locked window rule holds even when a layer tries to switch it off
    t.store.windows.clear();
    t.store.globalDefault.templates_only_for_new_messages = false;
    assert.equal((await t.sender.send(t.text())).code, "window_closed");
    // a hotel override beats the line profile in a real send: marketing on at the line, off for this hotel
    t.store.lineProfiles.set(SHARED.id, { marketing_allowed: true });
    t.store.hotelOverrides.set(HOTEL, { marketing_allowed: false });
    assert.equal((await t.sender.send(t.template({}, "promo"))).code, "marketing_not_allowed");
    t.store.hotelOverrides.delete(HOTEL);
    assert.equal((await t.sender.send(t.template({}, "promo"))).status, "sent");
  });
});

describe("whatsapp send pipeline: sending", () => {
  test("the pending row exists before Meta is called; the hotel name leads on the shared line; a reply uses the line of the open window", async () => {
    const t = setup();
    t.openWindow(OWN.id);
    let seen: string | undefined;
    t.meta.onSend(() => {
      seen = t.store.messages.get("pending-first")?.status;
    });
    const r = await t.sender.send(t.text({ id: "pending-first" }));
    assert.equal(seen, "pending");
    assert.equal(r.status, "sent");
    assert.equal(t.store.messages.get("pending-first")!.status, "sent");
    assert.equal(t.store.messages.get("pending-first")!.wamid, "wamid.FAKE0001");
    const call = t.meta.sends()[0];
    assert.ok(call.path.includes(OWN.phoneNumberId)); // the open window was on the own line
    assert.equal(call.authorization, "Bearer tok");
    assert.equal((call.body?.text as { body: string }).body, "Your room is ready"); // own line: no label
    // the shared line gets the bold hotel name as the first line
    t.openWindow(SHARED.id);
    await t.sender.send(t.text());
    // ... and a "Wrong hotel?" button (a reply button), whose id names the hotel so the guest's tap can be routed
    const shared = t.meta.sends()[1].body as { type: string; interactive: { type: string; body: { text: string }; action: { buttons: { reply: { id: string; title: string } }[] } } };
    assert.equal(shared.type, "interactive");
    assert.equal(shared.interactive.body.text, "*Hotel Pallav*\nYour room is ready");
    assert.deepEqual(shared.interactive.action.buttons.map((b) => [b.reply.id.startsWith("w:"), b.reply.title]), [[true, "Wrong hotel?"]]);
  });

  test("a timeout is an unknown outcome: the row stays pending and is never resent", async () => {
    const t = setup({ timeoutMs: 20 });
    t.openWindow();
    t.meta.script({ type: "hang" });
    const req = t.text();
    const r = await t.sender.send(req);
    assert.equal(r.status, "unknown");
    assert.equal(t.store.messages.get(req.id)!.status, "pending");
    assert.equal(t.store.messages.get(req.id)!.failureCode, "unknown_outcome");
    const again = await t.sender.send(req);
    assert.equal(again.status, "duplicate");
    assert.equal(t.meta.sends().length, 1);
  });

  test("a policy error never retries; a 5xx is failed with a retry hint and may be sent again by the outbox", async () => {
    const t = setup();
    t.openWindow();
    t.meta.script({ type: "policy", code: 131047 });
    const a = t.text();
    const r = await t.sender.send(a);
    assert.deepEqual([r.status, r.code], ["failed", "reengagement_window_closed"]);
    assert.equal((await t.sender.send(a)).status, "duplicate");
    assert.equal(t.meta.sends().length, 1);
    t.meta.script({ type: "5xx" });
    const b = t.text();
    const s = await t.sender.send(b);
    assert.equal(s.status, "retry");
    assert.ok((s.retryAfterSeconds ?? 0) > 0);
    assert.equal(t.meta.sends().length, 2); // this module did not resend by itself
    assert.equal((await t.sender.send(b)).status, "sent"); // the outbox calls again with the same id
    assert.equal(t.store.messages.get(b.id)!.status, "sent");
  });

  test("a 401 twice marks the line needs_reconnect and sending on it stops", async () => {
    const t = setup();
    t.openWindow();
    t.meta.script({ type: "401" }, { type: "401" });
    const first = await t.sender.send(t.text());
    assert.deepEqual([first.code, first.lineNeedsReconnect], ["token_invalid", false]);
    const second = await t.sender.send(t.text());
    assert.equal(second.lineNeedsReconnect, true);
    assert.equal(t.store.lines.get(SHARED.id)!.status, "needs_reconnect");
    assert.equal((await t.sender.send(t.text())).code, "line_not_active");
    assert.equal(t.meta.sends().length, 2);
  });

  test("the client reaches the other endpoints and never puts the token in a result", async () => {
    const meta = createFakeMeta();
    const graph = createGraphClient({ fetch: meta.fetch });
    const phone = await graph.getPhoneNumber("secret-token", "1055550001111");
    assert.equal(phone.kind, "ok");
    if (phone.kind === "ok") assert.equal(phone.quality, "GREEN");
    const media = await graph.downloadMedia("secret-token", "media-1");
    assert.equal(media.kind, "ok");
    assert.equal((await graph.markRead("secret-token", "1055550001111", "wamid.X")).kind, "ok");
    assert.equal((await graph.registerNumber("secret-token", "1055550001111", "123456")).kind, "ok");
    assert.equal((await graph.subscribeApp("secret-token", "2055550002222")).kind, "ok");
    assert.ok(meta.calls[0].path.startsWith("/v"));
    meta.script({ type: "refused" });
    const refused = await graph.sendText("secret-token", "1055550001111", GUEST, "hello");
    assert.equal(refused.kind, "transient"); // the connection never opened: nothing reached Meta
    assert.ok(!JSON.stringify(refused).includes("secret-token"));
  });
});
