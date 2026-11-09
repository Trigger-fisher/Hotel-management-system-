// The per-process cache of a hotel's food business name (services/auth/foodName.ts): one read per hotel per minute, forgotten at once when the setting is saved.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cachedFoodName, FOOD_NAME_CACHE_MS, forgetFoodName } from "../../src/server/services/auth/foodName";

const HOTEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("the food name cache", () => {
  test("two calls inside a minute read once; forgetFoodName makes the next call read again; the minute passing does too; hotels do not share", async () => {
    let at = 1_000_000;
    const reads: string[] = [];
    const read = async (hotelId: string): Promise<string | null> => (reads.push(hotelId), hotelId === HOTEL ? "Sunrise Food" : null);
    const now = () => at;
    assert.equal(await cachedFoodName(HOTEL, read, now), "Sunrise Food");
    assert.equal(await cachedFoodName(HOTEL, read, now), "Sunrise Food");
    assert.deepEqual(reads, [HOTEL], "one database read");
    assert.equal(await cachedFoodName(OTHER, read, now), null);
    assert.equal(await cachedFoodName(OTHER, read, now), null, "a null answer is kept too");
    assert.deepEqual(reads, [HOTEL, OTHER]);
    forgetFoodName(HOTEL);
    await cachedFoodName(HOTEL, read, now);
    assert.deepEqual(reads, [HOTEL, OTHER, HOTEL], "forgotten: read again");
    at += FOOD_NAME_CACHE_MS + 1;
    await cachedFoodName(HOTEL, read, now);
    assert.equal(reads.length, 4, "a minute later: read again");
  });

  test("a read that fails is not kept: the next call reads again", async () => {
    let calls = 0;
    const failing = async (): Promise<string | null> => {
      calls += 1;
      throw new Error("down");
    };
    await assert.rejects(() => cachedFoodName(OTHER + "x", failing), /down/);
    await assert.rejects(() => cachedFoodName(OTHER + "x", failing), /down/);
    assert.equal(calls, 2);
  });
});
