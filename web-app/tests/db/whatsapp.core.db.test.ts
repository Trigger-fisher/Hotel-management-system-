// WhatsApp phase 1, tasks 1 and 2 (platform 0180, hotel 0057; docs/plans/WHATSAPP-MASTER-PLAN.md part 8) on the REAL PostgreSQL, throwaway hms_test only: the table rules (unique numbers, one platform
// line, one current own line per hotel with history kept, one open hold per guest, a saved event once), the hotel tables being each hotel's own, and the PostgreSQL stores the intake stands on
// (claim hands an event to one worker only). Run with: npm run test:db
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgWhatsAppEventStore, createPgWhatsAppLineStore } from "../../src/server/repos/postgres/whatsapp";
import { whatsappConfig } from "../../src/server/whatsapp/config";
import { createWhatsAppIntake } from "../../src/server/whatsapp/intake";
import { sealEvent, sealToken } from "../../src/server/whatsapp/seal";
import { signBody } from "../../src/server/whatsapp/signature";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotelA: CreatedHotel;
let hotelB: CreatedHotel;

const ENV = { WHATSAPP_APP_SECRET: "db-app-secret", WHATSAPP_VERIFY_TOKEN: "db-verify", HMS_HASH_KEY: randomBytes(32).toString("base64") };
const cfg = () => whatsappConfig(ENV)!;
const SHARED = "1055550001111";
const OWN_A = "1055550002222";
const OWN_A2 = "1055550003333";
const PLATFORM = "1055550004444";
const WABA = "2055550009999";
const tokenOf = (phoneNumberId: string): string => sealToken(cfg().sealKey, "EAAG-test", phoneNumberId);
// a line cannot be removed while a hotel is attached (the rule the Connect screen relies on), so the hotel rows go first
const clearWhatsApp = async (): Promise<void> => {
  for (const table of ["whatsapp_suppressions", "whatsapp_line_hotels", "whatsapp_lines"]) await owner.query(`DELETE FROM platform.${table}`);
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await clearWhatsApp();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotelA = await createTestHotel(owner, "WhatsApp Hotel A");
  hotelB = await createTestHotel(owner, "WhatsApp Hotel B");
});
after(async () => {
  await database?.close();
  if (owner) {
    await clearWhatsApp().catch(() => undefined);
    await removeAllTestHotels(owner).catch(() => undefined);
  }
  await owner?.end();
  await release?.();
});

const addLine = async (kind: string, phoneNumberId: string, extra: { status?: string; token?: string } = {}): Promise<string> =>
  String((await owner.query("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret) VALUES ($1, $2, $3, $4, $5) RETURNING id", [kind, phoneNumberId, WABA, extra.status ?? "test", extra.token ?? tokenOf(phoneNumberId)])).rows[0].id);
const q = (text: string, params: unknown[] = []) => owner.query(text, params);

describe("the hotel tables (0057) are each hotel's own", () => {
  test("opt-outs, usage and templates sit in the hotel's schema; a number is opted out once; one hotel never sees another's", async () => {
    const line = "00000000-0000-4000-8000-0000000000c1";
    await q(`INSERT INTO "${hotelA.schema}".wa_optouts (phone_digits, line_id) VALUES ('919825041236', $1)`, [line]);
    assert.equal((await q(`SELECT 1 FROM "${hotelA.schema}".wa_optouts`)).rows.length, 1);
    assert.equal((await q(`SELECT 1 FROM "${hotelB.schema}".wa_optouts`)).rows.length, 0, "hotel B has its own, empty table");
    assert.equal(await sqlStateOf(q(`INSERT INTO "${hotelA.schema}".wa_optouts (phone_digits) VALUES ('919825041236')`)), "23505");
    await q(`INSERT INTO "${hotelB.schema}".wa_optouts (phone_digits) VALUES ('919825041236')`);
    assert.equal(await sqlStateOf(q(`INSERT INTO "${hotelA.schema}".wa_optouts (phone_digits) VALUES ('12ab')`)), "23514", "digits only, 8 to 15");
    await q(`INSERT INTO "${hotelA.schema}".wa_usage (day, line_id, category, sent, started) VALUES ('2026-11-04', $1, 'utility', 3, 3)`, [line]);
    assert.equal(await sqlStateOf(q(`INSERT INTO "${hotelA.schema}".wa_usage (day, line_id, category) VALUES ('2026-11-04', $1, 'utility')`, [line])), "23505", "one counter per day, line and category");
    assert.equal(await sqlStateOf(q(`INSERT INTO "${hotelA.schema}".wa_usage (day, line_id, category) VALUES ('2026-11-05', $1, 'gossip')`, [line])), "23514");
    await q(`INSERT INTO "${hotelA.schema}".wa_templates (name, language, category, body) VALUES ('booking_confirmed', 'en', 'utility', 'Hello {{1}}')`);
    assert.equal(await sqlStateOf(q(`INSERT INTO "${hotelA.schema}".wa_templates (name, language, category, body) VALUES ('booking_confirmed', 'en', 'utility', 'Again')`)), "23505", "one template per name, language and line");
    assert.equal(await sqlStateOf(q(`INSERT INTO "${hotelA.schema}".wa_templates (name, language, category, body, status) VALUES ('x', 'en', 'utility', 'b', 'maybe')`)), "23514");
    assert.equal(await sqlStateOf(q(`INSERT INTO "${hotelA.schema}".wa_templates (name, language, category, body) VALUES ('Bad Name', 'en', 'utility', 'b')`)), "23514");
  });

  test("conv_messages carries the line, and the guest record carries the consent", async () => {
    const cols = (await q("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND ((table_name = 'conv_messages' AND column_name = 'line_id') OR (table_name = 'customers' AND column_name IN ('wa_consent_at', 'wa_consent_by')))", [hotelB.schema])).rows.map((r) => `${r.table_name}.${r.column_name}`).sort();
    assert.deepEqual(cols, ["conv_messages.line_id", "customers.wa_consent_at", "customers.wa_consent_by"]);
  });
});

describe("the platform tables (0180)", () => {
  let shared = "";
  let ownA = "";

  test("a number (Meta's id) belongs to one line; there is one platform line; a person line needs its owner; a token must be sealed text", async () => {
    shared = await addLine("shared", SHARED);
    assert.equal(await sqlStateOf(addLine("shared", SHARED)), "23505", "the same phone number id twice");
    await addLine("platform", PLATFORM);
    assert.equal(await sqlStateOf(addLine("platform", "1055550005555")), "23505", "a second platform line");
    assert.equal(await sqlStateOf(addLine("person", "1055550006666")), "23514", "a person line without an owner");
    assert.equal(await sqlStateOf(addLine("shared", "1055550007777", { token: "EAAG-in-the-clear" })), "23514", "a token that is not sealed");
    assert.equal(await sqlStateOf(addLine("shared", "abc")), "23514", "not a Meta id");
    assert.equal(await sqlStateOf(addLine("hotline", "1055550008888")), "23514");
    assert.equal(await sqlStateOf(addLine("shared", "1055550008888", { status: "on" })), "23514");
    const row = (await q("SELECT status, quality, webhook_subscribed, subscribed_fields, token_failures, managed FROM platform.whatsapp_lines WHERE id = $1", [shared])).rows[0];
    assert.deepEqual([row.status, row.quality, row.webhook_subscribed, row.subscribed_fields, row.token_failures, row.managed], ["test", "unknown", false, [], 0, false]);
  });

  test("a hotel's use of a line keeps its history: one current row per line, one current own line per hotel, closing a row frees the place", async () => {
    ownA = await addLine("hotel", OWN_A);
    const own2 = await addLine("hotel", OWN_A2);
    const use = (line: string, hotel: CreatedHotel, extra = "") => q(`INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1, $2${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id, own`, [line, hotel.id]);
    const onShared = (await use(shared, hotelA)).rows[0];
    assert.equal(onShared.own, false, "the shared line is not the hotel's own (set by the database from the line's kind)");
    assert.equal(await sqlStateOf(use(shared, hotelA)), "23505", "one current row per (line, hotel)");
    const first = (await use(ownA, hotelA)).rows[0];
    assert.equal(first.own, true);
    assert.equal(await sqlStateOf(use(own2, hotelA)), "23505", "a hotel has at most one current own line");
    // a hotel may be on the shared line and its own at once (the move: pending, then transition)
    assert.equal((await q("SELECT 1 FROM platform.whatsapp_line_hotels WHERE hotel_id = $1 AND valid_to IS NULL", [hotelA.id])).rows.length, 2);
    // closing keeps the row (history) and frees the place
    await q("UPDATE platform.whatsapp_line_hotels SET valid_to = now() WHERE id = $1", [first.id]);
    await use(own2, hotelA);
    assert.equal((await q("SELECT 1 FROM platform.whatsapp_line_hotels WHERE hotel_id = $1", [hotelA.id])).rows.length, 3, "history is kept");
    await use(shared, hotelB);
    assert.equal(await sqlStateOf(q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id) VALUES ($1, $2)", ["00000000-0000-4000-8000-0000000000ff", hotelB.id])), "23503", "a line that does not exist");
  });

  test("a hotel code is unique among current rows; the move states and windows are checked", async () => {
    await q("UPDATE platform.whatsapp_line_hotels SET hotel_code = 'pallav' WHERE hotel_id = $1 AND line_id = $2", [hotelA.id, shared]);
    assert.equal(await sqlStateOf(q("UPDATE platform.whatsapp_line_hotels SET hotel_code = 'pallav' WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared])), "23505");
    assert.equal(await sqlStateOf(q("UPDATE platform.whatsapp_line_hotels SET hotel_code = 'No Spaces' WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared])), "23514");
    assert.equal(await sqlStateOf(q("UPDATE platform.whatsapp_line_hotels SET state = 'limbo' WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared])), "23514");
    assert.equal(await sqlStateOf(q("UPDATE platform.whatsapp_line_hotels SET transition_ends_at = now() WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared])), "23514", "an end date only while in transition");
    await q("UPDATE platform.whatsapp_line_hotels SET state = 'transition', transition_ends_at = now() + interval '30 days', redirect_phone = '919825041236' WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared]);
    assert.equal(await sqlStateOf(q("UPDATE platform.whatsapp_line_hotels SET valid_to = valid_from - interval '1 day' WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared])), "23514");
    assert.equal(await sqlStateOf(q("UPDATE platform.whatsapp_line_hotels SET redirect_phone = '+91 98' WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared])), "23514");
    assert.equal(await sqlStateOf(q("UPDATE platform.whatsapp_line_hotels SET daily_cap = -1 WHERE hotel_id = $1 AND line_id = $2", [hotelB.id, shared])), "23514");
  });

  test("one open hold per guest per line (the guest is not asked twice); a hold goes with its line; a hash must be 32 bytes", async () => {
    const hash = randomBytes(32);
    const sealed = sealEvent(cfg().sealKey, { text: "which hotel?" }, shared);
    const hold = () => q("INSERT INTO platform.whatsapp_holds (line_id, guest_hash, payload_secret, candidate_hotels, expires_at) VALUES ($1, $2, $3, $4, now() + interval '10 minutes')", [shared, hash, sealed, [hotelA.id, hotelB.id]]);
    await hold();
    assert.equal(await sqlStateOf(hold()), "23505");
    assert.equal(await sqlStateOf(q("INSERT INTO platform.whatsapp_holds (line_id, guest_hash, payload_secret, expires_at) VALUES ($1, $2, $3, now())", [shared, randomBytes(8), sealed])), "23514");
    assert.equal(await sqlStateOf(q("INSERT INTO platform.whatsapp_holds (line_id, guest_hash, payload_secret, expires_at) VALUES ($1, $2, 'plain text', now())", [shared, randomBytes(32)])), "23514", "the message must be sealed");
  });

  test("the message index finds a message's line and hotel once; suppressions hold a number once per hotel and once for the platform", async () => {
    await q("INSERT INTO platform.whatsapp_message_index (line_id, wamid, hotel_id, direction) VALUES ($1, 'wamid.IDX1', $2, 'out')", [shared, hotelA.id]);
    assert.equal(await sqlStateOf(q("INSERT INTO platform.whatsapp_message_index (line_id, wamid, hotel_id, direction) VALUES ($1, 'wamid.IDX1', $2, 'in')", [shared, hotelB.id])), "23505");
    const hash = randomBytes(32);
    const suppress = (hotel: string | null) => q("INSERT INTO platform.whatsapp_suppressions (number_hash, hotel_id, reason) VALUES ($1, $2, 'stop')", [hash, hotel]);
    await suppress(hotelA.id);
    await suppress(hotelB.id);
    assert.equal(await sqlStateOf(suppress(hotelA.id)), "23505");
    await suppress(null);
    assert.equal(await sqlStateOf(suppress(null)), "23505", "one platform-wide row per number");
    assert.equal(await sqlStateOf(q("INSERT INTO platform.whatsapp_suppressions (number_hash, reason) VALUES ($1, 'because')", [randomBytes(32)])), "23514");
  });

  test("the settings are seeded with WhatsApp OFF and the switch profiles of the plan", async () => {
    const rows = Object.fromEntries((await q("SELECT key, value FROM platform.platform_settings WHERE key LIKE 'whatsapp.%'")).rows.map((r) => [String(r.key), r.value]));
    assert.equal(rows["whatsapp.enabled"], false);
    assert.equal(rows["whatsapp.routing_timeframe_minutes"], 120);
    assert.equal(rows["whatsapp.default_daily_cap"], 50);
    assert.equal(rows["whatsapp.hold_minutes"], 10);
    assert.equal(rows["whatsapp.routing_mode"], "strict");
    assert.equal((rows["whatsapp.rules.shared"] as Record<string, unknown>).hotel_may_start_chats, false);
    assert.equal((rows["whatsapp.rules.platform"] as Record<string, unknown>).hotel_may_start_chats, true);
    assert.equal((rows["whatsapp.rules.own_default"] as Record<string, unknown>).automatic_messages_one_way, false);
  });
});

describe("the PostgreSQL stores, as the app's own login", () => {
  const T0 = new Date("2026-11-04T10:00:00Z");
  const later = (s: number) => new Date(T0.getTime() + s * 1000);

  test("the intake saves a signed call once through the real stores and moves the line's last event time", async () => {
    const lines = createPgWhatsAppLineStore(database.pool);
    const events = createPgWhatsAppEventStore(database.pool);
    const intake = createWhatsAppIntake({ config: () => whatsappConfig(ENV), lines, events, now: () => T0 });
    const body = { object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: SHARED }, messages: [{ from: "919825041236", id: "wamid.DB1", timestamp: "1762200000", type: "text", text: { body: "Hello" } }] } }] }] };
    const raw = JSON.stringify(body);
    assert.deepEqual(await intake.receive({ rawBody: raw, signature: signBody("db-app-secret", raw) }), { saved: 1, duplicates: 0, ignored: 0 });
    assert.deepEqual(await intake.receive({ rawBody: raw, signature: signBody("db-app-secret", raw) }), { saved: 0, duplicates: 1, ignored: 0 });
    const row = (await q("SELECT e.state, e.kind, e.attempts, l.last_event_at FROM platform.whatsapp_events e JOIN platform.whatsapp_lines l ON l.id = e.line_id WHERE e.dedupe_key LIKE 'm:%:wamid.DB1'")).rows[0];
    assert.deepEqual([row.state, row.kind, row.attempts], ["received", "message", 0]);
    assert.equal((row.last_event_at as Date).toISOString(), T0.toISOString());
    assert.ok(!JSON.stringify((await q("SELECT payload_secret FROM platform.whatsapp_events WHERE dedupe_key LIKE '%wamid.DB1'")).rows).includes("Hello"), "the guest's text is sealed in the table");
    assert.equal((await lines.findByPhoneNumberId("9999999999")), null);
    assert.equal((await lines.findByWabaId(WABA))?.phoneNumberId !== undefined, true);
  });

  test("claim gives each event to one worker only, even when two ask at the same moment; a lease that ran out is taken again", async () => {
    const events = createPgWhatsAppEventStore(database.pool);
    const line = String((await q("SELECT id FROM platform.whatsapp_lines WHERE phone_number_id = $1", [SHARED])).rows[0].id);
    await q("DELETE FROM platform.whatsapp_events");
    const mk = (k: string, at: Date) => ({ lineId: line, kind: "message" as const, dedupeKey: `m:${line}:${k}`, payloadSecret: sealEvent(cfg().sealKey, { k }, line), receivedAt: at });
    const { saved } = await events.save([mk("c1", T0), mk("c2", later(1)), mk("c3", later(2))]);
    assert.equal(saved.length, 3);
    const [a, b] = await Promise.all([events.claim(later(10), 2, 60), events.claim(later(10), 2, 60)]);
    const ids = [...a, ...b].map((e) => e.id);
    assert.equal(ids.length, 3, "three events, handed out once each");
    assert.equal(new Set(ids).size, 3);
    assert.ok([...a, ...b].every((e) => e.state === "processing" && e.attempts === 1));
    assert.equal((await events.claim(later(30), 5, 60)).length, 0, "all leased");
    const again = await events.claim(later(80), 5, 60);
    assert.equal(again.length, 3, "a crashed worker's events are found again");
    assert.deepEqual(again.map((e) => e.attempts), [2, 2, 2]);
    assert.deepEqual(again.map((e) => e.dedupeKey.split(":").pop()), ["c1", "c2", "c3"], "oldest first");
  });

  test("done clears the payload, a failure retries later and a null time is dead, parking is not a failed attempt, and purge removes by age", async () => {
    const events = createPgWhatsAppEventStore(database.pool);
    await q("DELETE FROM platform.whatsapp_events");
    const line = String((await q("SELECT id FROM platform.whatsapp_lines WHERE phone_number_id = $1", [SHARED])).rows[0].id);
    const mk = (k: string) => ({ lineId: line, kind: "status" as const, dedupeKey: `s:${line}:${k}:sent`, payloadSecret: sealEvent(cfg().sealKey, { k }, line), receivedAt: T0 });
    await events.save([mk("d1"), mk("d2"), mk("d3")]);
    const [d1, d2, d3] = await events.claim(later(1), 3, 60);
    await events.complete(d1.id, later(2));
    await events.fail(d2.id, "ROUTE_FAILED", later(60), later(3));
    await events.park(d3.id, later(120), later(3));
    const state = async (id: string) => (await q("SELECT state, attempts, payload_secret FROM platform.whatsapp_events WHERE id = $1", [id])).rows[0];
    assert.deepEqual([(await state(d1.id)).state, (await state(d1.id)).payload_secret], ["done", null]);
    assert.deepEqual([(await state(d2.id)).state, (await state(d2.id)).attempts], ["failed", 1]);
    assert.deepEqual([(await state(d3.id)).state, (await state(d3.id)).attempts], ["parked", 0], "parking does not count as an attempt");
    assert.deepEqual((await events.claim(later(30), 5, 60)).length, 0, "nothing due yet");
    const [retry] = await events.claim(later(61), 5, 60);
    assert.deepEqual([retry.id, retry.attempts], [d2.id, 2]);
    await events.fail(retry.id, "ROUTE_FAILED", null, later(62));
    assert.equal((await state(d2.id)).state, "dead");
    assert.ok((await state(d2.id)).payload_secret, "a dead event keeps its payload for the replay tool");
    assert.deepEqual(await events.purge(later(3600)), { done: 0, failed: 0 });
    assert.deepEqual(await events.purge(later(86_400 + 100)), { done: 1, failed: 0 });
    assert.deepEqual(await events.purge(new Date(T0.getTime() + 8 * 86_400_000)), { done: 0, failed: 1 });
  });

  test("a done event cannot be stored with a payload missing unless it is done or dead", async () => {
    const line = String((await q("SELECT id FROM platform.whatsapp_lines WHERE phone_number_id = $1", [SHARED])).rows[0].id);
    assert.equal(await sqlStateOf(q("INSERT INTO platform.whatsapp_events (line_id, kind, dedupe_key, payload_secret, state) VALUES ($1, 'message', 'm:nopayload', NULL, 'received')", [line])), "23514");
    assert.equal(await sqlStateOf(q("INSERT INTO platform.whatsapp_events (line_id, kind, dedupe_key, payload_secret, state) VALUES ($1, 'message', 'm:badstate', 'v1.a.b.c', 'lost')", [line])), "23514");
  });
});
