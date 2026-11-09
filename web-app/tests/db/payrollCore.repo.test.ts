// The Payroll core repositories on the REAL PostgreSQL instance (repos/postgres/payrollCore.ts): the fixed companies, staff, deductions, attendance
// marks, months and grid, the shared lists, staff e-mails, the log and the setup checks. Every rule of the in-memory double is proven here against
// the database, including the company scoping (a row of another company reads as absent).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { EmployeeFields, PayrollCoreRepos } from "../../src/server/repos/payrollCore";
import { createPgPayrollCoreUnit } from "../../src/server/repos/postgres/payrollCore";
import { RepoError, type Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<PayrollCoreRepos>;
let HP: string;
let PF: string;
let OT: string;
const USER = newId();
const ACTOR = newId();
const run = <T>(work: (r: PayrollCoreRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: USER }, work);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Payroll Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 8 });
  unit = createPgPayrollCoreUnit(database.withHotel);
  const ids = await owner.query(`SELECT id, code FROM "${hotel.schema}".payroll_companies`);
  HP = String(ids.rows.find((r) => r.code === "HP01")?.id);
  PF = String(ids.rows.find((r) => r.code === "PF01")?.id);
  OT = String((await owner.query(`INSERT INTO "${hotel.schema}".payroll_companies (name, code) VALUES ('Other Co', 'OT01') RETURNING id`)).rows[0].id);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

let seq = 0;
const emp = (over: Partial<EmployeeFields> = {}): EmployeeFields => ({
  employeeCode: `E${String(++seq).padStart(3, "0")}`, name: `Person ${seq}`, designation: "Cook", department: "Kitchen", shift: null, responsibilities: null, joiningDate: "2025-04-01", salaryPaise: BigInt(1_800_000),
  dailyWorkingHours: "8.00", contactCountry: "91", contactNumber: "9876543210", address: null, emergencyContactName: null, emergencyContactRelation: null, emergencyContactCountry: "91",
  emergencyContactNumber: null, paymentMode: "Cash", bankName: null, accountHolderName: null, accountNumber: null, ifscCode: null, branchName: null, idProofType: null, idProofNumber: null,
  email: `person${seq}@example.test`, dateOfBirth: null, gender: null, nationality: null, countryAndPincode: null, qualification: null, qualificationInstitution: null, skills: null, photoPath: null,
  idProofImagePath: null, idProofBackImagePath: null, resumePath: null, ...over,
});

describe("payroll companies (fixed)", () => {
  test("listed in the fixed order with staff counts from one grouped count; details change, name and code never do", async () => {
    await run((r) => r.employees.create(HP, emp(), ACTOR));
    const inactive = await run((r) => r.employees.create(HP, emp(), ACTOR));
    await run((r) => r.employees.setActive(HP, inactive.id, false, ACTOR));
    await run((r) => r.employees.create(PF, emp(), ACTOR));
    const list = await run((r) => r.payrollCompanies.list({}));
    assert.deepEqual(list.map((c) => [c.code, c.staffCount, c.activeStaffCount]), [["HP01", 2, 1], ["PF01", 1, 1], ["OT01", 0, 0]]);
    assert.deepEqual(list[0].name, "Payroll Hotel");
    assert.deepEqual((await run((r) => r.payrollCompanies.list({ words: ["food"] }))).map((c) => c.code), ["PF01"]);
    assert.deepEqual((await run((r) => r.payrollCompanies.list({ active: false }))).length, 0);
    assert.deepEqual((await run((r) => r.payrollCompanies.row(HP)))?.staffCount, 2);
    assert.equal(await run((r) => r.payrollCompanies.row(newId())), null);
    const upd = await run((r) => r.payrollCompanies.update(HP, { ownerName: "Mr Owner", panNumber: "ABCDE1234F", accountNumber: "1234567890", ifscCode: "SBIN0000001", bankName: "SBI" }, ACTOR));
    assert.deepEqual([upd.ownerName, upd.panNumber, upd.accountNumber, upd.ifscCode, upd.updatedBy, upd.code, upd.name], ["Mr Owner", "ABCDE1234F", "1234567890", "SBIN0000001", ACTOR, "HP01", "Payroll Hotel"]);
    await assert.rejects(() => run((r) => r.payrollCompanies.update(newId(), { ownerName: "x" }, ACTOR)), (e) => e instanceof RepoError);
    assert.equal((await run((r) => r.payrollCompanies.get(HP, { forUpdate: true })))?.ownerName, "Mr Owner");
  });
});

describe("employees", () => {
  test("create reads every field back (account and ID numbers in plain text); the code is unique among live staff of a company without regard to case; the e-mail too", async () => {
    const a = await run((r) => r.employees.create(OT, emp({ employeeCode: "AB-1", name: "Asha Rao", accountNumber: "1234567890123", ifscCode: "HDFC0001234", idProofNumber: "ABCDE1234F", emergencyContactNumber: "9000000001", dailyWorkingHours: "7.50", email: "asha@example.test" }), ACTOR));
    assert.deepEqual([a.accountNumber, a.ifscCode, a.idProofNumber, a.emergencyContactNumber, a.dailyWorkingHours, a.salaryPaise, a.isActive, a.createdBy, a.updatedBy, a.deletedAt, a.payrollCompanyId], ["1234567890123", "HDFC0001234", "ABCDE1234F", "9000000001", "7.50", BigInt(1_800_000), true, ACTOR, ACTOR, null, OT]);
    await assert.rejects(() => run((r) => r.employees.create(OT, emp({ employeeCode: "ab-1" }), ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    await assert.rejects(() => run((r) => r.employees.create(OT, emp({ email: "asha@example.test" }), ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    const other = await run((r) => r.employees.create(PF, emp({ employeeCode: "AB-1", email: "asha@example.test" }), ACTOR));
    assert.equal(other.payrollCompanyId, PF, "another company may reuse the code and the e-mail");
    assert.equal(await run((r) => r.employees.codeTaken(OT, "AB-1")), true);
    assert.equal(await run((r) => r.employees.codeTaken(OT, "ab-1", a.id)), false);
    assert.equal(await run((r) => r.employees.emailTaken(OT, "ASHA@example.test")), true);
    assert.equal(await run((r) => r.employees.emailTaken(OT, "nobody@example.test")), false);
    assert.equal(await run((r) => r.employees.get(PF, a.id)), null, "a row of another company reads as absent");
    assert.deepEqual((await run((r) => r.employees.get(OT, a.id)))?.name, "Asha Rao");
  });

  describe("lists, lookup, scoping and the recycle bin", () => {
    const ids: Record<string, string> = {};
    before(async () => {
      await owner.query(`DELETE FROM "${hotel.schema}".employees WHERE payroll_company_id = $1`, [OT]);
      const make = async (key: string, over: Partial<EmployeeFields>) => void (ids[key] = (await run((r) => r.employees.create(OT, emp(over), ACTOR))).id);
      await make("old", { name: "Zara Old", employeeCode: "Z1", joiningDate: "2020-01-01", designation: "Manager", department: "Office" });
      await make("new", { name: "Anil New", employeeCode: "A1", joiningDate: "2025-12-01", contactNumber: "9111111111" });
      await make("mid", { name: "mira Mid", employeeCode: "M1", joiningDate: "2023-05-05", email: "mira@example.test" });
      await run((r) => r.employees.setActive(OT, ids.mid, false, ACTOR));
    });
    const names = async (query: Record<string, unknown>) => (await run((r) => r.employees.list(OT, { page: 1, pageSize: 10, sort: "joining", ...query } as never))).rows.map((x) => x.name);

    test("sorts, words (never a sealed column), activity and paging", async () => {
      assert.deepEqual(await names({ sort: "joining" }), ["Anil New", "mira Mid", "Zara Old"]);
      assert.deepEqual(await names({ sort: "name" }), ["Anil New", "mira Mid", "Zara Old"], "ignoring case");
      assert.deepEqual(await names({ sort: "active" }), ["Anil New", "Zara Old", "mira Mid"], "active first, then by name");
      assert.deepEqual(await names({ sort: "name", words: ["manager"] }), ["Zara Old"]);
      assert.deepEqual(await names({ sort: "name", words: ["9111"] }), ["Anil New"]);
      assert.deepEqual(await names({ sort: "name", active: false }), ["mira Mid"]);
      assert.deepEqual(await names({ sort: "name", words: ["1234567890"] }), [], "the account number is never searched");
      const page = await run((r) => r.employees.list(OT, { page: 2, pageSize: 2, sort: "name" }));
      assert.deepEqual([page.total, page.rows.length], [3, 1]);
      const touched = await run((r) => r.employees.update(OT, ids.old, { designation: "Director" }, ACTOR));
      assert.equal(touched.designation, "Director");
      assert.equal((await run((r) => r.employees.list(OT, { page: 1, pageSize: 1, sort: "updated" }))).rows[0].name, "Zara Old", "the Salary Update list: most recently updated first");
    });

    test("lookup by code or name prefix (active first), counts, own ids and getMany never leave the company", async () => {
      assert.deepEqual((await run((r) => r.employees.lookup(OT, { prefix: "a", limit: 5 }))).map((x) => x.name), ["Anil New"]);
      assert.deepEqual((await run((r) => r.employees.lookup(OT, { prefix: "M", limit: 5 }))).map((x) => x.name), ["mira Mid"], "by code M1 or name, any case");
      assert.deepEqual((await run((r) => r.employees.lookup(OT, { prefix: "", limit: 2 }))).map((x) => x.name), ["Anil New", "Zara Old"], "active first");
      assert.deepEqual((await run((r) => r.employees.lookup(OT, { prefix: "%", limit: 5 }))), [], "a percent sign is not a wildcard");
      assert.deepEqual(await run((r) => r.employees.counts(OT)), { active: 2, all: 3 });
      assert.deepEqual((await run((r) => r.employees.ownIds(OT, [ids.old, ids.new, newId()]))).sort(), [ids.old, ids.new].sort());
      assert.deepEqual(await run((r) => r.employees.ownIds(PF, [ids.old])), []);
      assert.equal((await run((r) => r.employees.getMany(OT, [ids.old, ids.mid]))).length, 2);
      assert.equal((await run((r) => r.employees.getMany(HP, [ids.old]))).length, 0);
    });

    test("soft delete hides, restore refuses a code now taken, purge only from the bin; update and setActive of a missing person fail", async () => {
      assert.equal(await run((r) => r.employees.softDelete(OT, ids.new, ACTOR)), true);
      assert.equal(await run((r) => r.employees.softDelete(OT, ids.new, ACTOR)), false);
      assert.equal(await run((r) => r.employees.get(OT, ids.new)), null);
      assert.equal((await run((r) => r.employees.get(OT, ids.new, { deleted: true })))?.deletedBy, ACTOR);
      assert.deepEqual(await names({ deleted: "only", sort: "name" }), ["Anil New"]);
      assert.equal(await run((r) => r.employees.codeTaken(OT, "A1")), false, "a binned code is free");
      const taker = await run((r) => r.employees.create(OT, emp({ employeeCode: "A1" }), ACTOR));
      await assert.rejects(() => run((r) => r.employees.restore(OT, ids.new)), (e) => e instanceof RepoError && e.kind === "unique");
      await run((r) => r.employees.softDelete(OT, taker.id, ACTOR));
      assert.equal(await run((r) => r.employees.restore(OT, ids.new)), true);
      assert.equal(await run((r) => r.employees.purge(OT, ids.new)), false, "a live person is not purged");
      await run((r) => r.employees.softDelete(OT, ids.new, ACTOR));
      assert.equal(await run((r) => r.employees.purge(PF, ids.new)), false, "not from another company");
      assert.equal(await run((r) => r.employees.purge(OT, ids.new)), true);
      await assert.rejects(() => run((r) => r.employees.update(OT, newId(), { name: "x" }, ACTOR)), (e) => e instanceof RepoError);
      await assert.rejects(() => run((r) => r.employees.setActive(OT, ids.new, true, ACTOR)), (e) => e instanceof RepoError);
    });
  });

  test("blockingDependency names what still points at a person, in Pallav's order", async () => {
    const e = await run((r) => r.employees.create(HP, emp(), ACTOR));
    assert.equal(await run((r) => r.employees.blockingDependency(e.id)), null);
    const staffAdv = await insertRow(owner, hotel.schema, "staff_advances", { employee_id: e.id });
    assert.equal(await run((r) => r.employees.blockingDependency(e.id)), "Staff Advance Salaries");
    const salary = await insertRow(owner, hotel.schema, "salary_processings", { employee_id: e.id, payroll_company_id: HP });
    assert.equal(await run((r) => r.employees.blockingDependency(e.id)), "Salary Processing");
    await insertRow(owner, hotel.schema, "bonus_incentives", { employee_id: e.id, payroll_company_id: HP });
    assert.equal(await run((r) => r.employees.blockingDependency(e.id)), "Bonus & Incentive Management");
    await insertRow(owner, hotel.schema, "payroll_advances", { employee_id: e.id, payroll_company_id: HP });
    assert.equal(await run((r) => r.employees.blockingDependency(e.id)), "Advance Management");
    const month = await run((r) => r.attendance.month(HP, 2026, 3));
    await run((r) => r.attendance.write(month.id, { upsert: [{ employeeId: e.id, day: 1, attendanceStatusId: null, shortcutKey: null, attendancePercentage: 0, overtimeHours: "0", skipsFood: false }], clear: [] }));
    assert.equal(await run((r) => r.employees.blockingDependency(e.id)), "Attendance Management");
    void staffAdv;
    void salary;
  });
});

describe("deduction types and assignments", () => {
  test("create, unique name per company without regard to case, list newest first with assignment counts, own ids, update, remove with its assignments", async () => {
    const rent = await run((r) => r.deductions.create(HP, { name: "Room rent", amountPaise: BigInt(50_000) }, ACTOR));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const adv = await run((r) => r.deductions.create(HP, { name: "Advance", amountPaise: BigInt(0) }, ACTOR));
    await assert.rejects(() => run((r) => r.deductions.create(HP, { name: "ROOM RENT", amountPaise: BigInt(1) }, ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal((await run((r) => r.deductions.create(PF, { name: "Room rent", amountPaise: BigInt(1) }, ACTOR))).payrollCompanyId, PF, "another company may reuse the name");
    assert.equal(await run((r) => r.deductions.nameTaken(HP, "room RENT")), true);
    assert.equal(await run((r) => r.deductions.nameTaken(HP, "room rent", rent.id)), false);
    const person = await run((r) => r.employees.create(HP, emp(), ACTOR));
    await run((r) => r.employeeDeductions.sync(person.id, [{ deductionId: rent.id, deductionType: "Monthly", amountPaise: BigInt(40_000) }], ACTOR));
    const list = await run((r) => r.deductions.list(HP));
    assert.deepEqual(list.map((d) => [d.name, d.assignedCount]), [["Advance", 0], ["Room rent", 1]]);
    assert.deepEqual((await run((r) => r.deductions.list(HP, { activeOnly: true }))).length, 2);
    assert.equal(await run((r) => r.deductions.isAssigned(rent.id)), true);
    assert.equal(await run((r) => r.deductions.isAssigned(adv.id)), false);
    assert.equal(await run((r) => r.deductions.any(HP)), true);
    assert.equal(await run((r) => r.deductions.any(OT)), false);
    assert.deepEqual(await run((r) => r.deductions.ownIds(HP, [rent.id, newId()])), [rent.id]);
    assert.equal(await run((r) => r.deductions.get(PF, rent.id)), null, "another company's deduction reads as absent");
    const upd = await run((r) => r.deductions.update(HP, adv.id, { amountPaise: BigInt(999), isActive: false }, ACTOR));
    assert.deepEqual([upd.amountPaise, upd.isActive], [BigInt(999), false]);
    assert.equal((await run((r) => r.deductions.list(HP, { activeOnly: true }))).length, 1);
    await assert.rejects(() => run((r) => r.deductions.update(PF, adv.id, { name: "x" }, ACTOR)), (e) => e instanceof RepoError);
    assert.equal(await run((r) => r.deductions.remove(PF, rent.id)), false);
    assert.equal(await run((r) => r.deductions.remove(HP, rent.id)), true);
    assert.deepEqual(await run((r) => r.employeeDeductions.forEmployees([person.id])), [], "assignments go with the deduction");
  });

  test("sync keeps, updates, adds and drops assignments with one statement per kind; only the employee's own rows are touched", async () => {
    const d1 = await run((r) => r.deductions.create(OT, { name: "D1", amountPaise: BigInt(1) }, ACTOR));
    const d2 = await run((r) => r.deductions.create(OT, { name: "D2", amountPaise: BigInt(2) }, ACTOR));
    const d3 = await run((r) => r.deductions.create(OT, { name: "D3", amountPaise: BigInt(3) }, ACTOR));
    const a = await run((r) => r.employees.create(OT, emp(), ACTOR));
    const b = await run((r) => r.employees.create(OT, emp(), ACTOR));
    await run((r) => r.employeeDeductions.sync(a.id, [{ deductionId: d1.id, deductionType: "Monthly", amountPaise: BigInt(100) }, { deductionId: d2.id, deductionType: "One Time", amountPaise: BigInt(200) }], ACTOR));
    await run((r) => r.employeeDeductions.sync(b.id, [{ deductionId: d1.id, deductionType: "Monthly", amountPaise: BigInt(7) }], ACTOR));
    const first = await run((r) => r.employeeDeductions.forEmployees([a.id]));
    assert.deepEqual(first.map((x) => [x.deductionId, x.deductionType, x.amountPaise, x.isSettled]).sort(), [[d1.id, "Monthly", BigInt(100), false], [d2.id, "One Time", BigInt(200), false]].sort());
    const keep = first.find((x) => x.deductionId === d1.id) as { id: string };
    const foreign = (await run((r) => r.employeeDeductions.forEmployees([b.id])))[0];
    await run((r) => r.employeeDeductions.sync(a.id, [{ id: keep.id, deductionId: d1.id, deductionType: "One Time", amountPaise: BigInt(150) }, { id: foreign.id, deductionId: d3.id, deductionType: "Monthly", amountPaise: BigInt(9) }], ACTOR));
    const after = await run((r) => r.employeeDeductions.forEmployees([a.id]));
    assert.deepEqual(after.map((x) => [x.deductionId, x.deductionType, x.amountPaise]).sort(), [[d1.id, "One Time", BigInt(150)], [d3.id, "Monthly", BigInt(9)]].sort(), "d2 dropped, d1 changed, a foreign id inserted as a new row");
    assert.equal(after.find((x) => x.id === keep.id)?.deductionType, "One Time");
    const b2 = await run((r) => r.employeeDeductions.forEmployees([b.id]));
    assert.deepEqual(b2.map((x) => [x.id, x.amountPaise]), [[foreign.id, BigInt(7)]], "the other employee's row is untouched");
    await run((r) => r.employeeDeductions.sync(a.id, [], ACTOR));
    assert.deepEqual(await run((r) => r.employeeDeductions.forEmployees([a.id])), []);
    assert.deepEqual(await run((r) => r.employeeDeductions.forEmployees([])), []);
  });
});

describe("attendance marks, months and the grid", () => {
  const status = (key: string, color: string, over: Record<string, unknown> = {}) => ({ name: `Mark ${key}`, shortcutKey: key, color, attendancePercentage: 100 as const, statusType: "Paid" as const, skipsFood: false, ...over });

  test("marks: shortcut key and colour are unique per company without regard to case; newest first or by name; used counts; update; remove leaves the days unmarked", async () => {
    const p = await run((r) => r.attendanceStatuses.create(HP, status("P", "#16A34A")));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const a = await run((r) => r.attendanceStatuses.create(HP, status("A", "#DC2626", { attendancePercentage: 0, statusType: "Unpaid", name: "Absent" })));
    await assert.rejects(() => run((r) => r.attendanceStatuses.create(HP, status("p", "#000000"))), (e) => e instanceof RepoError && e.kind === "unique");
    await assert.rejects(() => run((r) => r.attendanceStatuses.create(HP, status("Q", "#16a34a"))), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal((await run((r) => r.attendanceStatuses.create(PF, status("P", "#16A34A")))).payrollCompanyId, PF);
    assert.equal(await run((r) => r.attendanceStatuses.shortcutTaken(HP, "P")), true);
    assert.equal(await run((r) => r.attendanceStatuses.shortcutTaken(HP, "p", p.id)), false);
    assert.equal(await run((r) => r.attendanceStatuses.colorTaken(HP, "#dc2626")), true);
    assert.deepEqual((await run((r) => r.attendanceStatuses.list(HP, { activeOnly: false, order: "newest" }))).map((s) => s.shortcutKey), ["A", "P"]);
    assert.deepEqual((await run((r) => r.attendanceStatuses.list(HP, { activeOnly: false, order: "name" }))).map((s) => s.name), ["Absent", "Mark P"]);
    const u = await run((r) => r.attendanceStatuses.update(HP, a.id, { skipsFood: true, isActive: false }));
    assert.deepEqual([u.skipsFood, u.isActive], [true, false]);
    assert.equal((await run((r) => r.attendanceStatuses.list(HP, { activeOnly: true, order: "name" }))).length, 1);
    assert.equal(await run((r) => r.attendanceStatuses.get(PF, p.id)), null);
    const person = await run((r) => r.employees.create(HP, emp(), ACTOR));
    const month = await run((r) => r.attendance.month(HP, 2026, 4));
    await run((r) => r.attendance.write(month.id, { upsert: [1, 2, 3].map((day) => ({ employeeId: person.id, day, attendanceStatusId: p.id, shortcutKey: "P", attendancePercentage: 100, overtimeHours: "0", skipsFood: false })), clear: [] }));
    assert.equal((await run((r) => r.attendanceStatuses.usedCounts(HP))).get(p.id), 3);
    assert.equal(await run((r) => r.attendanceStatuses.isUsed(p.id)), true);
    assert.equal(await run((r) => r.attendanceStatuses.isUsed(a.id)), false);
    assert.equal(await run((r) => r.attendanceStatuses.remove(HP, p.id)), true);
    const days = await run((r) => r.attendance.entries(month.id, [person.id]));
    assert.deepEqual(days.map((d) => d.attendanceStatusId), [null, null, null], "ON DELETE SET NULL: the days stay, unmarked");
    assert.equal(await run((r) => r.attendanceStatuses.remove(HP, p.id)), false);
  });

  test("a month is made once (two first opens at the same time share one row), found without creating, updated, locked rows are left alone by the skips-food follow", async () => {
    const opens = await Promise.all(Array.from({ length: 6 }, () => run((r) => r.attendance.month(PF, 2027, 1))));
    assert.equal(new Set(opens.map((m) => m.id)).size, 1);
    assert.deepEqual([opens[0].isLocked, opens[0].generationCount, opens[0].lockedAt], [false, 0, null]);
    assert.equal(await run((r) => r.attendance.findMonth(PF, 2027, 2)), null, "a read never creates a month");
    assert.equal((await run((r) => r.attendance.findMonth(PF, 2027, 1)))?.id, opens[0].id);
    const locked = await run((r) => r.attendance.updateMonth(opens[0].id, { isLocked: true, lockedAt: new Date("2027-02-01T00:00:00Z"), generationCount: 2, unlockSessionId: "session-1" }));
    assert.deepEqual([locked.isLocked, locked.lockedAt?.toISOString(), locked.generationCount, locked.unlockSessionId], [true, "2027-02-01T00:00:00.000Z", 2, "session-1"]);
    assert.equal((await run((r) => r.attendance.month(PF, 2027, 1, { forUpdate: true }))).isLocked, true);
    await assert.rejects(() => run((r) => r.attendance.updateMonth(newId(), { isLocked: true })), (e) => e instanceof RepoError);
    await assert.rejects(() => run((r) => r.attendance.month(PF, 1999, 1)), (e) => e instanceof RepoError && e.kind === "check");
  });

  test("the grid: ONE read of a month for many people, batched upserts and clears, filled counts, incomplete names, and skips-food following only open months", async () => {
    const people = await Promise.all([1, 2, 3].map((i) => run((r) => r.employees.create(OT, emp({ name: `Grid ${i}` }), ACTOR))));
    const mark = await run((r) => r.attendanceStatuses.create(OT, status("G", "#123456", { skipsFood: false })));
    const month = await run((r) => r.attendance.month(OT, 2026, 2));
    const cell = (employeeId: string, day: number, over: Record<string, unknown> = {}) => ({ employeeId, day, attendanceStatusId: mark.id, shortcutKey: "G", attendancePercentage: 100, overtimeHours: "0", skipsFood: false, ...over });
    const all = [1, 2, 3, 4].flatMap((day) => people.slice(0, 2).map((p) => cell(p.id, day)));
    await run((r) => r.attendance.write(month.id, { upsert: all, clear: [] }));
    assert.equal(await run((r) => r.attendance.filledCount(month.id)), 8);
    const grid = await run((r) => r.attendance.entries(month.id, people.map((p) => p.id)));
    assert.equal(grid.length, 8);
    assert.deepEqual(grid.filter((g) => g.employeeId === people[0].id).map((g) => g.day), [1, 2, 3, 4]);
    await run((r) => r.attendance.write(month.id, { upsert: [cell(people[0].id, 2, { overtimeHours: "2.50", attendancePercentage: 50, attendanceStatusId: null, shortcutKey: null })], clear: [{ employeeId: people[1].id, day: 4 }, { employeeId: people[1].id, day: 3 }] }));
    const again = await run((r) => r.attendance.entries(month.id, [people[0].id, people[1].id]));
    const changed = again.find((g) => g.employeeId === people[0].id && g.day === 2);
    assert.deepEqual([changed?.overtimeHours, changed?.attendancePercentage, changed?.attendanceStatusId, changed?.shortcutKey], ["2.50", 50, null, null]);
    assert.equal(again.length, 6, "two cleared, none added");
    assert.equal(await run((r) => r.attendance.filledCount(month.id)), 5, "a cell with overtime only is not a filled day");
    await assert.rejects(() => run((r) => r.attendance.write(month.id, { upsert: [cell(people[0].id, 32)], clear: [] })), (e) => e instanceof RepoError && e.kind === "check");
    const incomplete = await run((r) => r.attendance.incomplete(OT, month.id, 3));
    assert.ok(incomplete.includes("Grid 3") && !incomplete.includes("Grid 1"), `Grid 3 has no days at all, Grid 1 has 3 filled: ${incomplete.join(",")}`);
    assert.deepEqual(await run((r) => r.attendance.entries(month.id, [])), []);
    assert.equal(await run((r) => r.attendance.followSkipsFood(mark.id, true)), 5, "open month: every day with this mark follows");
    await run((r) => r.attendance.updateMonth(month.id, { isLocked: true }));
    assert.equal(await run((r) => r.attendance.followSkipsFood(mark.id, false)), 0, "a locked month is never rewritten");
    const final = await run((r) => r.attendance.entries(month.id, [people[0].id]));
    assert.ok(final.filter((g) => g.attendanceStatusId !== null).every((g) => g.skipsFood));
  });
});

describe("shared lists, staff e-mails, the log and the setup checks", () => {
  test("master lists: shared items first, then the company's, by sort order then label; only active ones", async () => {
    await owner.query(`INSERT INTO "${hotel.schema}".payroll_master_items (payroll_company_id, list, label, sort_order, is_active) VALUES ($1, 'designations', 'Chef', 1, true), ($1, 'designations', 'Hidden', 2, false), ($2, 'designations', 'Other Co Item', 1, true)`, [OT, HP]);
    const items = await run((r) => r.payrollMasters.active("designations", OT));
    assert.deepEqual(items.map((i) => i.label), ["Chef"], "the shared designations list is empty in a new hotel; this company has one active item");
    const many = await run((r) => r.payrollMasters.activeMany(["gender", "designations"], OT));
    assert.ok(many.some((i) => i.list === "gender" && i.payrollCompanyId === null), "the shared lists come from the seeds");
    assert.deepEqual(many.filter((i) => i.list === "designations").map((i) => i.label), ["Chef"]);
    assert.ok(!(await run((r) => r.payrollMasters.active("designations", HP))).some((i) => i.label === "Chef"), "another company's items are not visible");
  });

  test("staff e-mails: open, finish, list with status and day filters (stalled sends count as failed), the live feed and the numbers", async () => {
    const person = await run((r) => r.employees.create(HP, emp({ name: "Mail Person", employeeCode: "ML1" }), ACTOR));
    const now = new Date("2026-03-04T10:00:00Z");
    const open = (over: Record<string, unknown> = {}) =>
      run((r) => r.staffEmails.open(HP, { payrollCompanyId: HP, employeeId: person.id, employeeName: "Mail Person", employeeCode: "ML1", designation: "Cook", recipientId: null, recipientName: "Ravi", recipientEmail: "ravi@example.test", subject: "Salary slip", attachment: "slip.pdf", sentBy: ACTOR, sentByName: "Asha", ipAddress: "10.0.0.1", createdAt: now, ...over } as never));
    const sent = await open();
    const failed = await open({ createdAt: new Date(now.getTime() + 60_000), recipientName: "Zed" });
    const stalled = await open({ createdAt: new Date(now.getTime() - 3_600_000), recipientName: "Old Send" });
    const fresh = await open({ createdAt: new Date(now.getTime() + 120_000), recipientName: "Fresh Send" });
    assert.deepEqual([sent.status, sent.message, sent.finishedAt], ["sending", null, null]);
    const done = await run((r) => r.staffEmails.finish(sent.id, { status: "sent", message: "Delivered", error: null, attachmentBytes: 2048, durationMs: 130 }));
    assert.deepEqual([done.status, done.attachmentBytes, done.durationMs, done.finishedAt instanceof Date], ["sent", 2048, 130, true]);
    await run((r) => r.staffEmails.finish(failed.id, { status: "failed", message: "x".repeat(600), error: "SMTP refused", attachmentBytes: null, durationMs: 5 }));
    assert.equal((await run((r) => r.staffEmails.get(failed.id)))?.message?.length, 500, "the message is cut to 500 characters");
    const staleBefore = new Date(now.getTime() - 600_000);
    const list = (status?: "sent" | "sending" | "failed", more: Record<string, unknown> = {}) => run((r) => r.staffEmails.list(HP, { status, staleBefore, page: 1, pageSize: 10, ...more }));
    assert.deepEqual((await list()).rows.map((x) => x.recipientName), ["Fresh Send", "Zed", "Ravi", "Old Send"], "newest first");
    assert.deepEqual((await list("sent")).rows.map((x) => x.recipientName), ["Ravi"]);
    assert.deepEqual((await list("sending")).rows.map((x) => x.recipientName), ["Fresh Send"], "a stalled send is not 'sending'");
    assert.deepEqual((await list("failed")).rows.map((x) => x.recipientName).sort(), ["Old Send", "Zed"], "failed, or stalled");
    assert.deepEqual((await list(undefined, { words: ["zed"] })).rows.map((x) => x.recipientName), ["Zed"]);
    assert.equal((await list(undefined, { from: "2026-03-04", to: "2026-03-04" })).total, 4, "all four were written on the 4th, India time");
    assert.equal((await list(undefined, { from: "2026-03-05" })).total, 0);
    assert.equal((await list(undefined, { to: "2026-03-03" })).total, 0);
    assert.equal((await run((r) => r.staffEmails.list(OT, { staleBefore, page: 1, pageSize: 10 }))).total, 0, "another company sees none");
    const feed = await run((r) => r.staffEmails.feed(HP, { staleBefore, after: new Date(now.getTime() + 30_000), watch: [sent.id] }));
    assert.deepEqual(feed.map((x) => x.recipientName), ["Ravi", "Zed", "Fresh Send"], "the new ones after the cursor plus the watched one, oldest first");
    const stats = await run((r) => r.staffEmails.stats(HP, { staleBefore, todayFrom: new Date("2026-03-04T00:00:00Z"), todayTo: new Date("2026-03-04T23:59:59Z") }));
    assert.deepEqual(stats, { total: 4, sent: 1, failed: 2, today: 4 });
    await assert.rejects(() => run((r) => r.staffEmails.finish(newId(), { status: "sent", message: "x", error: null, attachmentBytes: null, durationMs: 1 })), (e) => e instanceof RepoError);
    void stalled;
    void fresh;
  });

  test("the payroll log records without a password or sealed value; the dashboard's setup checks are one query", async () => {
    await run((r) => r.payrollLog.record({ payrollCompanyId: HP, companyName: "Payroll Hotel", userId: ACTOR, userName: "Asha", action: "created", status: "success", entity: "employee", subjectId: newId(), subjectLabel: "Asha Rao (E001)", summary: "Added Asha Rao", details: { salary: 18000, active: true, note: null }, ipAddress: "10.0.0.1" }));
    const log = await owner.query(`SELECT action, status, details FROM "${hotel.schema}".payroll_logs`);
    assert.deepEqual(log.rows, [{ action: "created", status: "success", details: { salary: 18000, active: true, note: null } }]);
    const before = await run((r) => r.payrollSetup.setup(PF));
    assert.deepEqual(before, { hasActiveStatus: true, hasActiveStaff: true, hasDeduction: true, hasJoiningLetter: false, hasExperienceLetter: false });
    const empty = await run((r) => r.payrollSetup.setup(OT));
    assert.equal(empty.hasJoiningLetter, false);
    assert.equal(await run((r) => r.payrollSetup.joiningTemplateActive(HP)), false);
    await owner.query(`INSERT INTO "${hotel.schema}".joining_letters (payroll_company_id, is_active) VALUES ($1, true)`, [HP]);
    await owner.query(`INSERT INTO "${hotel.schema}".experience_letters (payroll_company_id) VALUES ($1)`, [HP]);
    assert.equal(await run((r) => r.payrollSetup.joiningTemplateActive(HP)), true);
    const set = await run((r) => r.payrollSetup.setup(HP));
    assert.deepEqual([set.hasJoiningLetter, set.hasExperienceLetter], [true, true]);
  });
});

after(async () => {
  await releaseTestLock?.();
});
