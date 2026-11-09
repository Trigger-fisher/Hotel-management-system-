import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { createFieldSeal, isSealed } from "../../src/server/crypto/fieldSeal";
import { MEMBER_FIELD, numberSealer, sealedWrite } from "../../src/server/repos/postgres/sealedNumbers";
import { sealNumbers as sealAll } from "../../../common/db/scripts/seal-numbers";
import { SEALED_NUMBER_COLUMNS } from "../../../common/db/scripts/lint-sql";
import { SEALED_COLUMNS, sealedColumnNames } from "../../src/server/crypto/sealedColumns";
import { columnSealer } from "../../src/server/repos/postgres/sealedColumns";

// Release A of decision 74: the repository edge (write all three columns, read the sealed one, fall back to plain) and the backfill (idempotent, verified, rolled back on a difference).
const HOTEL = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5c";
// the fake connection below holds the customers and stays tables only: the backfill is asked for those two (the real tables are covered by tests/db/sealedNumbers.db.test.ts)
const TWO = SEALED_COLUMNS.filter((c) => c.table === "customers" || c.table === "pms_stays");
const sealNumbers = (client: Parameters<typeof sealAll>[0], hotels: Parameters<typeof sealAll>[1], seal: Parameters<typeof sealAll>[2], options: Parameters<typeof sealAll>[3] = {}) => sealAll(client, hotels, seal, { entries: TWO, ...options });
const key = randomBytes(32);
const seal = createFieldSeal(key);

describe("numberSealer (the repository edge)", () => {
  test("a number is written plain, sealed and indexed from the one typed value", () => {
    const c = numberSealer(HOTEL, seal).columns("customers", " 1234 5678 9012 ");
    assert.equal(c.id_proof_number, "1234 5678 9012");
    assert.ok(isSealed(c.id_proof_number_sealed));
    assert.match(String(c.id_proof_number_idx), /^[0-9a-f]{64}$/);
    assert.equal(seal.open(HOTEL, "customer.id_proof_number", c.id_proof_number_sealed), "1234 5678 9012");
  });
  test("clearing the number clears all three; an untouched number writes nothing", () => {
    const s = numberSealer(HOTEL, seal);
    assert.deepEqual(s.columns("customers", null), { id_proof_number: null, id_proof_number_sealed: null, id_proof_number_idx: null });
    assert.deepEqual(s.columns("customers", "  "), { id_proof_number: null, id_proof_number_sealed: null, id_proof_number_idx: null });
    assert.deepEqual(s.columns("customers", undefined), {});
  });
  test("a customer's number and a stay's number are sealed for different fields", () => {
    const s = numberSealer(HOTEL, seal);
    const c = s.columns("customers", "ABCDE1234F"), st = s.columns("stays", "ABCDE1234F");
    assert.notEqual(c.id_proof_number_idx, st.id_proof_number_idx);
    assert.throws(() => seal.open(HOTEL, "stay.id_proof_number", c.id_proof_number_sealed));
  });
  test("reading: the sealed column wins; a row not sealed yet gives the plain number", () => {
    const s = numberSealer(HOTEL, seal);
    const sealed = s.columns("stays", "P1234567");
    assert.equal(s.plainOf("stays", { id_proof_number: null, id_proof_number_sealed: sealed.id_proof_number_sealed }), "P1234567");
    assert.equal(s.plainOf("stays", { id_proof_number: "OLD-PLAIN", id_proof_number_sealed: null }), "OLD-PLAIN");
    assert.equal(s.plainOf("stays", { id_proof_number: null, id_proof_number_sealed: null }), null);
  });
  test("a sealed value of another hotel does not open, and is never replaced by the plain column", () => {
    const sealed = numberSealer(OTHER, seal).columns("stays", "P1234567");
    assert.throws(() => numberSealer(HOTEL, seal).plainOf("stays", { id_proof_number: "P1234567", id_proof_number_sealed: sealed.id_proof_number_sealed }));
  });
  test("without a key only the plain column is written and read, as before", () => {
    const s = numberSealer(HOTEL, null);
    assert.equal(s.on, false);
    assert.deepEqual(s.columns("customers", "A1"), { id_proof_number: "A1" });
    assert.equal(s.plainOf("customers", { id_proof_number: "A1", id_proof_number_sealed: "v1.x" }), "A1");
  });
  test("the other guests' numbers inside a stay's JSON: sealed on write, opened on read, names and the rest kept, a second write does not seal twice", () => {
    const codec = numberSealer(HOTEL, seal).membersCodec();
    const details = { dateOfBirth: "1990-01-01", members: [{ fullName: "Mira", idType: "Aadhaar", idNumber: "9999 8888 7777" }, { fullName: "Kid" }], idPhotos: ["a.jpg"] };
    const stored = codec.in(details)!;
    const parsed = JSON.parse(stored);
    assert.ok(isSealed(parsed.members[0].idNumber));
    assert.ok(!stored.includes("9999"), "no plain digits in the stored JSON");
    assert.deepEqual([parsed.dateOfBirth, parsed.members[0].fullName, parsed.members[1], parsed.idPhotos], ["1990-01-01", "Mira", { fullName: "Kid" }, ["a.jpg"]]);
    assert.deepEqual(codec.out(parsed), details, "read back whole");
    assert.equal(JSON.parse(codec.in(parsed)!).members[0].idNumber, parsed.members[0].idNumber, "a sealed number is kept as it is, never sealed again");
    assert.equal(seal.open(HOTEL, MEMBER_FIELD, parsed.members[0].idNumber), "9999 8888 7777");
    assert.throws(() => seal.open(HOTEL, "stay.id_proof_number", parsed.members[0].idNumber), "bound to its own field");
    assert.equal(codec.in(null), null);
    assert.equal(codec.out(null), null);
    assert.deepEqual(codec.out({ dateOfBirth: "x" }), { dateOfBirth: "x" }, "details without members pass through");
  });
  test("the members' codec without a key writes plain as before, reads plain, and refuses a sealed number it cannot open", () => {
    const codec = numberSealer(HOTEL, null).membersCodec();
    const stored = codec.in({ members: [{ fullName: "Mira", idNumber: "9999 8888 7777" }] })!;
    assert.ok(stored.includes("9999 8888 7777"));
    assert.deepEqual(codec.out(JSON.parse(stored)), { members: [{ fullName: "Mira", idNumber: "9999 8888 7777" }] });
    const sealedJson = numberSealer(HOTEL, seal).membersCodec().in({ members: [{ fullName: "Mira", idNumber: "9999 8888 7777" }] })!;
    assert.throws(() => codec.out(JSON.parse(sealedJson)));
  });
  test("sealedWrite swaps the plain column's entry and leaves every other column in place", () => {
    const s = numberSealer(HOTEL, seal);
    const w = sealedWrite(s, "customers", { columns: ["name", "id_proof_number", "city"], params: ["Asha", "X1234567", "Pune"] }, "X1234567");
    assert.deepEqual(w.columns.slice(0, 2), ["name", "city"]);
    assert.deepEqual(w.columns.slice(2).sort(), ["id_proof_number", "id_proof_number_idx", "id_proof_number_sealed"]);
    assert.equal(w.columns.length, w.params.length);
    const untouched = { columns: ["name"], params: ["Asha"] };
    assert.equal(sealedWrite(s, "customers", untouched, undefined), untouched, "a patch without the number does not touch it");
  });
});

// ---- a small fake of the owner connection: one customers table and one pms_stays table per schema, answering exactly the statements the backfill sends ----
type FakeRow = { id: string; id_proof_number: string | null; id_proof_number_sealed: string | null; id_proof_number_idx: string | null; version: number; guest_details?: { members: { fullName: string; idNumber?: string }[] } | null };
function fake(schemas: Record<string, { customers: FakeRow[]; pms_stays: FakeRow[] }>, options: { noColumn?: boolean; corruptOnUpdate?: boolean } = {}) {
  const log: string[] = [];
  let snapshot = "";
  const rowsOf = (text: string): FakeRow[] => {
    const m = /"(\w+)"\."(customers|pms_stays)"/.exec(text);
    return schemas[m![1]][m![2] as "customers"];
  };
  const sealedLooking = (v: unknown): boolean => typeof v === "string" && isSealed(v);
  const membersPending = (r: FakeRow): boolean => (r.guest_details?.members ?? []).some((m) => typeof m.idNumber === "string" && m.idNumber.trim() !== "" && !isSealed(m.idNumber));
  const pending = (r: FakeRow): boolean => r.id_proof_number !== null && r.id_proof_number.trim() !== "" && r.id_proof_number_sealed === null;
  return {
    log,
    async query(text: string, params: readonly unknown[] = []) {
      log.push(text.split(" ")[0]);
      if (text === "BEGIN") { snapshot = JSON.stringify(schemas); return { rows: [], affectedRows: 0 }; }
      if (text === "ROLLBACK") { for (const k of Object.keys(schemas)) delete schemas[k]; Object.assign(schemas, JSON.parse(snapshot)); return { rows: [], affectedRows: 0 }; }
      if (text === "COMMIT") return { rows: [], affectedRows: 0 };
      if (text.includes("information_schema.columns")) return { rows: options.noColumn ? [] : [{ column_name: "id_proof_number_sealed" }], affectedRows: 0 };
      if (text.startsWith("SELECT COUNT(*)") && text.includes("jsonb_typeof")) return { rows: [{ n: String(rowsOf(text).filter(membersPending).length) }], affectedRows: 0 };
      if (text.startsWith("SELECT COUNT(*)")) return { rows: [{ n: String(rowsOf(text).filter(pending).length) }], affectedRows: 0 };
      if (text.startsWith("SELECT id, guest_details") && text.includes("FOR UPDATE")) return { rows: rowsOf(text).filter(membersPending).sort((a, b) => a.id.localeCompare(b.id)).slice(0, Number(params[0])).map((r) => ({ id: r.id, guest_details: JSON.parse(JSON.stringify(r.guest_details)) })), affectedRows: 0 };
      if (text.startsWith("SELECT id, guest_details")) return { rows: rowsOf(text).filter((r) => (r.guest_details?.members ?? []).some((m) => sealedLooking(m.idNumber)) && r.id > String(params[0])).sort((a, b) => a.id.localeCompare(b.id)).slice(0, Number(params[1])).map((r) => ({ id: r.id, guest_details: JSON.parse(JSON.stringify(r.guest_details)) })), affectedRows: 0 };
      if (text.startsWith("UPDATE") && text.includes("SET guest_details")) {
        const r = rowsOf(text).find((x) => x.id === params[0]);
        if (!r) return { rows: [], affectedRows: 0 };
        r.guest_details = JSON.parse(String(params[1]));
        r.version += 1;
        return { rows: [], affectedRows: 1 };
      }
      if (text.includes("id_proof_number_sealed IS NOT NULL AND id >")) {
        const rows = rowsOf(text).filter((r) => r.id_proof_number_sealed !== null && r.id > String(params[0])).sort((a, b) => a.id.localeCompare(b.id)).slice(0, Number(params[1]));
        return { rows: rows.map((r) => ({ ...r })), affectedRows: 0 };
      }
      if (text.startsWith("SELECT id, id_proof_number FROM")) return { rows: rowsOf(text).filter(pending).sort((a, b) => a.id.localeCompare(b.id)).slice(0, Number(params[0])).map((r) => ({ id: r.id, id_proof_number: r.id_proof_number })), affectedRows: 0 };
      if (text.startsWith("UPDATE")) {
        const r = rowsOf(text).find((x) => x.id === params[0] && x.id_proof_number_sealed === null);
        if (!r) return { rows: [], affectedRows: 0 };
        r.id_proof_number_sealed = options.corruptOnUpdate ? "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA" : String(params[1]);
        r.id_proof_number_idx = String(params[2]);
        if (text.includes("version = version + 1")) r.version += 1;
        return { rows: [], affectedRows: 1 };
      }
      throw new Error(`unexpected statement: ${text}`);
    },
  };
}
const row = (n: number, plain: string | null): FakeRow => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, id_proof_number: plain, id_proof_number_sealed: null, id_proof_number_idx: null, version: 1 });
const SCHEMA = "hotel_alpha";
const make = () => ({ [SCHEMA]: { customers: [row(1, "1234 5678 9012"), row(2, null), row(3, "  "), row(4, "ABCDE1234F")], pms_stays: [{ ...row(5, "P1234567"), guest_details: { members: [{ fullName: "Mira", idNumber: "9999 8888 7777" }, { fullName: "Kid" }] } }, row(6, "")] } });

describe("seal-numbers (the backfill)", () => {
  const hotels = [{ id: HOTEL, schema: SCHEMA }];
  test("a dry run counts and writes nothing, and needs no key", async () => {
    const data = make();
    const out = await sealNumbers(fake(data), hotels, null, { dryRun: true });
    assert.deepEqual(out.map((s) => [s.table, s.pending, s.sealed]), [["customers.id_proof_number", 2, 0], ["pms_stays.id_proof_number", 1, 0], ["pms_stays.members", 1, 0]]);
    assert.ok(data[SCHEMA].customers.every((r) => r.id_proof_number_sealed === null));
  });
  test("it seals only rows that have a number, opens each back, and a rerun does nothing more", async () => {
    const data = make();
    const out = await sealNumbers(fake(data), hotels, seal, { batch: 1 });
    assert.deepEqual(out.map((s) => s.sealed), [2, 1, 1]);
    const c = data[SCHEMA].customers;
    assert.equal(seal.open(HOTEL, "customer.id_proof_number", c[0].id_proof_number_sealed), "1234 5678 9012");
    assert.equal(c[1].id_proof_number_sealed, null);
    assert.equal(c[2].id_proof_number_sealed, null);
    assert.equal(seal.open(HOTEL, "stay.id_proof_number", data[SCHEMA].pms_stays[0].id_proof_number_sealed), "P1234567");
    const members = data[SCHEMA].pms_stays[0].guest_details!.members;
    assert.equal(seal.open(HOTEL, MEMBER_FIELD, members[0].idNumber!), "9999 8888 7777", "another guest's number is sealed in place");
    assert.ok(!JSON.stringify(data[SCHEMA].pms_stays[0].guest_details).includes("9999"), "no plain digits are left in the JSON");
    assert.deepEqual([members[0].fullName, members[1]], ["Mira", { fullName: "Kid" }], "names and members without a number are kept");
    assert.equal(data[SCHEMA].pms_stays[0].version, 3, "a stay's version is raised for each change (its trigger demands it)");
    assert.equal(c[0].version, 1, "customers have no version");
    assert.equal(c[0].id_proof_number, "1234 5678 9012", "the plain column is untouched");
    const again = await sealNumbers(fake(data), hotels, seal);
    assert.deepEqual(again.map((s) => [s.pending, s.sealed]), [[0, 0], [0, 0], [0, 0]]);
  });
  test("verify opens every sealed number and compares it with the plain column", async () => {
    const data = make();
    await sealNumbers(fake(data), hotels, seal);
    const ok = await sealNumbers(fake(data), hotels, seal, { verify: true });
    assert.deepEqual(ok.map((s) => [s.checked, s.mismatched, s.pending]), [[2, 0, 0], [1, 0, 0], [1, 0, 0]]);
    data[SCHEMA].customers[0].id_proof_number = "CHANGED-AFTER";
    const bad = await sealNumbers(fake(data), hotels, seal, { verify: true });
    assert.equal(bad[0].mismatched, 1);
    data[SCHEMA].customers[3].id_proof_number_sealed = "garbage";
    assert.equal((await sealNumbers(fake(data), hotels, seal, { verify: true }))[0].mismatched, 2, "a value that cannot be opened counts as wrong");
  });
  test("a number that does not open back rolls that hotel back", async () => {
    const data = make();
    await assert.rejects(sealNumbers(fake(data, { corruptOnUpdate: true }), hotels, seal), /rolled back|could not be opened/);
    assert.ok(data[SCHEMA].customers.every((r) => r.id_proof_number_sealed === null), "nothing of the hotel was kept");
  });
  test("a hotel without the sealed columns (hotel migrations 0063, 0064) stops the run with a plain instruction; a live run without a key is refused", async () => {
    await assert.rejects(sealNumbers(fake(make(), { noColumn: true }), hotels, seal), /migrate first/);
    await assert.rejects(sealNumbers(fake(make()), hotels, null), /HMS_DATA_KEY/);
    await assert.rejects(sealNumbers(fake(make()), [{ id: HOTEL, schema: 'x"; DROP' }], seal, { dryRun: true }), /not a hotel schema/);
  });
  test("no message holds a number, a sealed value or a key", async () => {
    const said: string[] = [];
    await sealNumbers(fake(make()), hotels, seal, { say: (m) => said.push(m) });
    const all = said.join("\n");
    for (const secret of ["1234", "ABCDE", "P1234567", "v1.", key.toString("base64")]) assert.ok(!all.includes(secret), secret);
  });
});

describe("the list of sealed columns", () => {
  test("every sealed column and index of the list is in the SQL lint's allowlist, and nothing else is", () => {
    assert.deepEqual([...SEALED_NUMBER_COLUMNS].sort(), sealedColumnNames().sort());
  });
  test("each entry names its own field, once", () => {
    const fields = SEALED_COLUMNS.map((c) => c.field);
    assert.equal(new Set(fields).size, fields.length);
    assert.equal(new Set(SEALED_COLUMNS.map((c) => `${c.table}.${c.column}`)).size, SEALED_COLUMNS.length);
  });
});

describe("columnSealer (staff and payroll numbers)", () => {
  const cs = columnSealer(HOTEL, seal);
  test("a write keeps the plain value and adds the sealed twin (and the index for an ID number); a column the write does not carry is left alone", () => {
    const w = cs.write("employees", { columns: ["name", "account_number", "ifsc_code", "id_proof_number"], params: ["Asha", "1234567890", "SBIN0000001", "AB123456"] });
    assert.deepEqual(w.columns, ["name", "account_number", "ifsc_code", "id_proof_number", "id_proof_number_sealed", "id_proof_number_idx", "account_number_sealed", "ifsc_code_sealed"]);
    assert.deepEqual(w.params.slice(0, 4), ["Asha", "1234567890", "SBIN0000001", "AB123456"]);
    assert.ok(isSealed(String(w.params[4])) && isSealed(String(w.params[6])) && isSealed(String(w.params[7])));
    assert.match(String(w.params[5]), /^[0-9a-f]{64}$/);
    const only = cs.write("employees", { columns: ["name"], params: ["Asha"] });
    assert.deepEqual(only, { columns: ["name"], params: ["Asha"] });
    const other = cs.write("deductions", { columns: ["account_number"], params: ["1"] });
    assert.deepEqual(other, { columns: ["account_number"], params: ["1"] }, "a table with no sealed column is untouched");
  });
  test("null clears the twin; a blank is the same as null", () => {
    const w = cs.write("payroll_companies", { columns: ["pan_number", "account_number"], params: [null, "  "] });
    assert.deepEqual(w.params.slice(2), [null, null]);
  });
  test("a read puts the opened value in place of the plain column; a row not sealed yet is read as it is; the row itself is not changed", () => {
    const w = cs.write("employees", { columns: ["account_number"], params: ["1234567890"] });
    const row = { id: "x", account_number: "OLD", account_number_sealed: w.params[1], ifsc_code: "SBIN0000001", ifsc_code_sealed: null };
    const read = cs.row("employees", row);
    assert.deepEqual([read.account_number, read.ifsc_code], ["1234567890", "SBIN0000001"]);
    assert.equal(row.account_number, "OLD", "the input row is a copy source only");
    const plain = { id: "y", account_number: "A1", account_number_sealed: null };
    assert.equal(cs.row("employees", plain), plain, "nothing to open: the same row comes back");
  });
  test("a value of another hotel or another column does not open", () => {
    const w = cs.write("employees", { columns: ["account_number"], params: ["1234567890"] });
    assert.throws(() => columnSealer(OTHER, seal).row("employees", { account_number: null, account_number_sealed: w.params[1] }));
    assert.throws(() => cs.row("employees", { ifsc_code: null, ifsc_code_sealed: w.params[1] }));
  });
  test("without a key nothing is added and nothing is opened", () => {
    const off = columnSealer(HOTEL, null);
    const w = { columns: ["account_number"], params: ["1"] };
    assert.equal(off.write("employees", w), w);
    const row = { account_number: "A1", account_number_sealed: "v1.x" };
    assert.equal(off.row("employees", row), row);
  });
});
