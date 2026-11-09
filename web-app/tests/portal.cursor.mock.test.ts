// The portal mocks page by cursor and leave out unreachable hotels exactly like the server (ui-shared/dashboards/portalCursor.mock.ts): limit + cursor in, nextCursor / total /
// unavailable out, the stable order (date newest first, hotel, id), a cursor bound to its list and filters, and a hotel down on demand. Run with `node --test tests/portal.cursor.mock.test.ts`.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { createCorporateApi } = await import("../../common/ui-shared/dashboards/corporate.mock");
const { createPortalNotificationsMock } = await import("../../common/ui-shared/dashboards/notifications.mock");
const { createGuestHotelsMock, createPortalHotelsMock } = await import("../../common/ui-shared/dashboards/portalHotels.mock");
const { setMockUnreachableHotels } = await import("../../common/ui-shared/dashboards/portalCursor.mock");
const { portalHotelStore, PORTAL_ALL_HOTELS } = await import("../../common/ui-shared/dashboards/portalHotel");

const corp = createCorporateApi({ latencyMs: 0 } as never);
const notes = createPortalNotificationsMock({ latencyMs: 0 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the results are checked field by field
const data = (r: any) => {
  assert.equal(r.ok, true, JSON.stringify(r.error ?? ""));
  return r.data;
};

afterEach(() => {
  setMockUnreachableHotels([]);
  portalHotelStore.set(PORTAL_ALL_HOTELS);
});

describe("cursor paging in the mocks", () => {
  test("the ledger by cursor (10 at a time) gives every row once, in the same order as one big page; the last page has no cursor", async () => {
    const big = data(await corp.getLedgerAccount({ limit: 100 }));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = data(await corp.getLedgerAccount({ limit: 10, ...(cursor ? { cursor } : {}) }));
      seen.push(...page.items.map((r: { id: string }) => r.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    assert.deepEqual(seen, big.items.map((r: { id: string }) => r.id));
    assert.equal(new Set(seen).size, seen.length);
    assert.equal(big.nextCursor, null);
    const keys = big.items.map((r: { date: string; hotelId: string; id: string }) => [r.date, r.hotelId, r.id]);
    assert.deepEqual(keys, [...keys].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? 1 : -1)));
  });

  test("a cursor used with another search or hotel is a 422 on cursor; a limit that is not 10, 25, 50 or 100 is refused; no limit = the old pages", async () => {
    const first = data(await corp.getLedgerAccount({ limit: 10 }));
    assert.ok(first.nextCursor);
    const wrong = await corp.getLedgerAccount({ limit: 10, cursor: first.nextCursor, search: "Mehta" });
    assert.equal(wrong.ok, false);
    assert.ok(!wrong.ok && wrong.error.details?.fields?.cursor);
    portalHotelStore.set("h-1");
    assert.equal((await corp.getLedgerAccount({ limit: 10, cursor: first.nextCursor })).ok, false);
    assert.equal((await corp.listDueBills({ limit: 7 as never })).ok, false);
    const old = data(await corp.listDueBills({ page: 1, pageSize: 10 }));
    assert.deepEqual([old.page, old.nextCursor], [1, null]);
  });

  test("notifications page by cursor too", async () => {
    const big = data(await notes.list({ limit: 100 }));
    const first = data(await notes.list({ limit: 10 }));
    assert.deepEqual(first.items.map((i: { id: string }) => i.id), big.items.slice(0, 10).map((i: { id: string }) => i.id));
    assert.deepEqual(first.unavailable, []);
  });
});

describe("a hotel that cannot be reached, on demand", () => {
  test("its rows leave every list, the dashboard, notifications and the summaries, and it is named in unavailable", async () => {
    setMockUnreachableHotels(["h-2"]);
    const due = data(await corp.listDueBills({}));
    assert.ok(due.items.every((r: { hotelId: string }) => r.hotelId !== "h-2"));
    assert.deepEqual(due.unavailable, [{ hotelId: "h-2", hotelName: "Sunrise Residency, Surat" }]);
    assert.deepEqual(data(await corp.getDashboard()).unavailable.map((u: { hotelId: string }) => u.hotelId), ["h-2"]);
    assert.ok(data(await notes.list({})).items.every((i: { hotelId: string }) => i.hotelId !== "h-2"));
    assert.deepEqual(data(await createPortalHotelsMock({ latencyMs: 0 }).summary()).unavailable.map((u: { hotelId: string }) => u.hotelId), ["h-2"]);
    assert.deepEqual(data(await createGuestHotelsMock({ latencyMs: 0 }).summary()).unavailable.map((u: { hotelId: string }) => u.hotelId), ["h-2"]);
  });

  test("every hotel down is the server's 503 sentence", async () => {
    setMockUnreachableHotels(["h-1", "h-2", "h-3"]);
    const r = await corp.listDueBills({});
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.error.code === "NETWORK_OFFLINE" && /None of your hotels/.test(r.error.message));
  });
});
