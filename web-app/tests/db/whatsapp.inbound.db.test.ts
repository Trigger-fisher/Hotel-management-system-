// WhatsApp phase 1, task 7 (docs/plans/WHATSAPP-MASTER-PLAN.md part 9) on the REAL PostgreSQL, throwaway hms_test only: an inbound message lands in the right hotel only (an own line), a shared-line
// message that cannot be placed is held and the guest is asked once, an answer delivers it, a repeat changes nothing, STOP is recorded. Run with: npm run test:db
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgWhatsAppInbox } from "../../src/server/repos/postgres/whatsappInbox";
import { createPgWhatsAppHoldStore, createPgWhatsAppRoutingStore } from "../../src/server/repos/postgres/whatsappRouting";
import { whatsappConfig } from "../../src/server/whatsapp/config";
import { createInboundHandler, type WaInboundNotifier } from "../../src/server/whatsapp/inbound";
import type { MessageEvent } from "../../src/server/whatsapp/processor";
import type { WaLine } from "../../src/server/whatsapp/ports";
import { sealToken } from "../../src/server/whatsapp/seal";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

process.env.HMS_HASH_KEY = randomBytes(32).toString("base64");
process.env.WHATSAPP_APP_SECRET = "inbound-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "inbound-verify";
const cfg = whatsappConfig()!;

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotelA: CreatedHotel;
let hotelB: CreatedHotel;
let ownLine: WaLine;
let sharedLine: WaLine;
const GUEST = "919825041236";
const T0 = new Date("2026-11-04T10:00:00Z");

const told: { to: string; body: string }[] = [];
const asked: { to: string; kind: string; names: string[] }[] = [];
const notifier: WaInboundNotifier = {
  askHotel: async (_line, to, q) => (asked.push({ to, kind: q.kind, names: [] }), { wamid: "wamid.QUESTION1" }),
  tell: async (_line, to, body) => void told.push({ to, body }),
  hotelNames: async (ids) => ids.map((id) => (id === hotelA.id ? "Hotel A" : "Hotel B")),
};
const handler = () => {
  const routing = createPgWhatsAppRoutingStore(database.pool);
  return createInboundHandler({
    routing,
    holds: createPgWhatsAppHoldStore(database.pool),
    inbox: createPgWhatsAppInbox({ pool: database.pool, withHotel: database.withHotel }),
    notifier,
    hashKey: () => cfg.hashKey,
    sealKey: () => cfg.sealKey,
    settings: async () => ({ mode: "strict", timeframeMinutes: 120, holdMinutes: 10 }),
  });
};

const message = (wamid: string, message: Record<string, unknown>, from = GUEST): MessageEvent => ({ kind: "message", phoneNumberId: "x", wabaId: "y", wamid, from, timestamp: Math.floor(T0.getTime() / 1000), contactName: "Asha Patel", message: { id: wamid, ...message } });
const text = (wamid: string, body: string) => message(wamid, { type: "text", text: { body } });
const run = (line: WaLine, event: MessageEvent) => handler().message({ event, line, row: {} as never, now: T0 });
const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
const count = async (hotel: CreatedHotel, extra = "") => Number((await q(`SELECT count(*)::int AS n FROM "${hotel.schema}".conv_messages WHERE channel = 'whatsapp' ${extra}`)).rows[0].n);

const addLine = async (kind: string, phoneNumberId: string): Promise<WaLine> => {
  const id = String((await q("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret) VALUES ($1, $2, '2055550009999', 'test', $3) RETURNING id", [kind, phoneNumberId, sealToken(cfg.sealKey, "tok", phoneNumberId)])).rows[0].id);
  return { id, kind: kind as WaLine["kind"], phoneNumberId, wabaId: "2055550009999", status: "test" };
};
const clear = async (): Promise<void> => {
  for (const t of ["whatsapp_selections", "whatsapp_holds", "whatsapp_message_index", "whatsapp_suppressions", "whatsapp_line_hotels", "whatsapp_lines"]) await owner.query(`DELETE FROM platform.${t}`);
  await owner.query("DELETE FROM platform.guest_hotels");
  await owner.query("DELETE FROM platform.guests WHERE mobile = '+919825041236'");
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await clear();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  hotelA = await createTestHotel(owner, "Inbound Hotel A");
  hotelB = await createTestHotel(owner, "Inbound Hotel B");
  ownLine = await addLine("hotel", "1055550011111");
  sharedLine = await addLine("shared", "1055550022222");
  // a hotel that has just connected its own number is "pending": its guests on the shared number are still asked and delivered as before
  await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id, state) VALUES ($1, $2, 'pending')", [ownLine.id, hotelA.id]);
  for (const h of [hotelA, hotelB]) await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id) VALUES ($1, $2)", [sharedLine.id, h.id]);
  const guest = String((await q("INSERT INTO platform.guests (display_name, mobile) VALUES ('Asha Patel', '+919825041236') RETURNING id")).rows[0].id);
  for (const h of [hotelA, hotelB]) await q("INSERT INTO platform.guest_hotels (hotel_id, customer_id, guest_id) VALUES ($1, $2, $3)", [h.id, randomUUID(), guest]);
});
after(async () => {
  await database?.close();
  if (owner) {
    await clear().catch(() => undefined);
    await removeAllTestHotels(owner).catch(() => undefined);
  }
  await owner?.end();
  await release?.();
});

describe("a message on a hotel's own number", () => {
  test("lands in that hotel only, with its line, its 24-hour window and one unread; a repeat changes nothing", async () => {
    assert.deepEqual(await run(ownLine, text("wamid.OWN1", "Is breakfast included?")), { kind: "done" });
    assert.equal(await count(hotelA), 1);
    assert.equal(await count(hotelB), 0, "the other hotel has nothing");
    const row = (await q(`SELECT m.wa_text, m.status, m.direction, m.line_id, c.unread_count, c.wa_window_closes_at FROM "${hotelA.schema}".conv_messages m JOIN "${hotelA.schema}".conv_conversations c ON c.id = m.conversation_id`)).rows[0];
    assert.deepEqual([row.wa_text, row.status, row.direction, row.line_id, row.unread_count], ["Is breakfast included?", "received", "in", ownLine.id, 1]);
    assert.equal((row.wa_window_closes_at as Date).toISOString(), new Date(T0.getTime() + 86_400_000).toISOString());
    await run(ownLine, text("wamid.OWN1", "Is breakfast included?"));
    assert.equal(await count(hotelA), 1, "the same message again is not stored twice");
    assert.equal(Number((await q(`SELECT unread_count FROM "${hotelA.schema}".conv_conversations`)).rows[0].unread_count), 1);
    assert.equal((await q("SELECT 1 FROM platform.whatsapp_message_index WHERE line_id = $1 AND wamid = 'wamid.OWN1' AND hotel_id = $2", [ownLine.id, hotelA.id])).rows.length, 1, "the message index knows its hotel");
    const usage = (await q(`SELECT received FROM "${hotelA.schema}".wa_usage WHERE line_id = $1`, [ownLine.id])).rows[0];
    assert.equal(usage.received, 1, "counted once");
  });

  test("STOP is recorded for that hotel and answered once; START takes it away; a reaction never makes a thread", async () => {
    told.length = 0;
    await run(ownLine, text("wamid.OWN2", "STOP"));
    assert.equal((await q(`SELECT 1 FROM "${hotelA.schema}".wa_optouts WHERE phone_digits = $1`, [GUEST])).rows.length, 1);
    assert.equal(told.length, 1);
    await run(ownLine, text("wamid.OWN3", "start"));
    assert.equal((await q(`SELECT 1 FROM "${hotelA.schema}".wa_optouts`)).rows.length, 0);
    const before = await count(hotelA);
    await run(ownLine, message("wamid.OWN4", { type: "reaction", reaction: { message_id: "wamid.OWN1", emoji: "👍" } }));
    assert.equal(await count(hotelA), before, "no new message");
    assert.deepEqual((await q(`SELECT wa_reactions FROM "${hotelA.schema}".conv_messages WHERE external_id = 'wamid.OWN1'`)).rows[0].wa_reactions, [{ emoji: "👍", fromContact: true }]);
  });

  test("what HMS says by itself is in the Super Admin's default language when the guest's words do not tell theirs (a keyword says nothing), and the STOP is still recorded", async () => {
    told.length = 0;
    const gujarati = createInboundHandler({
      routing: createPgWhatsAppRoutingStore(database.pool),
      holds: createPgWhatsAppHoldStore(database.pool),
      inbox: createPgWhatsAppInbox({ pool: database.pool, withHotel: database.withHotel }),
      notifier,
      hashKey: () => cfg.hashKey,
      sealKey: () => cfg.sealKey,
      settings: async () => ({ mode: "strict", timeframeMinutes: 120, holdMinutes: 10, defaultLanguage: "gu" }),
    });
    await gujarati.message({ event: text("wamid.OWN5", "STOP"), line: ownLine, row: {} as never, now: T0 });
    assert.equal((await q(`SELECT 1 FROM "${hotelA.schema}".wa_optouts WHERE phone_digits = $1`, [GUEST])).rows.length, 1);
    assert.ok(/[઀-૿]/.test(told[0].body) && told[0].body.includes("START"), "answered in Gujarati");
    await gujarati.message({ event: text("wamid.OWN6", "START"), line: ownLine, row: {} as never, now: T0 });
    assert.equal((await q(`SELECT 1 FROM "${hotelA.schema}".wa_optouts`)).rows.length, 0);
  });
});

describe("a message on the shared number", () => {
  test("a guest with two hotels and no rule to go by is asked once; nothing is delivered and the message is held sealed", async () => {
    asked.length = 0;
    await run(sharedLine, text("wamid.SH1", "Can I get a late checkout?"));
    await run(sharedLine, text("wamid.SH2", "Hello? Anyone there?"));
    assert.equal(asked.length, 1, "asked once, the second message joins the hold");
    assert.deepEqual([await count(hotelA, "AND external_id LIKE 'wamid.SH%'"), await count(hotelB, "AND external_id LIKE 'wamid.SH%'")], [0, 0]);
    const hold = (await q("SELECT id, candidate_hotels, payload_secret, question_wamid FROM platform.whatsapp_holds")).rows;
    assert.equal(hold.length, 1);
    assert.ok(!String(hold[0].payload_secret).includes("late checkout"), "sealed");
    assert.equal(hold[0].question_wamid, "wamid.QUESTION1");
    assert.equal((hold[0].candidate_hotels as string[]).length, 2);
  });

  test("the answer delivers every held message to the chosen hotel, in order, deletes the hold and remembers the choice", async () => {
    const hold = (await q("SELECT id, candidate_hotels FROM platform.whatsapp_holds")).rows[0];
    const chosen = (hold.candidate_hotels as string[])[0];
    const hotel = chosen === hotelA.id ? hotelA : hotelB;
    const other = hotel === hotelA ? hotelB : hotelA;
    const tap = message("wamid.SH3", { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `h:${hold.id}:0`, title: "Hotel" } } });
    assert.deepEqual(await run(sharedLine, tap), { kind: "done" });
    const delivered = (await q(`SELECT external_id FROM "${hotel.schema}".conv_messages WHERE channel = 'whatsapp' AND external_id LIKE 'wamid.SH%' ORDER BY sent_at, external_id`)).rows.map((r) => r.external_id);
    assert.deepEqual(delivered, ["wamid.SH1", "wamid.SH2"]);
    assert.equal(await count(other, "AND external_id LIKE 'wamid.SH%'"), 0, "the other hotel never sees it");
    assert.equal((await q("SELECT 1 FROM platform.whatsapp_holds")).rows.length, 0);
    const sel = (await q("SELECT hotel_id FROM platform.whatsapp_selections WHERE line_id = $1", [sharedLine.id])).rows[0];
    assert.equal(sel.hotel_id, chosen);
    // the next message goes straight to the chosen hotel (a live selection), without a question
    asked.length = 0;
    await run(sharedLine, text("wamid.SH4", "Thanks, and one more thing"));
    assert.equal(asked.length, 0);
    assert.equal(await count(hotel, "AND external_id = 'wamid.SH4'"), 1);
  });

  test("an answer that is too late or not the guest's is refused with one plain line and delivers nothing", async () => {
    told.length = 0;
    const gone = message("wamid.SH5", { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `h:${randomUUID()}:0`, title: "Hotel" } } });
    await run(sharedLine, gone);
    assert.equal(told.length, 1);
  });
});
