// WhatsApp phase 1, task 8 integration (docs/plans/WHATSAPP-MASTER-PLAN.md part 12): the real sender on the PostgreSQL send store, a fake Meta, throwaway hms_test only. A free-text reply in an open
// window is a pending row before Meta is called, then sent with the wamid, counted, indexed; refusals leave no row; an unknown outcome stays pending; one request id never reaches Meta twice.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgWhatsAppSendStore, messageIdOf } from "../../src/server/repos/postgres/whatsappSend";
import { whatsappConfig } from "../../src/server/whatsapp/config";
import { createFakeMeta } from "../../src/server/whatsapp/fakeMeta";
import { createGraphClient } from "../../src/server/whatsapp/graph";
import { openToken, sealToken } from "../../src/server/whatsapp/seal";
import { createSender } from "../../src/server/whatsapp/send";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
let lineId = "";

const ENV = { WHATSAPP_APP_SECRET: "db-app-secret", WHATSAPP_VERIFY_TOKEN: "db-verify", HMS_HASH_KEY: randomBytes(32).toString("base64") };
const cfg = () => whatsappConfig(ENV)!;
const PHONE_ID = "1055550001111";
const GUEST = "919825041236";
const OTHER = "919825049999";
const NOBODY = "919825048888";
const T0 = new Date("2026-11-04T10:00:00Z");
const q = (text: string, params: unknown[] = []) => owner.query(text, params);
const clearWhatsApp = async (): Promise<void> => {
  for (const table of ["whatsapp_message_index", "whatsapp_suppressions", "whatsapp_line_hotels", "whatsapp_lines"]) await owner.query(`DELETE FROM platform.${table}`);
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await clearWhatsApp();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "WhatsApp Send Hotel");
  lineId = String((await q("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret) VALUES ('shared', $1, '2055550009999', 'active', $2) RETURNING id", [PHONE_ID, sealToken(cfg().sealKey, "EAAG-test", PHONE_ID)])).rows[0].id);
  // the hotel uses the shared line; recipients need not be in-house for this test
  await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id, rules_override) VALUES ($1, $2, '{\"recipients_stay_guests_only\":false}')", [lineId, hotel.id]);
  await q("UPDATE platform.platform_settings SET value = 'true'::jsonb WHERE key = 'whatsapp.enabled'");
  // a guest who wrote one minute ago (window open), and one more who wrote yesterday (window closed)
  for (const [digits, closes] of [[GUEST, new Date(T0.getTime() + 3600_000)], [OTHER, new Date(T0.getTime() + 3600_000)]] as const) {
    const contact = String((await q(`INSERT INTO "${hotel.schema}".conv_contacts DEFAULT VALUES RETURNING id`)).rows[0].id);
    await q(`INSERT INTO "${hotel.schema}".conv_contact_handles (contact_id, kind, value) VALUES ($1, 'phone', $2)`, [contact, digits]);
    const conv = String((await q(`INSERT INTO "${hotel.schema}".conv_conversations (contact_id, last_message_at, last_channel, last_direction, last_inbound_at, channels, wa_window_closes_at) VALUES ($1, $2, 'whatsapp', 'in', $2, ARRAY['whatsapp'], $3) RETURNING id`, [contact, T0, closes])).rows[0].id);
    await q(`INSERT INTO "${hotel.schema}".conv_messages (conversation_id, channel, direction, status, external_id, sent_at, sent_from, wa_type, wa_text, line_id) VALUES ($1, 'whatsapp', 'in', 'received', $2, $3, 'contact', 'text', 'Hello', $4)`, [conv, `wamid.IN.${digits}`, T0, lineId]);
  }
  await q(`INSERT INTO "${hotel.schema}".wa_optouts (phone_digits) VALUES ($1)`, [OTHER]);
});
after(async () => {
  await database?.close();
  if (owner) {
    await q("UPDATE platform.platform_settings SET value = 'false'::jsonb WHERE key = 'whatsapp.enabled'").catch(() => undefined);
    await clearWhatsApp().catch(() => undefined);
    await removeAllTestHotels(owner).catch(() => undefined);
  }
  await owner?.end();
  await release?.();
});

const build = () => {
  const meta = createFakeMeta();
  const store = createPgWhatsAppSendStore({ pool: database.pool, withHotel: database.withHotel, hashKey: cfg().hashKey });
  const sender = createSender({ store, graph: createGraphClient({ fetch: meta.fetch, timeoutMs: 300 }), openToken: (s, p) => openToken(cfg().sealKey, s, p), now: () => T0 });
  return { meta, sender };
};
const scope = { kind: "hotel", hotelId: "" } as { kind: "hotel"; hotelId: string };
const row = async (requestId: string) => (await q(`SELECT status, external_id, failure_code, line_id, wa_text FROM "${hotel.schema}".conv_messages WHERE id = $1`, [messageIdOf(requestId)])).rows[0];

describe("the send pipeline on PostgreSQL", () => {
  test("a reply in an open window: pending before Meta is called, then sent with the wamid, counted and indexed; a repeat never calls Meta again", async () => {
    scope.hotelId = hotel.id;
    const { meta, sender } = build();
    let seenPending: unknown;
    meta.onSend(() => {
      void q(`SELECT status FROM "${hotel.schema}".conv_messages WHERE id = $1`, [messageIdOf("req-1")]).then((r) => (seenPending = r.rows[0]?.status));
    });
    const req = { id: "req-1", scope: { ...scope }, to: GUEST, content: { kind: "text", body: "Your room is ready" }, by: { id: "00000000-0000-4000-8000-0000000000aa" } } as const;
    const res = await sender.send(req);
    assert.equal(res.status, "sent", res.code);
    assert.equal(meta.sends().length, 1);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seenPending, "pending", "the row existed, pending, when Meta was called");
    const r = await row("req-1");
    assert.deepEqual([r.status, r.external_id, r.line_id, r.failure_code], ["sent", res.wamid, lineId, null]);
    const usage = (await q(`SELECT category, sent, started, failed FROM "${hotel.schema}".wa_usage`)).rows;
    assert.deepEqual(usage.map((u) => [u.category, u.sent, u.started, u.failed]), [["service", 1, 0, 0]]);
    assert.equal((await q("SELECT hotel_id, direction FROM platform.whatsapp_message_index WHERE wamid = $1", [res.wamid])).rows.length, 1);
    const again = await sender.send(req);
    assert.deepEqual([again.status, again.existingStatus], ["duplicate", "sent"]);
    assert.equal(meta.sends().length, 1, "Meta was called once");
  });

  test("refusals leave no row: opted out, and no open window with no template", async () => {
    const { meta, sender } = build();
    const optedOut = await sender.send({ id: "req-2", scope: { ...scope }, to: OTHER, content: { kind: "text", body: "Hi" }, by: { id: "x" } });
    assert.deepEqual([optedOut.status, optedOut.code], ["refused", "opted_out"]);
    const closed = await sender.send({ id: "req-3", scope: { ...scope }, to: NOBODY, content: { kind: "text", body: "Hi" }, by: { id: "x" } });
    assert.deepEqual([closed.status, closed.code], ["refused", "window_closed"]);
    assert.equal(await row("req-2"), undefined);
    assert.equal(await row("req-3"), undefined);
    assert.equal(meta.sends().length, 0);
  });

  test("an unknown outcome leaves the row pending with the marker and is not resent", async () => {
    const { meta, sender } = build();
    meta.script({ type: "hang" });
    const req = { id: "req-4", scope: { ...scope }, to: GUEST, content: { kind: "text", body: "Are you there" }, by: { id: "x" } } as const;
    const res = await sender.send(req);
    assert.deepEqual([res.status, res.code], ["unknown", "unknown_outcome"]);
    const r = await row("req-4");
    assert.deepEqual([r.status, r.failure_code], ["pending", "UNKNOWN_OUTCOME"]);
    const again = await sender.send(req);
    assert.deepEqual([again.status, again.code], ["duplicate", "unknown_outcome"]);
    assert.equal(meta.sends().length, 1);
  });
});
