// The expense catalogue admin (Pallav ExpenseCatalogController / masters/_catalog), end to end through the REAL route files, the wrapper, the service and the
// in-memory hotel store: categories and priced items per business, mirroring by name with scope "both", Pallav's words, permissions, hotel isolation.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { DELETE as deleteCategory, PATCH as renameCategory } from "../../src/app/api/v1/admin/masters/catalog/categories/[id]/route";
import { POST as createItem } from "../../src/app/api/v1/admin/masters/catalog/categories/[id]/items/route";
import { DELETE as deleteItem, PATCH as updateItem } from "../../src/app/api/v1/admin/masters/catalog/items/[id]/route";
import { GET as getCatalog } from "../../src/app/api/v1/admin/masters/[key]/catalog/route";
import { POST as createCategory } from "../../src/app/api/v1/admin/masters/[key]/catalog/categories/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("super", id(1), { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] });
mk("editor", id(2), { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "edit")] });
mk("viewer", id(3), { grants: [grant("masters", "view")] });
mk("nobody", id(4), {});
mk("superB", id(5), { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] });

const audits: { action: string; item: unknown }[] = [];
let hotel = createMemoryHotel();

function wire(): void {
  hotel = createMemoryHotel();
  audits.length = 0;
  configureAdmin(
    buildAdminServices({
      unit: hotel.unit,
      people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) },
      audit: { record: async (e) => void audits.push({ action: e.action, item: e.details.item }) },
      catalog,
      now: () => new Date("2026-10-05T10:00:00+05:30"),
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = async (res: Response, status = 200): Promise<any> => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const HK = "expense_catalog_hotel";
const FK = "expense_catalog_food";
const q = (scope: string) => (scope ? `?scope=${scope}` : "");
const get = async (key: string, scope = "", who = "super") => ok(await getCatalog(req("GET", `/api/v1/admin/masters/${key}/catalog${q(scope)}`, who), ctx({ key })));
const addCat = (key: string, name: unknown, scope = "", who = "super") => createCategory(req("POST", `/api/v1/admin/masters/${key}/catalog/categories${q(scope)}`, who, { name }), ctx({ key }));
const rename = (cid: string, name: unknown, scope = "", who = "super") => renameCategory(req("PATCH", `/api/v1/admin/masters/catalog/categories/${cid}${q(scope)}`, who, { name }), ctx({ id: cid }));
const dropCat = (cid: string, scope = "", who = "super") => deleteCategory(req("DELETE", `/api/v1/admin/masters/catalog/categories/${cid}${q(scope)}`, who), ctx({ id: cid }));
const addItem = (cid: string, body: unknown, scope = "", who = "super") => createItem(req("POST", `/api/v1/admin/masters/catalog/categories/${cid}/items${q(scope)}`, who, body), ctx({ id: cid }));
const editItem = (iid: string, body: unknown, scope = "", who = "super") => updateItem(req("PATCH", `/api/v1/admin/masters/catalog/items/${iid}${q(scope)}`, who, body), ctx({ id: iid }));
const dropItem = (iid: string, scope = "", who = "super") => deleteItem(req("DELETE", `/api/v1/admin/masters/catalog/items/${iid}${q(scope)}`, who), ctx({ id: iid }));
const fieldsOf = async (res: Response) => (await json(res)).error.details.fields;

beforeEach(wire);

describe("categories", () => {
  test("empty at first; an unknown list is 404; create on 'both' adds the category to both businesses (Pallav words)", async () => {
    assert.deepEqual(await get(HK), { setKey: HK, business: "hotel", scope: "both", categories: [] });
    assert.equal((await getCatalog(req("GET", "/api/v1/admin/masters/shift/catalog", "super"), ctx({ key: "shift" }))).status, 404);
    const made = await ok(await addCat(HK, "  Cleaning  "), 201);
    assert.equal(made.category.name, "Cleaning");
    assert.equal(made.message, '"Cleaning" added to both businesses.');
    assert.deepEqual((await get(FK)).categories.map((c: { name: string; shared: boolean }) => [c.name, c.shared]), [["Cleaning", true]]);
    assert.deepEqual((await get(HK)).categories.map((c: { name: string; shared: boolean }) => [c.name, c.shared]), [["Cleaning", true]]);
    assert.ok(audits.some((a) => a.action === "master.catalog_category_created"));
  });

  test("on one business only: not mirrored, not shared, hidden from the 'both' view; the name must be new on that business, case-insensitively", async () => {
    const made = await ok(await addCat(HK, "Laundry", "hotel"), 201);
    assert.equal(made.message, '"Laundry" added to Hotel Pallav.');
    assert.deepEqual((await get(FK)).categories, []);
    assert.deepEqual((await get(HK, "hotel")).categories.map((c: { name: string; shared: boolean }) => [c.name, c.shared]), [["Laundry", false]]);
    assert.deepEqual((await get(HK, "both")).categories, [], "'both' keeps only what both businesses have");
    const dup = await addCat(HK, "LAUNDRY", "hotel");
    assert.deepEqual([dup.status, (await fieldsOf(dup)).name], [422, "That category is already on this list."]);
    assert.equal((await fieldsOf(await addCat(HK, "   "))).name, "The name field is required.");
    assert.equal((await fieldsOf(await addCat(HK, "x".repeat(81)))).name, "The name field must not be greater than 80 characters.");
    assert.equal((await addCat(HK, "x".repeat(80), "hotel")).status, 201);
    // a 'both' create next to an existing twin by name adds nothing twice
    await ok(await addCat(FK, "Laundry", "both"), 201);
    assert.deepEqual((await get(HK, "both")).categories.map((c: { name: string; shared: boolean }) => [c.name, c.shared]), [["Laundry", true]]);
  });

  test("rename: with 'both' the twin follows; a name already on the list is refused; unknown id is 404", async () => {
    const a = (await ok(await addCat(HK, "Garden"), 201)).category;
    await ok(await addCat(HK, "Pool"), 201);
    assert.equal((await rename(a.id, "pool")).status, 422);
    const r = await ok(await rename(a.id, "Lawn"));
    assert.deepEqual([r.category.name, r.message], ["Lawn", "Category renamed in both businesses."]);
    assert.deepEqual((await get(FK)).categories.map((c: { name: string }) => c.name).sort(), ["Lawn", "Pool"]);
    const only = await ok(await rename(a.id, "Grass", "hotel"));
    assert.equal(only.message, "Category renamed.");
    assert.ok((await get(FK, "food")).categories.some((c: { name: string }) => c.name === "Lawn"), "the other business keeps its name");
    assert.equal((await rename(id(999), "Whatever")).status, 404);
  });

  test("delete is final: the category and its items go (both businesses on 'both'); Pallav's words; unknown is 404", async () => {
    const c = (await ok(await addCat(HK, "Repairs"), 201)).category;
    await ok(await addItem(c.id, { name: "Bulb", pricePaise: 12000 }), 201);
    const gone = await ok(await dropCat(c.id));
    assert.equal(gone.message, '"Repairs" removed from both businesses. Expenses already recorded keep what they were saved with.');
    assert.deepEqual([(await get(HK)).categories, (await get(FK)).categories], [[], []]);
    assert.equal(hotel.store.dataFor(HOTEL_A).catalogRows.length, 0, "hard delete: nothing is kept");
    assert.equal((await dropCat(c.id)).status, 404);
  });
});

describe("items", () => {
  test("create with a price, mirrored on 'both'; the same name twice in a category is refused; Pallav's price words", async () => {
    const c = (await ok(await addCat(HK, "Cleaning"), 201)).category;
    const made = await ok(await addItem(c.id, { name: " Mop ", pricePaise: 25050 }), 201);
    assert.deepEqual(made.item, { id: made.item.id, name: "Mop", pricePaise: 25050 });
    assert.equal(made.message, '"Mop" added to both businesses.');
    const food = (await get(FK)).categories[0];
    assert.deepEqual(food.items.map((i: { name: string; pricePaise: number; shared: boolean }) => [i.name, i.pricePaise, i.shared]), [["Mop", 25050, true]]);
    const dup = await addItem(c.id, { name: "mop", pricePaise: 1 });
    assert.deepEqual([dup.status, (await fieldsOf(dup)).name], [422, "That item is already in this category."]);
    const cases: [unknown, string, string][] = [
      [{ name: "", pricePaise: 5 }, "name", "The name field is required."],
      [{ name: "y".repeat(81), pricePaise: 5 }, "name", "The name field must not be greater than 80 characters."],
      [{ name: "A", pricePaise: null }, "price", "The price field is required."],
      [{ name: "A" }, "price", "The price field is required."],
      [{ name: "A", pricePaise: 1.5 }, "price", "The price field is required."],
      [{ name: "A", pricePaise: -1 }, "price", "The price field must be at least 0."],
      [{ name: "A", pricePaise: 1_000_000_000 }, "price", "The price field must not be greater than 9999999.99."],
    ];
    for (const [body, field, text] of cases) assert.equal((await fieldsOf(await addItem(c.id, body)))[field], text, JSON.stringify(body));
    assert.equal((await addItem(c.id, { name: "Free item", pricePaise: 0 })).status, 201, "a price of 0 is allowed");
    assert.equal((await addItem(c.id, { name: "Dear item", pricePaise: 999_999_999 })).status, 201, "9,999,999.99 is the largest price");
    assert.equal((await addItem(id(998), { name: "A", pricePaise: 1 })).status, 404);
    assert.equal((await addItem(c.id, { name: "A", pricePaise: 1, extra: true })).status, 422, "strict body");
  });

  test("on one business only an item stays there; update changes name and price (the twin follows on 'both'); delete removes it (and the twin)", async () => {
    const c = (await ok(await addCat(HK, "Kitchen"), 201)).category;
    const mop = (await ok(await addItem(c.id, { name: "Gas", pricePaise: 90000 }, "hotel"), 201)).item;
    assert.equal((await get(FK)).categories[0].items.length, 0);
    const both = (await ok(await addItem(c.id, { name: "Salt", pricePaise: 2000 }), 201)).item;
    const upd = await ok(await editItem(both.id, { name: "Sea salt", pricePaise: 3000 }));
    assert.deepEqual([upd.item.name, upd.item.pricePaise, upd.message], ["Sea salt", 3000, "Item updated in both businesses."]);
    assert.deepEqual((await get(FK)).categories[0].items.map((i: { name: string; pricePaise: number }) => [i.name, i.pricePaise]), [["Sea salt", 3000]]);
    const alone = await ok(await editItem(mop.id, { name: "Gas cylinder", pricePaise: 95000 }, "hotel"));
    assert.equal(alone.message, "Item updated.");
    assert.equal((await editItem(mop.id, { name: "Sea salt", pricePaise: 1 })).status, 422, "another item of the category has that name");
    assert.equal((await editItem(id(997), { name: "A", pricePaise: 1 })).status, 404);
    const del = await ok(await dropItem(both.id));
    assert.equal(del.message, '"Sea salt" removed from both businesses. Expenses already recorded keep it.');
    assert.deepEqual((await get(FK)).categories[0].items, []);
    assert.deepEqual((await get(HK, "hotel")).categories[0].items.map((i: { name: string }) => i.name), ["Gas cylinder"]);
    assert.equal((await dropItem(both.id)).status, 404);
  });

  test("the 'both' view keeps only shared categories and shared items", async () => {
    const c = (await ok(await addCat(HK, "Mixed"), 201)).category;
    await ok(await addItem(c.id, { name: "Shared", pricePaise: 100 }), 201);
    await ok(await addItem(c.id, { name: "Hotel only", pricePaise: 200 }, "hotel"), 201);
    assert.deepEqual((await get(HK, "both")).categories[0].items.map((i: { name: string; shared: boolean }) => [i.name, i.shared]), [["Shared", true]]);
    assert.deepEqual((await get(HK, "hotel")).categories[0].items.map((i: { name: string; shared: boolean }) => [i.name, i.shared]), [["Shared", true], ["Hotel only", false]]);
  });
});

describe("permissions and isolation", () => {
  test("view reads; edit (the highest level the Masters module offers) creates, changes and removes; nobody gets 403; no session 401", async () => {
    const c = (await ok(await addCat(HK, "Perm"), 201)).category;
    const it = (await ok(await addItem(c.id, { name: "I", pricePaise: 1 }), 201)).item;
    assert.equal((await getCatalog(req("GET", `/api/v1/admin/masters/${HK}/catalog`, "viewer"), ctx({ key: HK }))).status, 200);
    assert.equal((await addCat(HK, "X", "", "viewer")).status, 403);
    assert.equal((await addCat(HK, "Edited", "", "editor")).status, 201);
    assert.equal((await rename(c.id, "Perm2", "", "editor")).status, 200);
    assert.equal((await editItem(it.id, { name: "I2", pricePaise: 2 }, "", "editor")).status, 200);
    assert.equal((await dropItem(it.id, "", "viewer")).status, 403);
    assert.equal((await dropCat(c.id, "", "viewer")).status, 403);
    assert.equal((await getCatalog(req("GET", `/api/v1/admin/masters/${HK}/catalog`, "nobody"), ctx({ key: HK }))).status, 403);
    assert.equal((await getCatalog(req("GET", `/api/v1/admin/masters/${HK}/catalog`, null), ctx({ key: HK }))).status, 401);
    assert.equal((await dropItem(it.id, "", "editor")).status, 200);
    assert.equal((await dropCat(c.id, "", "editor")).status, 200);
  });

  test("another hotel's SuperAdmin sees an empty catalogue and cannot reach this hotel's category or item", async () => {
    const c = (await ok(await addCat(HK, "Private"), 201)).category;
    const it = (await ok(await addItem(c.id, { name: "Secret", pricePaise: 10 }), 201)).item;
    assert.deepEqual((await get(HK, "", "superB")).categories, []);
    assert.equal((await rename(c.id, "Hijack", "", "superB")).status, 404);
    assert.equal((await dropCat(c.id, "", "superB")).status, 404);
    assert.equal((await editItem(it.id, { name: "Hijack", pricePaise: 1 }, "", "superB")).status, 404);
    assert.equal((await dropItem(it.id, "", "superB")).status, 404);
    assert.equal((await addItem(c.id, { name: "Planted", pricePaise: 1 }, "", "superB")).status, 404);
    assert.deepEqual((await get(HK)).categories.map((x: { name: string }) => x.name), ["Private"]);
  });
});
