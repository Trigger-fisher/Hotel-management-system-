// Daily Cash expenses (cash withdrawals and miscellaneous expenses with their lines) end to end through the REAL route files, the wrapper, the
// shared entry engine and the in-memory repositories. Expected behaviour: docs/specs/cash-withdrawals.md and cash-expenses.md.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { CashExpense, CashList, ExpenseInput, ExpenseLineInput } from "@shared/dashboards/cash";
import { DELETE as purgeRoute } from "../../src/app/api/v1/expense/entries/[id]/purge/route";
import { POST as restoreRoute } from "../../src/app/api/v1/expense/entries/[id]/restore/route";
import { DELETE as removeRoute, GET as getRoute, PATCH as updateRoute } from "../../src/app/api/v1/expense/entries/[id]/route";
import { GET as listRoute, POST as createRoute } from "../../src/app/api/v1/expense/entries/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureCashExpenses } from "../../src/server/compose/cash";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { toPaise } from "../../src/server/money/paise";
import { createMemoryCash } from "../../src/server/repos/memory/cashDeposit";
import { createExpenseService } from "../../src/server/services/cash/expenseService";
import type { Person } from "../../src/server/services/cash/ports";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { viewer: id(1), editor: id(2), editor2: id(3), admin: id(4), superAdmin: id(5), nobody: id(6), wOnly: id(7), mOnly: id(8), adminB: id(9) };
const P = (userId: string, name: string, roleKey: string, roleLevel: number): [string, Person] => [userId, { id: userId, name, roleKey, roleLevel, deleted: false }];
const people = new Map<string, Person>([
  P(U.viewer, "Vera Viewer", "viewer", 1), P(U.editor, "Asha Editor", "editor", 2), P(U.editor2, "Esha Editor", "editor", 2), P(U.admin, "Hari Admin", "admin", 3),
  P(U.superAdmin, "Sonal Super", "super_admin", 4), P(U.nobody, "Nina Nobody", "viewer", 1), P(U.wOnly, "Wanda Withdraw", "editor", 2), P(U.mOnly, "Milo Misc", "editor", 2), P(U.adminB, "Beena Admin", "admin", 3),
]);

const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", U.viewer, { grants: [grant("expense", "view")] });
mk("editor", U.editor, { grants: [grant("expense", "edit")] });
mk("editor2", U.editor2, { grants: [grant("expense", "edit")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("expense", "full"), grant("users", "full"), grant("system.backdate", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("expense", "full"), grant("users", "full"), grant("system.backdate", "full")] });
mk("force", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("expense", "full"), grant("users", "full"), grant("system.backdate", "full"), grant("system.force", "full")] });
sessions.set("force", { ...(sessions.get("force") as VerifiedSession), forceMode: true });
mk("nobody", U.nobody, {});
mk("wOnly", U.wOnly, { grants: [grant("expense.withdrawals", "create")] });
mk("mOnly", U.mOnly, { grants: [grant("expense.misc", "create")] });
mk("adminB", U.adminB, { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("expense", "full"), grant("users", "full")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
let cash = createMemoryCash();
let auditEvents: { action: string }[] = [];

function wire(): void {
  cash = createMemoryCash();
  auditEvents = [];
  configureCashExpenses(createExpenseService({ unit: cash.unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async (e) => void auditEvents.push(e) }, catalog, now: () => clock }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
}

const cat = (n: number): string => `cat-${n}`;
const item = (n: number): string => `item-${n}`;
async function seed(hotelId = HOTEL_A): Promise<void> {
  const data = cash.store.dataFor(hotelId);
  data.lists = { cash_person_hotel: ["Ramesh (Kitchen)", "Suresh"], cash_person_food: ["Hitesh Parmar"] };
  data.years = [
    { id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" },
    { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" },
  ];
  data.catalog = {
    hotel: [
      { id: cat(1), name: "Dairy", items: [{ id: item(1), name: "Milk", pricePaise: toPaise(5000) }, { id: item(2), name: "Eggs", pricePaise: toPaise(700) }] },
      { id: cat(2), name: "Bakery", items: [{ id: item(3), name: "Bread", pricePaise: toPaise(4500) }, { id: item(9), name: "Free sample", pricePaise: toPaise(0) }] },
    ],
    food: [{ id: cat(3), name: "Fuel", items: [{ id: item(4), name: "Gas cylinder", pricePaise: toPaise(165000) }] }],
  };
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
const body = async (res: Response) => (await res.json()) as any;

const line = (itemId: string, over: Partial<ExpenseLineInput> = {}, categoryId = cat(1)): ExpenseLineInput => ({ key: "k", lineId: null, categoryId, itemId, quantity: "1", pricing: "listed", amountPaise: null, ...over });
const withdrawal = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({ kind: "withdrawal", book: "hotel", withdrawer: "Ramesh (Kitchen)", employeeId: "", yearMonth: "", amountPaise: 120000, lines: [], instruction: "", stamp: null, ...over });
const misc = (lines: ExpenseLineInput[], over: Partial<ExpenseInput> = {}): ExpenseInput => ({ kind: "misc", book: "hotel", withdrawer: "", employeeId: "", yearMonth: "", amountPaise: null, lines, instruction: "", stamp: null, ...over });
const MILK_EGGS = (): ExpenseLineInput[] => [line(item(1), { quantity: "2" }), line(item(2), { quantity: "12" })];

const create = (who: string, input: ExpenseInput, headers: Record<string, string> = {}) => createRoute(req("POST", "/api/v1/expense/entries", who, input, headers), ctx());
const created = async (who: string, input: ExpenseInput): Promise<CashExpense & { version: number }> => {
  const res = await create(who, input);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await body(res)).data;
};
const list = async (who: string, qs = ""): Promise<{ status: number; data: CashList<CashExpense>; error?: { code: string } }> => {
  const res = await listRoute(req("GET", `/api/v1/expense/entries${qs}`, who), ctx());
  const b = await body(res);
  return { status: res.status, data: b.data, error: b.error };
};
const patch = (who: string, entryId: string, input: ExpenseInput, version = 1) => updateRoute(req("PATCH", `/api/v1/expense/entries/${entryId}`, who, { ...input, version }), ctx({ id: entryId }));
const del = (who: string, entryId: string, version: number) => removeRoute(req("DELETE", `/api/v1/expense/entries/${entryId}`, who, { version }), ctx({ id: entryId }));
const restore = (who: string, entryId: string, version: number) => restoreRoute(req("POST", `/x/${entryId}/restore`, who, { version }), ctx({ id: entryId }));
const purge = (who: string, entryId: string) => purgeRoute(req("DELETE", `/x/${entryId}/purge`, who), ctx({ id: entryId }));
const fieldsOf = async (res: Response): Promise<Record<string, string>> => (await body(res)).error.details.fields;
const logs = (hotelId = HOTEL_A) => cash.store.dataFor(hotelId).systemLogs;

beforeEach(async () => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
  await seed();
});

describe("permissions: reading goes through the module expense, writing through the kind's part", () => {
  test("no session 401; the module view lists; a person with nothing is 403", async () => {
    assert.equal((await listRoute(req("GET", "/x", null), ctx())).status, 401);
    assert.equal((await list("viewer")).status, 200);
    assert.equal((await list("nobody")).status, 403);
  });
  test("a viewer cannot record; a withdrawals-part holder records withdrawals but not misc; a misc-part holder the reverse; neither can read", async () => {
    assert.equal((await create("viewer", withdrawal())).status, 403);
    assert.equal((await create("wOnly", withdrawal())).status, 201);
    assert.equal((await create("wOnly", misc(MILK_EGGS()))).status, 403);
    assert.equal((await create("mOnly", misc(MILK_EGGS()))).status, 201);
    assert.equal((await create("mOnly", withdrawal())).status, 403);
    assert.equal((await list("wOnly")).status, 403, "the part has no view: reading is through the module");
  });
  test("the same part covers both books (one part, unlike revenue)", async () => {
    assert.equal((await create("wOnly", withdrawal({ book: "food", withdrawer: "Hitesh Parmar" }))).status, 201);
  });
  test("a staff advance is not available yet; unknown fields are refused", async () => {
    const res = await create("admin", withdrawal({ kind: "advance" }));
    assert.equal(res.status, 422);
    assert.equal((await fieldsOf(res)).kind, "Staff advances are not available yet.");
    assert.equal((await createRoute(req("POST", "/x", "admin", { ...withdrawal(), userId: id(99) }), ctx())).status, 422);
  });
});

describe("cash withdrawals", () => {
  test("201 with the DTO: type, kind, withdrawer, no lines, entry number per table, recorded by the session's person", async () => {
    const a = await created("editor", withdrawal({ instruction: "  Vegetables  " }));
    const b = await created("editor", withdrawal());
    assert.deepEqual([a.type, a.kind, a.book, a.withdrawer, a.lines, a.employee, a.yearMonth, a.instruction, a.amountPaise], ["hotel-withdrawal", "withdrawal", "hotel", "Ramesh (Kitchen)", [], null, null, "Vegetables", 120000]);
    assert.deepEqual([a.entryNo, b.entryNo], [1, 2]);
    assert.deepEqual(a.recordedBy, { id: U.editor, name: "Asha Editor" });
    assert.equal(a.at, "2026-10-05T04:30:00.000Z");
    assert.equal((await created("editor", withdrawal({ book: "food", withdrawer: "Hitesh Parmar" }))).entryNo, 1, "the food book counts on its own");
  });
  test("the amount in words is stored; the log line is Pallav's: module expense, entity, label, details in paise", async () => {
    const row = await created("editor", withdrawal({ amountPaise: 12345600, instruction: "stock" }));
    assert.equal(cash.store.dataFor(HOTEL_A).withdrawals.hotel[0].amountInWords, "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only");
    const l = logs()[0];
    assert.deepEqual([l.module, l.action, l.entity, l.summary, l.subjectLabel, l.subjectId], ["expense", "created", "Hotel Cash Withdrawal", "Added Hotel Cash Withdrawal: 0001", "0001", row.id]);
    assert.deepEqual(l.details, { Date: "05-10-2026", "Amount (paise)": 12345600, "Paid to": "Ramesh (Kitchen)", What: "stock" });
  });
  test("validation messages, word for word (ExpenseController::rules/messages)", async () => {
    const msg = async (over: Partial<ExpenseInput>) => fieldsOf(await create("admin", withdrawal(over)));
    assert.equal((await msg({ withdrawer: "" })).withdrawer, "Choose who is taking the cash.");
    assert.equal((await msg({ withdrawer: "Nobody" })).withdrawer, "Choose a name from the Hotel list. The SuperAdmin adds names in Master Data, under Expense.");
    assert.equal((await msg({ book: "food", withdrawer: "Ramesh (Kitchen)" })).withdrawer, "Choose a name from the Food list. The SuperAdmin adds names in Master Data, under Expense.");
    assert.equal((await msg({ withdrawer: "x".repeat(101) })).withdrawer, "The withdrawer field must not be greater than 100 characters.");
    assert.equal((await msg({ amountPaise: null })).amount, "The amount field is required.");
    assert.equal((await msg({ amountPaise: 0 })).amount, "The amount field must be at least 0.01.");
    assert.equal((await msg({ amountPaise: 1_000_000_000_000 })).amount, "The amount field must not be greater than 9999999999.99.");
    assert.equal((await msg({ instruction: "x".repeat(1001) })).instruction, "The instruction field must not be greater than 1000 characters.");
    assert.equal((await create("admin", withdrawal({ instruction: "x".repeat(1000) }))).status, 201, "a withdrawal may carry 1000 characters");
  });
  test("irrelevant fields (lines, employee, month) are ignored for a withdrawal", async () => {
    const row = await created("admin", withdrawal({ lines: MILK_EGGS(), employeeId: "e1", yearMonth: "2026-10" }));
    assert.deepEqual([row.lines, row.employee, row.yearMonth], [[], null, null]);
  });
  test("edit: only the newest entry of its TABLE; the refusal says 'entry'; an admin or the owner may, someone else may not", async () => {
    const first = await created("editor", withdrawal());
    await created("editor", withdrawal());
    const old = await patch("editor", first.id, withdrawal({ amountPaise: 5 }));
    assert.equal(old.status, 403);
    assert.equal((await body(old)).error.message, "Only the latest entry in a book can be edited.");
    const newest = (await list("viewer")).data.items.find((i) => i.isLatest) as CashExpense;
    const other = await patch("editor2", newest.id, withdrawal({ amountPaise: 5 }), 1);
    assert.equal(other.status, 403);
    assert.equal((await body(other)).error.message, "You are not allowed to edit this entry.");
    assert.equal((await patch("admin", newest.id, withdrawal({ amountPaise: 5 }))).status, 200);
  });
  test("the newest is per table: a miscellaneous expense recorded later does not close the newest withdrawal", async () => {
    const w = await created("editor", withdrawal());
    await created("editor", misc(MILK_EGGS()));
    assert.equal((await patch("editor", w.id, withdrawal({ amountPaise: 7 }))).status, 200);
  });
  test("an edit takes the entry over: recorded by becomes the editor, unless the editor is the SuperAdmin (ExpenseController.php:504-507)", async () => {
    const row = await created("editor", withdrawal());
    const byAdmin = (await body(await patch("admin", row.id, withdrawal({ amountPaise: 500 })))).data;
    assert.deepEqual(byAdmin.recordedBy, { id: U.admin, name: "Hari Admin" });
    assert.equal(cash.store.dataFor(HOTEL_A).withdrawals.hotel[0].fullName, "Hari Admin");
    const bySuper = (await body(await patch("super", row.id, withdrawal({ amountPaise: 600 }), 2))).data;
    assert.deepEqual(bySuper.recordedBy, { id: U.admin, name: "Hari Admin" }, "the SuperAdmin leaves the recorder as it was");
  });
  test("an edit logs only what moved, in Pallav's words; a stale version is 409 CONFLICT with the current version", async () => {
    const row = await created("editor", withdrawal({ amountPaise: 150000 }));
    await patch("editor", row.id, withdrawal({ amountPaise: 250000, withdrawer: "Suresh" }));
    const l = logs()[1];
    assert.equal(l.summary, "Changed Hotel Cash Withdrawal: 0001 (Amount (paise), Withdrawer)");
    assert.equal((l.details as Record<string, string>)["Amount (paise)"], "was 150000, became 250000");
    const stale = await patch("editor", row.id, withdrawal({ amountPaise: 9 }), 1);
    assert.equal(stale.status, 409);
    assert.equal((await body(stale)).error.details.currentVersion, 2);
  });
  test("an edit may keep a receiver that has since left the list; a new one must be on it", async () => {
    const row = await created("editor", withdrawal());
    cash.store.dataFor(HOTEL_A).lists.cash_person_hotel = ["Suresh"];
    assert.equal((await patch("editor", row.id, withdrawal({ amountPaise: 5 }))).status, 200);
    assert.equal((await fieldsOf(await patch("editor", row.id, withdrawal({ withdrawer: "Other" }), 2))).withdrawer, "Choose a name from the Hotel list. The SuperAdmin adds names in Master Data, under Expense.");
  });
  test("the kind of a saved entry cannot change", async () => {
    const row = await created("admin", withdrawal());
    const res = await patch("admin", row.id, misc(MILK_EGGS()));
    assert.equal((await fieldsOf(res)).kind, "The kind of a saved entry cannot change.");
  });
});

describe("miscellaneous expenses: the lines, the prices and the totals", () => {
  test("listed lines take the CATALOGUE price; the amount is the sum; the names and the words are built from the lines", async () => {
    const row = await created("editor", misc([...MILK_EGGS(), line(item(3), { quantity: "1", categoryId: cat(2) })]));
    assert.equal(row.amountPaise, 2 * 5000 + 12 * 700 + 4500, "milk x2, eggs x12, bread x1");
    assert.deepEqual(row.lines.map((l) => [l.categoryName, l.itemName, l.quantity, l.pricePaise, l.totalPaise, l.pricing]), [
      ["Dairy", "Milk", 2, 5000, 10000, "listed"],
      ["Dairy", "Eggs", 12, 700, 8400, "listed"],
      ["Bakery", "Bread", 1, 4500, 4500, "listed"],
    ]);
    const stored = cash.store.dataFor(HOTEL_A).misc.hotel[0];
    assert.deepEqual([stored.expenseName, stored.expenseHead], ["Milk, Eggs +1 more", "Dairy +1"]);
    assert.equal(stored.amountInWords, "Two Hundred Twenty Nine Rupees Only");
    assert.equal(row.type, "hotel-misc");
  });
  test("quantity is rounded to three places; a custom line takes the amount typed and its price for one is amount / quantity", async () => {
    const row = await created("editor", misc([line(item(1), { quantity: "2.5" }), line(item(2), { quantity: "3", pricing: "custom", amountPaise: 1000 }), line(item(3), { quantity: "1.2345", categoryId: cat(2) })]));
    assert.deepEqual(row.lines.map((l) => [l.quantity, l.pricePaise, l.totalPaise]), [
      [2.5, 5000, 12500],
      [3, 333, 1000],
      [1.235, 4500, 5558],
    ]);
    assert.equal(row.amountPaise, 12500 + 1000 + 5558);
  });
  test("validation: no lines, too many, per-line quantity and amount messages, item not in the catalogue, nothing to keep", async () => {
    const msg = async (lines: ExpenseLineInput[]) => fieldsOf(await create("admin", misc(lines)));
    assert.equal((await msg([])).lines, "The lines field must have at least 1 items.");
    assert.equal((await msg(Array.from({ length: 41 }, () => line(item(1))))).lines, "The lines field must not have more than 40 items.");
    assert.equal((await msg([line(item(1), { quantity: "" })]))["lines.0.quantity"], "The lines.0.quantity field is required.");
    assert.equal((await msg([line(item(1), { quantity: "abc" })]))["lines.0.quantity"], "The lines.0.quantity field must be a number.");
    assert.equal((await msg([line(item(1), { quantity: "0" })]))["lines.0.quantity"], "The lines.0.quantity field must be at least 0.001.");
    assert.equal((await msg([line(item(1), { quantity: "1000001" })]))["lines.0.quantity"], "The lines.0.quantity field must not be greater than 1000000.");
    assert.equal((await msg([line(item(1), { pricing: "custom" })]))["lines.0.amount"], "The lines.0.amount field is required when lines.0.pricing is custom.");
    assert.equal((await msg([line(item(1), { pricing: "custom", amountPaise: 0 })]))["lines.0.amount"], "The lines.0.amount field must be at least 0.01.");
    assert.equal((await msg([line("", {})]))["lines.0.item"], "The lines.0.item_id field is required.");
    assert.equal((await msg([line("nope")]))["lines.0.item"], "Choose an item from the list.");
    assert.equal((await msg([line(item(4), {}, cat(3))]))["lines.0.item"], "Choose an item from the list.", "a food item is not in the hotel catalogue");
    assert.equal((await msg([line("keep", {}, "keep")]))["lines.0.item"], "Choose an item for this line.");
    assert.equal((await msg([line(item(9), {}, cat(2))])).lines, "The total must be more than zero.");
  });
  test("a misc expense keeps an instruction up to 500 characters (not 1000)", async () => {
    assert.equal((await fieldsOf(await create("admin", misc(MILK_EGGS(), { instruction: "x".repeat(501) })))).instruction, "The instruction field must not be greater than 500 characters.");
  });
  test("editing an UNCHANGED listed line keeps the price it was saved with, even after the catalogue price moved; a changed item takes the new price", async () => {
    const row = await created("editor", misc([line(item(1), { quantity: "2" }), line(item(2), { quantity: "10" })]));
    cash.store.dataFor(HOTEL_A).catalog.hotel[0].items[0].pricePaise = toPaise(9000);
    cash.store.dataFor(HOTEL_A).catalog.hotel[0].items[1].pricePaise = toPaise(1000);
    const [milk, eggs] = row.lines;
    const res = await patch("editor", row.id, misc([line(item(1), { quantity: "3", lineId: milk.id }), line(item(3), { quantity: "1", lineId: eggs.id }, cat(2))]));
    const out = (await body(res)).data as CashExpense;
    assert.deepEqual(out.lines.map((l) => [l.itemName, l.pricePaise, l.totalPaise]), [["Milk", 5000, 15000], ["Bread", 4500, 4500]], "milk keeps 50.00, bread is a new item at its catalogue price");
    assert.equal(out.amountPaise, 19500);
  });
  test("editing replaces every line (new ids), changes the amount, words, names and the log line", async () => {
    const row = await created("editor", misc(MILK_EGGS()));
    const out = (await body(await patch("editor", row.id, misc([line(item(1), { quantity: "1" })])))).data as CashExpense;
    assert.equal(out.lines.length, 1);
    assert.ok(!row.lines.some((l) => l.id === out.lines[0].id), "the line ids changed");
    assert.equal(out.amountPaise, 5000);
    assert.equal(logs()[1].summary, "Changed Hotel Miscellaneous Expense: 0001 (Amount (paise), Expense name)", "the head is Dairy before and after, so it did not move");
  });
  test("a line whose item left the catalogue is shown as 'keep' and stays exactly as saved on edit", async () => {
    const row = await created("editor", misc(MILK_EGGS()));
    cash.store.dataFor(HOTEL_A).catalog.hotel[0].items.splice(0, 1); // Milk removed
    const shown = (await body(await getRoute(req("GET", "/x", "viewer"), ctx({ id: row.id })))).data as CashExpense;
    assert.deepEqual([shown.lines[0].categoryId, shown.lines[0].itemId, shown.lines[0].itemName], ["keep", "keep", "Milk"]);
    assert.deepEqual([shown.lines[1].categoryId, shown.lines[1].itemId], [cat(1), item(2)]);
    const out = (await body(await patch("editor", row.id, misc([line("keep", { lineId: shown.lines[0].id, quantity: "2" }, "keep"), line(item(2), { lineId: shown.lines[1].id, quantity: "12" })])))).data as CashExpense;
    assert.deepEqual(out.lines.map((l) => [l.itemName, l.totalPaise]), [["Milk", 10000], ["Eggs", 8400]]);
  });
  test("Pallav defect fixed: a restored miscellaneous expense still has its lines", async () => {
    const row = await created("editor", misc(MILK_EGGS()));
    await del("admin", row.id, 1);
    assert.equal(cash.store.dataFor(HOTEL_A).misc.hotel[0].lines.length, 2, "soft delete keeps the lines");
    const back = (await body(await restore("super", row.id, 2))).data as CashExpense;
    assert.equal(back.lines.length, 2);
    assert.equal(back.amountPaise, 18400);
  });
  test("a food entry uses the FOOD catalogue", async () => {
    const row = await created("admin", misc([line(item(4), { quantity: "2" }, cat(3))], { book: "food" }));
    assert.equal(row.amountPaise, 330000);
    assert.equal(row.type, "food-misc");
  });
});

describe("the recycle bin, entry numbers, the lock and force mode (shared with revenue through the engine)", () => {
  test("delete: only an admin; soft delete; the bin; restore and purge are SuperAdmin only; numbers are per table", async () => {
    const w = await created("editor", withdrawal());
    const m = await created("editor", misc(MILK_EGGS()));
    assert.deepEqual([w.entryNo, m.entryNo], [1, 1], "withdrawals and misc expenses number separately");
    assert.equal((await del("editor", w.id, 1)).status, 403);
    assert.equal((await del("admin", w.id, 1)).status, 200);
    assert.equal((await list("viewer")).data.total, 1);
    assert.equal((await list("admin", "?deleted=only")).status, 403);
    assert.equal((await list("super", "?deleted=only")).data.total, 1);
    assert.equal((await restore("admin", w.id, 2)).status, 403);
    assert.equal((await restore("super", w.id, 2)).status, 200);
    await del("admin", w.id, 3);
    assert.equal((await purge("super", w.id)).status, 200);
    assert.equal((await created("editor", withdrawal())).entryNo, 1, "the last number is free again after a purge");
    assert.equal((await purge("super", m.id)).status, 404, "a live entry is never purged");
  });
  test("the delete log line holds what it held, and a recycle-bin restore is logged in module recycle-bin", async () => {
    const w = await created("editor", withdrawal({ instruction: "cash" }));
    await del("admin", w.id, 1);
    assert.deepEqual(logs()[1].details, { Date: "05-10-2026", "Amount (paise)": 120000, "Paid to": "Ramesh (Kitchen)", What: "cash" });
    await restore("super", w.id, 2);
    assert.deepEqual([logs()[2].module, logs()[2].summary], ["recycle-bin", "Added Hotel Cash Withdrawal: 0001"]);
  });
  test("the accounting-year lock applies to expenses too, with Pallav's message on the date field", async () => {
    const res = await create("admin", withdrawal({ stamp: { date: "2026-03-15", time: "10:00" } }));
    assert.equal(res.status, 422);
    assert.equal((await fieldsOf(res)).date, "2025-26 is closed, so nothing can be dated 15 Mar 2026. Only 2026-27 (Apr 2026 - Mar 2027) takes entries.");
  });
  test("date and time can be chosen only with system.backdate (otherwise the moment of saving)", async () => {
    assert.equal((await created("editor", withdrawal({ stamp: { date: "2026-09-01", time: "08:15" } }))).at, "2026-10-05T04:30:00.000Z");
    assert.equal((await created("admin", withdrawal({ stamp: { date: "2026-09-01", time: "08:15" } }))).at, "2026-09-01T02:45:00.000Z");
  });
  test("force mode: the SuperAdmin may correct a closed expense; the force log says 'Edited a closed expense entry'", async () => {
    const first = await created("editor", withdrawal());
    await created("editor", withdrawal());
    assert.equal((await patch("force", first.id, withdrawal({ amountPaise: 777 }))).status, 200);
    assert.equal(cash.store.dataFor(HOTEL_A).forceLogs[0].summary, "Forced past a lock: Edited a closed expense entry");
    assert.deepEqual(auditEvents.map((e) => e.action), ["force.override"]);
  });
  test("Idempotency-Key: the same key and request is one entry", async () => {
    const key = { "idempotency-key": "key-expense-0001" };
    assert.equal((await create("editor", misc(MILK_EGGS()), key)).status, 201);
    assert.equal((await create("editor", misc(MILK_EGGS()), key)).headers.get("idempotent-replayed"), "true");
    assert.equal((await list("viewer")).data.total, 1);
  });
  test("if the log cannot be written nothing is saved (one transaction), lines included", async () => {
    const base = cash.unit;
    configureCashExpenses(createExpenseService({ unit: { run: (s, work) => base.run(s, (r) => work({ ...r, systemLogs: { write: async () => { throw new Error("log down"); } } })) }, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => clock }));
    assert.equal((await create("editor", misc(MILK_EGGS()))).status, 500);
    assert.equal(cash.store.dataFor(HOTEL_A).misc.hotel.length, 0);
  });
});

describe("the list: withdrawals and miscellaneous expenses together", () => {
  test("merged newest first; filters by book and kind; tab counts; the total of every page; the numbers on top count both kinds", async () => {
    await created("admin", withdrawal({ amountPaise: 100000, stamp: { date: "2026-10-01", time: "09:00" } }));
    await created("admin", misc([line(item(1), { quantity: "1" })], { stamp: { date: "2026-10-03", time: "09:00" } }));
    await created("admin", withdrawal({ book: "food", withdrawer: "Hitesh Parmar", amountPaise: 30000, stamp: { date: "2026-10-02", time: "09:00" } }));
    const all = (await list("viewer")).data;
    assert.deepEqual(all.items.map((i) => [i.kind, i.book]), [["misc", "hotel"], ["withdrawal", "food"], ["withdrawal", "hotel"]]);
    assert.deepEqual(all.counts, { all: 3, hotel: 2, food: 1 });
    assert.equal(all.shownTotalPaise, 135000);
    assert.equal((await list("viewer", "?kind=misc")).data.total, 1);
    assert.equal((await list("viewer", "?book=food")).data.total, 1);
    assert.deepEqual((await list("viewer", "?kind=withdrawal&book=hotel")).data.items.map((i) => i.amountPaise), [100000]);
    assert.deepEqual(all.stats, { todayPaise: 0, monthPaise: 135000, hotelMonthPaise: 105000, foodMonthPaise: 30000 });
  });
  test("Pallav's search with the extra words: the kind's name, the book, the lines' category and item, the recorder", async () => {
    await created("editor", withdrawal({ instruction: "Vegetables for the week" }));
    await created("editor2", misc(MILK_EGGS(), { instruction: "o'brien; DROP TABLE x;--" }));
    const q = async (s: string) => (await list("viewer", `?search=${encodeURIComponent(s)}`)).data.items.map((i) => i.kind).sort();
    assert.deepEqual(await q("cash withdrawal"), ["withdrawal"]);
    assert.deepEqual(await q("miscellaneous"), ["misc"]);
    assert.deepEqual(await q("milk eggs"), ["misc"], "the lines' item names");
    assert.deepEqual(await q("dairy"), ["misc"], "the lines' category and the expense head");
    assert.deepEqual(await q("kitchen vegetables"), ["withdrawal"]);
    assert.deepEqual(await q("esha"), ["misc"]);
    assert.deepEqual(await q("hotel"), ["misc", "withdrawal"]);
    assert.deepEqual(await q("'; drop table"), ["misc"]);
  });
  test("sort is a whitelist, page size is 10/25/50/100, an advance filter shows nothing yet, hostile input is 422", async () => {
    await created("admin", withdrawal({ amountPaise: 500 }));
    await created("admin", withdrawal({ amountPaise: 100 }));
    assert.deepEqual((await list("viewer", "?sort=amountPaise&dir=asc")).data.items.map((i) => i.amountPaise), [100, 500]);
    assert.equal((await list("viewer", "?kind=advance")).data.total, 0);
    for (const qs of ["?sort=password_hash", "?sort=name;DROP", "?kind=other", "?pageSize=7", "?page=0", "?book=all&book=hotel"]) assert.equal((await list("viewer", qs)).status, 422, qs);
  });
  test("isLatest is per table and ordered by date, time and creation", async () => {
    const w1 = await created("admin", withdrawal());
    const m1 = await created("admin", misc(MILK_EGGS()));
    const w2 = await created("admin", withdrawal({ stamp: { date: "2026-09-01", time: "08:00" } }));
    assert.deepEqual([w1.isLatest, m1.isLatest, w2.isLatest], [true, true, false].map((v, i) => (i === 0 ? true : v)));
    const items = (await list("viewer")).data.items;
    assert.equal(items.find((i) => i.id === w1.id)?.isLatest, true);
    assert.equal(items.find((i) => i.id === w2.id)?.isLatest, false, "a backdated entry is not the newest");
    assert.equal(items.find((i) => i.id === m1.id)?.isLatest, true);
  });
});

describe("hotel isolation and the contract", () => {
  test("hotel B cannot read, change, delete, restore or purge hotel A's entries (404); catalogues and numbers are per hotel", async () => {
    await seed(HOTEL_B);
    const w = await created("editor", withdrawal());
    const m = await created("editor", misc(MILK_EGGS()));
    for (const entry of [w, m]) {
      assert.equal((await getRoute(req("GET", "/x", "adminB"), ctx({ id: entry.id }))).status, 404);
      assert.equal((await patch("adminB", entry.id, withdrawal())).status, 404);
      assert.equal((await del("adminB", entry.id, 1)).status, 404);
    }
    assert.equal((await list("adminB")).data.total, 0);
    const mine = await create("adminB", withdrawal());
    assert.equal(((await body(mine)).data as CashExpense).entryNo, 1);
  });
  test("a withdrawal and a miscellaneous expense have exactly the ui-shared CashExpense keys (plus the version, a contract request)", async () => {
    const sample: CashExpense = {
      id: "x", entryNo: 1, at: "2026-10-05T04:30:00.000Z", recordedBy: { id: "x", name: "x" }, createdAt: "x", updatedAt: "x", isLatest: true,
      type: "hotel-withdrawal", kind: "withdrawal", book: "hotel", withdrawer: null, employee: null, yearMonth: null,
      lines: [{ id: "x", categoryId: "x", categoryName: "x", itemId: "x", itemName: "x", pricing: "listed", quantity: 1, pricePaise: 1, totalPaise: 1 }],
      amountPaise: 1, instruction: null,
    };
    assertMatchesContract(await created("editor", withdrawal({ instruction: "x" })), { ...sample, version: 1, withdrawer: "x", lines: [] }, "withdrawal");
    assertMatchesContract(await created("editor", misc(MILK_EGGS())), { ...sample, version: 1 }, "misc");
  });
  test("the list has exactly the CashList keys", async () => {
    await created("editor", withdrawal());
    const l = (await list("viewer")).data;
    assert.deepEqual(Object.keys(l).sort(), ["counts", "items", "page", "pageSize", "shownTotalPaise", "stats", "total"]);
    assert.deepEqual(Object.keys(l.stats).sort(), ["foodMonthPaise", "hotelMonthPaise", "monthPaise", "todayPaise"]);
  });
});

describe("the lookups the forms are drawn from (GET /api/v1/cash/lookups)", () => {
  const lookups = async (who: string | null) => {
    const { GET } = await import("../../src/app/api/v1/cash/lookups/route");
    const { configureCashLookups } = await import("../../src/server/compose/cash");
    const { createLookupsService } = await import("../../src/server/services/cash/lookupsService");
    configureCashLookups(createLookupsService({ unit: cash.unit, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => clock }));
    return GET(req("GET", "/api/v1/cash/lookups", who), ctx());
  };
  test("anyone who may read Revenue or Expenses gets the active names, the catalogue with paise prices and the shifts; nobody else", async () => {
    assert.equal((await lookups(null)).status, 401);
    assert.equal((await lookups("nobody")).status, 403);
    assert.equal((await lookups("wOnly")).status, 403, "a write-only part is not a read");
    const data = (await body(await lookups("viewer"))).data;
    assert.deepEqual(data.receivers, { hotel: ["Ramesh (Kitchen)", "Suresh"], food: ["Hitesh Parmar"] });
    assert.deepEqual(data.depositors, { hotel: [], food: [] });
    assert.deepEqual(data.staff, []);
    assert.deepEqual(data.shifts, ["Morning", "Afternoon", "Evening", "Night"]);
    const milk = data.catalogue[0].items[0];
    assert.deepEqual([data.catalogue[0].name, data.catalogue[0].book, milk.name, milk.pricePaise], ["Dairy", "hotel", "Milk", 5000]);
    assert.equal(data.catalogue.length, 3);
  });
  test("names taken off a Master Data list disappear; another hotel's lists are never shown", async () => {
    cash.store.dataFor(HOTEL_A).lists.cash_person_hotel = ["Suresh"];
    assert.deepEqual((await body(await lookups("viewer"))).data.receivers.hotel, ["Suresh"]);
    assert.deepEqual((await body(await lookups("adminB"))).data.receivers, { hotel: [], food: [] });
  });
});
