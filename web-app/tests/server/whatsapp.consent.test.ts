// A guest's agreement to automatic WhatsApp messages (4 Nov 2026): recorded with who and when, withdrawn, refused without a mobile number, logged once per change.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.consent.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Catalog } from "@/server/auth/catalog";
import type { VerifiedSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { memoryWaConsentRepo } from "@/server/repos/postgres/whatsappConsent";
import { createConsentService, type ConsentRepos } from "@/server/services/whatsapp/consentService";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";
const session = { userId: "u1", hotelId: "h1", accountRole: "hotel_admin" } as unknown as VerifiedSession;
const meta = { ip: "127.0.0.1", traceId: "t" } as never;
const fails = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

describe("guest consent", () => {
  test("record, read, withdraw; a guest with no mobile number is refused; each change is logged once; an unknown guest is not found", async () => {
    const consent = memoryWaConsentRepo({ [A]: { mobile: "+91 98765 43210" }, [B]: { mobile: null } });
    const logs: string[] = [];
    const repos = { consent, systemLogs: { write: async (row: { summary: string }) => void logs.push(row.summary) } } as unknown as ConsentRepos;
    const unit = { run: async (_s: unknown, work: (r: ConsentRepos) => Promise<unknown>) => work(repos) } as never;
    const people = { get: async () => new Map([["u1", { name: "Rajiv" }]]) } as never;
    const service = createConsentService({ unit, people, catalog: {} as Catalog, now: () => new Date("2026-11-04T10:00:00Z") });

    assert.deepEqual(await service.get(session, A), { on: false, at: null, hasMobile: true });
    assert.deepEqual(await service.set(session, A, true, meta), { on: true, at: "2026-11-04T10:00:00.000Z", hasMobile: true });
    await service.set(session, A, true, meta);
    assert.equal(consent.state.get(A)?.by, "u1");
    assert.equal((await service.set(session, A, false, meta)).on, false);
    await fails(service.set(session, B, true, meta), "CONFLICT");
    await fails(service.get(session, "00000000-0000-4000-8000-0000000000ff"), "NOT_FOUND");
    assert.deepEqual(logs, ["Guest agreed to WhatsApp messages", "Guest's WhatsApp agreement withdrawn"]);
    await fails(service.set({ ...session, token: { id: "t" } } as unknown as VerifiedSession, A, true, meta), "FORBIDDEN");
  });
});
