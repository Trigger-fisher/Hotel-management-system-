// The WhatsApp terms gate (4 Nov 2026): the Hotel Admin accepts once, anyone with Conversations reads, a new version asks again, an API key is refused.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.terms.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createCatalog } from "@/server/auth/catalog";
import { PERMISSION_CATALOG } from "@/server/auth/catalog.generated";
import type { VerifiedSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { createTermsService, type TermsRepos } from "@/server/services/whatsapp/termsService";
import { termsAcceptanceOf, WA_TERMS_KEY, WA_TERMS_VERSION } from "@/server/whatsapp/terms";

const admin = { userId: "u1", hotelId: "h1", accountRole: "hotel_admin" } as unknown as VerifiedSession;
const meta = { ip: "127.0.0.1", traceId: "t" } as never;
const fails = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

describe("the WhatsApp terms", () => {
  test("not accepted -> the admin accepts (logged once) -> accepted; a second accept changes nothing; a user cannot accept", async () => {
    const store = new Map<string, string | null>();
    const logs: string[] = [];
    const repos = {
      adminSettings: { get: async (keys: readonly string[]) => keys.filter((k) => store.has(k)).map((k) => ({ key: k, value: store.get(k) ?? null })), set: async (rows: readonly { key: string; value: string | null }[]) => void rows.forEach((r) => store.set(r.key, r.value)) },
      systemLogs: { write: async (row: { summary: string }) => void logs.push(row.summary) },
    } as unknown as TermsRepos;
    const unit = { run: async (_s: unknown, work: (r: TermsRepos) => Promise<unknown>) => work(repos) } as never;
    const people = { get: async () => new Map([["u1", { name: "Rajiv" }]]) } as never;
    const service = createTermsService({ unit, people, catalog: createCatalog(PERMISSION_CATALOG), now: () => new Date("2026-11-04T10:00:00Z") });

    const before = await service.get(admin);
    assert.deepEqual([before.accepted, before.canAccept, before.version], [null, true, WA_TERMS_VERSION]);
    assert.ok(before.points.length >= 5);
    const after = await service.accept(admin, meta);
    assert.deepEqual(after.accepted, { at: "2026-11-04T10:00:00.000Z", byName: "Rajiv" });
    await service.accept(admin, meta);
    assert.deepEqual(logs, ["WhatsApp terms accepted"]);

    // a user (not the Hotel Admin) may read, never accept; an API key reads nothing
    const user = { ...admin, accountRole: "hotel_user", permissions: {} } as unknown as VerifiedSession;
    await fails(service.accept(user, meta), "FORBIDDEN");
    await fails(service.get({ ...user, token: { id: "t" } } as unknown as VerifiedSession), "FORBIDDEN");
  });

  test("only the current version counts; a broken value is not an acceptance", () => {
    const ok = JSON.stringify({ version: WA_TERMS_VERSION, at: "2026-11-04T10:00:00Z", by: "u1" });
    assert.ok(termsAcceptanceOf(ok));
    assert.equal(termsAcceptanceOf(JSON.stringify({ version: "2025-01", at: "x", by: "u" })), null);
    assert.equal(termsAcceptanceOf("not json"), null);
    assert.equal(termsAcceptanceOf(null), null);
    assert.equal(WA_TERMS_KEY, "whatsapp.terms");
  });
});
