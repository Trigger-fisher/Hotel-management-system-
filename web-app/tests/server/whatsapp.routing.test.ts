// WhatsApp phase 1, task 6 (MJ, 4 Nov 2026; docs/plans/WHATSAPP-MASTER-PLAN.md parts 10, 11, 14, 27.1, 29.4): shared-line routing, holds, the interactive question.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.routing.test.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import { hashNumber } from "@/server/whatsapp/config";
import { answerHold, createOrAppendHold, sweepExpiredHolds, type HeldMessage } from "@/server/whatsapp/holds";
import { BODY_MAX, BUTTON_TITLE_MAX, buildHotelQuestion, chatButtonId, choiceId, cutTitle, parseButtonId, ROW_TITLE_MAX, wrongButtonId } from "@/server/whatsapp/interactive";
import { decide, routeInbound, selectionAfter, type RoutingDecisionInput, type RoutingOutcome } from "@/server/whatsapp/routing";
import { createMemoryHoldStore, createMemoryRoutingStore } from "@/server/whatsapp/routingMemory";
import type { WaGuestHotel, WaLineHotel } from "@/server/whatsapp/routingPorts";

const NOW = new Date("2026-11-04T10:00:00Z");
const min = (m: number): Date => new Date(NOW.getTime() - m * 60_000);
const lh = (hotelId: string, state: WaLineHotel["state"] = "shared", code: string | null = null): WaLineHotel => ({ hotelId, state, hotelCode: code, redirectPhone: state === "active" ? "919800000000" : null });
const gh = (hotelId: string, inMin: number | null = null, outMin: number | null = null): WaGuestHotel => ({ hotelId, lastInAt: inMin === null ? null : min(inMin), lastOutAt: outMin === null ? null : min(outMin) });

const base = (over: Partial<RoutingDecisionInput> = {}): RoutingDecisionInput => ({
  line: { kind: "shared" },
  mode: "strict",
  now: NOW,
  timeframeMinutes: 120,
  message: { text: "hello", buttonId: null, replyOwnerHotelId: null },
  lineHotels: [lh("A", "shared", "goa"), lh("B", "shared", "pune")],
  guestHotels: [gh("A", 30), gh("B", 600)],
  openHoldId: null,
  selection: null,
  ...over,
});
const msg = (over: Partial<RoutingDecisionInput["message"]>) => ({ text: "hello", buttonId: null, replyOwnerHotelId: null, ...over });
const routedTo = (o: RoutingOutcome): string | null => (o.kind === "route" ? o.hotelId : null);

describe("routing matrix", () => {
  test("rules 1 to 3 route in both modes", () => {
    for (const mode of ["strict", "balanced"] as const) {
      assert.equal(routedTo(decide(base({ mode, message: msg({ replyOwnerHotelId: "B" }) }))), "B");
      assert.equal(routedTo(decide(base({ mode, message: msg({ text: "Pune: need a towel" }) }))), "B");
      assert.equal(routedTo(decide(base({ mode, message: msg({ buttonId: chatButtonId("A") }) }))), "A");
      assert.deepEqual(decide(base({ mode, message: msg({ buttonId: choiceId("hold-1", 1) }) })), { kind: "answer", holdId: "hold-1", index: 1 });
    }
    // a code inside a sentence is not a code
    assert.equal(decide(base({ message: msg({ text: "going to goa soon" }) })).kind, "ask");
  });

  test("\"Wrong hotel?\" beats the reply context and the selection, and offers only the guest's OTHER hotels", () => {
    const tap = { buttonId: wrongButtonId("A"), text: null, replyOwnerHotelId: "A" };
    assert.deepEqual(parseButtonId(wrongButtonId("A")), { kind: "wrong", hotelId: "A" });
    for (const mode of ["strict", "balanced"] as const) {
      assert.deepEqual(decide(base({ mode, message: tap, selection: { hotelId: "A", expiresAt: new Date(NOW.getTime() + 60_000) } })), { kind: "wrong", hotelId: "A", hotelIds: ["B"] });
    }
    // no other hotel known: nothing to offer (the caller asks in plain words)
    assert.deepEqual(decide(base({ message: tap, guestHotels: [gh("A", 30)] })), { kind: "wrong", hotelId: "A", hotelIds: [] });
    // a hotel that moved to its own number is never offered
    assert.deepEqual(decide(base({ message: tap, lineHotels: [lh("A"), lh("B", "transition")] })), { kind: "wrong", hotelId: "A", hotelIds: [] });
  });

  test("strict mode asks where balanced mode routes (rules 4 to 6)", () => {
    // rule 4: nobody known -> ask in both, generic
    for (const mode of ["strict", "balanced"] as const) assert.deepEqual(decide(base({ mode, guestHotels: [] })), { kind: "ask", hotelIds: [], generic: true });
    // rule 5: one candidate
    const one = { guestHotels: [gh("A", 5000)] };
    assert.equal(decide(base({ ...one })).kind, "ask");
    assert.equal(routedTo(decide(base({ ...one, mode: "balanced" }))), "A");
    // rule 6: one wrote within the timeframe
    assert.equal(decide(base()).kind, "ask");
    assert.equal(routedTo(decide(base({ mode: "balanced" }))), "A");
    // two within the timeframe, close together -> ask(active); one clearly newest (by more than T) -> route
    assert.deepEqual(decide(base({ mode: "balanced", guestHotels: [gh("A", 10), gh("B", 20)] })), { kind: "ask", hotelIds: ["A", "B"], generic: false });
    assert.equal(routedTo(decide(base({ mode: "balanced", guestHotels: [gh("A", 1), gh("B", 119)] }))), null);
    // none active -> ask all candidates newest first
    assert.deepEqual(decide(base({ mode: "balanced", guestHotels: [gh("B", 900), gh("A", 500)] })), { kind: "ask", hotelIds: ["A", "B"], generic: false });
  });

  test("an active selection routes in strict mode and then runs out; a second hotel's explicit choice replaces it", () => {
    const sel = { hotelId: "A", expiresAt: new Date(NOW.getTime() + 60_000) };
    assert.equal(routedTo(decide(base({ selection: sel }))), "A");
    assert.equal(decide(base({ selection: { hotelId: "A", expiresAt: NOW } })).kind, "ask");
    const opened = selectionAfter(decide(base({ message: msg({ text: "pune: hi" }) })), NOW, 120);
    assert.equal(opened?.hotelId, "B");
    assert.equal(opened?.expiresAt.getTime(), NOW.getTime() + 120 * 60_000);
    // a reply-context route does not open one; a selection route keeps it alive
    assert.equal(selectionAfter(decide(base({ message: msg({ replyOwnerHotelId: "A" }) })), NOW, 120), null);
    assert.ok(selectionAfter(decide(base({ selection: sel })), NOW, 120));
  });

  test("an open hold takes the message instead of a second question", () => {
    assert.deepEqual(decide(base({ openHoldId: "hold-9" })), { kind: "held-append", holdId: "hold-9" });
  });

  test("transition and active hotels (part 14)", () => {
    const hotels = [lh("A", "shared", "goa"), lh("T", "transition", "tr"), lh("X", "active", "own")];
    const guest = [gh("A", 5000), gh("T", 1), gh("X", 1)];
    // neither is a candidate: strict asks only A; balanced routes the single candidate A
    assert.deepEqual(decide(base({ lineHotels: hotels, guestHotels: guest })), { kind: "ask", hotelIds: ["A"], generic: false });
    assert.equal(routedTo(decide(base({ lineHotels: hotels, guestHotels: guest, mode: "balanced" }))), "A");
    // a transition hotel is reached by reply context, a code or a selection
    assert.equal(routedTo(decide(base({ lineHotels: hotels, message: msg({ replyOwnerHotelId: "T" }) }))), "T");
    assert.equal(routedTo(decide(base({ lineHotels: hotels, message: msg({ text: "tr: hi" }) }))), "T");
    assert.equal(routedTo(decide(base({ lineHotels: hotels, selection: { hotelId: "T", expiresAt: new Date(NOW.getTime() + 1000) } }))), "T");
    // a message naming an active hotel is redirected, never delivered
    for (const message of [msg({ text: "own: hi" }), msg({ replyOwnerHotelId: "X" }), msg({ buttonId: chatButtonId("X") })]) {
      assert.deepEqual(decide(base({ lineHotels: hotels, message })), { kind: "redirect", hotelId: "X", phone: "919800000000" });
    }
  });

  test("platform and own lines have no rules", () => {
    assert.deepEqual(decide(base({ line: { kind: "platform" } })), { kind: "platform" });
    assert.deepEqual(decide(base({ line: { kind: "hotel", hotelId: "H" }, guestHotels: [], lineHotels: [] })), { kind: "route", hotelId: "H", via: "own_line", explicit: false });
    assert.equal(decide(base({ line: { kind: "hotel" } })).kind, "drop");
  });
});

describe("holds", () => {
  const sealKey = randomBytes(32);
  const hashKey = randomBytes(32);
  const LINE = "line-1";
  const GUEST = "919825041236";
  const held = (n: number): HeldMessage => ({ wamid: `wamid.${n}`, receivedAt: NOW.toISOString(), content: { text: `secret text ${n}` } });

  test("create, append, answer (delivered in order, hold deleted, choice remembered), expiry", async () => {
    const store = createMemoryHoldStore();
    const routing = createMemoryRoutingStore();
    const deps = { store, sealKey, hashKey, routing };
    const first = await createOrAppendHold(deps, { lineId: LINE, guestDigits: GUEST, message: held(1), candidateHotelIds: ["A", "B"], holdMinutes: 10, now: NOW });
    assert.equal(first.created, true);
    const second = await createOrAppendHold(deps, { lineId: LINE, guestDigits: GUEST, message: held(2), candidateHotelIds: ["A", "B"], holdMinutes: 10, now: min(-1) });
    assert.deepEqual([second.holdId === first.holdId, second.created, second.appended], [true, false, true]);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0]?.expiresAt.getTime(), NOW.getTime() + 10 * 60_000, "append does not extend the expiry");
    assert.ok(!(store.rows[0]?.payloadSecret ?? "").includes("secret text"), "sealed");
    const lineHotels = [lh("A"), lh("B")];
    const at = min(-3);
    // wrong guest, bad index, unknown hold
    const other = { lineId: LINE, holdId: first.holdId, index: 0, now: at, lineHotels, deliver: async () => assert.fail("must not deliver") };
    assert.deepEqual(await answerHold(deps, { ...other, guestDigits: "919800000001" }), { ok: false, reason: "guest_mismatch" });
    assert.deepEqual(await answerHold(deps, { ...other, guestDigits: GUEST, index: 5 }), { ok: false, reason: "bad_choice" });
    assert.deepEqual(await answerHold(deps, { ...other, guestDigits: GUEST, holdId: "nope" }), { ok: false, reason: "missing" });
    // the real answer
    const got: Array<[string, string[]]> = [];
    const res = await answerHold(deps, { ...other, guestDigits: GUEST, index: 1, deliver: async (h, m) => void got.push([h, m.map((x) => x.wamid)]) });
    assert.deepEqual(res, { ok: true, kind: "delivered", hotelId: "B", count: 2 });
    assert.deepEqual(got, [["B", ["wamid.1", "wamid.2"]]]);
    assert.equal(store.rows.length, 0);
    const sel = await routing.getSelection(LINE, hashNumber(hashKey, GUEST));
    assert.equal(sel?.hotelId, "B");
    assert.equal(sel?.expiresAt.getTime(), at.getTime() + 10 * 60_000);
    // expiry: answered late -> discarded; swept -> discarded
    const late = await createOrAppendHold(deps, { lineId: LINE, guestDigits: GUEST, message: held(3), candidateHotelIds: ["A"], holdMinutes: 10, now: NOW });
    const afterwards = { lineId: LINE, guestDigits: GUEST, holdId: late.holdId, index: 0, now: new Date(NOW.getTime() + 10 * 60_000), lineHotels, deliver: async () => assert.fail("must not deliver") };
    assert.deepEqual(await answerHold(deps, afterwards), { ok: false, reason: "expired" });
    await createOrAppendHold(deps, { lineId: LINE, guestDigits: GUEST, message: held(4), candidateHotelIds: ["A"], holdMinutes: 10, now: NOW });
    assert.equal(await sweepExpiredHolds(store, new Date(NOW.getTime() + 11 * 60_000)), 1);
    assert.equal(store.rows.length, 0);
  });
});

describe("interactive question", () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `Hotel Grand Residency Number ${i + 1}`);
  test("buttons up to 3, a list for 4 to 10, 9 plus Other beyond, titles cut to the limits", () => {
    const three = buildHotelQuestion({ holdId: "h1", hotelNames: names(3) });
    assert.ok(three.kind === "interactive" && three.interactive.type === "button");
    const buttons = ((three as unknown as { interactive: { action: { buttons: Array<{ reply: { id: string; title: string } }> } } }).interactive.action.buttons);
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every((b) => Array.from(b.reply.title).length <= BUTTON_TITLE_MAX));
    assert.equal(buttons[2]?.reply.id, "h:h1:2");

    const rowsOf = (q: ReturnType<typeof buildHotelQuestion>) => (q as unknown as { interactive: { action: { sections: Array<{ rows: Array<{ id: string; title: string }> }> } } }).interactive.action.sections[0]?.rows ?? [];
    const ten = buildHotelQuestion({ holdId: "h1", hotelNames: names(10) });
    assert.ok(ten.kind === "interactive" && ten.interactive.type === "list");
    assert.equal(rowsOf(ten).length, 10);
    const twelve = buildHotelQuestion({ holdId: "h1", hotelNames: names(12) });
    const rows = rowsOf(twelve);
    assert.equal(rows.length, 10);
    assert.equal(rows[9]?.id, "h:h1:other");
    assert.ok(rows.every((r) => Array.from(r.title).length <= ROW_TITLE_MAX));
    assert.equal(twelve.kind === "interactive" && twelve.offered, 9);

    assert.equal(buildHotelQuestion({ holdId: "h1", hotelNames: [] }).kind, "text");
    assert.equal(Array.from(cutTitle("x".repeat(3000), BODY_MAX)).length, BODY_MAX);
    assert.deepEqual(parseButtonId("h:abc-1:3"), { kind: "choice", holdId: "abc-1", index: 3 });
    assert.equal(parseButtonId("h:abc:99x"), null);
  });
});

describe("random sequences (29.4)", () => {
  test("in strict mode nothing reaches a hotel unless reply context, a hotel code or an active selection applies", async () => {
    let seed = 20261104;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const LINE = "shared-1";
    const hotels = ["H0", "H1", "H2", "H3", "H4"];
    const states: WaLineHotel["state"][] = ["shared", "pending", "transition", "active", "shared"];
    const lineHotels = hotels.map((h, i) => lh(h, states[i], `code${i}`));
    const guests = ["919800000001", "919800000002", "919800000003"];
    const hashKey = randomBytes(32);
    const store = createMemoryRoutingStore({
      lineHotels: { [LINE]: lineHotels },
      guestHotels: Object.fromEntries(guests.map((g) => [g, hotels.filter(() => rnd(2) === 0).map((h) => gh(h, rnd(400), rnd(400)))])),
      index: Object.fromEntries(hotels.map((h, i) => [`${LINE}:wamid.${i}`, { hotelId: h }])),
    });
    const holds = createMemoryHoldStore();
    let delivered = 0;
    for (let step = 0; step < 600; step += 1) {
      const now = new Date(NOW.getTime() + step * 7 * 60_000);
      const guest = guests[rnd(guests.length)] as string;
      const kind = rnd(5);
      const replyIdx = rnd(hotels.length + 2); // beyond the list: an unknown message id
      const codeIdx = rnd(hotels.length);
      const text = kind === 1 ? `code${codeIdx}: hello` : kind === 2 ? `going to code${codeIdx} soon` : "hello";
      const replyToWamid = kind === 3 ? `wamid.${replyIdx}` : null;
      const buttonId = kind === 4 ? (rnd(2) === 0 ? chatButtonId(hotels[rnd(hotels.length)] as string) : choiceId("none", 0)) : null;
      const guestHash = hashNumber(hashKey, guest);
      const selBefore = await store.getSelection(LINE, guestHash);
      const out = await routeInbound({ store, holds, hashKey }, { line: { id: LINE, kind: "shared" }, mode: "strict", now, timeframeMinutes: 120, guestDigits: guest, text, buttonId, replyToWamid });
      const keep = selectionAfter(out, now, 120);
      if (keep) await store.saveSelection(LINE, guestHash, keep);
      if (out.kind !== "route") {
        assert.notEqual(out.kind, "platform");
        continue;
      }
      delivered += 1;
      const hotel = out.hotelId;
      const state = lineHotels.find((h) => h.hotelId === hotel)?.state;
      assert.notEqual(state, "active", "an active hotel is never delivered to");
      const byReply = replyToWamid !== null && store.index[`${LINE}:${replyToWamid}`]?.hotelId === hotel;
      const byCode = lineHotels.some((h) => h.hotelId === hotel && text.toLowerCase().startsWith(`${h.hotelCode}:`));
      const byChat = buttonId === chatButtonId(hotel);
      const bySelection = selBefore !== null && selBefore.hotelId === hotel && selBefore.expiresAt.getTime() > now.getTime();
      assert.ok(byReply || byCode || byChat || bySelection, `step ${step}: delivered to ${hotel} (${out.via}) with no rule behind it`);
    }
    assert.ok(delivered > 20, "the sequence exercised delivery");
  });
});
