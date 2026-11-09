// WhatsApp media on the REAL PostgreSQL, throwaway hms_test only: a guest's photo arrives as a "waiting" reference, the capture step runs once, its result is written into the message's media record, a
// retried event does not fetch again, and a refused file is written as "not kept". Run with: npm run test:db
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgWhatsAppInbox } from "../../src/server/repos/postgres/whatsappInbox";
import { createPgWhatsAppHoldStore, createPgWhatsAppRoutingStore } from "../../src/server/repos/postgres/whatsappRouting";
import { whatsappConfig } from "../../src/server/whatsapp/config";
import { createInboundHandler, type WaInboundNotifier } from "../../src/server/whatsapp/inbound";
import type { WaLine } from "../../src/server/whatsapp/ports";
import type { MessageEvent } from "../../src/server/whatsapp/processor";
import { sealToken } from "../../src/server/whatsapp/seal";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

process.env.HMS_HASH_KEY = randomBytes(32).toString("base64");
process.env.WHATSAPP_APP_SECRET = "media-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "media-verify";
const cfg = whatsappConfig()!;
const T0 = new Date("2026-11-04T10:00:00Z");
const GUEST = "919825041299";
let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
let line: WaLine;
const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
const clear = async (): Promise<void> => {
  for (const t of ["whatsapp_message_index", "whatsapp_line_hotels", "whatsapp_lines"]) await owner.query(`DELETE FROM platform.${t}`);
};
const notifier: WaInboundNotifier = { askHotel: async () => ({ wamid: null }), tell: async () => undefined, hotelNames: async (ids) => ids.map(() => "Hotel") };

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await clear();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "WhatsApp Media Hotel");
  const id = String((await q("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret) VALUES ('hotel', '1055550033333', '2055550009999', 'test', $1) RETURNING id", [sealToken(cfg.sealKey, "tok", "1055550033333")])).rows[0].id);
  line = { id, kind: "hotel", phoneNumberId: "1055550033333", wabaId: "2055550009999", status: "test" };
  await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id, state) VALUES ($1, $2, 'pending')", [id, hotel.id]);
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

const photo = (wamid: string): MessageEvent => ({ kind: "message", phoneNumberId: "x", wabaId: "y", wamid, from: GUEST, timestamp: Math.floor(T0.getTime() / 1000), contactName: "Asha Patel", message: { id: wamid, type: "image", image: { id: "media-77", mime_type: "image/jpeg", caption: "My room" } } });
const record = async (wamid: string) => (await q(`SELECT wa_media FROM "${hotel.schema}".conv_messages WHERE external_id = $1`, [wamid])).rows[0]?.wa_media as Record<string, unknown>;

describe("a guest's file on PostgreSQL", () => {
  test("waiting, captured once, written into the record; a retried event does not fetch again; a refusal is recorded as not kept", async () => {
    let captures = 0;
    let answer: Record<string, unknown> = { stored: true, key: "whatsapp/hotels/x/abc.jpg", size: 64, mime: "image/jpeg", inline: true };
    const handler = createInboundHandler({
      routing: createPgWhatsAppRoutingStore(database.pool),
      holds: createPgWhatsAppHoldStore(database.pool),
      inbox: createPgWhatsAppInbox({ pool: database.pool, withHotel: database.withHotel }),
      notifier,
      media: { capture: async () => (captures++, answer) },
      hashKey: () => cfg.hashKey,
      sealKey: () => cfg.sealKey,
      settings: async () => ({ mode: "strict", timeframeMinutes: 120, holdMinutes: 10 }),
    });
    const run = (event: MessageEvent) => handler.message({ event, line, row: {} as never, now: T0 });

    await run(photo("wamid.PHOTO1"));
    assert.equal(captures, 1);
    const r1 = await record("wamid.PHOTO1");
    assert.deepEqual([r1.stored, r1.pending, r1.key, r1.kind, r1.caption], [true, false, "whatsapp/hotels/x/abc.jpg", "image", "My room"]);
    await run(photo("wamid.PHOTO1"));
    assert.equal(captures, 1, "the same event again fetches nothing");

    answer = { stored: false, reason: "type_not_allowed" };
    await run(photo("wamid.PHOTO2"));
    const r2 = await record("wamid.PHOTO2");
    assert.deepEqual([r2.stored, r2.reason, r2.pending], [false, "type_not_allowed", false]);

    // a capture that failed to write (the event is retried) is fetched again: the record is still waiting
    await q(`UPDATE "${hotel.schema}".conv_messages SET wa_media = wa_media || '{"pending": true}'::jsonb WHERE external_id = 'wamid.PHOTO2'`);
    answer = { stored: true, key: "whatsapp/hotels/x/def.jpg", size: 10, mime: "image/jpeg", inline: true };
    await run(photo("wamid.PHOTO2"));
    assert.equal(captures, 3);
    assert.equal((await record("wamid.PHOTO2")).stored, true);
  });
});
