// Conversations, WhatsApp is design only for now (decision 66, A7): on the live site the channel answers "not connected yet" (never sample data), every WhatsApp write is a
// 409 with one sentence, a thread offers WhatsApp as unavailable, and the server's adapter is deliberately absent (the Meta integration adds it without changing a screen).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { WHATSAPP_NOT_CONNECTED, whatsappCopy, windowOf } from "@shared/dashboards/whatsapp";
import { GET as whatsappRoute } from "../../src/app/api/v1/conversations/whatsapp/route";
import { PATCH as automaticRoute } from "../../src/app/api/v1/conversations/whatsapp/automatic/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureConversations } from "../../src/server/compose/conversations";
import { whatsappChannel, whatsappStateOf, windowOf as serverWindowOf } from "../../src/server/conversations/whatsapp";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { guestMail, hotelWorld, STAFF } from "./helpers/conversations";
import { catalog, makeSession } from "./helpers/session";

const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
const sessions = new Map<string, VerifiedSession>([["admin", admin]]);
const ORIGIN = "https://hms.test";
const req = (method: string, path: string, body?: unknown) => new Request(`${ORIGIN}${path}`, { method, headers: { host: "hms.test", origin: ORIGIN, "x-test-session": "admin", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
let w = hotelWorld();

beforeEach(() => {
  w = hotelWorld();
  configureConversations(w.service);
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

describe("WhatsApp on the live site", () => {
  test("the channel is 'not connected yet'; the automatic messages and a WhatsApp reply answer 409 with one sentence; no adapter exists yet", async () => {
    const r = await whatsappRoute(req("GET", "/api/v1/conversations/whatsapp"));
    assert.equal(r.headers.get("cache-control"), "private, no-cache", "an ETag answer (API audit B21)");
    assert.deepEqual((await r.json()).data, WHATSAPP_NOT_CONNECTED);
    const a = await automaticRoute(req("PATCH", "/api/v1/conversations/whatsapp/automatic", { key: "booking_confirmed", on: true }));
    assert.deepEqual([a.status, (await a.json()).error.message], [409, whatsappCopy.notAvailableWrite]);
    assert.equal(whatsappChannel, null);
    assert.deepEqual(await whatsappStateOf(), WHATSAPP_NOT_CONNECTED);
    assert.equal(serverWindowOf, windowOf, "one window rule for the mock and the future adapter");
  });

  test("a thread offers WhatsApp as unavailable, the summary says not connected, and a WhatsApp reply is refused", async () => {
    w.imap.deliver("inbox", guestMail({ from: "asha@guest.in" }), new Date("2026-10-24T09:59:00Z"));
    await w.service.sync(admin, {});
    const conv = w.data().convConversations[0];
    const thread = await w.service.thread(admin, conv.id);
    assert.deepEqual(thread.replyChannels, [{ channel: "email", available: true }, { channel: "whatsapp", available: false, reason: "WhatsApp is not connected yet." }]);
    assert.deepEqual([thread.defaultChannel, thread.window], ["email", null]);
    assert.deepEqual((await w.service.summary(admin)).whatsapp, { connected: false, available: false });
    await assert.rejects(w.service.reply(admin, conv.id, { channel: "whatsapp", templateId: "t1", variables: ["Asha"] }, { traceId: "t", ip: null }), (e: unknown) => (e as Error).message === whatsappCopy.notAvailableWrite);
  });
});
