// The hotel's WhatsApp chat, live (WhatsApp phase 3 start, 4 Nov 2026): a hotel whose number is connected shows WhatsApp as available, and a WhatsApp reply goes through the sender as THAT hotel with the
// staff member recorded; a refusal is one plain sentence; nothing changes while WhatsApp is off. Memory unit and a fake sender; kept short.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/conversations.whatsapp.live.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { whatsappCopy, type WhatsAppSettings } from "@shared/dashboards/whatsapp";
import type { InboundEntry } from "../../src/server/conversations/channel";
import { AppError } from "../../src/server/errors";
import { hotelWorld, STAFF } from "./helpers/conversations";
import { HOTEL_A, makeSession } from "./helpers/session";

const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
const meta = { traceId: "t", ip: null };
const CONNECTED: WhatsAppSettings = { connected: true, available: true, number: "+1 555 000 3333", displayName: "Hotel Pallav", displayNameStatus: "approved", quality: "green", templates: [], automatic: [] };
const OFF: WhatsAppSettings = { connected: false, available: false, templates: [], automatic: [] };
type Send = (req: { hotelId: string; by: string; to: string; text: string }) => Promise<{ ok: boolean; message: string; messageId?: string }>;

const guestEntry = (): InboundEntry => ({
  channel: "whatsapp", direction: "in", externalId: "wamid.IN1", sentAt: new Date("2026-10-24T09:59:00Z"), person: "919825041236", personName: "Asha Patel", from: "919825041236", replyTo: null, to: [], cc: [], subject: null,
  preview: "Is breakfast included?", hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: "contact", status: "received",
  whatsapp: { type: "text", text: "Is breakfast included?", sentFrom: "contact", status: "received" },
});

/** A hotel with one guest message already saved (as the inbound path does); `send` is the fake sender behind the reply box. */
async function world(send: (messageId: string) => Send, state: WhatsAppSettings = CONNECTED) {
  const calls: { hotelId: string; by: string; to: string; text: string }[] = [];
  let messageId = "";
  const w = hotelWorld({ whatsapp: async () => state, whatsappSend: async (r) => (calls.push(r), send(messageId)(r)) });
  await w.hotel.unit.run(admin, async (repos) => void (await repos.conversations.ingest([guestEntry()], { mailbox: null }, repos.matcher, w.clock.now)));
  const conv = w.data().convConversations[0];
  messageId = w.data().convMessages[0].id;
  return { w, conv, calls };
}

describe("the hotel's WhatsApp chat is live", () => {
  test("a connected hotel is told its number, the summary agrees, and WhatsApp is available on the thread", async () => {
    const { w, conv } = await world(() => async () => ({ ok: true, message: "" }));
    const summary = (await w.service.summary(admin)).whatsapp;
    assert.deepEqual([summary.connected, summary.available, summary.number, summary.displayName], [true, true, "+1 555 000 3333", "Hotel Pallav"]);
    const thread = await w.service.thread(admin, conv.id);
    assert.ok(thread.replyChannels.some((c) => c.channel === "whatsapp" && c.available));
  });

  test("a WhatsApp reply is sent as THIS hotel to the guest's number by the signed-in person, trimmed, and the saved message comes back", async () => {
    const { w, conv, calls } = await world((id) => async () => ({ ok: true, message: "", messageId: id }));
    const out = await w.service.reply(admin, conv.id, { channel: "whatsapp", text: "  Yes, breakfast is included.  " }, meta);
    assert.deepEqual(calls, [{ hotelId: HOTEL_A, by: STAFF.admin, to: "919825041236", text: "Yes, breakfast is included." }]);
    assert.equal(out.kind, "whatsapp");
  });

  test("a refusal by the sender is one plain sentence (409); an empty message is a validation error", async () => {
    const { w, conv } = await world(() => async () => ({ ok: false, message: "The 24-hour window is closed. Use a template." }));
    await assert.rejects(w.service.reply(admin, conv.id, { channel: "whatsapp", text: "hello" }, meta), (e: unknown) => e instanceof AppError && e.code === "CONFLICT" && e.message === "The 24-hour window is closed. Use a template.");
    await assert.rejects(w.service.reply(admin, conv.id, { channel: "whatsapp", text: "   " }, meta), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED");
  });

  test("while WhatsApp is off for the hotel nothing changes: not connected, and a reply answers the old sentence without calling the sender", async () => {
    const { w, conv, calls } = await world(() => async () => ({ ok: true, message: "" }), OFF);
    assert.deepEqual((await w.service.summary(admin)).whatsapp, { connected: false, available: false });
    await assert.rejects(w.service.reply(admin, conv.id, { channel: "whatsapp", text: "hello" }, meta), (e: unknown) => (e as Error).message === whatsappCopy.notAvailableWrite);
    assert.equal(calls.length, 0);
  });
});
