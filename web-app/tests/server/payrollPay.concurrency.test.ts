// Payroll pay: concurrency, idempotent money creates and the audit line in the same unit (Backend review 06-REVIEW-B5-B6a.md follow-ups 1-3).
// The in-memory store runs one unit at a time per hotel (the advisory lock's effect) and rolls a unit back when it throws, so `Promise.all`
// interleavings show what the MySQL implementation must keep: the month row lock (`INSERT IGNORE` + `SELECT ... FOR UPDATE` on attendance_months)
// serialises generate / re-generate / unlock of ONE month; `FOR UPDATE` on salary_processings serialises payments; on payroll_advances serialises a run and an edit.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { Advance, PaymentMonth, SalaryRecord } from "@shared/dashboards/payrollPay";
import { POST as generateRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/generate/route";
import { POST as regenerateRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/regenerate/route";
import { GET as sheetRoute, PUT as saveRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/route";
import { POST as unlockRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/unlock/route";
import { POST as createStatusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance-statuses/route";
import { DELETE as deleteAdvanceRoute, PATCH as updateAdvanceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/[id]/route";
import { POST as createAdvanceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/route";
import { POST as createBonusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/bonuses/route";
import { DELETE as deleteEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/route";
import { POST as createEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/route";
import { POST as bulkRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/payments/bulk/route";
import { PATCH as paymentRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/payments/[id]/route";
import { GET as paymentsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/payments/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildPayrollServices, configurePayroll } from "../../src/server/compose/payrollCore";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { PayrollCompanyRecord } from "../../src/server/repos/payrollCore";
import type { Unit } from "../../src/server/repos/types";
import type { Person } from "../../src/server/services/cash/ports";
import type { PayrollUnitRepos } from "../../src/server/services/payrollCore/context";
import { createPayFigures } from "../../src/server/services/payrollPay/paymentService";
import { createSalaryRun } from "../../src/server/services/payrollPay/salaryRun";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([
  [id(1), { id: id(1), name: "Chetan Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [id(4), { id: id(4), name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [id(5), { id: id(5), name: "Sonal Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("clerk", id(1), { roleKey: "editor", roleLevel: 2, grants: [grant("payroll", "full")] });
mk("clerk2", id(2), { roleKey: "editor", roleLevel: 2, grants: [grant("payroll", "full")] });
mk("admin", id(4), { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("payroll", "full"), grant("users", "full")] });
mk("admin2", id(5), { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("payroll", "full"), grant("users", "full")] });


let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
let failLog = false;
const HP = id(101);

function wire(): void {
  hotel = createMemoryHotel();
  failLog = false;
  const now = () => clock;
  // a log line that cannot be written rolls the whole unit back, as the transaction does
  const unit: Unit<PayrollUnitRepos> = {
    run: (session, work) =>
      hotel.unit.run(session, (repos) =>
        work({
          ...repos,
          payrollLog: {
            record: async (entry) => {
              if (failLog) throw new Error("the log could not be written");
              await repos.payrollLog.record(entry);
            },
          },
        }),
      ),
  };
  configurePayroll(
    buildPayrollServices({
      unit,
      people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) },
      audit: { record: async () => undefined },
      catalog,
      now,
      mail: { staffDetails: async () => ({ queued: true }), offerLetter: async () => ({ queued: true }) },
      renderer: { render: async () => ({ status: "pending" }) },
      salaryRun: createSalaryRun({ now }),
      payFigures: createPayFigures(),
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  const at = new Date("2026-01-01T00:00:00Z");
  const company: PayrollCompanyRecord = {
    id: HP, name: "Hotel Pallav", code: "HP01", isActive: true, logoPath: null, signatureImagePath: null, updatedBy: null, createdAt: at, updatedAt: at, ownerName: null, mobileNumber: null, email: null,
    address: "Ring Road", city: "Rajkot", state: "Gujarat", pincode: null, panNumber: null, tanNumber: null, pfRegistrationNumber: null, esicRegistrationNumber: null,
    professionalTaxRegistrationNumber: null, authorizedPersonName: null, authorizedDesignation: null, authorizedMobile: null, authorizedEmail: null, bankName: null,
    accountNumber: null, ifscCode: null, branchName: null,
  };
  hotel.store.dataFor(HOTEL_A).payrollCompanies.push(company);
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, ...headers };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve({ companyId: HP, ...params }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const message = async (res: Response) => (await json(res)).error.message;
const data = () => hotel.store.dataFor(HOTEL_A);
const base = `/api/v1/payroll/companies/${HP}`;
const ok = async <T>(res: Response, status = 200): Promise<T> => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data as T;
};
const full = (n: number, key = "P"): string[] => Array.from({ length: n }, () => key);

async function employee(name: string, code: string, salaryPaise: number): Promise<string> {
  const body = {
    name, dateOfBirth: "", gender: "", contactNumber: "98765 43210", contactCountry: "91", email: `${code.toLowerCase()}@example.com`, address: "", nationality: "", countryAndPincode: "",
    emergencyContactName: "", emergencyContactRelation: "", emergencyContactNumber: "", emergencyContactCountry: "91", employeeCode: code, designation: "Chef", department: "Kitchen",
    shift: "", joiningDate: "2026-01-01", dailyWorkingHours: 8, qualification: "", qualificationInstitution: "", skills: "", responsibilities: "", salaryPaise, paymentMode: "Cash",
    bankName: "", accountHolderName: "", ifscCode: "", branchName: "", deductions: [], idProofType: "",
  };
  return (await ok<{ employee: { id: string } }>(await createEmployeeRoute(req("POST", `${base}/employees`, "clerk", body), ctx()), 201)).employee.id;
}
const advanceInput = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, date: "2026-08-10T10:00:00+05:30", amountPaise: 500_000, recoveryType: "Monthly", instalmentPaise: 200_000, remarks: "Festival", ...over });
const generate = (month: string, who = "clerk") => generateRoute(req("POST", `${base}/attendance/${month}/generate`, who), ctx({ month }));
const regenerate = (month: string, who = "admin") => regenerateRoute(req("POST", `${base}/attendance/${month}/regenerate`, who), ctx({ month }));
const month = async (who = "clerk"): Promise<PaymentMonth> => ok(await paymentsRoute(req("GET", `${base}/payments`, who), ctx()));

/** Two people with September fully filled; an August advance for the first (Monthly Rs 2,000 of Rs 5,000). Not yet generated. */
async function prepared(): Promise<{ a: string; b: string; advanceId: string }> {
  await ok(await createStatusRoute(req("POST", `${base}/attendance-statuses`, "clerk", { name: "Present", shortcutKey: "P", color: "#22C55E", attendancePercentage: 100, statusType: "Paid" }), ctx()), 201);
  const a = await employee("Asha Patel", "E-1", 3_000_000);
  const b = await employee("Bimal Shah", "E-2", 2_400_000);
  clock = new Date("2026-08-12T10:00:00+05:30");
  const adv = await ok<Advance>(await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a)), ctx()), 201);
  clock = new Date("2026-10-05T10:00:00+05:30");
  await sheetRoute(req("GET", `${base}/attendance/2026-09`, "clerk"), ctx({ month: "2026-09" }));
  await ok(await saveRoute(req("PUT", `${base}/attendance/2026-09`, "clerk", { rows: [{ employeeId: a, days: full(30) }, { employeeId: b, days: full(30) }] }), ctx({ month: "2026-09" })));
  return { a, b, advanceId: adv.id };
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("concurrency: the month row lock guards generate", () => {
  test("two admins generate the SAME month at once: one salary run, the other is refused; never two runs or two carry-forwards", async () => {
    await prepared();
    const [x, y] = await Promise.all([generate("2026-09", "admin"), generate("2026-09", "admin2")]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    const loser = x.status === 409 ? x : y;
    assert.equal(await message(loser), "Salary has already been generated for this month. An Admin must unlock attendance to re-generate.");
    assert.equal(data().salaryProcessings.length, 2);
    assert.equal(data().attendanceMonths[0].generationCount, 1);
    assert.equal(data().payrollAdvances.filter((a) => a.isCarryForward).length, 1);
    assert.equal(data().payrollAdvances.find((a) => !a.isCarryForward)!.recoveredAmountPaise, BigInt(500_000));
  });

  test("two admins re-generate the same month at once: both succeed in turn, the result is the same as one (nothing double-counted)", async () => {
    await prepared();
    await ok(await generate("2026-09"));
    await ok(await unlockRoute(req("POST", `${base}/attendance/2026-09/unlock`, "admin"), ctx({ month: "2026-09" })));
    const [x, y] = await Promise.all([regenerate("2026-09", "admin"), regenerate("2026-09", "admin2")]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.equal(data().salaryProcessings.length, 2);
    assert.equal(data().payrollAdvances.filter((a) => a.isCarryForward).length, 1);
    const parent = data().payrollAdvances.find((a) => !a.isCarryForward)!;
    assert.deepEqual([parent.recoveredAmountPaise, parent.isSettled], [BigInt(500_000), true]);
    assert.equal(data().attendanceMonths[0].generationCount, 3);
    assert.deepEqual((await month()).rows.map((r) => r.netPaise).sort((p, q) => p - q), [2_400_000, 2_800_000]);
  });

  test("generate against a save of the same month: the save is refused once the month is locked, or lands before the run and is paid", async () => {
    const { a } = await prepared();
    const [g, s] = await Promise.all([generate("2026-09"), saveRoute(req("PUT", `${base}/attendance/2026-09`, "clerk", { rows: [{ employeeId: a, days: full(29).concat("") }] }), ctx({ month: "2026-09" }))]);
    if (s.status === 200) {
      // the save ran first: day 30 cleared, so the run is refused for incompleteness
      assert.equal(g.status, 409);
      assert.match(await message(g), /Please complete attendance entries for all active employees before generating salary: Asha Patel\./);
      assert.equal(data().salaryProcessings.length, 0);
    } else {
      // the run ran first and locked the month
      assert.equal(g.status, 200);
      assert.equal(await message(s), "This attendance month is locked. An Admin must unlock it before changes can be made.");
    }
  });
});

describe("concurrency: payments", () => {
  test("generate against a bulk payment: payments are put back after a re-generate; paid is never above what the salary can bear", async () => {
    await prepared();
    await ok(await generate("2026-09"));
    const ids = (await month()).rows.map((r) => r.id);
    await ok(await unlockRoute(req("POST", `${base}/attendance/2026-09/unlock`, "admin"), ctx({ month: "2026-09" })));
    const [r, p] = await Promise.all([regenerate("2026-09"), bulkRoute(req("POST", `${base}/payments/bulk`, "clerk", { ids, status: "Paid", paidOn: "2026-10-04", reference: "NEFT-1" }), ctx())]);
    // whichever ran second, the month holds two salaries, each Paid for its net or Pending, never more than net
    assert.equal(r.status, 200);
    assert.equal(p.status, 200);
    const rows = (await month()).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(row.paidPaise <= row.netPaise, `${row.employeeName} paid ${row.paidPaise} of ${row.netPaise}`);
      assert.ok(row.paymentStatus === "Pending" || row.paymentStatus === "Paid", row.paymentStatus);
      assert.equal(row.paidPaise, row.paymentStatus === "Paid" ? row.netPaise : 0);
    }
  });

  test("the same salary paid twice at once by two clerks (MJ #23): the first lands, the second is warned (CONFLICT with currentVersion); paid never above net", async () => {
    await prepared();
    await ok(await generate("2026-09"));
    const target = (await month()).rows[0];
    const body = (paidPaise: number, reference: string) => ({ status: "Partially Paid", paidPaise, paidOn: "2026-10-04", reference, remarks: "", version: target.version });
    const [x, y] = await Promise.all([
      paymentRoute(req("PATCH", `${base}/payments/${target.id}`, "clerk", body(1_000_000, "UTR-A")), ctx({ id: target.id })),
      paymentRoute(req("PATCH", `${base}/payments/${target.id}`, "clerk2", body(1_500_000, "UTR-B")), ctx({ id: target.id })),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    const loser = x.status === 409 ? x : y;
    assert.equal((await json(loser)).error.details.currentVersion, target.version + 1);
    const final = (await month()).rows.find((r) => r.id === target.id)!;
    assert.equal(final.version, target.version + 1);
    assert.ok(final.paidPaise <= final.netPaise);
    // the warned clerk reloads, sees the new version and pays on top of it
    const retry = await ok<SalaryRecord>(await paymentRoute(req("PATCH", `${base}/payments/${target.id}`, "clerk2", { ...body(1_200_000, "UTR-C"), version: final.version }), ctx({ id: target.id })));
    assert.deepEqual([retry.paidPaise, retry.version], [1_200_000, target.version + 2]);
    // a payment above the net is refused whichever order
    assert.equal((await paymentRoute(req("PATCH", `${base}/payments/${target.id}`, "clerk", body(1_000, "UTR-E")), ctx({ id: target.id }))).status, 409, "a stale form is refused");
    assert.equal((await paymentRoute(req("PATCH", `${base}/payments/${target.id}`, "clerk", { ...body(target.netPaise, "UTR-D"), version: retry.version }), ctx({ id: target.id }))).status, 422);
  });

  test("a bulk payment with one stale version is refused whole; a re-generate moves the version past any form opened before it", async () => {
    await prepared();
    await ok(await generate("2026-09"));
    const [r1, r2] = (await month()).rows;
    await ok(await paymentRoute(req("PATCH", `${base}/payments/${r1.id}`, "clerk", { status: "Paid", paidPaise: null, paidOn: "2026-10-04", reference: "N1", remarks: "", version: r1.version }), ctx({ id: r1.id })));
    const bulk = { ids: [r1.id, r2.id], status: "Paid", paidOn: "2026-10-04", reference: "NEFT", versions: { [r1.id]: r1.version, [r2.id]: r2.version } };
    const refused = await bulkRoute(req("POST", `${base}/payments/bulk`, "clerk", bulk), ctx());
    assert.equal(refused.status, 409);
    assert.equal((await json(refused)).error.details.currentVersion, r1.version + 1);
    assert.equal((await month()).rows.find((r) => r.id === r2.id)!.paymentStatus, "Pending", "nothing was written");
    const okBulk = await ok<{ updated: number }>(await bulkRoute(req("POST", `${base}/payments/bulk`, "clerk", { ...bulk, versions: { [r1.id]: r1.version + 1, [r2.id]: r2.version } }), ctx()));
    assert.equal(okBulk.updated, 2);

    // a form opened on version v: after a re-generate the new row is at least v + 1, so the old form is stale
    await ok(await unlockRoute(req("POST", `${base}/attendance/2026-09/unlock`, "admin"), ctx({ month: "2026-09" })));
    await ok(await regenerate("2026-09"));
    const after = (await month()).rows.find((r) => r.employeeId === r1.employeeId)!;
    assert.ok(after.version > r1.version + 1, `${after.version} must be past the last version the form saw`);
    const stale = await paymentRoute(req("PATCH", `${base}/payments/${after.id}`, "clerk", { status: "Pending", paidPaise: null, paidOn: "", reference: "", remarks: "", version: r1.version + 2 }), ctx({ id: after.id }));
    assert.equal(stale.status, 409);
  });
});

describe("concurrency: advances and employees against the run", () => {
  test("an advance edited while the month is generated: either the edit lands first (the run recovers the edited instalment) or it is refused as processed", async () => {
    const { a, advanceId } = await prepared();
    // dated in September, the month being generated: the edit and the run compete for the same advance
    const sept = await ok<Advance>(await createAdvanceRoute(req("POST", `${base}/advances`, "admin", advanceInput(a, { date: "2026-09-15T10:00:00+05:30", amountPaise: 400_000, instalmentPaise: 100_000 })), ctx()), 201);
    const [g, e] = await Promise.all([generate("2026-09"), updateAdvanceRoute(req("PATCH", `${base}/advances/${sept.id}`, "admin", advanceInput(a, { date: "2026-09-15T10:00:00+05:30", amountPaise: 400_000, instalmentPaise: 300_000 })), ctx({ id: sept.id }))]);
    assert.equal(g.status, 200);
    const line = data().salaryLines.find((l) => l.sourceType === "advance" && l.sourceId === sept.id)!;
    if (e.status === 200) assert.equal(line.amountPaise, BigInt(300_000), "the run took the edited instalment");
    else {
      assert.equal(e.status, 409);
      assert.equal(await message(e), "Salary Processing is already completed for this period, so this advance cannot be changed.");
      assert.equal(line.amountPaise, BigInt(100_000), "the run took the original instalment");
    }
    void advanceId;
    const parent = data().payrollAdvances.find((x) => x.id === sept.id)!;
    assert.equal(parent.isSettled, true);
  });

  test("an advance deleted while the month is generated: deleted before (not recovered) or refused after (recovered once)", async () => {
    const { a } = await prepared();
    const sept = await ok<Advance>(await createAdvanceRoute(req("POST", `${base}/advances`, "admin", advanceInput(a, { date: "2026-09-15T10:00:00+05:30", amountPaise: 400_000, instalmentPaise: 100_000 })), ctx()), 201);
    const [g, d] = await Promise.all([generate("2026-09"), deleteAdvanceRoute(req("DELETE", `${base}/advances/${sept.id}`, "admin"), ctx({ id: sept.id }))]);
    assert.equal(g.status, 200);
    const lines = data().salaryLines.filter((l) => l.sourceType === "advance" && l.sourceId === sept.id);
    if (d.status === 200) assert.equal(lines.length, 0, "a deleted advance is not recovered");
    else {
      assert.equal(d.status, 409);
      assert.equal(lines.length, 1);
    }
  });

  test("an employee deleted while the month is generated: deleted first (no salary for them) or refused after (a salary names them)", async () => {
    const { b } = await prepared();
    const [g, d] = await Promise.all([generate("2026-09"), deleteEmployeeRoute(req("DELETE", `${base}/employees/${b}`, "admin"), ctx({ id: b }))]);
    assert.equal(g.status === 200 || g.status === 409, true);
    const salaries = data().salaryProcessings.filter((p) => p.employeeId === b).length;
    if (d.status === 200) assert.equal(salaries, 0, "a person deleted before the run has no salary row");
    else {
      assert.equal(d.status, 409, "refused while attendance or a salary names the person");
      assert.equal(data().employees.find((e) => e.id === b)!.deletedAt, null);
    }
  });
});

describe("idempotent money creates (Idempotency-Key through the wrapper)", () => {
  test("advances and bonuses: the same key and body replays one record; the same key with another body is refused", async () => {
    const { a } = await prepared();
    const key = { "idempotency-key": "adv-key-0000000001" };
    const first = await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a, { date: "2026-10-05" }), key), ctx());
    const again = await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a, { date: "2026-10-05" }), key), ctx());
    assert.deepEqual([first.status, again.status, again.headers.get("idempotent-replayed")], [201, 201, "true"]);
    assert.equal((await json(again)).data.id, (await json(first)).data.id);
    assert.equal(data().payrollAdvances.filter((x) => x.entryNo === 2).length, 1);
    const other = await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a, { date: "2026-10-05", amountPaise: 999_900 }), key), ctx());
    assert.deepEqual([other.status, (await json(other)).error.code], [422, "IDEMPOTENCY_KEY_REUSED"]);

    const bonus = { employeeId: a, date: "2026-10-05", type: "Bonus", amountPaise: 100_000, remarks: "x" };
    const bkey = { "idempotency-key": "bonus-key-000000001" };
    const b1 = await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", bonus, bkey), ctx());
    const b2 = await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", bonus, bkey), ctx());
    assert.deepEqual([b1.status, b2.status, data().bonuses.length], [201, 201, 1]);
    assert.equal((await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", { ...bonus, amountPaise: 1 }, bkey), ctx())).status, 422);
  });

  test("payments (single and bulk): a retry with the same key replays; another body under that key is refused", async () => {
    await prepared();
    await ok(await generate("2026-09"));
    const rows = (await month()).rows;
    const key = { "idempotency-key": "pay-key-00000000001" };
    const body = { status: "Paid", paidPaise: null, paidOn: "2026-10-04", reference: "NEFT-1", remarks: "" };
    const first = await paymentRoute(req("PATCH", `${base}/payments/${rows[0].id}`, "clerk", body, key), ctx({ id: rows[0].id }));
    const again = await paymentRoute(req("PATCH", `${base}/payments/${rows[0].id}`, "clerk", body, key), ctx({ id: rows[0].id }));
    assert.deepEqual([first.status, again.status, again.headers.get("idempotent-replayed")], [200, 200, "true"]);
    assert.equal((await paymentRoute(req("PATCH", `${base}/payments/${rows[0].id}`, "clerk", { ...body, reference: "OTHER" }, key), ctx({ id: rows[0].id }))).status, 422);

    const bulkKey = { "idempotency-key": "bulk-key-0000000001" };
    const bulk = { ids: [rows[1].id], status: "Paid", paidOn: "2026-10-04", reference: "NEFT-2" };
    const b1 = await bulkRoute(req("POST", `${base}/payments/bulk`, "clerk", bulk, bulkKey), ctx());
    const b2 = await bulkRoute(req("POST", `${base}/payments/bulk`, "clerk", bulk, bulkKey), ctx());
    assert.deepEqual([b1.status, b2.status, b2.headers.get("idempotent-replayed")], [200, 200, "true"]);
    assert.equal(data().payrollLogs.filter((l) => l.entity === "Salary Payment" && l.summary === "1 payment(s) marked Paid.").length, 1, "a replay writes nothing twice");
  });
});

describe("the audit line is in the same unit", () => {
  test("a log line that cannot be written rolls the action back: generate, payment, revision, advance and bonus", async () => {
    const { a } = await prepared();
    failLog = true;
    assert.equal((await generate("2026-09")).status, 500);
    assert.equal(data().salaryProcessings.length, 0);
    assert.equal(data().payrollAdvances.find((x) => !x.isCarryForward)!.isSettled, false, "the advance was not recovered");
    assert.equal(data().attendanceMonths.find((m) => m.month === 9)!.isLocked, false);
    assert.equal((await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a, { date: "2026-10-05" })), ctx())).status, 500);
    assert.equal(data().payrollAdvances.length, 1);
    assert.equal((await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", { employeeId: a, date: "2026-10-05", type: "Bonus", amountPaise: 100, remarks: "" }), ctx())).status, 500);
    assert.equal(data().bonuses.length, 0);

    failLog = false;
    await ok(await generate("2026-09"));
    const row = (await month()).rows[0];
    failLog = true;
    assert.equal((await paymentRoute(req("PATCH", `${base}/payments/${row.id}`, "clerk", { status: "Paid", paidPaise: null, paidOn: "2026-10-04", reference: "", remarks: "" }), ctx({ id: row.id }))).status, 500);
    assert.equal(((await month()).rows.find((r) => r.id === row.id) as SalaryRecord).paymentStatus, "Pending");
  });

  test("the audit lines carry the money in paise-derived figures and who did it, in the same unit as the write", async () => {
    const { a } = await prepared();
    await ok(await generate("2026-09"));
    const row = (await month()).rows.find((r) => r.employeeId === a)!;
    await ok(await paymentRoute(req("PATCH", `${base}/payments/${row.id}`, "clerk", { status: "Partially Paid", paidPaise: 1_000_000, paidOn: "2026-10-04", reference: "UTR", remarks: "" }), ctx({ id: row.id })));
    const log = data().payrollLogs.filter((l) => l.entity === "Salary Payment").at(-1)!;
    assert.deepEqual([log.action, log.status, log.userName, log.details], ["updated", "success", "Chetan Clerk", { Month: "2026-09", Status: "Partially Paid", Paid: "10,000.00" }]);
    assert.equal(data().payrollLogs.some((l) => l.entity === "Attendance" && l.summary === "Salary generated for 9/2026"), true);
  });
});
