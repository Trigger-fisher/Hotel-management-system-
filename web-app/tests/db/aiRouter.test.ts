// The AI router (MJ, 3 Nov 2026): which AI database serves a scope. Like the shard router, but it REFUSES where the shard router falls back.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AiRefused, aiUrlName, aiUrlsFrom, createAiRouter, type AiRoute, type AiScope } from "../../src/db/aiRouter";

const hotel = (id: string): AiScope => ({ kind: "hotel", hotelId: id });
const route = (over: Partial<AiRoute> = {}): AiRoute => ({ databaseKey: "ai-1", enabled: true, features: ["ask"], dailyRequestLimit: 200, monthlyBudgetPaise: 0, ...over });
const refusal = async (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e: unknown) => (e instanceof AiRefused ? e.reason : "OTHER"));

describe("the AI router", () => {
  test("a hotel with no route is refused, never given a default", async () => {
    const router = createAiRouter({ lookup: async () => null, connect: () => "db" });
    assert.equal(await refusal(router.resolve(hotel("a"))), "NO_ROUTE");
  });

  test("a route that is switched off is refused, and so is a feature the route does not list", async () => {
    const off = createAiRouter({ lookup: async () => route({ enabled: false }), connect: () => "db" });
    assert.equal(await refusal(off.resolve(hotel("a"))), "SWITCHED_OFF");
    const on = createAiRouter({ lookup: async () => route({ features: ["ask"] }), connect: () => "db" });
    assert.equal(await refusal(on.resolve(hotel("a"), "search")), "FEATURE_OFF");
    assert.equal((await on.resolve(hotel("a"), "ask")).database, "db");
    const none = createAiRouter({ lookup: async () => route({ features: [] }), connect: () => "db" });
    assert.equal(await refusal(none.resolve(hotel("a"), "ask")), "FEATURE_OFF", "an empty list means nothing is allowed");
  });

  test("each hotel reaches only the database of its own route", async () => {
    const map: Record<string, AiRoute> = { a: route({ databaseKey: "ai-1" }), b: route({ databaseKey: "ai-2" }) };
    const router = createAiRouter({ lookup: async (s) => (s.kind === "hotel" ? (map[s.hotelId] ?? null) : null), connect: (k) => `conn:${k}` });
    assert.equal((await router.resolve(hotel("a"))).database, "conn:ai-1");
    assert.equal((await router.resolve(hotel("b"))).database, "conn:ai-2");
    assert.equal(await refusal(router.resolve(hotel("c"))), "NO_ROUTE");
  });

  test("a group and the platform have routes of their own, apart from any hotel", async () => {
    const router = createAiRouter({
      lookup: async (s) => (s.kind === "group" ? route({ databaseKey: "g" }) : s.kind === "platform" ? route({ databaseKey: "p" }) : null),
      connect: (k) => `conn:${k}`,
    });
    assert.equal((await router.resolve({ kind: "group", groupId: "x" })).database, "conn:g");
    assert.equal((await router.resolve({ kind: "platform" })).database, "conn:p");
    assert.equal(await refusal(router.resolve(hotel("a"))), "NO_ROUTE");
  });

  test("a database with no address on this server is refused", async () => {
    const router = createAiRouter({ lookup: async () => route(), connect: () => null });
    assert.equal(await refusal(router.resolve(hotel("a"))), "NO_DATABASE");
  });

  test("when the map cannot be read AI is refused (not the main database), and the next request asks again", async () => {
    let reads = 0;
    let down = true;
    const router = createAiRouter({ lookup: async () => { reads++; if (down) throw new Error("down"); return route(); }, connect: () => "db" });
    assert.equal(await refusal(router.resolve(hotel("a"))), "MAP_UNAVAILABLE");
    down = false;
    assert.equal((await router.resolve(hotel("a"))).database, "db");
    assert.equal(reads, 2, "the failure was not remembered");
  });

  test("a route is remembered for a minute, a switch turned off shows after that, and forget shows it at once", async () => {
    let t = 0;
    let reads = 0;
    let on = true;
    const router = createAiRouter({ lookup: async () => { reads++; return route({ enabled: on }); }, connect: () => "db", now: () => t });
    await router.resolve(hotel("a"));
    await router.resolve(hotel("a"));
    assert.equal(reads, 1);
    on = false;
    assert.equal((await router.resolve(hotel("a"))).route.enabled, true, "still remembered");
    t = 61_000;
    assert.equal(await refusal(router.resolve(hotel("a"))), "SWITCHED_OFF");
    on = true;
    router.forget(hotel("a"));
    assert.equal((await router.resolve(hotel("a"))).route.enabled, true, "forgotten, so read again");
  });

  test("the setting of an AI database key, and the databases named in the environment", () => {
    assert.equal(aiUrlName("eu-1"), "DATABASE_URL_AI_EU_1");
    assert.deepEqual(aiUrlsFrom({ DATABASE_URL_AI_EU_1: "x", DATABASE_URL_AI_EMPTY: "", DATABASE_URL: "y", DATABASE_URL_SHARD_EU_1: "z" }), { DATABASE_URL_AI_EU_1: "x" });
  });
});
