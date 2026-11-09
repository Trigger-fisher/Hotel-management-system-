// The WhatsApp backup on the REAL PostgreSQL, throwaway hms_test only: a hotel's copy holds its WhatsApp chats, message library, opt-outs, campaigns and guest agreements, and NOT its email or the rest of
// the guest record; it is encrypted, opens with the key, and a second hotel's chats never appear in the first hotel's copy. Run with: npm run test:db
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgBackupSource } from "../../src/server/compose/whatsappBackup";
import { createPgWhatsAppInbox } from "../../src/server/repos/postgres/whatsappInbox";
import { createPgWhatsAppHoldStore, createPgWhatsAppRoutingStore } from "../../src/server/repos/postgres/whatsappRouting";
import type { RawObjects } from "../../src/server/mail/files";
import { backupDay, backupKey, decryptBackup, runBackup, verifyBackups } from "../../src/server/whatsapp/backup";
import { whatsappConfig } from "../../src/server/whatsapp/config";
import { createInboundHandler } from "../../src/server/whatsapp/inbound";
import type { WaLine } from "../../src/server/whatsapp/ports";
import type { MessageEvent } from "../../src/server/whatsapp/processor";
import { sealToken } from "../../src/server/whatsapp/seal";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

process.env.HMS_HASH_KEY = randomBytes(32).toString("base64");
process.env.WHATSAPP_APP_SECRET = "backup-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "backup-verify";
const cfg = whatsappConfig()!;
const NOW = new Date("2026-11-04T22:00:00Z");
let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let a: CreatedHotel;
let b: CreatedHotel;
let lineA: WaLine;
let lineB: WaLine;
const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
const clear = async (): Promise<void> => {
  for (const t of ["whatsapp_message_index", "whatsapp_line_hotels", "whatsapp_lines"]) await owner.query(`DELETE FROM platform.${t}`);
};
const memory = (): RawObjects & { map: Map<string, { bytes: Uint8Array; modified: Date }> } => {
  const map = new Map<string, { bytes: Uint8Array; modified: Date }>();
  return { map, put: async (k, v) => void map.set(k, { bytes: v, modified: NOW }), get: async (k) => map.get(k)?.bytes ?? null, size: async (k) => map.get(k)?.bytes.length ?? null, remove: async (k) => void map.delete(k), list: async (p) => [...map].filter(([k]) => k.startsWith(p)).map(([key, v]) => ({ key, size: v.bytes.length, modified: v.modified })) };
};
const addLine = async (phoneId: string): Promise<WaLine> => {
  const id = String((await q("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret) VALUES ('hotel', $1, '2055550009999', 'test', $2) RETURNING id", [phoneId, sealToken(cfg.sealKey, "tok", phoneId)])).rows[0].id);
  return { id, kind: "hotel", phoneNumberId: phoneId, wabaId: "2055550009999", status: "test" };
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await clear();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  a = await createTestHotel(owner, "Backup Hotel A");
  b = await createTestHotel(owner, "Backup Hotel B");
  lineA = await addLine("1055550044441");
  lineB = await addLine("1055550044442");
  await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id, state) VALUES ($1, $2, 'pending'), ($3, $4, 'pending')", [lineA.id, a.id, lineB.id, b.id]);
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

const text = (wamid: string, body: string, from: string): MessageEvent => ({ kind: "message", phoneNumberId: "x", wabaId: "y", wamid, from, timestamp: Math.floor(NOW.getTime() / 1000), contactName: "Asha Patel", message: { id: wamid, type: "text", text: { body } } });

describe("the WhatsApp backup on PostgreSQL", () => {
  test("a hotel's copy has its WhatsApp rows only, in its own file, encrypted; another hotel's chats and the hotel's email are not in it", async () => {
    const handler = createInboundHandler({
      routing: createPgWhatsAppRoutingStore(database.pool),
      holds: createPgWhatsAppHoldStore(database.pool),
      inbox: createPgWhatsAppInbox({ pool: database.pool, withHotel: database.withHotel }),
      notifier: { askHotel: async () => ({ wamid: null }), tell: async () => undefined, hotelNames: async () => [] },
      hashKey: () => cfg.hashKey,
      sealKey: () => cfg.sealKey,
      settings: async () => ({ mode: "strict", timeframeMinutes: 120, holdMinutes: 10 }),
    });
    await handler.message({ event: text("wamid.A1", "Is breakfast included?", "919825041211"), line: lineA, row: {} as never, now: NOW });
    await handler.message({ event: text("wamid.B1", "Another hotel's guest here", "919825041222"), line: lineB, row: {} as never, now: NOW });
    const S = `"${a.schema}"`;
    // an email conversation in hotel A (must not be copied), an opt-out, a template, a guest who agreed and one who did not
    const contact = String((await q(`INSERT INTO ${S}.conv_contacts DEFAULT VALUES RETURNING id`)).rows[0].id);
    const conv = String((await q(`INSERT INTO ${S}.conv_conversations (contact_id, last_message_at, last_channel, last_direction, channels) VALUES ($1, now(), 'email', 'in', ARRAY['email']) RETURNING id`, [contact])).rows[0].id);
    await q(`INSERT INTO ${S}.conv_messages (conversation_id, channel, direction, status, external_id, sent_at, sent_from, subject, preview) VALUES ($1, 'email', 'in', 'received', 'mail-1', now(), 'contact', 'Private booking mail', 'do not copy this email')`, [conv]);
    await q(`INSERT INTO ${S}.wa_optouts (phone_digits) VALUES ('919825041299')`);
    await q(`INSERT INTO ${S}.wa_templates (name, language, category, body) VALUES ('welcome', 'hinglish', 'utility', 'Namaste, aapka swagat hai hamare hotel mein.')`);
    await q(`INSERT INTO ${S}.customers (name, mobile, wa_consent_at, email) VALUES ('Agreed Guest', '9825041211', now(), 'agreed@example.com'), ('Silent Guest', '9825041233', NULL, 'silent@example.com')`);

    const objects = memory();
    const run = await runBackup({ source: createPgBackupSource(() => NOW, () => database), objects, key: cfg.hashKey, now: NOW, limit: 5 });
    assert.deepEqual([run.written, run.failed], [3, 0], "the platform and the two hotels");

    const blob = objects.map.get(backupKey({ kind: "hotel", hotelId: a.id }, backupDay(NOW)))!.bytes;
    assert.equal(Buffer.from(blob).includes(Buffer.from("breakfast")), false, "encrypted");
    const copy = decryptBackup(cfg.hashKey, blob, { kind: "hotel", hotelId: a.id }, backupDay(NOW));
    assert.ok(copy.includes("Is breakfast included?"), "the WhatsApp message is in");
    assert.ok(!copy.includes("Another hotel's guest"), "another hotel's chat is not");
    assert.ok(!copy.includes("do not copy this email") && !copy.includes("Private booking mail"), "no email");
    assert.ok(copy.includes("919825041299") && copy.includes('"welcome"') && copy.includes("hinglish"), "opt-out and library are in");
    assert.ok(!copy.includes("agreed@example.com") && !copy.includes("silent@example.com"), "not the rest of the guest record");
    const rows = copy.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { t: string; r?: Record<string, unknown> });
    assert.equal(rows[0].t, "_header");
    assert.equal(rows.filter((r) => r.t === "customer_consent").length, 1, "only the guest who agreed");
    assert.ok(rows.some((r) => r.t === "conv_contact_handles"), "the phone handle is kept so the chat can be restored to its guest");

    const check = await verifyBackups({ objects, key: cfg.hashKey });
    assert.deepEqual([check.ok, check.checked], [true, 3]);
  });
});
