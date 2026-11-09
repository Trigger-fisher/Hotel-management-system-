// Decision 74, RELEASE A, on the REAL PostgreSQL instance: a customer's and a stay's ID number are written plain + sealed + indexed through the repositories, read back
// as the plain number, kept when another field changes, replaced/cleared with the number; and `seal-numbers` seals the rows saved before the key existed, verifies them
// and can be run twice. Needs hotel migrations 0063 and 0064 (the test database is migrated by `db:cli migrate --test`).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { listHotels, sealNumbers } from "../../../common/db/scripts/seal-numbers";
import { createDatabase, type Database } from "../../src/db";
import { resetConfigCache } from "../../src/server/config/env";
import { resetKeyCache } from "../../src/server/crypto";
import { createFieldSeal, isSealed } from "../../src/server/crypto/fieldSeal";
import { MEMBER_FIELD } from "../../src/server/repos/postgres/sealedNumbers";
import { newId } from "../../src/server/db/ids";
import type { CompaniesRepos, CustomerFields } from "../../src/server/repos/companies";
import type { FrontOfficeRepos, RoomFields, StayFields } from "../../src/server/repos/frontOffice";
import { createPgCompaniesUnit } from "../../src/server/repos/postgres/companies";
import { createPgFrontOfficeUnit } from "../../src/server/repos/postgres/frontOffice";
import { createPgPayrollCoreUnit } from "../../src/server/repos/postgres/payrollCore";
import { createPgPayrollPayUnit } from "../../src/server/repos/postgres/payrollPay";
import type { EmployeeFields, PayrollCoreRepos } from "../../src/server/repos/payrollCore";
import type { PayrollPayRepos, SalaryProcessingFields } from "../../src/server/repos/payrollPay";
import type { Unit } from "../../src/server/repos/types";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

const KEY = randomBytes(32);
const KEY_TEXT = KEY.toString("base64");
const AADHAAR = "1234 5678 9012";
let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let customers: Unit<CompaniesRepos>;
let frontOffice: Unit<FrontOfficeRepos>;
let roomTypeId: string;
let payCore: Unit<PayrollCoreRepos>;
let payPay: Unit<PayrollPayRepos>;
let HP: string;
let before_: string | undefined;
const USER = newId();
const ACTOR = newId();
const onCustomers = <T>(work: (r: CompaniesRepos) => Promise<T>): Promise<T> => customers.run({ hotelId: hotel.id, userId: USER }, work);
const onStays = <T>(work: (r: FrontOfficeRepos) => Promise<T>): Promise<T> => frontOffice.run({ hotelId: hotel.id, userId: USER }, work);

/** The key is read from the environment when a repository is bound (per request); the tests switch it on and off. */
function keyOn(on: boolean): void {
  if (on) process.env.HMS_DATA_KEY = KEY_TEXT;
  else delete process.env.HMS_DATA_KEY;
  resetConfigCache();
  resetKeyCache();
}
const raw = async (table: "customers" | "pms_stays", id: string) =>
  (await owner.query(`SELECT id_proof_number AS plain, id_proof_number_sealed AS sealed, id_proof_number_idx AS idx FROM "${hotel.schema}"."${table}" WHERE id = $1`, [id])).rows[0];

const customer = (over: Partial<CustomerFields> = {}): CustomerFields & { createdBy: string } => ({
  name: "Asha Rao", mobile: String(9_000_000_000 + Math.floor(Math.random() * 999_999_999)), email: null, address: null, city: null, idProofType: "Aadhaar", idProofNumber: null, notes: null, isActive: true, source: "admin", createdBy: ACTOR, ...over,
});
const room = (): RoomFields & { createdBy: string } => ({ number: `R${Math.random().toString(36).slice(2, 6)}`, floor: "1", roomTypeId, hkStatus: "clean", outOfOrder: false, outOfOrderReason: null, notes: null, sortOrder: 1, createdBy: ACTOR });
const stay = (roomId: string, over: Partial<StayFields> = {}): StayFields & { createdBy: string } => ({
  reservationId: null, roomId, grNumber: null, guestName: "Walk In", mobile: null, email: null, address: null, city: null, nationality: "Indian", idProofType: "Aadhaar", idProofNumber: AADHAAR, companyId: null, guestGstin: null,
  adults: 1, children: 0, plan: "EP", ratePaise: BigInt(300_000), checkInAt: new Date("2026-03-10T08:00:00Z"), expectedCheckOut: "2026-03-12", checkOutAt: null, status: "in_house", billId: null, hotelGstPercent: null,
  foodGstPercent: null, notes: null, guestDetails: null, idProofPath: null, createdBy: ACTOR, ...over,
});

before(async () => {
  before_ = process.env.HMS_DATA_KEY;
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Sealed Numbers Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 8 });
  customers = createPgCompaniesUnit(database.withHotel);
  frontOffice = createPgFrontOfficeUnit(database.withHotel);
  payCore = createPgPayrollCoreUnit(database.withHotel);
  payPay = createPgPayrollPayUnit(database.withHotel);
  HP = String((await owner.query(`SELECT id FROM "${hotel.schema}".payroll_companies WHERE code = 'HP01'`)).rows[0].id);
  roomTypeId = String((await owner.query(`INSERT INTO "${hotel.schema}".site_rooms (slug, name, total_count, sort_order) VALUES ('deluxe', 'Deluxe', 5, 1) RETURNING id`)).rows[0].id);
});

after(async () => {
  if (before_ === undefined) delete process.env.HMS_DATA_KEY;
  else process.env.HMS_DATA_KEY = before_;
  resetConfigCache();
  resetKeyCache();
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

describe("a customer's ID number (key on)", () => {
  test("is stored plain, sealed and indexed, and read back as the number that was typed", async () => {
    keyOn(true);
    const made = await onCustomers((r) => r.customers.create(customer({ idProofNumber: ` ${AADHAAR} ` })));
    assert.equal(made.idProofNumber, AADHAAR);
    const row = await raw("customers", made.id);
    assert.equal(row.plain, AADHAAR);
    assert.ok(isSealed(String(row.sealed)), "sealed column filled");
    assert.ok(!String(row.sealed).includes("1234"), "no digits in the sealed text");
    assert.match(String(row.idx).trim(), /^[0-9a-f]{64}$/);
    assert.equal((await onCustomers((r) => r.customers.get(made.id)))?.idProofNumber, AADHAAR);
    assert.equal((await onCustomers((r) => r.customers.list({ page: 1, pageSize: 50, words: [made.name.split(" ")[0].toLowerCase()] } as never))).rows.find((c) => c.id === made.id)?.idProofNumber, AADHAAR);
  });

  test("another field changing leaves the sealed number alone; a new number replaces all three; clearing clears all three", async () => {
    keyOn(true);
    const made = await onCustomers((r) => r.customers.create(customer({ idProofNumber: "ABCDE1234F" })));
    const first = await raw("customers", made.id);
    await onCustomers((r) => r.customers.update(made.id, { city: "Surat" }, ACTOR));
    const same = await raw("customers", made.id);
    assert.deepEqual([same.sealed, same.idx, same.plain], [first.sealed, first.idx, first.plain]);
    await onCustomers((r) => r.customers.update(made.id, { idProofNumber: "P1234567" }, ACTOR));
    const changed = await raw("customers", made.id);
    assert.equal(changed.plain, "P1234567");
    assert.notEqual(changed.sealed, first.sealed);
    assert.notEqual(changed.idx, first.idx);
    assert.equal((await onCustomers((r) => r.customers.get(made.id)))?.idProofNumber, "P1234567");
    await onCustomers((r) => r.customers.update(made.id, { idProofNumber: null }, ACTOR));
    const cleared = await raw("customers", made.id);
    assert.deepEqual([cleared.plain, cleared.sealed, cleared.idx], [null, null, null]);
    assert.equal((await onCustomers((r) => r.customers.get(made.id)))?.idProofNumber, null);
  });

  test("the same number gives the same index; a different number a different one", async () => {
    keyOn(true);
    const a = await onCustomers((r) => r.customers.create(customer({ idProofNumber: "1234 5678 9012" })));
    const b = await onCustomers((r) => r.customers.create(customer({ idProofNumber: "123456789012" })));
    const c = await onCustomers((r) => r.customers.create(customer({ idProofNumber: "123456789013" })));
    assert.equal((await raw("customers", a.id)).idx, (await raw("customers", b.id)).idx);
    assert.notEqual((await raw("customers", a.id)).idx, (await raw("customers", c.id)).idx);
  });
});

describe("a stay's ID number (key on)", () => {
  test("is stored plain, sealed and indexed; the version moves with the update; other fields keep the number", async () => {
    keyOn(true);
    const room1 = await onStays((r) => r.rooms.create(room()));
    const made = await onStays((r) => r.stays.create(stay(room1.id)));
    assert.equal(made.idProofNumber, AADHAAR);
    const row = await raw("pms_stays", made.id);
    assert.equal(row.plain, AADHAAR);
    assert.ok(isSealed(String(row.sealed)));
    const upd = await onStays((r) => r.stays.update(made.id, made.version, { guestName: "New Name" }, ACTOR));
    assert.ok(upd.ok);
    assert.deepEqual((({ sealed, idx }) => ({ sealed, idx }))(await raw("pms_stays", made.id)), { sealed: row.sealed, idx: row.idx });
    const upd2 = await onStays((r) => r.stays.update(made.id, made.version + 1, { idProofNumber: "P7654321" }, ACTOR));
    assert.ok(upd2.ok && upd2.record.idProofNumber === "P7654321");
    assert.equal((await raw("pms_stays", made.id)).plain, "P7654321");
    assert.equal((await onStays((r) => r.stays.get(made.id)))?.idProofNumber, "P7654321");
  });

  test("a customer's sealed number does not open as a stay's (different field), and not in another hotel", async () => {
    keyOn(true);
    const made = await onCustomers((r) => r.customers.create(customer({ idProofNumber: "X1234567" })));
    const sealed = String((await raw("customers", made.id)).sealed);
    const seal = createFieldSeal(KEY);
    assert.equal(seal.open(hotel.id, "customer.id_proof_number", sealed), "X1234567");
    assert.throws(() => seal.open(hotel.id, "stay.id_proof_number", sealed));
    assert.throws(() => seal.open(newId(), "customer.id_proof_number", sealed));
  });
});

describe("staff and payroll numbers (employees, payroll companies, salary rows)", () => {
  const onCore = <T>(work: (r: PayrollCoreRepos) => Promise<T>): Promise<T> => payCore.run({ hotelId: hotel.id, userId: USER }, work);
  const onPay = <T>(work: (r: PayrollPayRepos) => Promise<T>): Promise<T> => payPay.run({ hotelId: hotel.id, userId: USER }, work);
  let seq = 0;
  const emp = (over: Partial<EmployeeFields> = {}): EmployeeFields => ({
    employeeCode: `S${String(++seq).padStart(3, "0")}`, name: `Person ${seq}`, designation: "Cook", department: "Kitchen", shift: null, responsibilities: null, joiningDate: "2025-04-01", salaryPaise: BigInt(1_800_000),
    dailyWorkingHours: "8.00", contactCountry: "91", contactNumber: "9876543210", address: null, emergencyContactName: null, emergencyContactRelation: null, emergencyContactCountry: "91",
    emergencyContactNumber: null, paymentMode: "Bank", bankName: "SBI", accountHolderName: "Asha Rao", accountNumber: "1234567890", ifscCode: "SBIN0000001", branchName: "Surat", idProofType: "Aadhaar",
    idProofNumber: AADHAAR, email: `sealed${seq}@example.test`, dateOfBirth: null, gender: null, nationality: null, countryAndPincode: null, qualification: null, qualificationInstitution: null, skills: null,
    photoPath: null, idProofImagePath: null, idProofBackImagePath: null, resumePath: null, ...over,
  });
  const rawEmp = async (id: string) =>
    (await owner.query(`SELECT id_proof_number AS idn, id_proof_number_sealed AS idn_s, id_proof_number_idx AS idn_i, account_number AS acc, account_number_sealed AS acc_s, ifsc_code AS ifsc, ifsc_code_sealed AS ifsc_s FROM "${hotel.schema}".employees WHERE id = $1`, [id])).rows[0];

  test("an employee's ID, account number and IFSC are stored sealed beside the plain ones and read back as typed; another field leaves them alone; clearing clears both", async () => {
    keyOn(true);
    const made = await onCore((r) => r.employees.create(HP, emp(), ACTOR));
    assert.deepEqual([made.idProofNumber, made.accountNumber, made.ifscCode], [AADHAAR, "1234567890", "SBIN0000001"]);
    const row = await rawEmp(made.id);
    assert.deepEqual([row.idn, row.acc, row.ifsc], [AADHAAR, "1234567890", "SBIN0000001"]);
    for (const k of ["idn_s", "acc_s", "ifsc_s"]) assert.ok(isSealed(String(row[k])), k);
    assert.ok(!String(row.acc_s).includes("1234567890") && !String(row.idn_s).includes("1234"));
    assert.match(String(row.idn_i).trim(), /^[0-9a-f]{64}$/);
    const seal = createFieldSeal(KEY);
    assert.equal(seal.open(hotel.id, "employees.account_number", String(row.acc_s)), "1234567890");
    assert.throws(() => seal.open(hotel.id, "payroll_companies.account_number", String(row.acc_s)), "bound to its own table and column");
    assert.deepEqual((({ idProofNumber, accountNumber, ifscCode }) => [idProofNumber, accountNumber, ifscCode])((await onCore((r) => r.employees.get(HP, made.id)))!), [AADHAAR, "1234567890", "SBIN0000001"]);
    await onCore((r) => r.employees.update(HP, made.id, { designation: "Chef" }, ACTOR));
    const same = await rawEmp(made.id);
    assert.deepEqual([same.acc_s, same.idn_s, same.idn_i], [row.acc_s, row.idn_s, row.idn_i]);
    await onCore((r) => r.employees.update(HP, made.id, { accountNumber: "5550001111" }, ACTOR));
    const changed = await rawEmp(made.id);
    assert.equal(seal.open(hotel.id, "employees.account_number", String(changed.acc_s)), "5550001111");
    assert.equal(changed.acc, "5550001111");
    await onCore((r) => r.employees.update(HP, made.id, { accountNumber: null, ifscCode: null }, ACTOR));
    const cleared = await rawEmp(made.id);
    assert.deepEqual([cleared.acc, cleared.acc_s, cleared.ifsc, cleared.ifsc_s], [null, null, null, null]);
  });

  test("the company's PAN, account and IFSC are sealed the same way", async () => {
    keyOn(true);
    await onCore((r) => r.payrollCompanies.update(HP, { panNumber: "ABCDE1234F", accountNumber: "9988776655", ifscCode: "HDFC0001234" }, ACTOR));
    const row = (await owner.query(`SELECT pan_number AS pan, pan_number_sealed AS pan_s, account_number AS acc, account_number_sealed AS acc_s, ifsc_code_sealed AS ifsc_s FROM "${hotel.schema}".payroll_companies WHERE id = $1`, [HP])).rows[0];
    assert.deepEqual([row.pan, row.acc], ["ABCDE1234F", "9988776655"]);
    for (const k of ["pan_s", "acc_s", "ifsc_s"]) assert.ok(isSealed(String(row[k])), k);
    const read = (await onCore((r) => r.payrollCompanies.get(HP)))!;
    assert.deepEqual([read.panNumber, read.accountNumber, read.ifscCode], ["ABCDE1234F", "9988776655", "HDFC0001234"]);
  });

  test("a salary row's account number and IFSC are sealed when the month is generated and read back opened", async () => {
    keyOn(true);
    const person = await onCore((r) => r.employees.create(HP, emp({ employeeCode: "SAL01" }), ACTOR));
    const fields: SalaryProcessingFields = {
      payrollCompanyId: HP, employeeId: person.id, year: 2026, month: 3, companyName: "Hotel", employeeCode: "SAL01", employeeName: person.name, designation: "Cook", department: "Kitchen", paymentMode: "Bank",
      monthlySalaryPaise: BigInt(1_800_000), dailyWorkingHours: "8.00", totalDaysInMonth: 31, dailySalaryPaise: BigInt(58_064), days0: "0.00", days25: "0.00", days50: "0.00", days75: "0.00", days100: "31.00",
      totalPayableDays: "31.00", attendanceSalaryPaise: BigInt(1_800_000), overtimeHours: "0.00", hourlyRatePaise: BigInt(0), overtimeAmountPaise: BigInt(0), bonusAmountPaise: BigInt(0),
      incentiveAmountPaise: BigInt(0), deductionAmountPaise: BigInt(0), advanceDeductionPaise: BigInt(0), pendingAdvanceAmountPaise: BigInt(0), netSalaryPaise: BigInt(1_800_000), paymentStatus: "Pending",
      generationCount: 1, processedBy: ACTOR, processedAt: new Date("2026-04-01T05:00:00Z"), paidAmountPaise: BigInt(0), paidAt: null, paymentReference: null, paymentRemarks: null, paymentUpdatedBy: null,
      paymentUpdatedAt: null, bankName: "SBI", accountHolderName: "Asha Rao", accountNumber: "1234567890", ifscCode: "SBIN0000001", branchName: "Surat",
    };
    const [made] = await onPay((r) => r.salaryProcessings.createMany([{ fields, lines: [] }]));
    assert.deepEqual([made.accountNumber, made.ifscCode], ["1234567890", "SBIN0000001"]);
    const row = (await owner.query(`SELECT account_number AS acc, account_number_sealed AS acc_s, ifsc_code_sealed AS ifsc_s FROM "${hotel.schema}".salary_processings WHERE id = $1`, [made.id])).rows[0];
    assert.equal(row.acc, "1234567890");
    assert.ok(isSealed(String(row.acc_s)) && isSealed(String(row.ifsc_s)));
    assert.deepEqual((await onPay((r) => r.salaryProcessings.get(HP, made.id)))?.accountNumber, "1234567890");
  });

  test("saved with no key: plain only; `seal-numbers` seals every column in place, `--verify` finds 0 wrong and 0 plain-only, a rerun does nothing", async () => {
    keyOn(false);
    const old = await onCore((r) => r.employees.create(HP, emp({ employeeCode: "OLD01", accountNumber: "7776665554", ifscCode: "ICIC0000099", idProofNumber: "OLD-STAFF-ID" }), ACTOR));
    const before = await rawEmp(old.id);
    assert.deepEqual([before.acc_s, before.ifsc_s, before.idn_s, before.idn_i], [null, null, null, null]);
    const seal = createFieldSeal(KEY);
    const hotels = (await listHotels(owner)).filter((h) => h.schema === hotel.schema);
    const dry = await sealNumbers(owner, hotels, null, { dryRun: true });
    assert.ok(dry.find((x) => x.table === "employees.account_number")!.pending >= 1);
    const done = await sealNumbers(owner, hotels, seal);
    assert.ok(done.find((x) => x.table === "employees.account_number")!.sealed >= 1);
    const after = await rawEmp(old.id);
    assert.deepEqual([after.acc, after.idn], ["7776665554", "OLD-STAFF-ID"], "the plain columns are untouched");
    assert.equal(seal.open(hotel.id, "employees.account_number", String(after.acc_s)), "7776665554");
    assert.equal(seal.open(hotel.id, "employees.ifsc_code", String(after.ifsc_s)), "ICIC0000099");
    assert.equal(String(after.idn_i).trim(), seal.blindIndex(hotel.id, "employees.id_proof_number", "OLD-STAFF-ID"));
    const checked = await sealNumbers(owner, hotels, seal, { verify: true });
    assert.equal(checked.reduce((n, x) => n + x.mismatched, 0), 0);
    assert.equal(checked.reduce((n, x) => n + x.pending, 0), 0);
    assert.equal((await sealNumbers(owner, hotels, seal)).reduce((n, x) => n + x.sealed, 0), 0);
    keyOn(true);
    assert.equal((await onCore((r) => r.employees.get(HP, old.id)))?.accountNumber, "7776665554");
  });
});

describe("the duplicate warning on the real database", () => {
  test("found by the search index (sealed rows) and by the plain column (rows not sealed yet), only in-house, never itself", async () => {
    keyOn(true);
    const r1 = await onStays((r) => r.rooms.create(room()));
    const r2 = await onStays((r) => r.rooms.create(room()));
    const r3 = await onStays((r) => r.rooms.create(room()));
    const a = await onStays((r) => r.stays.create(stay(r1.id, { idProofNumber: "DUP 1111-2222" })));
    const b = await onStays((r) => r.stays.create(stay(r2.id, { idProofNumber: "dup11112222" })));
    assert.deepEqual((await onStays((r) => r.stays.sameIdInHouse("DUP 1111-2222", a.id))).map((x) => x.id), [b.id]);
    assert.deepEqual((await onStays((r) => r.stays.sameIdInHouse("dup11112222", b.id))).map((x) => x.id), [a.id]);
    // a row saved with no key has no index yet: the plain column answers
    keyOn(false);
    const c = await onStays((r) => r.stays.create(stay(r3.id, { idProofNumber: "DUP-1111 2222" })));
    keyOn(true);
    assert.deepEqual((await onStays((r) => r.stays.sameIdInHouse("DUP11112222", a.id))).map((x) => x.id).sort(), [b.id, c.id].sort());
    assert.deepEqual(await onStays((r) => r.stays.sameIdInHouse("NOBODY-HAS-THIS", a.id)), []);
    assert.deepEqual(await onStays((r) => r.stays.sameIdInHouse("   ", a.id)), []);
    // a guest who has left is not a duplicate
    await owner.query(`UPDATE "${hotel.schema}".pms_stays SET status = 'checked_out', check_out_at = check_in_at + interval '1 day', version = version + 1 WHERE id = $1`, [b.id]);
    assert.deepEqual((await onStays((r) => r.stays.sameIdInHouse("DUP 1111-2222", a.id))).map((x) => x.id), [c.id]);
  });
});

describe("the other guests of a stay (guest_details JSON)", () => {
  const withMembers = (roomId: string, idNumber: string): StayFields & { createdBy: string } =>
    stay(roomId, { idProofNumber: "", idProofType: "", guestDetails: { members: [{ fullName: "Mira Mehta", mobile: "9876500009", idType: "Aadhaar", idNumber }] } as never });
  const rawMember = async (id: string): Promise<string> => String((await owner.query(`SELECT guest_details->'members'->0->>'idNumber' AS n FROM "${hotel.schema}".pms_stays WHERE id = $1`, [id])).rows[0].n);

  test("saved with the key: sealed inside the JSON, no plain digits stored, read back as typed", async () => {
    keyOn(true);
    const room3 = await onStays((r) => r.rooms.create(room()));
    const made = await onStays((r) => r.stays.create(withMembers(room3.id, "9999 8888 7777")));
    assert.equal(made.guestDetails?.members?.[0].idNumber, "9999 8888 7777");
    const stored = await rawMember(made.id);
    assert.ok(isSealed(stored) && !stored.includes("9999"));
    assert.equal(createFieldSeal(KEY).open(hotel.id, MEMBER_FIELD, stored), "9999 8888 7777");
    assert.equal((await onStays((r) => r.stays.get(made.id)))?.guestDetails?.members?.[0].idNumber, "9999 8888 7777");
    // an update of another field keeps the members as they are, still sealed once
    const upd = await onStays((r) => r.stays.update(made.id, made.version, { notes: "late arrival" }, ACTOR));
    assert.ok(upd.ok);
    assert.equal(await rawMember(made.id), stored);
  });

  test("saved without the key: plain in the JSON; `seal-numbers` seals it in place, verifies it, and a rerun does nothing", async () => {
    keyOn(false);
    const room4 = await onStays((r) => r.rooms.create(room()));
    const made = await onStays((r) => r.stays.create(withMembers(room4.id, "5555 4444 3333")));
    assert.equal(await rawMember(made.id), "5555 4444 3333");
    const seal = createFieldSeal(KEY);
    const hotels = (await listHotels(owner)).filter((h) => h.schema === hotel.schema);
    const dry = await sealNumbers(owner, hotels, null, { dryRun: true });
    assert.ok(dry.find((x) => x.table === "pms_stays.members")!.pending >= 1);
    const done = await sealNumbers(owner, hotels, seal);
    assert.ok(done.find((x) => x.table === "pms_stays.members")!.sealed >= 1);
    const stored = await rawMember(made.id);
    assert.ok(isSealed(stored) && !stored.includes("5555"));
    assert.equal(seal.open(hotel.id, MEMBER_FIELD, stored), "5555 4444 3333");
    const checked = await sealNumbers(owner, hotels, seal, { verify: true });
    assert.equal(checked.reduce((n, x) => n + x.mismatched, 0), 0);
    assert.equal(checked.find((x) => x.table === "pms_stays.members")!.pending, 0);
    assert.equal((await sealNumbers(owner, hotels, seal)).reduce((n, x) => n + x.sealed, 0), 0);
    keyOn(true);
    assert.equal((await onStays((r) => r.stays.get(made.id)))?.guestDetails?.members?.[0].idNumber, "5555 4444 3333");
  });
});

describe("saved without the key, then sealed by `seal-numbers`", () => {
  test("a row saved with no key has only the plain number and still reads; the backfill seals it, verifies it, and a rerun does nothing", async () => {
    keyOn(false);
    const c = await onCustomers((r) => r.customers.create(customer({ idProofNumber: "OLD-PLAIN-1" })));
    const room2 = await onStays((r) => r.rooms.create(room()));
    const s = await onStays((r) => r.stays.create(stay(room2.id, { idProofNumber: "OLD-PLAIN-2" })));
    for (const [table, id] of [["customers", c.id], ["pms_stays", s.id]] as const) {
      const row = await raw(table, id);
      assert.deepEqual([row.sealed, row.idx], [null, null]);
    }
    assert.equal((await onCustomers((r) => r.customers.get(c.id)))?.idProofNumber, "OLD-PLAIN-1");

    const seal = createFieldSeal(KEY);
    const hotels = (await listHotels(owner)).filter((h) => h.schema === hotel.schema);
    assert.equal(hotels.length, 1);
    const dry = await sealNumbers(owner, hotels, null, { dryRun: true });
    assert.ok(dry.reduce((n, x) => n + x.pending, 0) >= 2, "the dry run counts the waiting rows and changes nothing");
    assert.equal((await raw("customers", c.id)).sealed, null);

    const done = await sealNumbers(owner, hotels, seal);
    assert.ok(done.reduce((n, x) => n + x.sealed, 0) >= 2);
    for (const [table, id, field, plain] of [["customers", c.id, "customer.id_proof_number", "OLD-PLAIN-1"], ["pms_stays", s.id, "stay.id_proof_number", "OLD-PLAIN-2"]] as const) {
      const row = await raw(table, id);
      assert.equal(row.plain, plain, "the plain column is untouched");
      assert.equal(seal.open(hotel.id, field, String(row.sealed)), plain);
      assert.equal(String(row.idx).trim(), seal.blindIndex(hotel.id, field, plain));
    }
    const checked = await sealNumbers(owner, hotels, seal, { verify: true });
    assert.equal(checked.reduce((n, x) => n + x.mismatched, 0), 0);
    assert.equal(checked.reduce((n, x) => n + x.pending, 0), 0);
    const again = await sealNumbers(owner, hotels, seal);
    assert.equal(again.reduce((n, x) => n + x.sealed, 0), 0, "a rerun seals nothing more");

    keyOn(true);
    assert.equal((await onCustomers((r) => r.customers.get(c.id)))?.idProofNumber, "OLD-PLAIN-1", "read through the sealed column");
    assert.equal((await onStays((r) => r.stays.get(s.id)))?.idProofNumber, "OLD-PLAIN-2");
  });

  test("--verify catches a sealed number that no longer matches its plain column", async () => {
    keyOn(true);
    const c = await onCustomers((r) => r.customers.create(customer({ idProofNumber: "VERIFY-ME-1" })));
    await owner.query(`UPDATE "${hotel.schema}".customers SET id_proof_number = 'TAMPERED-1' WHERE id = $1`, [c.id]);
    const hotels = (await listHotels(owner)).filter((h) => h.schema === hotel.schema);
    const checked = await sealNumbers(owner, hotels, createFieldSeal(KEY), { verify: true });
    assert.ok(checked.reduce((n, x) => n + x.mismatched, 0) >= 1, "the difference between the plain and the sealed number is reported");
  });
});
