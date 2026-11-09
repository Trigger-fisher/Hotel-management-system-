// Daily Cash revenue through the WHOLE stack on the real database: real sign-in, session cookie, the real route files and wrapper, the cash service,
// the PostgreSQL hotel repositories, withHotel and the hotel's own role. A second hotel's administrator proves the isolation from the top.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DELETE as purgeRoute } from "../../src/app/api/v1/revenue/deposits/[id]/purge/route";
import { POST as restoreRoute } from "../../src/app/api/v1/revenue/deposits/[id]/restore/route";
import { DELETE as removeRoute, GET as getRoute, PATCH as updateRoute } from "../../src/app/api/v1/revenue/deposits/[id]/route";
import { GET as listRoute, POST as createRoute } from "../../src/app/api/v1/revenue/deposits/route";
import { GET as expenseListRoute, POST as expenseCreateRoute } from "../../src/app/api/v1/expense/entries/route";
import { DELETE as expenseRemoveRoute, PATCH as expenseUpdateRoute } from "../../src/app/api/v1/expense/entries/[id]/route";
import { createDatabase, type Database } from "../../src/db";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { json, req } from "../server/helpers/authWorld";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { loginCookie, makeAdmin, startStack, stopStack, type Admin } from "./helpers/stack";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let database: Database;
let A: CreatedHotel;
let B: CreatedHotel;
let adminA: Admin;
let adminB: Admin;
let cookieA: string;
let cookieB: string;
let depositor: string;

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  A = await createTestHotel(owner, "Flow Alpha");
  B = await createTestHotel(owner, "Flow Beta");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 10 });
  startStack(database);
  adminA = await makeAdmin(owner, A.id, "super_admin");
  adminB = await makeAdmin(owner, B.id, "super_admin");
  cookieA = await loginCookie(owner, adminA);
  cookieB = await loginCookie(owner, adminB);
  // the hotel's own Master Data (a new hotel starts with empty lists): one depositor, and the accounting year the entry falls in
  depositor = "Front desk";
  for (const hotel of [A, B]) {
    await owner.query(`DELETE FROM "${hotel.schema}".accounting_years`);
    await owner.query(`INSERT INTO "${hotel.schema}".accounting_years (label, starts_on, ends_on) VALUES ('2026-27', '2026-04-01', '2027-03-31'), ('2025-26', '2025-04-01', '2026-03-31')`);
    const set = await owner.query(`SELECT id FROM "${hotel.schema}".option_sets WHERE key = 'revenue_depositor_hotel'`);
    await owner.query(`INSERT INTO "${hotel.schema}".option_items (option_set_id, label, value) VALUES ($1, $2, $2)`, [set.rows[0].id, depositor]);
  }
});

after(async () => {
  stopStack();
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const input = (over: Record<string, unknown> = {}) => ({ book: "hotel", depositor, amountPaise: 150000, instruction: "", stamp: null, ...over });
const call = (cookie: string, method: string, path: string, body?: unknown) => req(method, path, { cookie, body });

describe("Daily Cash revenue on the real database, through the real routes", () => {
  test("create, read, list, edit, delete, restore and purge a deposit as a signed-in administrator", async () => {
    const made = await createRoute(call(cookieA, "POST", "/api/v1/revenue/deposits", input({ instruction: "Night shift" })), ctx());
    const created = await json(made);
    assert.equal(made.status, 201, JSON.stringify(created));
    const deposit = created.data;
    assert.equal(deposit.entryNo, 1);
    assert.equal(deposit.amountPaise, 150000);
    assert.equal(deposit.depositor, depositor);

    const listed = await json(await listRoute(call(cookieA, "GET", "/api/v1/revenue/deposits"), ctx()));
    assert.ok(listed.data.items.some((r: { id: string }) => r.id === deposit.id), JSON.stringify(listed).slice(0, 300));
    const one = await json(await getRoute(call(cookieA, "GET", `/api/v1/revenue/deposits/${deposit.id}`), ctx({ id: deposit.id })));
    assert.equal(one.data.id, deposit.id);

    const edited = await updateRoute(call(cookieA, "PATCH", `/api/v1/revenue/deposits/${deposit.id}`, { ...input({ amountPaise: 200000 }), version: deposit.version }), ctx({ id: deposit.id }));
    const editedBody = await json(edited);
    assert.equal(edited.status, 200, JSON.stringify(editedBody));
    assert.equal(editedBody.data.amountPaise, 200000);
    const stale = await updateRoute(call(cookieA, "PATCH", `/api/v1/revenue/deposits/${deposit.id}`, { ...input(), version: deposit.version }), ctx({ id: deposit.id }));
    assert.equal(stale.status, 409, "a stale version is a conflict");

    const removed = await removeRoute(call(cookieA, "DELETE", `/api/v1/revenue/deposits/${deposit.id}`, { version: editedBody.data.version }), ctx({ id: deposit.id }));
    assert.equal(removed.status, 200, JSON.stringify(await json(removed)));
    const binRow = await owner.query(`SELECT deleted_at, deleted_by::text AS by, amount_paise::text AS amount, version FROM "${A.schema}".hotel_cash_deposits WHERE id = $1`, [deposit.id]);
    assert.ok(binRow.rows[0].deleted_at instanceof Date);
    assert.equal(binRow.rows[0].by, adminA.id);
    assert.equal(binRow.rows[0].amount, "200000");

    const restored = await restoreRoute(call(cookieA, "POST", `/api/v1/revenue/deposits/${deposit.id}/restore`, { version: binRow.rows[0].version }), ctx({ id: deposit.id }));
    assert.equal(restored.status, 200, JSON.stringify(await json(restored)));
    const logs = await owner.query(`SELECT action FROM "${A.schema}".system_logs WHERE module = 'revenue' ORDER BY created_at, id`);
    assert.ok(logs.rows.length >= 3, "every change wrote its log line in the same transaction");
    const gone = await removeRoute(call(cookieA, "DELETE", `/api/v1/revenue/deposits/${deposit.id}`, { version: (await json(restored)).data.version }), ctx({ id: deposit.id }));
    assert.equal(gone.status, 200);
    const purged = await purgeRoute(call(cookieA, "DELETE", `/api/v1/revenue/deposits/${deposit.id}/purge`), ctx({ id: deposit.id }));
    assert.equal(purged.status, 200, JSON.stringify(await json(purged)));
    assert.equal((await owner.query(`SELECT 1 FROM "${A.schema}".hotel_cash_deposits WHERE id = $1`, [deposit.id])).rows.length, 0);
  });

  test("hotel B's administrator never sees or touches hotel A's deposits, and A never sees B's, by any route", async () => {
    const made = async (cookie: string, amountPaise: number) => {
      const res = await createRoute(call(cookie, "POST", "/api/v1/revenue/deposits", input({ amountPaise })), ctx());
      const body = await json(res);
      assert.equal(res.status, 201, JSON.stringify(body));
      return body.data;
    };
    const a = await made(cookieA, 111100);
    const b = await made(cookieB, 222200);
    const listB = await json(await listRoute(call(cookieB, "GET", "/api/v1/revenue/deposits"), ctx()));
    const idsB = listB.data.items.map((r: { id: string }) => r.id);
    assert.ok(idsB.includes(b.id) && !idsB.includes(a.id));
    const readA = await getRoute(call(cookieB, "GET", `/api/v1/revenue/deposits/${a.id}`), ctx({ id: a.id }));
    assert.equal(readA.status, 404, "another hotel's id is simply not found");
    const delA = await removeRoute(call(cookieB, "DELETE", `/api/v1/revenue/deposits/${a.id}`, { version: a.version }), ctx({ id: a.id }));
    assert.equal(delA.status, 404);
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${A.schema}".hotel_cash_deposits WHERE id = $1 AND deleted_at IS NULL`, [a.id])).rows[0].n), 1);
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${B.schema}".hotel_cash_deposits WHERE id = $1`, [a.id])).rows[0].n), 0);
  });

  test("a request with no session, and a cookie that is not a session, are refused", async () => {
    assert.equal((await listRoute(req("GET", "/api/v1/revenue/deposits"), ctx())).status, 401);
    assert.equal((await listRoute(call("not-a-real-token", "GET", "/api/v1/revenue/deposits"), ctx())).status, 401);
  });
});

describe("Daily Cash expenses on the real database, through the real routes", () => {
  test("a withdrawal and a miscellaneous expense with priced catalogue lines: totals, lines, edit replaces the lines, delete keeps them", async () => {
    const cats = await owner.query(`INSERT INTO "${A.schema}".expense_categories (business, name, sort_order) VALUES ('hotel', 'Dairy', 1) RETURNING id`);
    const categoryId = String(cats.rows[0].id);
    const items = await owner.query(`INSERT INTO "${A.schema}".expense_items (expense_category_id, name, price_paise, sort_order) VALUES ($1, 'Milk', 6000, 1), ($1, 'Eggs', 800, 2) RETURNING id`, [categoryId]);
    const [milk, eggs] = items.rows.map((r) => String(r.id));
    const people = await owner.query(`SELECT id FROM "${A.schema}".option_sets WHERE key = 'cash_person_hotel'`);
    await owner.query(`INSERT INTO "${A.schema}".option_items (option_set_id, label, value) VALUES ($1, 'Suresh', 'Suresh')`, [people.rows[0].id]);

    const withdrawal = { kind: "withdrawal", book: "hotel", withdrawer: "Suresh", employeeId: "", yearMonth: "", amountPaise: 120000, lines: [], instruction: "", stamp: null };
    const w = await expenseCreateRoute(call(cookieA, "POST", "/api/v1/expense/entries", withdrawal), ctx());
    const wBody = await json(w);
    assert.equal(w.status, 201, JSON.stringify(wBody));
    assert.equal(wBody.data.amountPaise, 120000);

    const line = (itemId: string, quantity: string) => ({ key: "k", lineId: null, categoryId, itemId, quantity, pricing: "listed", amountPaise: null });
    const misc = { kind: "misc", book: "hotel", withdrawer: "", employeeId: "", yearMonth: "", amountPaise: null, lines: [line(milk, "2"), line(eggs, "12")], instruction: "", stamp: null };
    const m = await expenseCreateRoute(call(cookieA, "POST", "/api/v1/expense/entries", misc), ctx());
    const mBody = await json(m);
    assert.equal(m.status, 201, JSON.stringify(mBody));
    assert.equal(mBody.data.amountPaise, 2 * 6000 + 12 * 800, "the total is worked out from the catalogue prices");
    assert.equal(mBody.data.lines.length, 2);
    const stored = await owner.query(`SELECT quantity::text AS q, price_paise::text AS p, total_paise::text AS t FROM "${A.schema}".expense_lines WHERE expense_id = $1 ORDER BY created_at, id`, [mBody.data.id]);
    assert.deepEqual(stored.rows.map((r) => [r.q, r.p, r.t]), [["2.000", "6000", "12000"], ["12.000", "800", "9600"]]);

    const edited = await expenseUpdateRoute(call(cookieA, "PATCH", `/api/v1/expense/entries/${mBody.data.id}`, { ...misc, lines: [line(milk, "1")], version: mBody.data.version }), ctx({ id: mBody.data.id }));
    const eBody = await json(edited);
    assert.equal(edited.status, 200, JSON.stringify(eBody));
    assert.equal(eBody.data.lines.length, 1);
    assert.equal(eBody.data.amountPaise, 6000);
    const listed = await json(await expenseListRoute(call(cookieA, "GET", "/api/v1/expense/entries"), ctx()));
    assert.ok(listed.data.items.some((i: { id: string }) => i.id === wBody.data.id) && listed.data.items.some((i: { id: string }) => i.id === mBody.data.id));
    const removed = await expenseRemoveRoute(call(cookieA, "DELETE", `/api/v1/expense/entries/${mBody.data.id}`, { version: eBody.data.version }), ctx({ id: mBody.data.id }));
    assert.equal(removed.status, 200, JSON.stringify(await json(removed)));
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${A.schema}".expense_lines WHERE expense_id = $1`, [mBody.data.id])).rows[0].n), 1, "soft delete keeps the lines");
    assert.equal((await expenseListRoute(call(cookieB, "GET", "/api/v1/expense/entries"), ctx())).status, 200);
    const listB = await json(await expenseListRoute(call(cookieB, "GET", "/api/v1/expense/entries"), ctx()));
    assert.equal(listB.data.items.length, 0, "hotel B sees none of hotel A's expenses");
  });
});

after(async () => {
  await releaseTestLock?.();
});
