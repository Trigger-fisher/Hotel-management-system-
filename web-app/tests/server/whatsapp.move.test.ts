// A hotel's move to its own WhatsApp number (4 Nov 2026): pending -> transition -> active, the conditions of the cut-over, finishing early, undoing, the automatic finish, who may do it.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.move.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { VerifiedSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { createMoveService } from "@/server/services/whatsapp/moveService";
import { createMemoryMoveStore } from "@/server/whatsapp/move";

const H = "00000000-0000-4000-8000-0000000000b1";
const NONE = "00000000-0000-4000-8000-0000000000b2";
const T0 = new Date("2026-11-04T10:00:00Z");
const session = { userId: "u1", accountRole: "super_admin" } as unknown as VerifiedSession;
const meta = { ip: "127.0.0.1", traceId: "t" } as never;
const fails = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

const build = (approved = 1, lineStatus = "test") => {
  const audits: string[] = [];
  const store = createMemoryMoveStore({ [H]: { name: "Hotel Pallav", ownLine: { id: "line1", phone: "+91 98765 43210", status: lineStatus }, state: "pending" }, [NONE]: { name: "Hotel Pearl", ownLine: null, state: "none" } }, 30);
  const unit = { run: async (work: (r: unknown) => Promise<unknown>) => work({ audit: { write: async (row: { reason?: string }) => void audits.push(row.reason ?? "") } }) } as never;
  const gate = { superRead: () => undefined, superWrite: async () => undefined, refuse: async (_s: unknown, _m: unknown, _p: unknown, e: Error) => e, actor: async () => ({ userId: "u1", name: "Rajiv", role: "super_admin" }) } as never;
  return { store, audits, service: createMoveService({ unit, store, now: () => T0, gate, approvedMessages: async () => approved }) };
};

describe("a hotel's move to its own number", () => {
  test("cut over -> transition for the setting's days -> finish early; the audit names every step", async () => {
    const { service, store, audits } = build();
    const before = await service.status(session, H);
    assert.deepEqual([before.state, before.can.cutOver, before.cutOverBlockedBy], ["pending", true, null]);
    const cut = await service.cutOver(session, H, meta);
    assert.equal(cut.state, "transition");
    assert.equal(cut.transitionEndsAt, new Date(T0.getTime() + 30 * 86_400_000).toISOString());
    assert.deepEqual([cut.can.cutOver, cut.can.finish, cut.can.undo], [false, true, true]);
    await fails(service.cutOver(session, H, meta), "CONFLICT");
    assert.equal((await service.finish(session, H, meta)).state, "active");
    assert.equal(store.rows[H].endsAt, null);
    assert.deepEqual(audits, ["whatsapp:move_cut_over: ok", "whatsapp:move_finished: ok"]);
  });

  test("the cut-over needs a connected number and an approved message; a hotel without its own number cannot", async () => {
    await fails(build(0).service.cutOver(session, H, meta), "CONFLICT");
    assert.match((await build(0).service.status(session, H)).cutOverBlockedBy ?? "", /approved/);
    await fails(build(1, "paused").service.cutOver(session, H, meta), "CONFLICT");
    await fails(build().service.cutOver(session, NONE, meta), "CONFLICT");
    await fails(build().service.status(session, "00000000-0000-4000-8000-0000000000ff"), "NOT_FOUND");
  });

  test("undo returns to pending from the transition or the finished move; there is nothing to undo from pending", async () => {
    const { service, store } = build();
    await fails(service.undo(session, H, meta), "CONFLICT");
    await service.cutOver(session, H, meta);
    assert.equal((await service.undo(session, H, meta)).state, "pending");
    await service.cutOver(session, H, meta);
    await service.finish(session, H, meta);
    assert.equal((await service.undo(session, H, meta)).state, "pending");
    assert.equal(store.rows[H].endsAt, null);
  });

  test("the sweep finishes a cut-over whose days are over, and only that one", async () => {
    const { service, store } = build();
    await service.cutOver(session, H, meta);
    assert.equal(await store.finishDue(new Date(T0.getTime() + 29 * 86_400_000)), 0);
    assert.equal(await store.finishDue(new Date(T0.getTime() + 31 * 86_400_000)), 1);
    assert.equal(store.rows[H].state, "active");
  });

  test("an API key, an Enter-hotel visit and a portal account are refused", async () => {
    const { service } = build();
    await fails(service.status({ ...session, token: { id: "t" } } as unknown as VerifiedSession, H), "FORBIDDEN");
    await fails(service.cutOver({ ...session, visit: { hotelId: H } } as unknown as VerifiedSession, H, meta), "FORBIDDEN");
  });
});
