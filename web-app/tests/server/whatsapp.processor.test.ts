// WhatsApp phase 1, task 5 (docs/plans/WHATSAPP-MASTER-PLAN.md part 29.1): the event processor, with fake handlers. Kept short on purpose; the full scenario suite comes at the end.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.processor.test.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import { createMemoryEventStore, createMemoryLineStore } from "@/server/whatsapp/memory";
import type { WaWebhookEvent } from "@/server/whatsapp/payload";
import type { WaLine } from "@/server/whatsapp/ports";
import { createEventProcessor, createMemoryGuestLock, nextStatus, PARK_GIVE_UP_SECONDS, RETRY_SECONDS, type WaEventHandlers, type WaHandlerResult } from "@/server/whatsapp/processor";
import { sealEvent } from "@/server/whatsapp/seal";

const KEY = randomBytes(32);
const LINE: WaLine = { id: "00000000-0000-4000-8000-0000000000a1", kind: "shared", phoneNumberId: "1055550001111", wabaId: "2055550002222", status: "test" };
const T0 = new Date("2026-11-04T10:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

const message = (wamid: string, from = "919825041236"): WaWebhookEvent => ({ kind: "message", phoneNumberId: LINE.phoneNumberId, wabaId: LINE.wabaId, wamid, from, timestamp: 1762200000, contactName: null, message: { id: wamid, type: "text", text: { body: "private words" } } });
const status = (wamid: string): WaWebhookEvent => ({ kind: "status", phoneNumberId: LINE.phoneNumberId, wabaId: LINE.wabaId, wamid, status: "delivered", timestamp: 1762200100, recipient: "919825041236", errors: [] });

function setup(handler: Partial<Record<"message" | "status" | "other", (wamid: string) => Promise<WaHandlerResult>>> = {}, enabled = true) {
  const events = createMemoryEventStore();
  let clock = T0;
  const seen: string[] = [];
  const handlers: WaEventHandlers = {
    message: async ({ event }) => (seen.push(event.wamid), handler.message ? handler.message(event.wamid) : { kind: "done" }),
    status: async ({ event }) => (seen.push(event.wamid), handler.status ? handler.status(event.wamid) : { kind: "done" }),
    other: async () => ({ kind: "done" }),
  };
  const processor = createEventProcessor({ events, lines: createMemoryLineStore([LINE]), handlers, sealKey: () => KEY, enabled: async () => enabled, lock: createMemoryGuestLock(), now: () => clock });
  const save = async (event: WaWebhookEvent, key: string, receivedAt = T0, payload = sealEvent(KEY, event, LINE.id)) => (await events.save([{ lineId: LINE.id, kind: event.kind === "template" ? "template" : event.kind, dedupeKey: key, payloadSecret: payload, receivedAt }])).saved[0];
  return { events, processor, seen, save, tick: (s: number) => (clock = at(s)) };
}

describe("the event processor", () => {
  test("the kill switch off takes nothing; on, an event is opened, handled and its payload cleared", async () => {
    const off = setup({}, false);
    await off.save(message("wamid.A1"), "m:1");
    assert.deepEqual(await off.processor.runBatch(), { active: false, taken: 0, done: 0, parked: 0, retried: 0, dead: 0 });
    assert.equal(off.events.rows[0].state, "received", "the event waits");
    const on = setup();
    await on.save(message("wamid.A1"), "m:1");
    assert.deepEqual(await on.processor.runBatch(), { active: true, taken: 1, done: 1, parked: 0, retried: 0, dead: 0 });
    assert.deepEqual([on.events.rows[0].state, on.events.rows[0].payloadSecret], ["done", null]);
  });

  test("a failing handler is retried on the schedule and then dead; only a code is kept, never the thrown text", async () => {
    const s = setup({
      message: async () => {
        throw new Error("boom with private words");
      },
    });
    await s.save(message("wamid.B1"), "m:b1");
    let when = 0;
    for (let i = 0; i < RETRY_SECONDS.length; i += 1) {
      s.tick(when);
      const r = await s.processor.runBatch();
      assert.equal(r.retried, 1, `attempt ${i + 1} is retried`);
      when += RETRY_SECONDS[i] + 1;
    }
    s.tick(when);
    assert.equal((await s.processor.runBatch()).dead, 1, "the schedule is used up");
    const row = s.events.rows[0];
    assert.deepEqual([row.state, row.lastErrorCode], ["dead", "HANDLER_ERROR"]);
    assert.ok(!JSON.stringify(row).includes("private"), "no guest text outside the sealed payload");
    s.tick(when + 999_999);
    assert.equal((await s.processor.runBatch()).taken, 0, "a dead event is not taken again");
  });

  test("a poison event (unreadable payload) is dead at once and never reaches a handler", async () => {
    const s = setup();
    await s.save(message("wamid.C1"), "m:c1", T0, sealEvent(randomBytes(32), message("wamid.C1"), LINE.id));
    assert.equal((await s.processor.runBatch()).dead, 1);
    assert.deepEqual([s.events.rows[0].state, s.events.rows[0].lastErrorCode, s.seen.length], ["dead", "UNREADABLE", 0]);
    const t = setup({ message: async () => ({ kind: "dead", code: "NEVER" }) });
    await t.save(message("wamid.C2"), "m:c2");
    assert.equal((await t.processor.runBatch()).dead, 1);
  });

  test("a status before its message is parked without counting an attempt, found again, and dropped after ten minutes", async () => {
    let known = false;
    const s = setup({ status: async () => (known ? { kind: "done" } : { kind: "park" }) });
    const id = await s.save(status("wamid.OUT1"), "s:1");
    assert.equal((await s.processor.runBatch()).parked, 1);
    assert.equal(s.events.rows[0].attempts, 0);
    s.tick(30);
    assert.equal((await s.processor.runBatch()).taken, 0, "not yet");
    known = true;
    s.tick(70);
    assert.equal((await s.processor.runBatch()).done, 1, "applied once its message exists");
    const never = setup({ status: async () => ({ kind: "park" }) });
    await never.save(status("wamid.OUT2"), "s:2");
    never.tick(0);
    await never.processor.runBatch();
    never.tick(PARK_GIVE_UP_SECONDS + 5);
    await never.processor.runBatch();
    assert.equal(never.events.rows[0].state, "done", "not ours: dropped");
    assert.ok(id);
  });

  test("two events of one guest run one after the other in order; another guest is not held up", async () => {
    const order: string[] = [];
    const gate: { open?: () => void } = {};
    const s = setup({
      message: async (wamid) => {
        order.push(`start ${wamid}`);
        if (wamid === "wamid.G1") await new Promise<void>((resolve) => (gate.open = resolve));
        order.push(`end ${wamid}`);
        return { kind: "done" };
      },
    });
    const lock = createMemoryGuestLock();
    const first = lock(LINE.id, "919825041236", 1000, async () => (await s.processor.processEvent(await s.save(message("wamid.G1"), "m:g1")), undefined));
    await new Promise((r) => setTimeout(r, 10));
    const second = lock(LINE.id, "919825041236", 1000, async () => (await s.processor.processEvent(await s.save(message("wamid.G2"), "m:g2")), undefined));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(order, ["start wamid.G1"], "the second waits for the first");
    gate.open?.();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["start wamid.G1", "end wamid.G1", "start wamid.G2", "end wamid.G2"]);
    const busy = createMemoryGuestLock();
    let release!: () => void;
    const held = busy("l", "g", 1000, () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((r) => setTimeout(r, 5));
    await assert.rejects(busy("l", "g", 20, async () => undefined), /lock was busy/, "a lock that is not free in time is an error the processor retries");
    await busy("l", "other-guest", 20, async () => undefined);
    release();
    await held;
  });

  test("a status moves forward only", () => {
    assert.equal(nextStatus("pending", "sent"), "sent");
    assert.equal(nextStatus("sent", "read"), "read", "read before delivered is fine");
    assert.equal(nextStatus("read", "delivered"), "read");
    assert.equal(nextStatus("delivered", "sent"), "delivered");
    assert.equal(nextStatus("delivered", "failed"), "delivered");
    assert.equal(nextStatus("pending", "failed"), "failed");
    assert.equal(nextStatus("failed", "delivered"), "delivered", "a late delivery receipt wins over a failure");
  });
});
