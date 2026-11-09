// WhatsApp phase 1, tasks 3 and 4 (MJ, 4 Nov 2026; docs/plans/WHATSAPP-MASTER-PLAN.md parts 9 and 30): the settings and the sealing, the signature, Meta's payloads split into events, and the intake
// that saves them once. Recorded payload shapes follow Meta's documentation (marked "verify" in the plan until the test number has produced real ones).
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.intake.test.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import { AppError } from "@/server/errors";
import { deriveSealKey, digitsOf, hashNumber, whatsappConfig, whatsappConfigStatus, type WhatsAppConfig } from "@/server/whatsapp/config";
import { createWhatsAppIntake } from "@/server/whatsapp/intake";
import { createMemoryEventStore, createMemoryLineStore } from "@/server/whatsapp/memory";
import { MAX_EVENTS_PER_CALL, parseWebhook } from "@/server/whatsapp/payload";
import type { WaLine } from "@/server/whatsapp/ports";
import { openEvent, openHold, openPin, openToken, sealEvent, sealHold, sealPin, sealToken } from "@/server/whatsapp/seal";
import { signBody, signatureMatches } from "@/server/whatsapp/signature";

const HASH = randomBytes(32).toString("base64");
const ENV = { WHATSAPP_APP_SECRET: "app-secret-xyz", WHATSAPP_VERIFY_TOKEN: "verify-me-123", HMS_HASH_KEY: HASH };
const cfg = (): WhatsAppConfig => whatsappConfig(ENV) as WhatsAppConfig;

const LINE: WaLine = { id: "00000000-0000-4000-8000-0000000000a1", kind: "shared", phoneNumberId: "1055550001111", wabaId: "2055550002222", status: "test" };

const textMessage = (wamid: string, body: string, extra: Record<string, unknown> = {}) => ({ from: "919825041236", id: wamid, timestamp: "1762200000", type: "text", text: { body }, ...extra });
const call = (value: Record<string, unknown>, field = "messages") => ({ object: "whatsapp_business_account", entry: [{ id: LINE.wabaId, changes: [{ field, value }] }] });
const withMeta = (v: Record<string, unknown>) => ({ messaging_product: "whatsapp", metadata: { display_phone_number: "15550001111", phone_number_id: LINE.phoneNumberId }, ...v });
const inbound = (wamid: string, body = "Is breakfast included?") => call(withMeta({ contacts: [{ profile: { name: "Asha Patel" }, wa_id: "919825041236" }], messages: [textMessage(wamid, body)] }));
const statusCall = (wamid: string, status: string, errors?: unknown) => call(withMeta({ statuses: [{ id: wamid, status, timestamp: "1762200100", recipient_id: "919825041236", ...(errors ? { errors } : {}) }] }));

describe("the settings and sealing", () => {
  test("WhatsApp is off unless the app secret, the verify token and the hash key are all there; the status never shows a value", () => {
    assert.equal(whatsappConfig({}), null);
    assert.equal(whatsappConfig({ ...ENV, WHATSAPP_APP_SECRET: "" }), null);
    assert.equal(whatsappConfig({ ...ENV, WHATSAPP_VERIFY_TOKEN: undefined }), null);
    assert.equal(whatsappConfig({ ...ENV, HMS_HASH_KEY: "not base64 at all" }), null, "a bad hash key is off, not an error");
    assert.ok(whatsappConfig(ENV));
    const status = whatsappConfigStatus(ENV);
    assert.deepEqual(status, { appSecret: true, verifyToken: true, sealKey: true, graphVersion: "v22.0" });
    assert.ok(!JSON.stringify(status).includes("app-secret-xyz"));
    assert.deepEqual(whatsappConfigStatus({}), { appSecret: false, verifyToken: false, sealKey: false, graphVersion: "v22.0" });
  });

  test("the sealing key is derived from the hash key unless WHATSAPP_SEAL_KEY overrides it; the graph version comes from one place", () => {
    const derived = cfg().sealKey;
    assert.equal(derived.length, 32);
    assert.deepEqual(derived, deriveSealKey(Buffer.from(HASH, "base64")));
    const own = randomBytes(32).toString("base64");
    assert.deepEqual(whatsappConfig({ ...ENV, WHATSAPP_SEAL_KEY: own })?.sealKey, Buffer.from(own, "base64"));
    assert.equal(whatsappConfig({ ...ENV, WHATSAPP_SEAL_KEY: "short" }), null);
    assert.equal(whatsappConfig({ ...ENV, WHATSAPP_GRAPH_VERSION: "v23.0" })?.graphVersion, "v23.0");
    assert.equal(whatsappConfig({ ...ENV, WHATSAPP_GRAPH_VERSION: "latest; drop" })?.graphVersion, "v22.0");
  });

  test("a sealed value opens only for the thing it was sealed for, and never contains its text", () => {
    const key = cfg().sealKey;
    const token = sealToken(key, "EAAG-token-value", "1055550001111");
    assert.ok(!token.includes("EAAG"));
    assert.equal(openToken(key, token, "1055550001111"), "EAAG-token-value");
    assert.throws(() => openToken(key, token, "1055550009999"), /could not be opened/, "a token copied to another line does not open");
    assert.throws(() => openToken(randomBytes(32), token, "1055550001111"), /could not be opened/);
    assert.equal(openPin(key, sealPin(key, "123456", "1055550001111"), "1055550001111"), "123456");
    assert.throws(() => openPin(key, token, "1055550001111"), /could not be opened/, "a token is not a pin");
    const event = sealEvent(key, { text: "private words" }, LINE.id);
    assert.ok(!event.includes("private"));
    assert.deepEqual(openEvent(key, event, LINE.id), { text: "private words" });
    assert.throws(() => openEvent(key, event, "other-line"), /could not be opened/);
    assert.throws(() => openHold(key, event, LINE.id), /could not be opened/, "an event is not a hold");
    assert.deepEqual(openHold(key, sealHold(key, { n: 1 }, LINE.id), LINE.id), { n: 1 });
  });

  test("numbers: digits only with the country code kept; routing tables hold a keyed hash, different per key", () => {
    assert.equal(digitsOf("+91 98250-41236"), "919825041236");
    assert.equal(digitsOf("12345"), null);
    assert.equal(digitsOf("not a number"), null);
    const key = cfg().hashKey;
    assert.equal(hashNumber(key, "919825041236").length, 32);
    assert.deepEqual(hashNumber(key, "919825041236"), hashNumber(key, "919825041236"));
    assert.notDeepEqual(hashNumber(key, "919825041236"), hashNumber(key, "919825041237"));
    assert.notDeepEqual(hashNumber(key, "919825041236"), hashNumber(randomBytes(32), "919825041236"));
  });
});

describe("the signature", () => {
  test("only the HMAC of the exact raw body made with the app secret passes", () => {
    const body = JSON.stringify(inbound("wamid.AAA1"));
    const good = signBody("app-secret-xyz", body);
    assert.match(good, /^sha256=[0-9a-f]{64}$/);
    assert.ok(signatureMatches("app-secret-xyz", body, good));
    assert.ok(signatureMatches("app-secret-xyz", body, good.toUpperCase().replace("SHA256=", "sha256=")), "hex case does not matter");
    assert.ok(!signatureMatches("app-secret-xyz", body + " ", good), "one extra byte");
    assert.ok(!signatureMatches("other-secret", body, good));
    assert.ok(!signatureMatches("app-secret-xyz", body, null));
    assert.ok(!signatureMatches("app-secret-xyz", body, ""));
    assert.ok(!signatureMatches("app-secret-xyz", body, good.slice(7)), "no sha256= prefix");
    assert.ok(!signatureMatches("app-secret-xyz", body, "sha256=abcd"), "too short");
    assert.ok(!signatureMatches("app-secret-xyz", body, `sha1=${good.slice(7, 47)}`));
  });
});

describe("Meta's payloads become single events", () => {
  test("a text message, with the name from the contact block", () => {
    const parsed = parseWebhook(inbound("wamid.AAA1"));
    assert.equal(parsed.events.length, 1);
    const e = parsed.events[0];
    assert.equal(e.kind, "message");
    if (e.kind !== "message") return;
    assert.deepEqual([e.wamid, e.from, e.contactName, e.timestamp, e.phoneNumberId, e.wabaId], ["wamid.AAA1", "919825041236", "Asha Patel", 1762200000, LINE.phoneNumberId, LINE.wabaId]);
    assert.equal((e.message.text as { body: string }).body, "Is breakfast included?");
  });

  test("every message and status of one call is its own event; a swipe-reply keeps its context; interactive replies and reactions are kept whole", () => {
    const parsed = parseWebhook(
      call(
        withMeta({
          messages: [
            textMessage("wamid.M1", "one", { context: { id: "wamid.OUT1" } }),
            { from: "919825041236", id: "wamid.M2", timestamp: "1762200001", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "h:abc:1", title: "Hotel Pallav" } } },
            { from: "919825041236", id: "wamid.M3", timestamp: "1762200002", type: "reaction", reaction: { message_id: "wamid.OUT1", emoji: "👍" } },
            { from: "919825041236", id: "wamid.M4", timestamp: "1762200003", type: "image", image: { id: "media-1", mime_type: "image/jpeg", caption: "room" } },
          ],
          statuses: [
            { id: "wamid.OUT1", status: "delivered", timestamp: "1762200010", recipient_id: "919825041236" },
            { id: "wamid.OUT1", status: "read", timestamp: "1762200020", recipient_id: "919825041236" },
          ],
        }),
      ),
    );
    assert.deepEqual(parsed.events.map((e) => e.kind), ["message", "message", "message", "message", "status", "status"]);
    const first = parsed.events[0];
    assert.equal(first.kind === "message" && (first.message.context as { id: string }).id, "wamid.OUT1");
    assert.equal(parsed.skipped, 0);
  });

  test("a failed status keeps Meta's error code and title (not guest data) and nothing else of the error", () => {
    const parsed = parseWebhook(statusCall("wamid.OUT2", "failed", [{ code: 131047, title: "Re-engagement message", message: "private?", error_data: { details: "x" } }]));
    const e = parsed.events[0];
    assert.equal(e.kind, "status");
    if (e.kind === "status") assert.deepEqual([e.status, e.errors], ["failed", [{ code: "131047", title: "Re-engagement message" }]]);
  });

  test("template approval and account changes are kept as their own kinds; a status of a kind HMS does not handle is skipped and counted", () => {
    const tpl = parseWebhook({ object: "whatsapp_business_account", entry: [{ id: LINE.wabaId, changes: [{ field: "message_template_status_update", value: { event: "APPROVED", message_template_id: 1, message_template_name: "booking_confirmed", message_template_language: "en" } }] }] });
    assert.deepEqual([tpl.events[0].kind, tpl.events[0].phoneNumberId, tpl.events[0].wabaId], ["template", null, LINE.wabaId]);
    const acct = parseWebhook(call(withMeta({ event: "FLAGGED", current_limit: "TIER_1K" }), "phone_number_quality_update"));
    assert.equal(acct.events[0].kind, "other");
    const odd = parseWebhook(statusCall("wamid.OUT3", "deleted"));
    assert.deepEqual([odd.events.length, odd.skipped], [0, 1]);
  });

  test("malformed bodies give no events and never throw", () => {
    for (const bad of [null, undefined, 5, "text", [], {}, { object: "page" }, { object: "whatsapp_business_account" }, { object: "whatsapp_business_account", entry: "x" }, { object: "whatsapp_business_account", entry: [null, 1, { changes: "x" }] }]) {
      assert.deepEqual(parseWebhook(bad).events, []);
    }
    const parsed = parseWebhook(call(withMeta({ messages: [{ id: "x" }, { from: "9198", id: "bad id with spaces" }, null, textMessage("wamid.OK1", "ok")] })));
    assert.deepEqual([parsed.events.length, parsed.skipped], [1, 3]);
  });

  test("more than the per-call limit is cut and counted, never silently", () => {
    const many = Array.from({ length: MAX_EVENTS_PER_CALL + 25 }, (_, i) => textMessage(`wamid.BULK${i}`, "x"));
    const parsed = parseWebhook(call(withMeta({ messages: many })));
    assert.equal(parsed.events.length, MAX_EVENTS_PER_CALL);
    assert.equal(parsed.dropped, 25);
  });
});

describe("the intake: check, save once, answer", () => {
  const setup = (lines = [LINE]) => {
    const events = createMemoryEventStore();
    const lineStore = createMemoryLineStore(lines);
    const woken: string[][] = [];
    const clock = new Date("2026-11-04T10:00:00Z");
    const intake = createWhatsAppIntake({ config: () => whatsappConfig(ENV), lines: lineStore, events, now: () => clock, wake: (ids) => woken.push(ids) });
    const send = (body: unknown, secret = "app-secret-xyz") => {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      return intake.receive({ rawBody: raw, signature: signBody(secret, raw) });
    };
    return { intake, events, lineStore, woken, send, clock };
  };
  const refused = async (work: Promise<unknown>, code: string) => {
    await assert.rejects(work, (e: unknown) => e instanceof AppError && e.code === code);
  };

  test("the subscription check answers the challenge for the right token and refuses anything else", async () => {
    const { intake } = setup();
    assert.equal(intake.verifySubscription({ mode: "subscribe", token: "verify-me-123", challenge: "1158201444" }), "1158201444");
    for (const q of [
      { mode: "subscribe", token: "wrong", challenge: "1" },
      { mode: "subscribe", token: null, challenge: "1" },
      { mode: "unsubscribe", token: "verify-me-123", challenge: "1" },
      { mode: "subscribe", token: "verify-me-123", challenge: null },
      { mode: "subscribe", token: "verify-me-123", challenge: "" },
      { mode: "subscribe", token: "verify-me-123", challenge: "x".repeat(201) },
    ]) assert.throws(() => intake.verifySubscription(q), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
  });

  test("not set up: the webhook is a 404 for both calls", async () => {
    const intake = createWhatsAppIntake({ config: () => null, lines: createMemoryLineStore([LINE]), events: createMemoryEventStore() });
    assert.throws(() => intake.verifySubscription({ mode: "subscribe", token: "x", challenge: "1" }), (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
    await refused(intake.receive({ rawBody: "{}", signature: null }), "NOT_FOUND");
  });

  test("a valid call is saved once, sealed, the line's last event time moves, and the processor is woken with the new ids", async () => {
    const { events, lineStore, woken, send, clock } = setup();
    const out = await send(inbound("wamid.AAA1", "My secret request"));
    assert.deepEqual(out, { saved: 1, duplicates: 0, ignored: 0 });
    assert.equal(events.rows.length, 1);
    const row = events.rows[0];
    assert.deepEqual([row.kind, row.state, row.lineId, row.dedupeKey], ["message", "received", LINE.id, `m:${LINE.id}:wamid.AAA1`]);
    assert.ok(!(row.payloadSecret ?? "").includes("secret request"), "the guest's text is sealed in the saved event");
    assert.equal((openEvent(cfg().sealKey, row.payloadSecret as string, LINE.id) as { wamid: string }).wamid, "wamid.AAA1");
    assert.deepEqual(lineStore.lastEvent.get(LINE.id), clock);
    assert.deepEqual(woken, [[row.id]]);
  });

  test("the same delivery again (Meta retries) changes nothing; a new status of the same message is a new event", async () => {
    const { events, send, woken } = setup();
    await send(inbound("wamid.AAA1"));
    assert.deepEqual(await send(inbound("wamid.AAA1")), { saved: 0, duplicates: 1, ignored: 0 });
    assert.equal(events.rows.length, 1);
    assert.equal(woken.length, 1, "nothing new, nobody woken");
    await send(statusCall("wamid.OUT1", "delivered"));
    await send(statusCall("wamid.OUT1", "delivered"));
    await send(statusCall("wamid.OUT1", "read"));
    assert.deepEqual(events.rows.map((r) => r.dedupeKey.slice(0, 2)), ["m:", "s:", "s:"]);
  });

  test("a wrong, missing or old-body signature is refused before anything is read or saved", async () => {
    const { intake, events, lineStore } = setup();
    const raw = JSON.stringify(inbound("wamid.AAA1"));
    await refused(intake.receive({ rawBody: raw, signature: signBody("not-the-secret", raw) }), "FORBIDDEN");
    await refused(intake.receive({ rawBody: raw, signature: null }), "FORBIDDEN");
    await refused(intake.receive({ rawBody: raw + " ", signature: signBody("app-secret-xyz", raw) }), "FORBIDDEN");
    await refused(intake.receive({ rawBody: "not json", signature: "garbage" }), "FORBIDDEN", );
    assert.equal(events.rows.length, 0);
    assert.equal(lineStore.lastEvent.size, 0);
  });

  test("a signed body that is not JSON is a validation error; an oversized one is refused", async () => {
    const { intake } = setup();
    const raw = "this is not json";
    await refused(intake.receive({ rawBody: raw, signature: signBody("app-secret-xyz", raw) }), "VALIDATION_FAILED");
    const big = "x".repeat(1024 * 1024 + 1);
    await refused(intake.receive({ rawBody: big, signature: signBody("app-secret-xyz", big) }), "VALIDATION_FAILED");
  });

  test("a number HMS does not know, and a banned line, are dropped and counted; other items of the same call are still saved", async () => {
    const banned = { ...LINE, id: "00000000-0000-4000-8000-0000000000b2", phoneNumberId: "1055550003333", status: "banned" as const };
    const { events, send } = setup([LINE, banned]);
    const mixed = {
      object: "whatsapp_business_account",
      entry: [
        { id: LINE.wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "9999999999" }, messages: [textMessage("wamid.UNK1", "who?")] } }] },
        { id: LINE.wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: banned.phoneNumberId }, messages: [textMessage("wamid.BAN1", "banned?")] } }] },
        { id: LINE.wabaId, changes: [{ field: "messages", value: withMeta({ messages: [textMessage("wamid.OK1", "hello")] }) }] },
      ],
    };
    assert.deepEqual(await send(mixed), { saved: 1, duplicates: 0, ignored: 2 });
    assert.deepEqual(events.rows.map((r) => r.dedupeKey), [`m:${LINE.id}:wamid.OK1`]);
  });

  test("a template approval names no number: it is saved on a line of that business account", async () => {
    const { events, send } = setup();
    const out = await send({ object: "whatsapp_business_account", entry: [{ id: LINE.wabaId, changes: [{ field: "message_template_status_update", value: { event: "REJECTED", message_template_name: "welcome", reason: "INVALID_FORMAT" } }] }] });
    assert.deepEqual(out, { saved: 1, duplicates: 0, ignored: 0 });
    assert.deepEqual([events.rows[0].kind, events.rows[0].lineId], ["template", LINE.id]);
    assert.equal((await send({ object: "whatsapp_business_account", entry: [{ id: "7777777777", changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }] }] })).ignored, 1, "a business account HMS does not know is dropped");
  });

  test("the processor's wake-up failing never fails the answer to Meta", async () => {
    const events = createMemoryEventStore();
    const intake = createWhatsAppIntake({
      config: () => whatsappConfig(ENV),
      lines: createMemoryLineStore([LINE]),
      events,
      wake: () => {
        throw new Error("boom");
      },
    });
    const raw = JSON.stringify(inbound("wamid.AAA1"));
    assert.deepEqual(await intake.receive({ rawBody: raw, signature: signBody("app-secret-xyz", raw) }), { saved: 1, duplicates: 0, ignored: 0 });
  });
});

describe("the saved events: claim, lease, retry, park, purge", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  const later = (s: number) => new Date(now.getTime() + s * 1000);
  const fresh = async () => {
    const store = createMemoryEventStore();
    const { saved } = await store.save([
      { lineId: LINE.id, kind: "message", dedupeKey: "m:1", payloadSecret: "v1.a.b.c", receivedAt: now },
      { lineId: LINE.id, kind: "message", dedupeKey: "m:2", payloadSecret: "v1.a.b.c", receivedAt: later(1) },
    ]);
    return { store, ids: saved };
  };

  test("two workers never get the same event; a held event comes back only after its lease ends", async () => {
    const { store } = await fresh();
    const a = await store.claim(later(5), 1, 60);
    const b = await store.claim(later(5), 5, 60);
    assert.deepEqual([a.length, b.length], [1, 1]);
    assert.notEqual(a[0].id, b[0].id);
    assert.deepEqual((await store.claim(later(30), 5, 60)).length, 0, "both are leased");
    const again = await store.claim(later(70), 5, 60);
    assert.equal(again.length, 2, "a crashed worker's events are found again");
    assert.deepEqual(again.map((e) => e.attempts), [2, 2]);
  });

  test("done clears the payload; a failure retries at its time and a null time is dead; parking is not a failed attempt", async () => {
    const { store, ids } = await fresh();
    const [one] = await store.claim(later(5), 1, 60);
    await store.complete(one.id, later(6));
    assert.equal(store.rows.find((r) => r.id === one.id)?.payloadSecret, null);
    const [two] = await store.claim(later(7), 1, 60);
    await store.fail(two.id, "ROUTE_FAILED", later(60), later(8));
    assert.equal((await store.claim(later(30), 5, 60)).length, 0, "not yet");
    const retried = await store.claim(later(61), 5, 60);
    assert.deepEqual([retried.length, retried[0].attempts], [1, 2]);
    await store.fail(retried[0].id, "ROUTE_FAILED", null, later(62));
    assert.equal(store.rows.find((r) => r.id === ids[1])?.state, "dead");
    assert.ok(store.rows.find((r) => r.id === ids[1])?.payloadSecret, "a dead event keeps its payload for the replay tool");
    const { store: s2 } = await fresh();
    const [p] = await s2.claim(later(5), 1, 60);
    await s2.park(p.id, later(20), later(6));
    assert.equal(s2.rows.find((r) => r.id === p.id)?.attempts, 0);
    assert.equal((await s2.claim(later(10), 5, 60)).filter((e) => e.id === p.id).length, 0);
    assert.equal((await s2.claim(later(25), 5, 60)).filter((e) => e.id === p.id).length, 1);
  });

  test("claimOne takes one due event by id, and not one that someone holds", async () => {
    const { store, ids } = await fresh();
    assert.ok(await store.claimOne(ids[0], later(5), 60));
    assert.equal(await store.claimOne(ids[0], later(6), 60), null);
    assert.equal(await store.claimOne("no-such-id", later(6), 60), null);
  });

  test("purge removes finished events after a day and failed ones after seven", async () => {
    const { store } = await fresh();
    const [a, b] = await store.claim(later(5), 2, 60);
    await store.complete(a.id, later(6));
    await store.fail(b.id, "X", null, later(7));
    assert.deepEqual(await store.purge(later(3600)), { done: 0, failed: 0 });
    assert.deepEqual(await store.purge(later(86_400 + 100)), { done: 1, failed: 0 });
    assert.deepEqual(await store.purge(later(8 * 86_400)), { done: 0, failed: 1 });
    assert.equal(store.rows.length, 0);
  });
});
