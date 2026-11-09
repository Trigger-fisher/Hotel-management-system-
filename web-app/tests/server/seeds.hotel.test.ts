// The hotel seeds: structural defaults generated from Pallav's own migrations and code. They must hold no real person,
// phone number, e-mail, bank detail or Hotel Pallav text, and they must be safe to run twice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { HOTEL_SEED_OUTPUT, generateHotelSeed, loadHotelDefaults } from "../../../common/db/scripts/generate-hotel-seeds";
import { formatViolations, lintDirectory, readSqlDirectory } from "../../../common/db/scripts/lint-sql";
import { loadMigrationFiles, runMigrations, type MigrationClient, type QueryResult } from "../../../common/db/scripts/migrate";

const seedsDir = path.join(__dirname, "..", "..", "..", "common", "db", "seeds", "hotel");
const defaults = loadHotelDefaults();
const sql = readFileSync(HOTEL_SEED_OUTPUT, "utf8");
/** The SQL without its comment lines: comments may name Pallav as the source, the data may not. */
const data = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
const HOTEL = `hotel_${"c".repeat(32)}`;

describe("hotel seed file", () => {
  test("the committed file is exactly what the generator produces", () => {
    assert.equal(sql, generateHotelSeed(defaults));
  });

  test("it passes the seed lint (idempotent INSERT ... ON CONFLICT only)", () => {
    const violations = lintDirectory(seedsDir, "hotel", "seed");
    assert.equal(violations.length, 0, formatViolations(violations));
    assert.deepEqual(readSqlDirectory(seedsDir).map((f) => f.name), ["0001_defaults.sql", "0002_first_accounting_year.sql"]);
  });

  test("every statement is an INSERT with ON CONFLICT, and the table names are unqualified", () => {
    const statements = data.split(";").map((s) => s.trim()).filter(Boolean);
    assert.ok(statements.length >= 8);
    for (const st of statements) {
      assert.match(st, /^INSERT INTO [a-z_]+/, st.slice(0, 40));
      assert.match(st, /ON CONFLICT/, st.slice(0, 40));
      assert.doesNotMatch(st, /INSERT INTO (platform|hotel_)/);
    }
  });
});

describe("what a seed must never contain", () => {
  test("no e-mail address", () => assert.doesNotMatch(data, /[^\s@'"]+@[^\s@'"]+\.[A-Za-z]{2,}/));
  test("no run of ten or more digits (phone, account, Aadhaar)", () => assert.doesNotMatch(data, /\d{10,}/));
  test("no IFSC or PAN shaped value", () => {
    assert.doesNotMatch(data, /\b[A-Z]{4}0[A-Z0-9]{6}\b/);
    assert.doesNotMatch(data, /\b[A-Z]{5}\d{4}[A-Z]\b/);
  });
  test("no encrypted value, password hash, key or token", () => {
    assert.doesNotMatch(data, /\bv1:[A-Za-z0-9_-]+:/);
    assert.doesNotMatch(data.replaceAll("is_secret", ""), /\$argon2|\$2y\$|BEGIN (RSA |EC )?PRIVATE KEY|password|secret|token/i);
  });
  test("no Hotel Pallav text (brand names became Hotel and Food)", () => {
    assert.doesNotMatch(data, /pallav/i);
    assert.doesNotMatch(data, /rajkot|kalavad/i);
  });
  test("no person's name: the names-only lists start empty", () => {
    for (const set of defaults.optionSets.filter((s) => /Names only|Miscellaneous/.test(s.description))) assert.deepEqual(set.items, [], set.key);
  });
});

describe("what it seeds (each list names its Pallav source in the JSON)", () => {
  test("two business units, generic names", () => {
    assert.deepEqual(defaults.businessUnits.rows.map((u) => [u.slug, u.name, u.code]), [["hotel", "Hotel", "HOTEL"], ["food", "Food", "FOOD"]]);
    assert.ok(defaults.businessUnits.source.includes("create_business_units_table.php"));
  });

  test("ten master lists, in Pallav's order, with its items", () => {
    assert.deepEqual(defaults.optionSets.map((s) => s.key), [
      "payment_mode", "hotel_plan", "shift", "company_contact_role", "revenue_depositor_hotel", "revenue_depositor_food", "cash_person_hotel", "cash_person_food", "expense_catalog_hotel", "expense_catalog_food",
    ]);
    const byKey = new Map(defaults.optionSets.map((s) => [s.key, s.items]));
    assert.deepEqual(byKey.get("payment_mode"), ["Cash", "Card", "Debit", "Bank Transfer", "Cheque", "UPI", "Complimentary"]);
    assert.deepEqual(byKey.get("hotel_plan"), ["EP", "CP", "MAP", "AP"]);
    assert.deepEqual(byKey.get("shift"), ["Morning", "Afternoon", "Evening", "Night"]);
    assert.deepEqual(byKey.get("company_contact_role"), ["Managing Director", "HR Head", "Assistant HR", "Accountant Head", "Accountant Assistant", "Other"]);
    for (const s of defaults.optionSets) {
      assert.ok(s.source.length > 20, `${s.key} needs a source`);
      assert.ok(["select", "radio", "checkbox"].includes(s.input));
      assert.ok(s.key.length <= 255 && s.icon.length <= 40);
    }
  });

  test("eight expense heads for each business, no items; five ID proof types; four shared payroll lists", () => {
    assert.equal(defaults.expenseCategories.names.length, 8);
    assert.deepEqual(defaults.expenseCategories.businesses, ["hotel", "food"]);
    assert.equal((sql.match(/\('(hotel|food)', '(Kitchen|Housekeeping|Maintenance|Utilities|Marketing|Transport|Office|Other)', \d\)/g) ?? []).length, 16);
    assert.deepEqual(defaults.idProofTypes.names, ["Aadhaar Card", "PAN Card", "Voter ID", "Driving Licence", "Passport"]);
    assert.deepEqual(defaults.payrollMasterItems.lists.map((l) => l.list), ["gender", "separation_type", "id_proofs", "salary_payment_mode"]);
    assert.ok(!/INSERT INTO expense_items/.test(data), "nothing is invented under the categories");
  });

  test("the two single website rows are created with column defaults only", () => {
    assert.ok(data.includes("INSERT INTO site_settings DEFAULT VALUES ON CONFLICT DO NOTHING;"));
    assert.ok(data.includes("INSERT INTO site_page_content DEFAULT VALUES ON CONFLICT DO NOTHING;"));
  });

  test("two app settings carry the GST percent used at check-out (MJ #19): 5 and 5, idempotent, not secret", () => {
    assert.deepEqual(defaults.appSettings.rows, [{ key: "checkout.hotel_gst_percent", value: "5" }, { key: "checkout.food_gst_percent", value: "5" }]);
    assert.ok(data.includes("INSERT INTO app_settings (key, value, is_secret)"));
    assert.ok(data.includes("('checkout.hotel_gst_percent', '5', false)") && data.includes("('checkout.food_gst_percent', '5', false)"));
    assert.match(data, /\('checkout\.food_gst_percent', '5', false\)\nON CONFLICT \(key\) DO NOTHING;/);
  });

  test("everything Pallav does not seed is listed, so a missing default is a decision and not an accident", () => {
    const notSeeded = (JSON.parse(readFileSync(path.join(seedsDir, "..", "source", "pallav-hotel-defaults.json"), "utf8")) as { notSeeded: string[] }).notSeeded;
    assert.ok(notSeeded.length >= 5);
    assert.ok(notSeeded.some((n) => /payroll companies/.test(n)));
  });
});

describe("applied by the runner in seeds mode", () => {
  test("a hotel schema gets it once; a second run changes nothing; it is tracked in schema_seeds", async () => {
    const recorded: { version: string; checksum: string }[] = [];
    const ran: string[] = [];
    const db: MigrationClient = {
      async query(text: string, params: readonly unknown[] = []): Promise<QueryResult> {
        if (text.startsWith("SELECT pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (text.startsWith("SELECT 1 AS present FROM information_schema.schemata")) return { rows: [{ present: 1 }] };
        if (text.startsWith("SELECT version, checksum FROM")) return { rows: [...recorded] };
        if (text.includes(".schema_seeds (version")) recorded.push({ version: String(params[0]), checksum: String(params[1]) });
        else if (text.includes("INSERT INTO business_units")) ran.push(text);
        return { rows: [] };
      },
    };
    const files = loadMigrationFiles(seedsDir);
    const run = () => runMigrations({ client: db, kind: "seeds", platformFiles: [], hotelFiles: files, listHotelSchemas: async () => [HOTEL], skipPlatform: true });
    const first = await run();
    assert.deepEqual(first.applied, [{ schema: HOTEL, version: "0001_defaults" }, { schema: HOTEL, version: "0002_first_accounting_year" }]);
    assert.deepEqual(recorded.map((r) => r.version), ["0001_defaults", "0002_first_accounting_year"]);
    assert.equal(ran.length, 1, "the file ran once");
    assert.deepEqual((await run()).applied, []);
    assert.equal(ran.length, 1, "a second run changed nothing");
  });
});
