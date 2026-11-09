// WhatsApp is the hotel's one shared desk (MJ, 5 Nov 2026): every chat belongs to the whole team. A WhatsApp list shows every chat whatever its done state (old data),
// in the memory repo, the PostgreSQL SQL and the counts alike; a chat of WhatsApp only is never assigned or marked done (422, one plain sentence), for a hotel and the
// platform; Email keeps both. Memory units; kept short.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/conversations.sharedDesk.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { conversationsCopy, inTab } from "@shared/dashboards/conversations";
import type { InboundEntry } from "../../src/server/conversations/channel";
import { AppError } from "../../src/server/errors";
import { createMemoryPlatformConversations } from "../../src/server/repos/memory/conversations";
import { tabSql } from "../../src/server/repos/postgres/conversations";
import { createPlatformConversationsService, type PlatformGatePort } from "../../src/server/services/conversations/platformConversationsService";
import { hotelWorld, PUBLIC_LOOKUP, STAFF } from "./helpers/conversations";
import { makeSession } from "./helpers/session";

const admin = makeSession({ userId: STAFF.admin, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
const superAdmin = makeSession({ userId: STAFF.admin, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
const meta = { traceId: "t", ip: null };
const AT = new Date("2026-10-24T09:59:00Z");
const shared = (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED" && e.message === conversationsCopy.errors.waShared;

const chat = (n: number): InboundEntry => ({
  channel: "whatsapp", direction: "in", externalId: `wamid.IN${n}`, sentAt: AT, person: `9198250412${30 + n}`, personName: `Guest ${n}`, from: `9198250412${30 + n}`, replyTo: null, to: [], cc: [], subject: null,
  preview: "Is breakfast included?", hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: "contact", status: "received",
  whatsapp: { type: "text", text: "Is breakfast included?", sentFrom: "contact", status: "received" },
});
const mail = (): InboundEntry => ({
  channel: "email", direction: "in", externalId: "<m1@guest.example>", sentAt: AT, person: "ravi@guest.example", personName: "Ravi Shah", from: "ravi@guest.example", replyTo: null, to: ["desk@gmail.com"], cc: [], subject: "Pickup",
  preview: "Pickup at 6?", hasAttachments: false, inReplyTo: null, references: [], box: "main", senderVerified: true, sentFrom: "contact", status: "received",
});

async function hotel() {
  const w = hotelWorld();
  await w.hotel.unit.run(admin, async (repos) => void (await repos.conversations.ingest([chat(1), chat(2), mail()], { mailbox: null }, repos.matcher, w.clock.now)));
  const rows = w.data().convConversations;
  const ids = { a: rows.find((c) => c.channels.join() === "whatsapp")!.id, b: rows.filter((c) => c.channels.join() === "whatsapp")[1]!.id, email: rows.find((c) => c.channels.includes("email"))!.id };
  return { w, ids };
}

describe("the shared desk lists every WhatsApp chat", () => {
  test("one rule: a done WhatsApp chat is in All and Waiting on the WhatsApp list, not on Email's", () => {
    const done = { box: "main" as const, status: "done" as const, unread: 0, assignedTo: null, lastDirection: "in" as const };
    assert.deepEqual([inTab("all", done, "me", "whatsapp"), inTab("waiting", done, "me", "whatsapp"), inTab("other", done, "me", "whatsapp")], [true, true, false]);
    assert.deepEqual([inTab("all", done, "me", "email"), inTab("all", done, "me", "all"), inTab("all", done, "me")], [false, false, false]);
    assert.equal(tabSql("all", "$1", "whatsapp"), "(v.box = 'main')");
    assert.equal(tabSql("waiting", "$1", "whatsapp"), "(v.box = 'main' AND v.last_direction = 'in')");
    assert.equal(tabSql("all", "$1", "email"), "(v.box = 'main' AND v.status = 'open')");
    assert.equal(tabSql("all", "$1"), "(v.box = 'main' AND v.status = 'open')");
  });

  test("the memory repo and its counts follow it (old data marked done stays listed)", async () => {
    const { w, ids } = await hotel();
    await w.hotel.unit.run(admin, async (repos) => void (await repos.conversations.setStatus(ids.a, "done")));
    const [wa, waCounts, all] = await w.hotel.unit.run(admin, async (repos) =>
      Promise.all([
        repos.conversations.list({ tab: "all", channel: "whatsapp", me: STAFF.admin, page: 1, pageSize: 25 }),
        repos.conversations.counts({ channel: "whatsapp", me: STAFF.admin }),
        repos.conversations.list({ tab: "all", channel: "all", me: STAFF.admin, page: 1, pageSize: 25 }),
      ]),
    );
    assert.ok(wa.rows.some((r) => r.id === ids.a), "the done chat is on the WhatsApp list");
    assert.deepEqual([wa.total, waCounts.all, waCounts.waiting], [2, 2, 2]);
    assert.ok(!all.rows.some((r) => r.id === ids.a), "a list of every channel keeps Email's rule");
  });
});

describe("a WhatsApp chat is never assigned or closed", () => {
  test("a hotel: assign and done are refused with one sentence (422) for WhatsApp, still allowed for email", async () => {
    const { w, ids } = await hotel();
    await assert.rejects(w.service.patch(admin, ids.a, { assignedTo: STAFF.neha }, meta), shared);
    await assert.rejects(w.service.patch(admin, ids.a, { assignedTo: null }, meta), shared);
    await assert.rejects(w.service.patch(admin, ids.a, { status: "done" }, meta), shared);
    await assert.rejects(w.service.patch(admin, ids.a, { status: "open" }, meta), shared);
    const c = w.data().convConversations.find((x) => x.id === ids.a)!;
    assert.deepEqual([c.status, c.assignedTo], ["open", null], "nothing changed");
    assert.equal((await w.service.patch(admin, ids.email, { status: "done" }, meta)).status, "done");
    assert.equal((await w.service.patch(admin, ids.email, { assignedTo: STAFF.neha }, meta)).assignedTo?.id, STAFF.neha);
    assert.equal((await w.service.bulk(admin, [ids.b, ids.email], "reopen", meta)).changed, 1, "bulk skips the WhatsApp chat");
  });

  test("the platform: the same refusal", async () => {
    const memory = createMemoryPlatformConversations();
    const gate: PlatformGatePort = { read() {}, async write() {}, superRead() {}, async superWrite() {}, async audit() {} };
    const service = createPlatformConversationsService({
      unit: memory.unit,
      gate,
      people: { get: async () => new Map() },
      now: () => AT,
      lookup: PUBLIC_LOOKUP,
      sleep: async () => undefined,
      smtp: async () => ({ config: null, passwordUnreadable: false }),
      staff: async () => [{ id: STAFF.admin, name: "Sonal Super" }, { id: STAFF.neha, name: "Neha Platform" }],
    } as never);
    await memory.unit.run(async (repos) => void (await repos.conversations.ingest([chat(1), mail()], { mailbox: null }, repos.matcher, AT)));
    const rows = memory.data().convConversations;
    const wa = rows.find((c) => c.channels.join() === "whatsapp")!.id;
    const email = rows.find((c) => c.channels.includes("email"))!.id;
    await assert.rejects(service.patch(superAdmin, wa, { assignedTo: STAFF.neha }, meta as never), shared);
    await assert.rejects(service.patch(superAdmin, wa, { status: "done" }, meta as never), shared);
    assert.equal((await service.patch(superAdmin, email, { status: "done" }, meta as never)).status, "done");
  });
});
