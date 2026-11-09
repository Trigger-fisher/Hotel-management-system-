// Admin core, slice 1: plan rates, master lists and settings, end to end through the REAL route files, the wrapper, the services and the in-memory
// hotel store (the SAME store as billing: a saved plan rate is what a bill is priced from, the option lists feed every form, and the general settings
// print on a bill). Expected behaviour: docs/specs/admin.md (each rule cites Pallav).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { DELETE as deleteItemRoute, PATCH as updateItemRoute } from "../../src/app/api/v1/admin/masters/items/[id]/route";
import { POST as moveItemRoute } from "../../src/app/api/v1/admin/masters/items/[id]/move/route";
import { POST as toggleItemRoute } from "../../src/app/api/v1/admin/masters/items/[id]/toggle/route";
import { POST as createItemRoute } from "../../src/app/api/v1/admin/masters/[key]/items/route";
import { DELETE as deleteSetRoute, GET as listRoute } from "../../src/app/api/v1/admin/masters/[key]/route";
import { GET as railRoute } from "../../src/app/api/v1/admin/masters/route";
import { DELETE as deleteRateRoute } from "../../src/app/api/v1/admin/plan-rates/[id]/route";
import { GET as panelRoute, POST as saveRateRoute } from "../../src/app/api/v1/admin/plan-rates/route";
import { PATCH as updateSettingsRoute } from "../../src/app/api/v1/admin/settings/[group]/route";
import { GET as settingsRoute } from "../../src/app/api/v1/admin/settings/route";
import { GET as settingsMapRoute } from "../../src/app/api/v1/admin/settings/map/route";
import { buildSettingsMap } from "../../src/server/services/admin/settingsMapService";
import { adminCopy } from "@shared/dashboards/admin";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { isSealedSmtpSecret, openSmtpSecret } from "../../src/server/mail/smtp";
import { randomBytes } from "node:crypto";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { activeOptionItems } from "../../src/server/repos/memory/admin";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { OptionItemRecord, OptionSetRecord } from "../../src/server/repos/admin";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";
import { platformSetupSession } from "../../src/server/auth/secretSettings";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([
  [id(1), { id: id(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
  [id(2), { id: id(2), name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("super", id(1), { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full"), grant("bills", "full")] });
// the platform owner inside the hotel on a full visit (the hotel gives the visitor its SuperAdmin role)
sessions.set("owner", { ...makeSession({ userId: id(7), client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] }), visit: { id: "v1", hotelId: HOTEL_A, hotelName: "Hotel A", expiresAt: new Date("2030-01-01"), access: "full", by: "super_admin" } });
// the Super Admin on this hotel's secret set-up from the Set-up centre (MJ, 5 Nov 2026): the only session the mail server, online payments and backup groups accept
sessions.set("setup", platformSetupSession(makeSession({ userId: id(1), hotelId: "", client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] }), HOTEL_A));
mk("admin", id(2), { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "edit")] });
mk("viewer", id(3), { grants: [grant("masters", "view")] });
mk("nobody", id(4), {});
mk("superB", id(5), { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
const SMTP_KEY = randomBytes(32);
let hotel = createMemoryHotel();
const audits: { action: string; item: unknown }[] = [];
const data = (h = HOTEL_A) => hotel.store.dataFor(h);

const set = (key: string, name: string, over: Partial<OptionSetRecord> = {}): OptionSetRecord => ({ id: id(900 + data().optionSetRows.length), key, name, description: null, icon: "bi-list", input: "select", isSystem: false, sortOrder: data().optionSetRows.length + 1, ...over });
function seedList(key: string, name: string, labels: string[], over: Partial<OptionSetRecord> = {}, hotelId = HOTEL_A): OptionSetRecord {
  const d = data(hotelId);
  const s = set(key, name, over);
  s.id = id((hotelId === HOTEL_A ? 900 : 5900) + d.optionSetRows.length);
  d.optionSetRows.push(s);
  labels.forEach((label, i) => d.optionItemRows.push({ id: id((hotelId === HOTEL_A ? 2000 : 7000) + d.optionItemRows.length), setId: s.id, label, value: label, color: null, isActive: true, isDefault: i === 0, sortOrder: i + 1 } satisfies OptionItemRecord));
  return s;
}

function wire(): void {
  hotel = createMemoryHotel();
  audits.length = 0;
  const now = () => clock;
  configureAdmin(
    buildAdminServices({
      unit: hotel.unit,
      people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) },
      audit: { record: async (e) => void audits.push({ action: e.action, item: e.details.item }) },
      catalog,
      now,
      smtpSecretKey: SMTP_KEY,
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  seedList("hotel_plan", "Plan", ["EP", "CP", "MAP", "AP"], { isSystem: true });
  seedList("payment_mode", "Payment Mode", ["Cash", "Card", "UPI"], { isSystem: true });
  seedList("shift", "Shift", ["Morning", "Night"]);
  seedList("cash_person_hotel", "Receivers (Hotel)", ["Suresh", "mahesh", "Anil"]);
  seedList("cash_person_food", "Receivers (Food)", ["Suresh", "Dinesh"]);
  seedList("expense_catalog_hotel", "Misc catalogue (Hotel)", []);
  seedList("expense_catalog_food", "Misc catalogue (Food)", []);
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, ...headers };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const fields = async (res: Response) => (await json(res)).error.details.fields;
const message = async (res: Response) => (await json(res)).error.message;
const ok = async <T>(res: Response, status = 200): Promise<T> => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data as T;
};

const rate = (who: string, body: Record<string, unknown>) => saveRateRoute(req("POST", "/api/v1/admin/plan-rates", who, { note: "", ...body }), ctx());
const panel = async (who = "super") => ok<{ plans: { value: string; label: string }[]; rates: Record<string, { id: string; plan: string; effectiveFrom: string; ratePaise: number; note: string; createdByName: string }[]>; today: string; owedThisMonthPaise: number }>(await panelRoute(req("GET", "/api/v1/admin/plan-rates", who), ctx()));
type Row = { id: string; label: string; value: string; color: string | null; isActive: boolean; isDefault: boolean; sortOrder: number; shared: boolean };
type List = { set: { key: string; name: string; isSystem: boolean; isNameOnly: boolean; isCatalog: boolean }; placement: { group: string; business: string } | null; sections: { key: string; setKey: string }[]; scope: string | null; rows: Row[] };
const list = async (key: string, scope = "", who = "super") => ok<List>(await listRoute(req("GET", `/api/v1/admin/masters/${key}${scope ? `?scope=${scope}` : ""}`, who), ctx({ key })));
const add = (key: string, body: Record<string, unknown>, scope = "", who = "super") => createItemRoute(req("POST", `/api/v1/admin/masters/${key}/items${scope ? `?scope=${scope}` : ""}`, who, { color: null, ...body }), ctx({ key }));
const itemsOf = (key: string, h = HOTEL_A) => {
  const d = data(h);
  const s = d.optionSetRows.find((x) => x.key === key)!;
  return d.optionItemRows.filter((i) => i.setId === s.id).sort((a, b) => a.sortOrder - b.sortOrder);
};

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("plan rates (MealPlanRateController)", () => {
  test("the panel: the active plans in their order, every rate newest date first grouped by plan, today and what the hotel owes this month", async () => {
    data().optionItemRows.find((i) => i.value === "AP")!.isActive = false;
    await ok(await rate("super", { plan: "CP", ratePaise: 25000, effectiveFrom: "2026-01-01" }));
    await ok(await rate("super", { plan: "CP", ratePaise: 27500, effectiveFrom: "2026-10-10" }));
    await ok(await rate("super", { plan: "MAP", ratePaise: 60000, effectiveFrom: "2026-01-01", note: "Season" }));
    data().bills.push({ billDate: "2026-10-03", planFoodAmountPaise: BigInt(210000) } as never, { billDate: "2026-09-30", planFoodAmountPaise: BigInt(999) } as never, { billDate: "2026-10-31", planFoodAmountPaise: BigInt(1000) } as never);
    const p = await panel();
    assert.deepEqual(p.plans, [{ value: "EP", label: "EP" }, { value: "CP", label: "CP" }, { value: "MAP", label: "MAP" }]);
    assert.deepEqual(p.rates.cp.map((r) => [r.effectiveFrom, r.ratePaise]), [["2026-10-10", 27500], ["2026-01-01", 25000]]);
    assert.deepEqual([p.rates.map?.[0]?.note, p.rates.map?.[0]?.createdByName, p.today, p.owedThisMonthPaise], ["Season", "Sonal Super", "2026-10-05", 211000]);
  });

  test("saving: one price per plan per date (a second one replaces it); the log says created or what changed; Pallav's words", async () => {
    const first = await ok<{ rate: { id: string; ratePaise: number }; message: string }>(await rate("super", { plan: "CP", ratePaise: 25000, effectiveFrom: "2026-10-01", note: "Autumn" }));
    assert.equal(first.message, "CP plan rate saved.");
    const log = data().systemLogs.at(-1)!;
    assert.deepEqual([log.module, log.action, log.entity, log.summary], ["masters", "created", "Plan rate", "Added Plan rate: CP from 01-10-2026"]);
    assert.deepEqual(log.details, { Plan: "CP", "Rate per person": 250, "Applies from": "01-10-2026", Note: "Autumn" });
    clock = new Date("2026-10-06T10:00:00+05:30");
    const again = await ok<{ rate: { id: string } }>(await rate("super", { plan: "CP", ratePaise: 26000, effectiveFrom: "2026-10-01", note: "Autumn" }));
    assert.equal(again.rate.id, first.rate.id, "the same row");
    assert.equal((await panel()).rates.cp.length, 1);
    assert.match(data().systemLogs.at(-1)!.summary, /^Changed Plan rate: CP from 01-10-2026 \(rate_per_person\)$/);
    // the rate is what a bill is priced from
    const table = await hotel.unit.run({ hotelId: HOTEL_A, userId: id(1) }, (repos) => repos.mealPlanRates.table());
    assert.deepEqual(table.map((t) => [t.plan, t.effectiveFrom, t.ratePaise]), [["CP", "2026-10-01", BigInt(26000)]]);

    let res = await rate("super", { plan: "XX", ratePaise: -5, effectiveFrom: "2026-02-30" });
    assert.deepEqual(await fields(res), { plan: "The selected plan is invalid.", ratePaise: "The rate per person field must be at least 0.", effectiveFrom: "The effective from field must be a valid date." });
    res = await rate("super", { plan: "CP", ratePaise: 10_000_001, effectiveFrom: "2026-10-01", note: "x".repeat(300) });
    assert.deepEqual(await fields(res), { ratePaise: "The rate per person field must not be greater than 100000.", note: "The note field must not be greater than 255 characters." });
    res = await rate("super", { plan: "", ratePaise: 1, effectiveFrom: "" });
    assert.equal(res.status, 422);
    // a plan hidden from forms is no longer offered here either
    data().optionItemRows.find((i) => i.value === "MAP")!.isActive = false;
    assert.deepEqual(await fields(await rate("super", { plan: "MAP", ratePaise: 1, effectiveFrom: "2026-10-01" })), { plan: "The selected plan is invalid." });
  });

  test("deleting: a bill already made keeps its amount; logged; refused to a viewer; a missing one is 404", async () => {
    const saved = await ok<{ rate: { id: string } }>(await rate("super", { plan: "CP", ratePaise: 25000, effectiveFrom: "2026-10-01" }));
    assert.equal((await deleteRateRoute(req("DELETE", `/api/v1/admin/plan-rates/${saved.rate.id}`, "viewer"), ctx({ id: saved.rate.id }))).status, 403);
    const out = await ok<{ message: string }>(await deleteRateRoute(req("DELETE", `/api/v1/admin/plan-rates/${saved.rate.id}`, "super"), ctx({ id: saved.rate.id })));
    assert.equal(out.message, "Rate removed. Bills already made keep the amount they were saved with.");
    assert.deepEqual([data().systemLogs.at(-1)!.action, data().systemLogs.at(-1)!.summary], ["deleted", "Removed Plan rate: CP from 01-10-2026"]);
    assert.equal((await deleteRateRoute(req("DELETE", `/api/v1/admin/plan-rates/${saved.rate.id}`, "super"), ctx({ id: saved.rate.id }))).status, 404);
  });

  test("permissions: the masters module (view to read, edit to save); no module is 403; another hotel sees only its own", async () => {
    assert.equal((await panelRoute(req("GET", "/api/v1/admin/plan-rates", "viewer"), ctx())).status, 200);
    assert.equal((await rate("viewer", { plan: "CP", ratePaise: 1, effectiveFrom: "2026-10-01" })).status, 403);
    assert.equal((await panelRoute(req("GET", "/api/v1/admin/plan-rates", "nobody"), ctx())).status, 403);
    assert.equal((await panelRoute(req("GET", "/api/v1/admin/plan-rates", null), ctx())).status, 401);
    await ok(await rate("super", { plan: "CP", ratePaise: 25000, effectiveFrom: "2026-10-01" }));
    const b = await panel("superB");
    assert.deepEqual([b.plans, b.rates], [[], {}]);
  });
});

describe("master lists (MasterDataController)", () => {
  test("the rail: a plain list says how many are in use; a list that exists once per business is ONE entry that opens on the hotel's first section", async () => {
    data().optionItemRows.find((i) => i.value === "Night")!.isActive = false;
    const rail = await ok<{ key: string; name: string; hint: string; count: number | null; grouped: boolean }[]>(await railRoute(req("GET", "/api/v1/admin/masters", "viewer"), ctx()));
    assert.deepEqual(rail.map((r) => [r.key, r.name, r.hint, r.count, r.grouped]), [
      ["hotel_plan", "Plan", "4 in use", 4, false],
      ["payment_mode", "Payment Mode", "3 in use", 3, false],
      ["shift", "Shift", "1 in use", 1, false],
      ["cash_person_hotel", "Expense", "Receiver Names · Miscellaneous", null, true],
    ]);
  });

  test("a plain list in its order; a list of names alphabetically (case ignored); a catalogue is flagged and has no rows here", async () => {
    assert.deepEqual((await list("shift")).rows.map((r) => r.label), ["Morning", "Night"]);
    const names = await list("cash_person_hotel", "hotel");
    assert.deepEqual(names.rows.map((r) => r.label), ["Anil", "mahesh", "Suresh"]);
    assert.deepEqual([names.set.isNameOnly, names.placement?.business, names.sections.map((s) => s.setKey)], [true, "hotel", ["cash_person_hotel", "expense_catalog_hotel"]]);
    const catalogue = await list("expense_catalog_hotel", "hotel");
    assert.deepEqual([catalogue.set.isCatalog, catalogue.rows], [true, []]);
    assert.equal((await listRoute(req("GET", "/api/v1/admin/masters/nothing", "super"), ctx({ key: "nothing" }))).status, 404);
  });

  test("adding: Pallav's words; the value defaults to the label; a name or value already on the list is refused; one default at a time", async () => {
    let res = await add("shift", { label: "", value: "" });
    assert.deepEqual(await fields(res), { label: "The label field is required." });
    res = await add("shift", { label: "x".repeat(61) });
    assert.deepEqual(await fields(res), { label: "The label field must not be greater than 60 characters." });
    res = await add("shift", { label: "Morning" });
    assert.deepEqual(await fields(res), { value: "The value has already been taken." });
    res = await add("shift", { label: "Day", value: "morning" });
    assert.deepEqual(await fields(res), { value: "The value has already been taken." }, "the check ignores case, as MySQL's collation did");
    res = await add("shift", { label: "Day", color: "#1234567890" });
    assert.deepEqual(await fields(res), { color: "The color field must not be greater than 7 characters." });
    const out = await ok<{ item: Row; message: string }>(await add("shift", { label: "Day", isDefault: true }), 201);
    assert.deepEqual([out.item.value, out.item.sortOrder, out.item.isDefault, out.message], ["Day", 3, true, '"Day" added to Shift.']);
    assert.deepEqual(itemsOf("shift").filter((i) => i.isDefault).map((i) => i.label), ["Day"], "the other default was cleared");
    assert.deepEqual(audits.at(-1), { action: "master.item_created", item: "Shift: Day" });
    res = await add("cash_person_hotel", { label: "suresh" });
    assert.deepEqual(await fields(res), { label: "That name is already on this list." });
    const person = await ok<{ item: Row }>(await add("cash_person_hotel", { label: "  Ramesh  ", color: "#fff", isDefault: true }, "hotel"), 201);
    assert.deepEqual([person.item.label, person.item.value, person.item.color, person.item.isDefault], ["Ramesh", "Ramesh", null, false], "a list of names keeps only the name");
  });

  test("on \"Both businesses\" a name is added to both lists once, shown as shared; narrowed to one business it stays there", async () => {
    const both = await ok<{ item: Row; message: string }>(await add("cash_person_hotel", { label: "Kiran" }, "both"), 201);
    assert.equal(both.message, '"Kiran" added to both businesses.');
    assert.deepEqual([itemsOf("cash_person_hotel").some((i) => i.label === "Kiran"), itemsOf("cash_person_food").some((i) => i.label === "Kiran")], [true, true]);
    // a name the other business already has is not added twice
    await ok(await add("cash_person_hotel", { label: "Dinesh" }, "both"), 201);
    assert.equal(itemsOf("cash_person_food").filter((i) => i.label === "Dinesh").length, 1);
    const one = await ok<{ message: string }>(await add("cash_person_hotel", { label: "Hotelonly" }, "hotel"), 201);
    assert.equal(one.message, '"Hotelonly" added to Receiver Names for Hotel Pallav.');
    assert.equal(itemsOf("cash_person_food").some((i) => i.label === "Hotelonly"), false);
    // Both reads only what both have; a business reads everything it has, shared ones marked
    assert.deepEqual((await list("cash_person_hotel", "both")).rows.map((r) => r.label), ["Dinesh", "Kiran", "Suresh"]);
    const hotelRows = (await list("cash_person_hotel", "hotel")).rows;
    assert.deepEqual(hotelRows.filter((r) => r.shared).map((r) => r.label), ["Dinesh", "Kiran", "Suresh"]);
    assert.equal(hotelRows.find((r) => r.label === "Hotelonly")!.shared, false);
    assert.deepEqual((await list("cash_person_hotel", "food")).set.key, "cash_person_food", "the scope picks the business's own list");
  });

  test("renaming, hiding and removing on \"Both\" keep the other business in step; on one business they touch that one only", async () => {
    const suresh = itemsOf("cash_person_hotel").find((i) => i.label === "Suresh")!;
    const renamed = await ok<{ message: string }>(await updateItemRoute(req("PATCH", `/api/v1/admin/masters/items/${suresh.id}?scope=both`, "super", { label: "Suresh K", value: "", color: null, isActive: true, isDefault: false }), ctx({ id: suresh.id })));
    assert.equal(renamed.message, "Option updated for both businesses.");
    assert.deepEqual([itemsOf("cash_person_food").some((i) => i.label === "Suresh K"), itemsOf("cash_person_food").some((i) => i.label === "Suresh")], [true, false]);
    const kiran = itemsOf("cash_person_hotel").find((i) => i.label === "Suresh K")!;
    const hidden = await ok<{ item: Row; message: string }>(await toggleItemRoute(req("POST", `/api/v1/admin/masters/items/${kiran.id}/toggle?scope=both`, "super"), ctx({ id: kiran.id })));
    assert.equal(hidden.message, '"Suresh K" is hidden from forms. Records that already use it keep it.');
    assert.equal(itemsOf("cash_person_food").find((i) => i.label === "Suresh K")!.isActive, false);
    const one = await ok<{ message: string }>(await toggleItemRoute(req("POST", `/api/v1/admin/masters/items/${kiran.id}/toggle?scope=hotel`, "super"), ctx({ id: kiran.id })));
    assert.equal(one.message, '"Suresh K" is offered on forms again.');
    assert.equal(itemsOf("cash_person_food").find((i) => i.label === "Suresh K")!.isActive, false, "narrowed to one business: the other is untouched");
    const gone = await ok<{ message: string }>(await deleteItemRoute(req("DELETE", `/api/v1/admin/masters/items/${kiran.id}?scope=both`, "super"), ctx({ id: kiran.id })));
    assert.equal(gone.message, '"Suresh K" removed from both businesses. Records that already use it are untouched.');
    assert.deepEqual([itemsOf("cash_person_hotel").some((i) => i.label === "Suresh K"), itemsOf("cash_person_food").some((i) => i.label === "Suresh K")], [false, false]);
  });

  test("a hidden option leaves the forms (billing reads only active ones, in order); moving swaps places; at an end nothing happens", async () => {
    const [morning, night] = itemsOf("shift");
    await ok(await toggleItemRoute(req("POST", `/api/v1/admin/masters/items/${night.id}/toggle`, "super"), ctx({ id: night.id })));
    assert.deepEqual(activeOptionItems(data(), "shift").map((o) => o.value), ["Morning"]);
    await ok(await toggleItemRoute(req("POST", `/api/v1/admin/masters/items/${night.id}/toggle`, "super"), ctx({ id: night.id })));
    const moved = await ok<{ moved: boolean }>(await moveItemRoute(req("POST", `/api/v1/admin/masters/items/${night.id}/move`, "super", { direction: "up" }), ctx({ id: night.id })));
    assert.equal(moved.moved, true);
    assert.deepEqual(itemsOf("shift").map((i) => i.label), ["Night", "Morning"]);
    assert.deepEqual(activeOptionItems(data(), "shift").map((o) => o.value), ["Night", "Morning"]);
    const end = await ok<{ moved: boolean }>(await moveItemRoute(req("POST", `/api/v1/admin/masters/items/${night.id}/move`, "super", { direction: "up" }), ctx({ id: night.id })));
    assert.equal(end.moved, false);
    assert.equal((await moveItemRoute(req("POST", `/api/v1/admin/masters/items/${morning.id}/move`, "super", { direction: "sideways" }), ctx({ id: morning.id }))).status, 422);
  });

  test("a list the app itself uses cannot be removed; any other can, with its entries; deleting is refused to a viewer", async () => {
    let res = await deleteSetRoute(req("DELETE", "/api/v1/admin/masters/hotel_plan", "super"), ctx({ key: "hotel_plan" }));
    assert.deepEqual([res.status, await message(res)], [409, "This list is used by the app itself and cannot be removed. You can still change what is in it."]);
    assert.equal((await deleteSetRoute(req("DELETE", "/api/v1/admin/masters/shift", "viewer"), ctx({ key: "shift" }))).status, 403);
    const out = await ok<{ message: string }>(await deleteSetRoute(req("DELETE", "/api/v1/admin/masters/shift", "super"), ctx({ key: "shift" })));
    assert.equal(out.message, 'List "Shift" removed.');
    assert.equal(data().optionItemRows.some((i) => i.label === "Morning"), false);
    assert.deepEqual(audits.at(-1), { action: "master.set_deleted", item: "Shift" });
    res = await deleteSetRoute(req("DELETE", "/api/v1/admin/masters/shift", "super"), ctx({ key: "shift" }));
    assert.equal(res.status, 404);
  });

  test("permissions and isolation: view reads, edit changes and deletes (the masters module offers nothing above edit); nobody is 403; the lists are the hotel's own", async () => {
    assert.equal((await railRoute(req("GET", "/api/v1/admin/masters", "nobody"), ctx())).status, 403);
    assert.equal((await add("shift", { label: "Late" }, "", "viewer")).status, 403);
    assert.equal((await add("shift", { label: "Late" }, "", "admin")).status, 201);
    const night = itemsOf("shift")[1];
    assert.equal((await deleteItemRoute(req("DELETE", `/api/v1/admin/masters/items/${night.id}`, "viewer"), ctx({ id: night.id }))).status, 403);
    assert.equal((await listRoute(req("GET", "/api/v1/admin/masters/shift", "superB"), ctx({ key: "shift" }))).status, 404, "hotel B has no such list");
    seedList("shift", "Shift", ["Other"], {}, HOTEL_B);
    assert.deepEqual((await list("shift", "", "superB")).rows.map((r) => r.label), ["Other"]);
    const foreign = data(HOTEL_B).optionItemRows[0];
    assert.equal((await toggleItemRoute(req("POST", `/api/v1/admin/masters/items/${foreign.id}/toggle`, "super"), ctx({ id: foreign.id }))).status, 404, "an id from another hotel is absent");
  });

  test("two people adding the same name at once: exactly one is added", async () => {
    const results = await Promise.all([add("shift", { label: "Dawn" }), add("shift", { label: "dawn" })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 422]);
    assert.equal(itemsOf("shift").filter((i) => i.value.toLowerCase() === "dawn").length, 1);
  });
});

describe("the Set-up map (H12)", () => {
  test("pure: each area's state and detail from the facts", () => {
    const empty = buildSettingsMap({ settings: new Map(), rooms: 0, planRates: 0, users: 1, site: null });
    assert.deepEqual([empty.done, empty.total, empty.items.map((i) => `${i.id}:${i.state}`)], [0, 7, ["profile:todo", "billing:todo", "rooms:todo", "rates:todo", "staff:todo", "website:todo", "payments:todo"]]);
    assert.deepEqual(empty.items.find((i) => i.id === "staff")?.detail, "1 person", "the Super Admin alone is not staff set up");
    const full = buildSettingsMap({
      settings: new Map([["general.site_name", "Hotel Sunrise"], ["general.support_phone", "0281 245"], ["billing.hotel_gstin", "24ABCDE1234F1Z5"], ["email.host", "smtp.x.in"], ["email.from_address", "desk@x.in"], ["email.daily_summary_to", "owner@x.in"], ["razorpay_hotel.enabled", "1"], ["razorpay_hotel.key_id", "rzp_x"]]),
      rooms: 23, planRates: 4, users: 5, site: { live: true, domains: 2 },
    });
    assert.deepEqual([full.done, full.items.map((i) => i.detail)], [7, ["Hotel Sunrise, 0281 245", "24ABCDE1234F1Z5", "23 rooms", "4 plan rates", "5 people", "Live on 2 domains", "Razorpay switched on"]]);
    const half = buildSettingsMap({ settings: new Map([["general.site_name", "H"], ["email.host", "smtp.x.in"], ["razorpay_food.key_id", "k"]]), rooms: 1, planRates: 0, users: 0, site: { live: false, domains: 0 } });
    assert.deepEqual(half.items.filter((i) => i.state === "partial").map((i) => i.id), ["profile", "website", "payments"]);
    assert.deepEqual(half.items.find((i) => i.id === "website")?.detail, "Not live yet");
    assert.deepEqual(half.items.find((i) => i.id === "rooms")?.params, undefined);
    assert.deepEqual(half.items.find((i) => i.id === "rates")?.params, { list: "plan-rates" });
  });

  test("the route: the hotel's own rows, SuperAdmin only; saving settings moves the states", async () => {
    const map = (who = "super") => settingsMapRoute(req("GET", "/api/v1/admin/settings/map", who), ctx());
    const before = await ok<{ items: { id: string; state: string }[]; done: number; total: number }>(await map());
    assert.deepEqual([before.done, before.total, before.items.some((i) => i.id === "email")], [0, 7, false]);
    assert.equal((await updateSettingsRoute(req("PATCH", "/api/v1/admin/settings/email", "super", { values: { "email.username": "desk@sunrise.in", "email.password": "abcdefghijklmnop" } }), ctx({ group: "email" }))).status, 403, "the mail server is the Set-up centre's");
    await ok(await updateSettingsRoute(req("PATCH", "/api/v1/admin/settings/billing", "super", { values: { "billing.hotel_gstin": "24ABCDE1234F1Z5" } }), ctx({ group: "billing" })));
    const after = await ok<{ items: { id: string; state: string; detail: string | null }[]; done: number }>(await map());
    assert.deepEqual([after.done, after.items.some((i) => i.id === "email"), after.items.find((i) => i.id === "billing")?.state], [1, false, "done"]);
    for (const who of ["admin", "viewer", "nobody"]) assert.equal((await map(who)).status, 403, who);
    assert.equal((await map(null as never)).status, 401);
    // the Email row reads naturally without a From address too (never ", no daily summary")
    const detail = adminCopy.settings.map.emailDetail;
    assert.deepEqual([detail("desk@x.in", true), detail("", false), detail("  ", true)], ["desk@x.in, daily summary on", "No daily summary", "Daily summary on"]);
  });
});

describe("settings (SettingsController)", () => {
  const save = (group: string, values: Record<string, unknown>, who = "super") => updateSettingsRoute(req("PATCH", `/api/v1/admin/settings/${group}`, who, { values }), ctx({ group }));
  const overview = (tab = "", who = "super") => settingsRoute(req("GET", `/api/v1/admin/settings${tab ? `?tab=${tab}` : ""}`, who), ctx());
  type Field = { key: string; type: string; secret: boolean; value: string | null; set: boolean; options: Record<string, string> | null };
  const fieldsOf = async (tab: string, who = "super"): Promise<Record<string, Field>> => Object.fromEntries((await ok<{ current: { fields: Field[] } }>(await overview(tab, who))).current.fields.map((f) => [f.key, f]));

  test("a hotel session (its own top role, a full visit) never saves online payments, the mail server or the backup; the Set-up centre does, and a Key ID must match its mode (MJ, 5 Nov 2026)", async () => {
    const test = { "razorpay_hotel.mode": "test", "razorpay_hotel.key_id": "rzp_test_abc123", "razorpay_hotel.key_secret": "secret123456", "razorpay_hotel.webhook_secret": "w".repeat(32) };
    for (const who of ["super", "owner"]) for (const group of ["razorpay_hotel", "razorpay_food", "email", "backup"]) assert.equal((await save(group, group === "razorpay_hotel" ? test : {}, who)).status, 403, `${who} ${group}`);
    assert.equal((await save("razorpay_hotel", test, "setup")).status, 200);
    assert.equal((await save("razorpay_hotel", { ...test, "razorpay_hotel.mode": "live" }, "setup")).status, 422, "a test key in Live mode");
    assert.equal((await save("razorpay_hotel", { ...test, "razorpay_hotel.mode": "live", "razorpay_hotel.key_id": "rzp_live_abc123" }, "setup")).status, 200);
  });

  test("only the SuperAdmin: an Admin, a viewer and a person with no module are refused with Pallav's kind of sentence", async () => {
    for (const who of ["admin", "viewer", "nobody"]) {
      const res = await overview("", who);
      assert.deepEqual([res.status, await message(res)], [403, "Only the SuperAdmin can open Settings."], who);
      assert.equal((await save("general", { "general.site_name": "X" }, who)).status, 403, who);
    }
    assert.equal((await overview("", null as never)).status, 401);
  });

  test("the groups in order, the open one with its values: a default shows until something is saved; a bad tab opens the first", async () => {
    const o = await ok<{ groups: { key: string }[]; current: { key: string; fields: Field[] } }>(await overview());
    assert.deepEqual(o.groups.map((g) => g.key), ["general", "billing", "recycle"], "the secret groups are the Set-up centre's");
    assert.deepEqual((await ok<{ groups: { key: string }[] }>(await overview("", "setup"))).groups.map((g) => g.key), ["general", "billing", "email", "razorpay_hotel", "razorpay_food", "backup", "recycle"]);
    assert.equal(o.current.key, "general");
    const general = await fieldsOf("general");
    assert.deepEqual([general["general.site_name"].value, general["general.check_in_time"].value, general["general.check_out_time"].value, general["general.support_email"].value], ["Hotel Pallav", "12:00", "11:00", null]);
    assert.equal((await ok<{ current: { key: string } }>(await overview("nonsense"))).current.key, "general");
    const email = await fieldsOf("email", "setup");
    assert.deepEqual(Object.keys(email), ["email.mode", "email.provider", "email.username", "email.password", "email.host", "email.port", "email.encryption", "email.region", "email.from_address", "email.from_name", "email.reply_to", "email.daily_limit", "email.daily_summary_to", "email.imap", "email.imap_host", "email.imap_port"], "the mail service form: every field, the page shows the ones the chosen service needs");
  });

  test("saving: trimmed, an empty value falls back to its default, an unsent toggle reads as off, a select outside its options falls back; logged by label", async () => {
    const out = await ok<{ group: { key: string }; message: string }>(
      await save("general", { "general.site_name": "  Hotel Sunrise  ", "general.support_phone": "0281 245 6789", "general.address": "150 Feet Ring Road, Rajkot", "general.check_in_time": "13:00", "general.check_out_time": "10:30", "general.portal_enabled": true }),
    );
    assert.equal(out.message, "General settings saved.");
    const general = await fieldsOf("general");
    assert.deepEqual([general["general.site_name"].value, general["general.support_phone"].value, general["general.portal_enabled"].value], ["Hotel Sunrise", "0281 245 6789", "1"]);
    await ok(await save("general", { "general.site_name": "" }));
    const again = await fieldsOf("general");
    assert.deepEqual([again["general.site_name"].value, again["general.portal_enabled"].value, again["general.check_in_time"].value], ["Hotel Pallav", "0", "12:00"], "empty = default; an unsent toggle = off");
    await ok(await save("razorpay_hotel", { "razorpay_hotel.mode": "nonsense" }, "setup"));
    assert.equal((await fieldsOf("razorpay_hotel", "setup"))["razorpay_hotel.mode"].value, "test", "outside the options: the default");
    const log = data().systemLogs.at(-1)!;
    assert.deepEqual([log.module, log.entity, log.summary], ["settings", "Settings", "Razorpay · {hotel} settings saved"]);
  });

  test("Pallav's checks and words: an email, a number, a time of day, a group that is not one, a setting of another group", async () => {
    let res = await save("email", { "email.username": "not-an-email" }, "setup");
    const body = await json(res);
    assert.deepEqual([res.status, body.error.message, body.error.details.fields], [422, "Enter a valid Gmail address, like name@gmail.com.", { "email.username": "Enter a valid Gmail address, like name@gmail.com." }]);
    res = await save("general", { "general.check_in_time": "12:00", "general.support_email": "nope" });
    assert.equal(res.status, 422);
    res = await save("general", { "general.check_in_time": "25:00" });
    assert.equal(await message(res), "Check-in time must be a 24-hour time such as 12:00.");
    res = await save("nonsense", {});
    assert.equal(res.status, 404);
    res = await save("general", { "email.username": "desk@gmail.com" });
    const other = await json(res);
    assert.deepEqual([res.status, other.error.details.fields], [422, { "email.username": "Not a setting of this group." }]);
    assert.equal((await updateSettingsRoute(req("PATCH", "/api/v1/admin/settings/general", "super", { values: {}, extra: 1 }), ctx({ group: "general" }))).status, 422, "strict body");
  });

  test("the bill header: the site name, address, phone and both GSTINs saved here are what a bill prints; a GSTIN is checked and kept upper case", async () => {
    await ok(await save("general", { "general.site_name": "Hotel Sunrise", "general.address": "150 Feet Ring Road, Rajkot", "general.support_phone": "0281 245 6789" }));
    let res = await save("billing", { "billing.hotel_gstin": "24ABC" });
    const bad = await json(res);
    assert.deepEqual([res.status, bad.error.message], [422, "Hotel GSTIN must be a valid GSTIN, for example 24ABCDE1234F1Z5."]);
    await ok(await save("billing", { "billing.hotel_gstin": " 24abcde1234f1z5 ", "billing.food_gstin": "24ABCDE1234F2Z4" }));
    const header = await hotel.unit.run({ hotelId: HOTEL_A, userId: id(1) }, (repos) => repos.hotelProfile.header());
    assert.deepEqual(header, { name: "Hotel Sunrise", foodName: "Pallav Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 245 6789", gstin: "24ABCDE1234F1Z5", foodGstin: "24ABCDE1234F2Z4" });
    await ok(await save("billing", { "billing.hotel_gstin": "", "billing.food_gstin": "24ABCDE1234F2Z4" }));
    assert.equal((await hotel.unit.run({ hotelId: HOTEL_A, userId: id(1) }, (repos) => repos.hotelProfile.header())).gstin, null, "emptied = not set");
    res = await save("billing", { "billing.hotel_gstin": "24ABCDE1234F1Z5" });
    assert.equal(res.status, 200);
    res = await save("billing", {});
    assert.equal(res.status, 200, "a save with nothing in it empties the group, as Pallav reads every field");
  });

  test("secrets are stored as typed and NEVER returned: the field says whether one is set; empty keeps; the log says 'changed' and never the value", async () => {
    let email = await fieldsOf("email", "setup");
    assert.deepEqual([email["email.password"].secret, email["email.password"].set, email["email.password"].value], [true, false, null]);
    await ok(await save("email", { "email.password": "  Sup3r Secret!  ", "email.username": "Mailer@Gmail.com" }, "setup"));
    email = await fieldsOf("email", "setup");
    assert.deepEqual([email["email.password"].set, email["email.password"].value, email["email.username"].value], [true, null, "mailer@gmail.com"]);
    const wire = JSON.stringify(await json(await overview("email", "setup")));
    assert.ok(!wire.includes("Sup3rSecret"), "the secret is in no response");
    const stored = String(data().appSettings.get("email.password")?.value);
    assert.ok(isSealedSmtpSecret(stored) && !stored.includes("Sup3rSecret"), "the mail password is stored ENCRYPTED");
    assert.equal(openSmtpSecret(SMTP_KEY, stored, HOTEL_A), "Sup3rSecret!", "the spaces are not part of an app password");
    assert.equal(data().appSettings.get("email.password")?.secret, true);
    const logged = JSON.stringify(data().systemLogs.at(-1));
    assert.ok(!logged.includes("Sup3rSecret") && logged.includes('"Password / key":"changed"'));
    await ok(await save("email", { "email.username": "mailer@gmail.com", "email.reply_to": "help@x.in", "email.password": "" }, "setup"));
    assert.equal(data().appSettings.get("email.password")?.value, stored, "left empty = keep what is saved");
    assert.equal((await fieldsOf("email", "setup"))["email.password"].set, true);
    assert.equal((await fieldsOf("email", "setup"))["email.reply_to"].value, "help@x.in");
    await ok(await save("razorpay_hotel", { "razorpay_hotel.key_id": "rzp_test_abc", "razorpay_hotel.key_secret": "shh", "razorpay_hotel.webhook_secret": "hook", "razorpay_hotel.enabled": true }, "setup"));
    const razor = await fieldsOf("razorpay_hotel", "setup");
    assert.deepEqual([razor["razorpay_hotel.key_id"].value, razor["razorpay_hotel.key_secret"].value, razor["razorpay_hotel.key_secret"].set, razor["razorpay_hotel.webhook_secret"].set, razor["razorpay_hotel.mode"].value], ["rzp_test_abc", null, true, true, "test"]);
  });

  test("settings are the hotel's own: hotel B saves and reads its own, never A's", async () => {
    await ok(await save("general", { "general.site_name": "Hotel Sunrise" }));
    await ok(await save("general", { "general.site_name": "Hotel Beta" }, "superB"));
    assert.equal((await fieldsOf("general"))["general.site_name"].value, "Hotel Sunrise");
    const b = await ok<{ current: { fields: Field[] } }>(await overview("general", "superB"));
    assert.equal(b.current.fields.find((f) => f.key === "general.site_name")!.value, "Hotel Beta");
  });
});
