// The room-service menu admin (Master Data, module masters), end to end through the REAL route files, the wrapper, the service and the in-memory hotel store:
// the three fixed groups, add / change / switch off / move / remove, plain-words field errors, permissions (view reads, edit changes), hotel isolation,
// the system log and the audit trail.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { POST as itemsPost } from "../../src/app/api/v1/admin/menu/items/route";
import { DELETE as itemDelete, PATCH as itemPatch } from "../../src/app/api/v1/admin/menu/items/[id]/route";
import { POST as itemMove } from "../../src/app/api/v1/admin/menu/items/[id]/move/route";
import { GET as menuGet } from "../../src/app/api/v1/admin/menu/route";
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
sessions.set("editor", makeSession({ userId: id(1), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "edit")] }));
sessions.set("viewer", makeSession({ userId: id(2), accountRole: "hotel_user", grants: [grant("masters", "view")] }));
sessions.set("nobody", makeSession({ userId: id(3), accountRole: "hotel_user" }));
sessions.set("editorB", makeSession({ userId: id(4), hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "edit")] }));
let hotel = createMemoryHotel();
const audits: { action: string }[] = [];

beforeEach(() => {
  hotel = createMemoryHotel();
  audits.length = 0;
  configureAdmin(
    buildAdminServices({
      unit: hotel.unit,
      people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) },
      audit: { record: async (e) => void audits.push(e) },
      catalog,
      now: () => new Date("2026-10-05T10:00:00+05:30"),
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
async function call(route: Route, method: string, who: string | null, body?: unknown, params: Record<string, string> = {}): Promise<{ status: number; data: any; error: any }> {
  const h: Record<string, string> = { host: "hms.test", origin: "https://hms.test" };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await route(new Request("https://hms.test/api/v1/admin/menu", { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
  const j = await res.json();
  return { status: res.status, data: j.data, error: j.error };
}
const add = (over: Record<string, unknown> = {}, who = "editor") => call(itemsPost, "POST", who, { group: "restaurant", name: "Paneer Butter Masala", note: null, pricePaise: 28000, available: true, ...over });
const names = async (group: string, who = "viewer") => (await call(menuGet, "GET", who)).data.find((g: { id: string }) => g.id === group).items.map((i: { name: string }) => i.name);
const logs = () => hotel.store.dataFor(HOTEL_A).systemLogs;

describe("the menu", () => {
  test("food only (MJ 26 Oct 2026): the Restaurant group, empty at first, with its label, business and kind", async () => {
    const r = await call(menuGet, "GET", "viewer");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.map((g: { id: string; label: string; business: string; kind: string; items: unknown[] }) => [g.id, g.label, g.business, g.kind, g.items.length]), [
      ["restaurant", "Restaurant", "food", "food", 0],
    ]);
  });

  test("add: the item goes to the end of its group with its price in whole paise; the note is trimmed or empty; logged and audited", async () => {
    const a = await add({ note: "  With raita  " });
    assert.equal(a.status, 201, JSON.stringify(a.error));
    assert.deepEqual([a.data.name, a.data.note, a.data.pricePaise, a.data.available], ["Paneer Butter Masala", "With raita", 28000, true]);
    await add({ name: "Dal Tadka", pricePaise: 19000, note: "" });
    assert.deepEqual(await names("restaurant"), ["Paneer Butter Masala", "Dal Tadka"]);
    const log = logs().at(-1)!;
    assert.deepEqual([log.module, log.action, log.entity, log.summary], ["masters", "created", "Room service menu", "Added Room service menu item: Dal Tadka"]);
    assert.deepEqual(audits.map((x) => x.action), ["master.menu_item_created", "master.menu_item_created"]);
  });

  test("plain-words field errors: no name, a long name or note, a price that is not whole paise or is out of range, an unknown group; the same name twice in a group (any case)", async () => {
    const err = async (over: Record<string, unknown>) => (await add(over));
    assert.equal((await err({ name: "  " })).error.details.fields.name, "Enter the name of the item.");
    assert.equal((await err({ name: "x".repeat(121) })).error.details.fields.name, "Keep the name under 120 characters.");
    assert.equal((await err({ note: "n".repeat(201) })).error.details.fields.note, "Keep the note under 200 characters.");
    for (const pricePaise of [-1, 10.5, 1_000_000_000]) assert.equal((await err({ pricePaise })).error.details.fields.pricePaise, "Enter a price between 0 and 99,99,999.99 rupees.", String(pricePaise));
    assert.equal((await err({ group: "spa" })).status, 422);
    assert.equal((await add()).status, 201);
    assert.equal((await add({ name: "PANEER butter masala" })).error.details.fields.name, "That item is already on this list.");
    for (const group of ["laundry", "service"]) assert.equal((await add({ group, name: "Shirt" })).error.details.fields.group, "Room service is food to the room only. Add the item to the Restaurant list.", group);
    assert.equal((await add({ pricePaise: 0, name: "Drinking water" })).status, 201, "free is a price");
  });

  test("change: name, note, price and the on/off switch; a name taken by another item is refused; the log names what changed; an unknown id is 404", async () => {
    const a = (await add()).data.id as string;
    const b = (await add({ name: "Dal Tadka" })).data.id as string;
    const r = await call(itemPatch, "PATCH", "editor", { name: "Paneer Butter Masala", note: "Spicy", pricePaise: 29000, available: false }, { id: a });
    assert.deepEqual([r.status, r.data.note, r.data.pricePaise, r.data.available], [200, "Spicy", 29000, false]);
    assert.deepEqual(logs().at(-1)!.details, { Changed: "note, pricePaise, available" });
    assert.equal((await call(itemPatch, "PATCH", "editor", { name: "dal tadka", note: null, pricePaise: 1, available: true }, { id: a })).error.details.fields.name, "That item is already on this list.");
    assert.equal((await call(itemPatch, "PATCH", "editor", { name: "X", note: null, pricePaise: 1, available: true }, { id: id(999) })).status, 404);
    void b;
  });

  test("move: swaps with the neighbour inside the group; at an end nothing happens", async () => {
    const a = (await add({ name: "A" })).data.id as string;
    const b = (await add({ name: "B" })).data.id as string;
    await add({ name: "C" });
    assert.deepEqual((await call(itemMove, "POST", "editor", { direction: "up" }, { id: b })).data, { id: b, moved: true });
    assert.deepEqual(await names("restaurant"), ["B", "A", "C"]);
    assert.equal((await call(itemMove, "POST", "editor", { direction: "up" }, { id: b })).data.moved, false);
    assert.deepEqual((await call(itemMove, "POST", "editor", { direction: "down" }, { id: a })).data.moved, true);
    assert.deepEqual(await names("restaurant"), ["B", "C", "A"]);
    assert.equal((await call(itemMove, "POST", "editor", { direction: "up" }, { id: id(999) })).status, 404);
  });

  test("remove: the item goes, the sentence says orders are not changed, the log and audit say Removed; removing again is 404", async () => {
    const a = (await add()).data.id as string;
    const r = await call(itemDelete, "DELETE", "editor", undefined, { id: a });
    assert.deepEqual([r.status, r.data.message], [200, '"Paneer Butter Masala" was removed from the menu. Orders already placed are not changed.']);
    assert.deepEqual(await names("restaurant"), []);
    assert.equal(logs().at(-1)!.summary, "Removed Room service menu item: Paneer Butter Masala");
    assert.equal(audits.at(-1)!.action, "master.menu_item_deleted");
    assert.equal((await call(itemDelete, "DELETE", "editor", undefined, { id: a })).status, 404);
  });
});

describe("who may, and which hotel", () => {
  test("view reads, edit changes, nobody gets 403, a stranger 401; another hotel sees and changes only its own menu", async () => {
    const a = (await add()).data.id as string;
    assert.equal((await call(menuGet, "GET", "viewer")).status, 200);
    for (const [route, method, body] of [[itemsPost, "POST", { group: "restaurant", name: "Tea", note: null, pricePaise: 100, available: true }], [itemPatch, "PATCH", { name: "Z", note: null, pricePaise: 1, available: true }], [itemDelete, "DELETE", undefined], [itemMove, "POST", { direction: "up" }]] as const) {
      assert.equal((await call(route, method, "viewer", body, { id: a })).status, 403, `${method} as viewer`);
      assert.equal((await call(route, method, "nobody", body, { id: a })).status, 403, `${method} as nobody`);
      assert.equal((await call(route, method, null, body, { id: a })).status, 401, `${method} anonymous`);
    }
    assert.equal((await call(menuGet, "GET", "nobody")).status, 403);
    assert.deepEqual(await names("restaurant", "editorB"), []);
    assert.equal((await call(itemDelete, "DELETE", "editorB", undefined, { id: a })).status, 404, "hotel A's item is absent for hotel B");
    assert.equal((await call(itemPatch, "PATCH", "editorB", { name: "Hijack", note: null, pricePaise: 1, available: true }, { id: a })).status, 404);
    assert.deepEqual(await names("restaurant"), ["Paneer Butter Masala"]);
  });
});
