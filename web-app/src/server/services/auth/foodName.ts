import "server-only";

// The hotel's food business name as GET /auth/session and the shell seed send it (hotel setting general.food_name, else the food payroll company PF01).
// Reading it opens the hotel's own schema (BEGIN, the role prelude, the SELECT, COMMIT) on every signed-in page load, so the answer is kept in this process
// for a minute per hotel. Saving Settings > General forgets it here at once (forgetFoodName), and every other instance follows within the minute.

/** How long a hotel's food name is trusted without reading the hotel's settings again. */
export const FOOD_NAME_CACHE_MS = 60_000;

const cache = new Map<string, { value: string | null; until: number }>();

/** The hotel's food name through the cache: `read` runs only when there is no fresh copy. A read that throws is not kept (the caller treats it as "not set"). */
export async function cachedFoodName(hotelId: string, read: (hotelId: string) => Promise<string | null>, now: () => number = Date.now): Promise<string | null> {
  const hit = cache.get(hotelId);
  if (hit && hit.until > now()) return hit.value;
  const value = await read(hotelId);
  cache.set(hotelId, { value, until: now() + FOOD_NAME_CACHE_MS });
  return value;
}

/** Drops a hotel's cached food name (the setting was just saved in this process). */
export function forgetFoodName(hotelId: string): void {
  cache.delete(hotelId);
}
