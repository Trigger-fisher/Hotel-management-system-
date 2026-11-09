// The hotel template on the REAL PostgreSQL instance: what create-hotel builds, table by table, and the rules only the database can prove.
// Needs the instance up (npm run test:db). Hotels are made by the real create-hotel on hms_test and removed at the end. Every hotel statement
// goes through the app's own door (withHotel), so it runs as the hotel's own role exactly like production.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { HOTEL_SOFT_DELETE_TABLES } from "../../../common/db/scripts/lint-sql";
import { createDatabase, type Database } from "../../src/db";
import type { TxClient } from "../../src/db/types";
import { ENTRY_NUMBER_TABLES } from "../../src/server/data/entryNo";
import { classifyPgError } from "../../src/server/db/pgErrors";
import { newId } from "../../src/server/db/ids";
import { appUrl, connectOwner, sqlStateOf, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, hotelMigrations, hotelSeeds, insertRow, removeAllTestHotels } from "./helpers/hotels";

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let tables: string[];

/** One unit of work as the hotel's own role. */
const h = <T>(work: (tx: TxClient) => Promise<T>): Promise<T> => database.withHotel({ hotelId: hotel.id }, work);
/** The SQLSTATE of inserting one generated row; each attempt is its own transaction, so a refusal never poisons the next. */
const tryInsert = (table: string, over: Record<string, unknown> = {}): Promise<string | null> => sqlStateOf(h((tx) => insertRow(tx, hotel.schema, table, over)));

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Template Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  tables = (await owner.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name", [hotel.schema])).rows.map((r) => String(r.t));
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

describe("what create-hotel builds", () => {
  test("79 hotel tables (67 from Pallav + idempotency_keys + menu_items + guest_id_scans + guest_requests + the three email-marketing tables + notifications and notification_targets + room_service_orders and their lines + support_requests + the seven Conversations tables of hotel 0050 + the stored mail of hotel 0053) plus the runner's two bookkeeping tables, and nothing else", () => {
    assert.equal(tables.filter((t) => !t.startsWith("schema_")).length, 86);
    assert.deepEqual(tables.filter((t) => t.startsWith("schema_")), ["schema_migrations", "schema_seeds"]);
  });

  test("every migration and seed file is recorded as applied", async () => {
    const m = await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".schema_migrations`);
    assert.equal(Number(m.rows[0].n), hotelMigrations().length);
    const s = await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".schema_seeds`);
    assert.equal(Number(s.rows[0].n), hotelSeeds().length);
    const setup = await owner.query(`SELECT status FROM platform.hotel_setup WHERE hotel_id = $1`, [hotel.id]);
    assert.deepEqual(setup.rows.map((r) => r.status), ["pending"], "a new hotel has its Set up your hotel checklist");
    const years = await owner.query(`SELECT count(*) AS n FROM "${hotel.schema}".accounting_years`);
    assert.equal(Number(years.rows[0].n), 1, "and its first accounting year");
  });

  test("the hotel seeds: 2 business units, 10 option sets, 16 expense categories, 5 ID proof types, the shared payroll lists, one row in each website singleton", async () => {
    const count = (table: string): Promise<number> => h(async (tx) => Number((await tx.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n));
    assert.equal(await count("business_units"), 2);
    assert.equal(await count("option_sets"), 10);
    assert.equal(await count("expense_categories"), 16);
    assert.equal(await count("id_proof_types"), 5);
    assert.equal(await count("site_settings"), 1);
    assert.equal(await count("site_page_content"), 1);
    assert.ok((await count("payroll_master_items")) > 0);
    assert.ok((await count("option_items")) > 0);
    for (const table of ["employees", "pms_stays", "customers", "bill_master_bills", "hotel_cash_deposits"]) assert.equal(await count(table), 0, `${table}: a new hotel starts empty`);
  });

  test("the platform knows the hotel and its schema name is the readable one (platform 0172); its role is still made from the id", async () => {
    const row = await owner.query("SELECT schema_name AS s FROM platform.hotels WHERE id = $1", [hotel.id]);
    assert.equal(String(row.rows[0].s), hotel.schema);
    assert.match(hotel.schema, /^[a-z][a-z0-9_]*$/);
    assert.ok(!hotel.schema.startsWith("hotel_") || hotel.schema.length < 38, "named for the hotel, not for its id");
    assert.equal((await owner.query("SELECT role_name FROM platform.hotels WHERE id = $1", [hotel.id])).rows[0].role_name, `hotel_${hotel.id.replaceAll("-", "")}_rw`);
    const audit = await owner.query("SELECT action FROM platform.audit_log WHERE hotel_id = $1", [hotel.id]);
    assert.deepEqual(audit.rows.map((r) => String(r.action)), ["hotel.create"]);
  });

  test("no column holds encrypted text, a blind index or a key, except the decided sealed ID-number columns (decision 74)", async () => {
    const odd = await owner.query("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = $1 AND (column_name ~ '(_index|_enc|_blind|_last4|cipher)$') AND column_name NOT IN ('id_proof_number_sealed', 'id_proof_number_idx')", [hotel.schema]);
    assert.deepEqual(odd.rows, []);
    const plain = await owner.query("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = $1 AND ((table_name = 'employees' AND column_name IN ('account_number', 'ifsc_code', 'id_proof_number', 'emergency_contact_number')) OR (table_name IN ('pms_stays', 'customers') AND column_name = 'id_proof_number'))", [hotel.schema]);
    assert.equal(plain.rows.length, 6);
  });

  test("every foreign key column has an index that starts with it (read from the server)", async () => {
    const fks = await owner.query(
      `SELECT t.relname AS t, a.attname AS c, a.attnum AS num, t.oid AS toid FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND n.nspname = $1`,
      [hotel.schema],
    );
    assert.ok(fks.rows.length > 20);
    for (const fk of fks.rows) {
      const idx = await owner.query("SELECT 1 AS x FROM pg_index i WHERE i.indrelid = $1::oid AND i.indkey[0] = $2::int2", [fk.toid, fk.num]);
      assert.ok(idx.rows.length > 0, `${String(fk.t)}.${String(fk.c)} has no index that starts with it`);
    }
  });

  test("no hotel table has a foreign key out of the hotel's own schema, and the salary tables keep Pallav's cut ties", async () => {
    const outside = await owner.query(
      `SELECT t.relname AS t FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_class f ON f.oid = k.confrelid JOIN pg_namespace fn ON fn.oid = f.relnamespace
        WHERE k.contype = 'f' AND n.nspname = $1 AND fn.nspname <> $1`,
      [hotel.schema],
    );
    assert.equal(outside.rows.length, 0);
    const salary = await owner.query("SELECT t.relname AS t FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE k.contype = 'f' AND n.nspname = $1 AND t.relname IN ('salary_processings', 'salary_update_histories')", [hotel.schema]);
    assert.deepEqual(salary.rows, []);
  });

  test("a fresh second hotel ends with exactly the same tables, columns, indexes, constraints and triggers", async () => {
    const second = await createTestHotel(owner, "Second Hotel");
    const shape = async (schema: string): Promise<string[]> => {
      const cols = await owner.query("SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || COALESCE(column_default, '-') AS x FROM information_schema.columns WHERE table_schema = $1 ORDER BY 1", [schema]);
      const idx = await owner.query("SELECT replace(indexdef, $1, '#') AS x FROM pg_indexes WHERE schemaname = $1 ORDER BY 1", [schema]);
      const cons = await owner.query("SELECT conrelid::regclass::text || ' ' || conname || ' ' || replace(pg_get_constraintdef(c.oid), $1, '#') AS x FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 ORDER BY 1", [schema]);
      const trg = await owner.query("SELECT tgrelid::regclass::text || ' ' || tgname AS x FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY 1", [schema]);
      return [...cols.rows, ...idx.rows, ...cons.rows, ...trg.rows].map((r) => String(r.x).replaceAll(schema, "#"));
    };
    assert.deepEqual(await shape(second.schema), await shape(hotel.schema));
  });
});

describe("every one of the 69 tables accepts a valid row (the generic builder fills the required columns from the server's own column list)", () => {
  test("insert one row into every table as the hotel's own role", async () => {
    const failures: string[] = [];
    for (const table of tables.filter((t) => !t.startsWith("schema_"))) {
      if (["site_settings", "site_page_content"].includes(table)) continue; // the singletons already hold their one row
      try {
        await h((tx) => insertRow(tx, hotel.schema, table, table === "idempotency_keys" ? { key: "table-sweep-key-1" } : table === "guest_id_scans" ? { created_at: new Date(), expires_at: new Date(Date.now() + 3600_000) } : table === "conv_contact_handles" ? { kind: "email", value: `sweep-${Date.now()}@example.in` } : table === "razorpay_records" ? { ref: "pay_SweepRow000001" } : {}));
      } catch (error) {
        failures.push(`${table}: ${(error as { code?: string }).code ?? "?"} ${(error as Error).message.slice(0, 120)}`);
      }
    }
    assert.deepEqual(failures, []);
  });
});

describe("constraints that only the database can prove", () => {
  test("site_settings and site_page_content hold one row and refuse a second", async () => {
    for (const table of ["site_settings", "site_page_content"]) {
      assert.equal(await sqlStateOf(h((tx) => tx.query(`INSERT INTO "${table}" DEFAULT VALUES`))), "23505", table);
    }
  });

  test("soft-delete uniques: after soft-deleting a company its name can be reused; two live ones cannot share it", async () => {
    const name = `Acme-${Date.now()}`;
    const first = await h((tx) => insertRow(tx, hotel.schema, "company_profiles", { name }));
    assert.equal(await tryInsert("company_profiles", { name }), "23505");
    await h((tx) => tx.query("UPDATE company_profiles SET deleted_at = now() WHERE id = $1", [first.id]));
    assert.equal(await tryInsert("company_profiles", { name }), null);
  });

  test("legacy_id is unique when set and repeatable when NULL", async () => {
    assert.equal(await tryInsert("id_proof_types", { legacy_id: 777001 }), null);
    assert.equal(await tryInsert("id_proof_types", { legacy_id: 777001 }), "23505");
    assert.equal(await tryInsert("id_proof_types", { legacy_id: null }), null);
    assert.equal(await tryInsert("id_proof_types", { legacy_id: null }), null);
  });

  test("money and date CHECKs refuse bad rows; a negative net salary is allowed", async () => {
    for (const amount of [0, -100]) assert.equal(await tryInsert("hotel_cash_deposits", { amount_paise: amount }), "23514", `deposit ${amount}`);
    assert.equal(await tryInsert("pms_reservations", { check_in: "2026-03-05", check_out: "2026-03-05" }), "23514");
    assert.equal(await tryInsert("bill_master_bills", { balance_hotel_amount_paise: -1 }), "23514");
    assert.equal(await tryInsert("salary_processings", { net_salary_paise: -5000 }), null);
  });

  test("percentages, ranges and enums: 101 percent, month 13, an unknown reservation status are refused", async () => {
    assert.equal(await tryInsert("attendance_statuses", { attendance_percentage: 101 }), "23514");
    assert.equal(await tryInsert("attendance_months", { month: 13 }), "23514");
    assert.equal(await tryInsert("pms_reservations", { status: "maybe" }), "23514");
  });

  test("foreign keys: CASCADE where Pallav has it, RESTRICT where a money record must outlive its parent", async () => {
    const category = await h((tx) => insertRow(tx, hotel.schema, "expense_categories", {}));
    await h((tx) => insertRow(tx, hotel.schema, "expense_items", { expense_category_id: category.id }));
    await h((tx) => tx.query("DELETE FROM expense_categories WHERE id = $1", [category.id]));
    assert.equal((await h((tx) => tx.query("SELECT 1 FROM expense_items WHERE expense_category_id = $1", [category.id]))).rows.length, 0, "the items went with their category (Pallav cascades)");
    const company = await h((tx) => insertRow(tx, hotel.schema, "company_profiles", {}));
    await h((tx) => insertRow(tx, hotel.schema, "bill_master_bills", { company_id: company.id }));
    const refused = await sqlStateOf(owner.query(`DELETE FROM "${hotel.schema}".company_profiles WHERE id = $1`, [company.id]));
    assert.equal(refused, "23001", "a money record is never deleted with its parent");
  });

  test("the GST percent used at check-out (MJ #19) is NULL until check-out and refused outside 0..28, on the stay and on the bill", async () => {
    for (const table of ["pms_stays", "bill_master_bills"]) {
      assert.equal(await tryInsert(table, { hotel_gst_percent: 5, food_gst_percent: 28 }), null);
      assert.equal(await tryInsert(table, {}), null);
      for (const bad of [-1, 28.01, 29, 100]) {
        assert.equal(await tryInsert(table, { hotel_gst_percent: bad }), "23514", `${table} hotel ${bad}`);
        assert.equal(await tryInsert(table, { food_gst_percent: bad }), "23514", `${table} food ${bad}`);
      }
    }
  });

  test("an ID number is stored in full: the guest's own text comes back exactly as written", async () => {
    const stay = await h((tx) => insertRow(tx, hotel.schema, "pms_stays", { id_proof_number: "1234 5678 9012" }));
    const back = await h((tx) => tx.query("SELECT id_proof_number AS n FROM pms_stays WHERE id = $1", [stay.id]));
    assert.equal(String(back.rows[0].n), "1234 5678 9012");
    assert.equal(await tryInsert("pms_stays", { id_proof_number: "1234 5678 9012" }), null, "two guests may carry the same document");
  });

  test("the hotel seed gives app_settings checkout.hotel_gst_percent and checkout.food_gst_percent = 5, not secret", async () => {
    const rows = await h((tx) => tx.query("SELECT key, value, is_secret FROM app_settings WHERE key LIKE 'checkout.%' ORDER BY key"));
    assert.deepEqual(rows.rows.map((r) => [String(r.key), String(r.value), r.is_secret]), [["checkout.food_gst_percent", "5", false], ["checkout.hotel_gst_percent", "5", false]]);
  });

  test("the two FIXED payroll companies exist, named after the hotel, codes HP01 and PF01 in every hotel", async () => {
    const rows = await h((tx) => tx.query("SELECT name, code FROM payroll_companies WHERE code IN ('HP01', 'PF01') ORDER BY code"));
    assert.deepEqual(rows.rows.map((r) => [String(r.name), String(r.code)]), [["Template Hotel", "HP01"], ["Template Hotel Food", "PF01"]]);
    assert.ok(!rows.rows.some((r) => /Pallav/i.test(String(r.name))));
  });

  test("the indexes the other workers asked for exist on the server (ledger, payroll core and pay)", async () => {
    const want: [string, string[]][] = [
      ["bill_master_bills", ["company_id", "bill_date"]], ["bill_master_advances", ["company_id", "payment_date"]],
      ["employees", ["payroll_company_id", "is_active", "name"]],
      ["salary_processings", ["payroll_company_id", "year", "month", "employee_name"]], ["salary_processings", ["payroll_company_id", "employee_id", "year", "month"]],
      ["payroll_advances", ["employee_id", "is_settled", "advance_date"]], ["bonus_incentives", ["employee_id", "entry_date"]],
      ["salary_update_histories", ["employee_id", "effective_date", "field_name"]],
    ];
    const indexes = await owner.query("SELECT tablename AS t, indexdef AS d FROM pg_indexes WHERE schemaname = $1", [hotel.schema]);
    for (const [table, columns] of want) {
      const wanted = `(${columns.join(", ")})`;
      assert.ok(indexes.rows.some((r) => String(r.t) === table && String(r.d).includes(wanted)), `${table} ${wanted}`);
    }
  });

  test("employees: the same e-mail twice in one company is refused, a deleted person or a missing e-mail frees it, another company may reuse it", async () => {
    const companyA = await h((tx) => insertRow(tx, hotel.schema, "payroll_companies", {}));
    const companyB = await h((tx) => insertRow(tx, hotel.schema, "payroll_companies", {}));
    const email = `staff-${Date.now()}@example.test`;
    const first = await h((tx) => insertRow(tx, hotel.schema, "employees", { payroll_company_id: companyA.id, email }));
    assert.equal(await tryInsert("employees", { payroll_company_id: companyA.id, email }), "23505");
    assert.equal(await tryInsert("employees", { payroll_company_id: companyB.id, email }), null);
    assert.equal(await tryInsert("employees", { payroll_company_id: companyA.id, email: null }), null);
    assert.equal(await tryInsert("employees", { payroll_company_id: companyA.id, email: null }), null);
    await h((tx) => tx.query("UPDATE employees SET deleted_at = now() WHERE id = $1", [first.id]));
    assert.equal(await tryInsert("employees", { payroll_company_id: companyA.id, email }), null);
  });

  test("an unknown parent is refused and the error names the constraint, not a value", async () => {
    try {
      await h((tx) => insertRow(tx, hotel.schema, "expense_items", { expense_category_id: newId() }));
      assert.fail("expected a foreign key error");
    } catch (error) {
      const info = classifyPgError(error);
      assert.equal(info.kind, "foreign_key");
      assert.equal(info.constraint, "expense_items_expense_category_id_fkey");
    }
  });

  test("UNIQUE(entry_no) is the backstop: a hand-made duplicate fails, and soft-deleted rows count", async () => {
    const first = await h((tx) => insertRow(tx, hotel.schema, "hotel_cash_deposits", { entry_no: 500001 }));
    assert.equal(await tryInsert("hotel_cash_deposits", { entry_no: 500001 }), "23505");
    await h((tx) => tx.query("UPDATE hotel_cash_deposits SET deleted_at = now(), version = version + 1 WHERE id = $1", [first.id]));
    assert.equal(await tryInsert("hotel_cash_deposits", { entry_no: 500001 }), "23505", "a recycle-binned entry keeps its number");
  });

  test("idempotency keys: the same (person, key) twice is refused, the same key for another person is fine, a completed row needs its status", async () => {
    const user = newId();
    const key = `key-${Date.now()}-abcdef`;
    const row = (userId: string, over: Record<string, unknown> = {}) => tryInsert("idempotency_keys", { user_id: userId, key, request_hash: "a".repeat(64), expires_at: "2030-01-01T00:00:00Z", ...over });
    assert.equal(await row(user), null);
    assert.equal(await row(user), "23505");
    assert.equal(await row(newId()), null);
    assert.equal(await row(newId(), { status: "completed", response_status: null }), "23514");
    assert.equal(await row(newId(), { status: "completed", response_status: 201 }), null);
  });

  test("every numbered book has UNIQUE(entry_no) and every recycle-bin table the soft-delete pair", async () => {
    for (const table of ENTRY_NUMBER_TABLES) {
      const k = await owner.query("SELECT 1 AS x FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexdef LIKE 'CREATE UNIQUE INDEX%(entry_no)%'", [hotel.schema, table]);
      assert.equal(k.rows.length, 1, table);
    }
    for (const table of HOTEL_SOFT_DELETE_TABLES) {
      const c = await owner.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name IN ('deleted_at', 'deleted_by')", [hotel.schema, table]);
      assert.equal(c.rows.length, 2, table);
    }
  });
});

after(async () => {
  await releaseTestLock?.();
});
