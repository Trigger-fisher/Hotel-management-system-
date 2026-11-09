// Hotels on the shared WhatsApp number (4 Nov 2026): attach, codes, detach (history kept), who may do it. Memory store, a stand-in gate and audit. Kept focused.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.linehotels.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { VerifiedSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { createLineHotelsService } from "@/server/services/whatsapp/lineHotelsService";
import { codeFromSlug, createMemoryLineHotelsStore } from "@/server/whatsapp/lineHotels";

const SHARED = "00000000-0000-4000-8000-0000000000a1";
const OWN = "00000000-0000-4000-8000-0000000000a2";
const PLATFORM = "00000000-0000-4000-8000-0000000000a3";
const H1 = "00000000-0000-4000-8000-0000000000b1";
const H2 = "00000000-0000-4000-8000-0000000000b2";
const H3 = "00000000-0000-4000-8000-0000000000b3";
const T0 = new Date("2026-11-04T10:00:00Z");
const session = { userId: "u1", accountRole: "super_admin" } as unknown as VerifiedSession;
const meta = { ip: "127.0.0.1", traceId: "t" } as never;

const build = () => {
  const audits: { reason?: string; after?: unknown }[] = [];
  const store = createMemoryLineHotelsStore({
    lines: { [SHARED]: "shared", [OWN]: "hotel", [PLATFORM]: "platform" },
    hotels: { [H1]: { name: "Hotel Sunrise", slug: "hotel-sunrise-rajkot" }, [H2]: { name: "Hotel Pearl", slug: "hotel-pearl" }, [H3]: { name: "Harbour Court", slug: "harbour-court" } },
  });
  const unit = { run: async (work: (r: unknown) => Promise<unknown>) => work({ audit: { write: async (row: { reason?: string; after?: unknown }) => void audits.push(row) } }) } as never;
  const gate = { superRead: () => undefined, superWrite: async () => undefined, refuse: async (_s: unknown, _m: unknown, _p: unknown, e: Error) => e, actor: async () => ({ userId: "u1", name: "Rajiv", role: "super_admin" }) } as never;
  return { store, audits, service: createLineHotelsService({ unit, store, now: () => T0, gate }) };
};
const fails = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

describe("hotels on the shared number", () => {
  test("a code is made from the hotel's slug when none is given, and a number is added when it is taken; a given code is cleaned and kept", async () => {
    const { service } = build();
    assert.equal(codeFromSlug("hotel-sunrise-rajkot"), "hotelsunriserajkot");
    assert.equal(codeFromSlug("ab"), "abhotel");
    const a = await service.attach(session, SHARED, { hotelId: H1 }, meta);
    assert.deepEqual([a.hotelCode, a.chatText, a.hotelName], ["hotelsunriserajkot", "hotelsunriserajkot: ", "Hotel Sunrise"]);
    const b = await service.attach(session, SHARED, { hotelId: H2, hotelCode: "  PEARL " }, meta);
    assert.equal(b.hotelCode, "pearl");
    const list = await service.list(session, SHARED);
    assert.deepEqual(list.attached.map((h) => [h.hotelName, h.hotelCode]), [["Hotel Pearl", "pearl"], ["Hotel Sunrise", "hotelsunriserajkot"]], "by hotel name");
    assert.deepEqual(list.available.map((h) => h.hotelId), [H3]);
  });

  test("a code is unique on a number: a given one that is taken is refused, a made one gets a number; bad codes are refused; the same hotel twice is refused", async () => {
    const { service, store } = build();
    await service.attach(session, SHARED, { hotelId: H1, hotelCode: "goa" }, meta);
    await fails(service.attach(session, SHARED, { hotelId: H2, hotelCode: "goa" }, meta), "CONFLICT");
    await fails(service.attach(session, SHARED, { hotelId: H2, hotelCode: "g o" }, meta), "VALIDATION_FAILED");
    await fails(service.attach(session, SHARED, { hotelId: H2, hotelCode: "ab" }, meta), "VALIDATION_FAILED");
    await fails(service.attach(session, SHARED, { hotelId: H1, hotelCode: "other" }, meta), "CONFLICT");
    store.rows.push({ lineId: SHARED, hotelId: H3, code: "hotelpearl", since: T0, closed: null });
    const made = await service.attach(session, SHARED, { hotelId: H2 }, meta);
    assert.equal(made.hotelCode, "hotelpearl2");
    await fails(service.attach(session, SHARED, { hotelId: "00000000-0000-4000-8000-0000000000ff" }, meta), "VALIDATION_FAILED");
  });

  test("a code can be changed or cleared, not to one in use; detaching closes the row (history kept) and frees the code and the place", async () => {
    const { service, store } = build();
    await service.attach(session, SHARED, { hotelId: H1, hotelCode: "sun" }, meta);
    await service.attach(session, SHARED, { hotelId: H2, hotelCode: "pearl" }, meta);
    assert.deepEqual(await service.setCode(session, SHARED, H1, " Sunny ", meta), { hotelCode: "sunny" });
    await fails(service.setCode(session, SHARED, H1, "pearl", meta), "CONFLICT");
    assert.deepEqual(await service.setCode(session, SHARED, H1, "", meta), { hotelCode: null });
    await fails(service.setCode(session, SHARED, H3, "x3x", meta), "NOT_FOUND");
    assert.deepEqual(await service.detach(session, SHARED, H2, meta), { detached: true });
    assert.equal(store.rows.filter((r) => r.hotelId === H2).length, 1, "the row is kept");
    assert.notEqual(store.rows.find((r) => r.hotelId === H2)?.closed, null);
    await fails(service.detach(session, SHARED, H2, meta), "NOT_FOUND");
    assert.equal((await service.attach(session, SHARED, { hotelId: H3, hotelCode: "pearl" }, meta)).hotelCode, "pearl", "the freed code can be used again");
    assert.equal((await service.attach(session, SHARED, { hotelId: H2 }, meta)).hotelName, "Hotel Pearl", "a detached hotel can come back");
  });

  test("only the shared number takes hotels; an unknown number is not found; the audit names the hotel and code; API keys, visits and portal accounts are refused", async () => {
    const { service, audits } = build();
    await fails(service.attach(session, OWN, { hotelId: H1 }, meta), "CONFLICT");
    await fails(service.list(session, PLATFORM), "CONFLICT");
    await fails(service.list(session, "00000000-0000-4000-8000-0000000000ee"), "NOT_FOUND");
    await service.attach(session, SHARED, { hotelId: H1, hotelCode: "sun" }, meta);
    await service.detach(session, SHARED, H1, meta);
    assert.deepEqual(audits.map((a) => a.reason), ["whatsapp:hotel_attached: ok", "whatsapp:hotel_detached: ok"]);
    assert.equal(JSON.stringify(audits[0].after).includes("sun"), true);
    await fails(service.list({ ...session, token: { id: "t" } } as unknown as VerifiedSession, SHARED), "FORBIDDEN");
    await fails(service.attach({ ...session, visit: { hotelId: H1 } } as unknown as VerifiedSession, SHARED, { hotelId: H1 }, meta), "FORBIDDEN");
  });
});
