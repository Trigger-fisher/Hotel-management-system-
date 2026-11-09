// Payroll pay (B6a) end to end through the REAL route files, the wrapper, the services and ONE in-memory hotel store shared with payroll core:
// the salary run behind attendance's generate, payments, slips, reports, salary revisions, advances and bonuses. Expected behaviour:
// docs/specs/payroll-pay.md (each rule cites Pallav). The arithmetic itself is golden in payrollPay.golden.test.ts.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { Advance, AdvanceList, BonusList, PaymentMonth, SalaryRecord } from "@shared/dashboards/payrollPay";
import { POST as generateRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/generate/route";
import { POST as regenerateRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/regenerate/route";
import { GET as sheetRoute, PUT as saveRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/route";
import { POST as unlockRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/unlock/route";
import { POST as createStatusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance-statuses/route";
import { POST as restoreAdvanceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/[id]/restore/route";
import { DELETE as deleteAdvanceRoute, PATCH as updateAdvanceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/[id]/route";
import { GET as listAdvancesRoute, POST as createAdvanceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/route";
import { DELETE as deleteBonusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/bonuses/[id]/route";
import { GET as listBonusRoute, POST as createBonusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/bonuses/route";
import { GET as dashboardRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/dashboard/route";
import { DELETE as deleteEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/route";
import { POST as createEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/route";
import { POST as bulkRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/payments/bulk/route";
import { PATCH as paymentRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/payments/[id]/route";
import { GET as paymentsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/payments/route";
import { GET as monthlyRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/reports/monthly/route";
import { GET as periodRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/reports/period/route";
import { POST as reviseRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/salary-profiles/[employeeId]/revisions/route";
import { GET as profileRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/salary-profiles/[employeeId]/route";
import { GET as profilesRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/salary-profiles/route";
import { GET as advancePdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/[id]/pdf/route";
import { GET as bonusPdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/bonuses/[id]/pdf/route";
import { GET as slipPdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/slips/[id]/pdf/route";
import { GET as registerPdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/payments/pdf/route";
import { GET as monthlyPdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/reports/monthly/pdf/route";
import { GET as periodPdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/reports/period/pdf/route";
import { GET as slipRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/slips/[id]/route";
import { GET as slipsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/slips/route";
import { GET as staffLookupRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/staff/lookup/route";
import { GET as staffRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/staff/route";
import { GET as refsRoute } from "../../src/app/api/v1/payroll/company-refs/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildPayrollServices, configurePayroll, getPayrollDocuments } from "../../src/server/compose/payrollCore";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { PayrollCompanyRecord } from "../../src/server/repos/payrollCore";
import type { Person } from "../../src/server/services/cash/ports";
import { createPayFigures } from "../../src/server/services/payrollPay/paymentService";
import { createSalaryRun } from "../../src/server/services/payrollPay/salaryRun";
import { createDocumentRenderer } from "../../src/server/documents";
import { assertMatchesContract } from "./helpers/contract";
import { formatINR } from "@shared/dashboards/format";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { clerk: id(1), admin: id(4), superAdmin: id(5) };
const people = new Map<string, Person>([
  [U.clerk, { id: U.clerk, name: "Chetan Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("clerk", U.clerk, { roleKey: "editor", roleLevel: 2, grants: [grant("payroll", "full")] });
mk("outsider", id(77), { grants: [] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("payroll", "full"), grant("users", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("payroll", "full"), grant("users", "full")] });
mk("slipsOnly", id(6), { grants: [grant("payroll.salary-slip", "view")] });


let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
const HP = id(101);

function wire(): void {
  hotel = createMemoryHotel();
  const now = () => clock;
  configurePayroll(
    buildPayrollServices({
      unit: hotel.unit,
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
    id: HP, name: "Hotel Pallav", code: "HP01", isActive: true, logoPath: null, signatureImagePath: null, updatedBy: null, createdAt: at, updatedAt: at,
    ownerName: null, mobileNumber: null, email: null, address: "Ring Road", city: "Rajkot", state: "Gujarat", pincode: null, panNumber: null, tanNumber: null, pfRegistrationNumber: null,
    esicRegistrationNumber: null, professionalTaxRegistrationNumber: null, authorizedPersonName: null, authorizedDesignation: null, authorizedMobile: null, authorizedEmail: null,
    bankName: null, accountNumber: null, ifscCode: null, branchName: null,
  };
  hotel.store.dataFor(HOTEL_A).payrollCompanies.push(company);
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve({ companyId: HP, ...params }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const fields = async (res: Response) => (await json(res)).error.details.fields;
const message = async (res: Response) => (await json(res)).error.message;
const data = () => hotel.store.dataFor(HOTEL_A);
const base = `/api/v1/payroll/companies/${HP}`;
const ok = async <T>(res: Response, status = 200): Promise<T> => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data as T;
};

async function employee(name: string, code: string, salaryPaise: number, over: Record<string, unknown> = {}): Promise<string> {
  const body = {
    name, dateOfBirth: "", gender: "", contactNumber: "98765 43210", contactCountry: "91", email: `${code.toLowerCase()}@example.com`, address: "", nationality: "", countryAndPincode: "",
    emergencyContactName: "", emergencyContactRelation: "", emergencyContactNumber: "", emergencyContactCountry: "91", employeeCode: code, designation: "Chef", department: "Kitchen",
    shift: "", joiningDate: "2026-01-01", dailyWorkingHours: 8, qualification: "", qualificationInstitution: "", skills: "", responsibilities: "", salaryPaise, paymentMode: "Cash",
    bankName: "", accountHolderName: "", ifscCode: "", branchName: "", deductions: [], idProofType: "", ...over,
  };
  return (await ok<{ employee: { id: string } }>(await createEmployeeRoute(req("POST", `${base}/employees`, "clerk", body), ctx()), 201)).employee.id;
}
const fill = (month: string, rows: { employeeId: string; days: string[] }[]) => saveRoute(req("PUT", `${base}/attendance/${month}`, "clerk", { rows }), ctx({ month }));
const open = (month: string, who = "clerk") => sheetRoute(req("GET", `${base}/attendance/${month}`, who), ctx({ month }));
const generate = (month: string, who = "clerk") => generateRoute(req("POST", `${base}/attendance/${month}/generate`, who), ctx({ month }));
const advanceInput = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, date: "2026-08-10T10:00:00+05:30", amountPaise: 500_000, recoveryType: "Monthly", instalmentPaise: 200_000, remarks: "Festival", ...over });
const full = (n: number, key = "P"): string[] => Array.from({ length: n }, () => key);

/** Two people, September fully present (B with 2 half days), an August advance for A, a September bonus for B; September generated. */
async function september(): Promise<{ a: string; b: string; advanceId: string }> {
  await ok(await createStatusRoute(req("POST", `${base}/attendance-statuses`, "clerk", { name: "Present", shortcutKey: "P", color: "#22C55E", attendancePercentage: 100, statusType: "Paid" }), ctx()), 201);
  await ok(await createStatusRoute(req("POST", `${base}/attendance-statuses`, "clerk", { name: "Half day", shortcutKey: "H", color: "#F59E0B", attendancePercentage: 50, statusType: "Paid" }), ctx()), 201);
  const a = await employee("Asha Patel", "E-1", 3_000_000);
  const b = await employee("Bimal Shah", "E-2", 2_400_000);
  clock = new Date("2026-08-12T10:00:00+05:30");
  const advance = await ok<Advance>(await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a)), ctx()), 201);
  clock = new Date("2026-09-20T10:00:00+05:30");
  await ok(await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", { employeeId: b, date: "2026-09-20", type: "Bonus", amountPaise: 150_000, remarks: "Navratri" }), ctx()), 201);
  clock = new Date("2026-10-05T10:00:00+05:30");
  await open("2026-09");
  await ok(await fill("2026-09", [{ employeeId: a, days: full(30) }, { employeeId: b, days: [...full(28), "H", "H"] }]));
  await ok(await generate("2026-09"));
  return { a, b, advanceId: advance.id };
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("the salary run (SalaryProcessor through attendance generate)", () => {
  test("each person's month: attendance pay, bonus, a Monthly advance instalment and the rest carried to the 1st of next month", async () => {
    const { a, b, advanceId } = await september();
    const month = await ok<PaymentMonth>(await paymentsRoute(req("GET", `${base}/payments`, "clerk"), ctx()));
    assert.equal(month.period, "2026-09");
    const byName = Object.fromEntries(month.rows.map((r) => [r.employeeName, r]));
    const A = byName["Asha Patel"];
    const B = byName["Bimal Shah"];
    assert.deepEqual([A.attendanceSalaryPaise, A.advanceRecoveryPaise, A.pendingAdvancePaise, A.netPaise, A.days.p100, A.payableDays], [3_000_000, 200_000, 300_000, 2_800_000, 30, 30]);
    assert.deepEqual([B.attendanceSalaryPaise, B.bonusPaise, B.netPaise, B.days.p50, B.payableDays], [2_320_000, 150_000, 2_470_000, 2, 29]);
    assert.deepEqual(A.lines, [{ category: "Advance", label: "Festival", type: "Monthly", paise: 200_000, pendingPaise: 300_000 }]);
    assert.deepEqual(B.lines, [{ category: "Bonus", label: "Navratri", type: null, paise: 150_000, pendingPaise: 0 }]);
    // the advance closed out; its balance became a carry-forward dated 1 Oct
    const advances = data().payrollAdvances;
    const parent = advances.find((x) => x.id === advanceId)!;
    assert.deepEqual([parent.isSettled, parent.recoveredAmountPaise], [true, BigInt(500_000)]);
    const carry = advances.find((x) => x.isCarryForward)!;
    assert.deepEqual([carry.amountPaise, carry.deductionAmountPaise, carry.parentAdvanceId, carry.remarks, carry.advanceDate.toISOString()], [BigInt(300_000), BigInt(200_000), advanceId, "Carry Forward from Previous Month - Festival", "2026-09-30T18:30:00.000Z"]);
    const sample: SalaryRecord = {
      id: "x", companyId: "x", employeeId: "x", employeeCode: "x", employeeName: "x", designation: "x", period: "x", processedAt: "x", monthlySalaryPaise: 1, dailyWorkingHours: 1, daysInMonth: 1,
      days: { p0: 1, p25: 1, p50: 1, p75: 1, p100: 1 }, payableDays: 1, otHours: 1, dailySalaryPaise: 1, hourlyRatePaise: 1, attendanceSalaryPaise: 1, otAmountPaise: 1, bonusPaise: 1, incentivePaise: 1,
      deductions: [{ label: "x", paise: 1 }], lines: [{ category: "Bonus", label: "x", type: null, paise: 1, pendingPaise: 1 }], advanceRecoveryPaise: 1, pendingAdvancePaise: 1, netPaise: 1, paymentMode: "x",
      bankName: "x", accountNumber: null, ifscCode: "x", branchName: "x", paymentStatus: "Pending", paidPaise: 1, paidOn: null, reference: "x", remarks: "x", paymentUpdatedBy: null, generationCount: 1, version: 1,
    };
    assertMatchesContract(A, sample);
    assert.equal(A.generationCount, 1);
    void b;
    void a;
    // the dashboard's pay half
    const d = await ok<{ payrollMonth: string; netPaise: number; kpis: { id: string; value: number }[] }>(await dashboardRoute(req("GET", `${base}/dashboard`, "clerk"), ctx()));
    assert.deepEqual([d.payrollMonth, d.netPaise, d.kpis.find((k) => k.id === "advances")?.value], ["2026-09", 5_270_000, 300_000]);
    // an employee with salary on record cannot be deleted (Employee::blockingDependency, after attendance)
    assert.equal(await message(await deleteEmployeeRoute(req("DELETE", `${base}/employees/${a}`, "admin"), ctx({ id: a }))), "This employee is already used in Attendance Management and cannot be deleted. Remove the dependent records first, or mark the employee Inactive.");
  });

  test("payments: Paid takes the net, a part payment must sit between 0 and the net, no future dates; bulk; a re-generate keeps what was paid", async () => {
    const { a } = await september();
    const month = await ok<PaymentMonth>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09`, "clerk"), ctx()));
    const A = month.rows.find((r) => r.employeeId === a)!;
    const B = month.rows.find((r) => r.employeeId !== a)!;
    let res = await paymentRoute(req("PATCH", `${base}/payments/${A.id}`, "clerk", { status: "Partially Paid", paidPaise: 2_800_000, paidOn: "", reference: "", remarks: "" }), ctx({ id: A.id }));
    assert.deepEqual(await fields(res), { paidPaise: "A partial payment must be more than ₹0 and less than the net salary of ₹28,000.00." });
    res = await paymentRoute(req("PATCH", `${base}/payments/${A.id}`, "clerk", { status: "Paid", paidPaise: null, paidOn: "2026-10-06", reference: "", remarks: "" }), ctx({ id: A.id }));
    assert.deepEqual(await fields(res), { paidOn: "The payment date cannot be in the future." });
    const paidA = await ok<SalaryRecord>(await paymentRoute(req("PATCH", `${base}/payments/${A.id}`, "clerk", { status: "Partially Paid", paidPaise: 1_000_000, paidOn: "", reference: "UTR1", remarks: "first half" }), ctx({ id: A.id })));
    assert.deepEqual([paidA.paymentStatus, paidA.paidPaise, paidA.paidOn, paidA.reference, paidA.paymentUpdatedBy], ["Partially Paid", 1_000_000, "2026-10-05", "UTR1", "Chetan Clerk"]);
    const bulk = await ok<{ updated: number; message: string }>(await bulkRoute(req("POST", `${base}/payments/bulk`, "clerk", { ids: [B.id], status: "Paid", paidOn: "2026-10-04", reference: "NEFT-9" }), ctx()));
    assert.deepEqual(bulk, { updated: 1, message: "1 payment(s) marked Paid." });
    assert.deepEqual(await fields(await bulkRoute(req("POST", `${base}/payments/bulk`, "clerk", { ids: [], status: "Partially Paid", paidOn: "", reference: "" }), ctx())), { ids: "Select at least one employee.", status: "The selected payment status is invalid." });

    // an Admin unlocks, a day changes, the month is re-generated: payments stay; the advance is not recovered twice
    await ok(await unlockRoute(req("POST", `${base}/attendance/2026-09/unlock`, "admin"), ctx({ month: "2026-09" })));
    await ok(await fill("2026-09", [{ employeeId: B.employeeId, days: full(30) }]), 200);
    await ok(await regenerateRoute(req("POST", `${base}/attendance/2026-09/regenerate`, "admin"), ctx({ month: "2026-09" })));
    const after = await ok<PaymentMonth>(await paymentsRoute(req("GET", `${base}/payments`, "clerk"), ctx()));
    const A2 = after.rows.find((r) => r.employeeId === a)!;
    const B2 = after.rows.find((r) => r.employeeId !== a)!;
    assert.deepEqual([A2.paymentStatus, A2.paidPaise, A2.reference, A2.netPaise, A2.generationCount], ["Partially Paid", 1_000_000, "UTR1", 2_800_000, 2]);
    // B's salary grew past what was paid: no longer fully settled
    assert.deepEqual([B2.netPaise, B2.paidPaise, B2.paymentStatus], [2_550_000, 2_470_000, "Partially Paid"]);
    assert.equal(data().payrollAdvances.filter((x) => x.isCarryForward).length, 1);
    assert.equal(data().salaryProcessings.length, 2);
    assert.deepEqual(after.summary, { netPaise: 5_350_000, paidPaise: 3_470_000, outstandingPaise: 1_880_000, fullyPaid: 0, total: 2, byStatus: { Pending: 0, Processing: 0, "On Hold": 0, "Partially Paid": 2, Paid: 0, Failed: 0 } });
  });
});

describe("advances and bonuses (PayrollAdvanceController, BonusIncentiveController)", () => {
  test("Pallav's words; locked once the month is processed; carry-forwards untouchable; Admins only; the recycle bin", async () => {
    const { a, advanceId } = await september();
    let res = await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a, { amountPaise: 0, instalmentPaise: 0, date: "2026-10-06" })), ctx());
    assert.deepEqual(await fields(res), { date: "Advance date cannot be in the future.", amountPaise: "Advance amount must be greater than zero.", instalmentPaise: "A monthly recovery needs an instalment greater than zero." });
    // today's date = the moment of the save; One Time recovers the whole amount
    const today = await ok<Advance>(await createAdvanceRoute(req("POST", `${base}/advances`, "clerk", advanceInput(a, { date: "2026-10-05", recoveryType: "One Time", instalmentPaise: null })), ctx()), 201);
    assert.deepEqual([today.date, today.instalmentPaise, today.canEdit, today.locked], [clock.toISOString(), 500_000, false, false]);
    res = await updateAdvanceRoute(req("PATCH", `${base}/advances/${today.id}`, "clerk", advanceInput(a)), ctx({ id: today.id }));
    assert.deepEqual([res.status, await message(res)], [403, "Only Admin users can update advance records."]);
    const carry = data().payrollAdvances.find((x) => x.isCarryForward)!;
    res = await deleteAdvanceRoute(req("DELETE", `${base}/advances/${carry.id}`, "admin"), ctx({ id: carry.id }));
    assert.equal(await message(res), "Carry-forward advances are generated by Salary Processing and cannot be deleted.");
    // an August advance is not locked by September's run (its own month, August, has no salary)
    const list = await ok<AdvanceList>(await listAdvancesRoute(req("GET", `${base}/advances`, "admin"), ctx()));
    assert.deepEqual(list.page.items.map((x) => [x.entryNo, x.isCarryForward, x.locked, x.canEdit]), [["3", false, false, true], ["2", true, false, false], ["1", false, false, true]]);
    // issued counts money handed over (not the carry-forward); recovered only what salaries took
    assert.deepEqual(list.summary, { issuedPaise: 1_000_000, recoveredPaise: 200_000, outstandingPaise: 800_000, open: 2 });
    assert.deepEqual(list.counts, { all: 3, open: 2, settled: 1 });
    assert.equal((await deleteAdvanceRoute(req("DELETE", `${base}/advances/${today.id}`, "admin"), ctx({ id: today.id }))).status, 200);
    assert.equal((await restoreAdvanceRoute(req("POST", `${base}/advances/${today.id}/restore`, "admin"), ctx({ id: today.id }))).status, 403);
    assert.equal((await restoreAdvanceRoute(req("POST", `${base}/advances/${today.id}/restore`, "super"), ctx({ id: today.id }))).status, 200);
    // an advance dated in September: that month's salary is processed, so it is locked (Pallav looks at the advance's own month)
    const sept = await ok<Advance>(await createAdvanceRoute(req("POST", `${base}/advances`, "admin", advanceInput(a, { date: "2026-09-15T10:00:00+05:30" })), ctx()), 201);
    assert.deepEqual([sept.locked, sept.canEdit], [true, false]);
    res = await updateAdvanceRoute(req("PATCH", `${base}/advances/${sept.id}`, "admin", advanceInput(a)), ctx({ id: sept.id }));
    assert.deepEqual([res.status, await message(res)], [409, "Salary Processing is already completed for this period, so this advance cannot be changed."]);
    void advanceId;
  });

  test("bonuses: the current month only, never once its salary is generated; locked entries cannot be deleted", async () => {
    const { b } = await september();
    let res = await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", { employeeId: b, date: "2026-09-30", type: "Bonus", amountPaise: 0, remarks: "" }), ctx());
    assert.deepEqual(await fields(res), { date: "Bonus and incentive entries can only be dated in the current month (October 2026).", amountPaise: "Amount must be greater than zero." });
    const list = await ok<BonusList>(await listBonusRoute(req("GET", `${base}/bonuses`, "admin"), ctx()));
    const sept = list.page.items[0];
    assert.deepEqual([sept.locked, sept.canDelete, list.summary.bonusPaise, list.counts.Bonus], [true, false, 150_000, 1]);
    res = await deleteBonusRoute(req("DELETE", `${base}/bonuses/${sept.id}`, "admin"), ctx({ id: sept.id }));
    assert.equal(await message(res), "Salary Processing is already completed for this period, so this entry cannot be deleted.");
    // October generated on its last day: no more October bonuses
    await open("2026-10");
    clock = new Date("2026-10-31T10:00:00+05:30");
    await ok(await fill("2026-10", data().employees.map((e) => ({ employeeId: e.id, days: full(31) }))));
    await ok(await generate("2026-10"));
    res = await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", { employeeId: b, date: "2026-10-31", type: "Incentive", amountPaise: 1000, remarks: "" }), ctx());
    assert.equal(await message(res), "Salary has already been generated for this month, so no more bonus or incentive entries can be added to it.");
  });
});

describe("salary revisions (SalaryUpdateController) and the run's schedule", () => {
  test("a revision records each changed field; bank numbers are plain and shown in full; a mid-month raise pays from its date on; nothing changed is refused", async () => {
    await ok(await createStatusRoute(req("POST", `${base}/attendance-statuses`, "clerk", { name: "Present", shortcutKey: "P", color: "#22C55E", attendancePercentage: 100, statusType: "Paid" }), ctx()), 201);
    const a = await employee("Asha Patel", "E-1", 3_000_000);
    const body = { effectiveDate: "2026-09-16", salaryPaise: 3_600_000, designation: "Head chef", department: "Kitchen", dailyWorkingHours: "8", paymentMode: "Bank", bankName: "SBI", accountHolderName: "Asha", accountNumber: "001234567890", ifscCode: "SBIN0001234", branchName: "" };
    const r = await ok<{ changed: number; message: string }>(await reviseRoute(req("POST", `${base}/salary-profiles/${a}/revisions`, "clerk", body), ctx({ employeeId: a })), 201);
    assert.deepEqual(r, { changed: 7, message: "7 field(s) updated and recorded in the update history." });
    const p = await ok<{ employee: { salaryPaise: number; accountNumber: string }; history: { changes: { field: string; previous: string | null; next: string | null }[] }[] }>(await profileRoute(req("GET", `${base}/salary-profiles/${a}`, "clerk"), ctx({ employeeId: a })));
    assert.deepEqual([p.employee.salaryPaise, p.employee.accountNumber], [3_600_000, "001234567890"]);
    assert.deepEqual(p.history[0].changes.map((c) => [c.field, c.previous, c.next]), [
      ["Salary", "30000.00", "36000.00"], ["Designation", "Chef", "Head chef"], ["Salary Payment Type", "Cash", "Bank"], ["Bank Name", null, "SBI"], ["Account Holder Name", null, "Asha"], ["Account Number", null, "001234567890"], ["IFSC Code", null, "SBIN0001234"],
    ]);
    assert.ok(JSON.stringify(data().revisions).includes("001234567890"), "the history keeps the real values");
    const { accountNumber: _drop, ...again } = body;
    void _drop;
    const res = await reviseRoute(req("POST", `${base}/salary-profiles/${a}/revisions`, "clerk", again), ctx({ employeeId: a }));
    assert.deepEqual([res.status, await message(res)], [409, "No tracked fields were changed."]);
    const list = await ok<{ items: { revisionCount: number; lastRevisedOn: string }[] }>(await profilesRoute(req("GET", `${base}/salary-profiles`, "clerk"), ctx()));
    assert.deepEqual([list.items[0].revisionCount, list.items[0].lastRevisedOn], [7, "2026-09-16"]);

    // September: 15 days at 30,000 and 15 at 36,000 (Pallav pays the new rate from the effective date)
    await open("2026-09");
    await ok(await fill("2026-09", [{ employeeId: a, days: full(30) }]));
    await ok(await generate("2026-09"));
    const slips = await ok<{ items: SalaryRecord[] }>(await slipsRoute(req("GET", `${base}/slips?period=2026-09`, "slipsOnly"), ctx()));
    const slip = slips.items[0];
    assert.deepEqual([slip.attendanceSalaryPaise, slip.monthlySalaryPaise, slip.accountNumber, slip.ifscCode], [3_300_000, 3_600_000, "001234567890", "SBIN0001234"]);
    assert.deepEqual((await ok<SalaryRecord>(await slipRoute(req("GET", `${base}/slips/${slip.id}`, "slipsOnly"), ctx({ id: slip.id })))).id, slip.id);
    assert.equal((await paymentsRoute(req("GET", `${base}/payments`, "slipsOnly"), ctx())).status, 403);
  });
});

describe("reports (SalaryReportController) and the pickers", () => {
  test("a period inside one month and not past today; the monthly report opens on the latest processed month with totals", async () => {
    await september();
    let res = await periodRoute(req("GET", `${base}/reports/period?from=2026-09-10&to=2026-09-01`, "clerk"), ctx());
    assert.deepEqual(await fields(res), { from: "From Date must be on or before To Date." });
    res = await periodRoute(req("GET", `${base}/reports/period?from=2026-09-10&to=2026-10-01`, "clerk"), ctx());
    assert.deepEqual(await fields(res), { to: "The selected date range must belong to the same month and year." });
    const period = await ok<{ rows: SalaryRecord[] }>(await periodRoute(req("GET", `${base}/reports/period?from=2026-09-01&to=2026-09-15`, "clerk"), ctx()));
    assert.deepEqual(period.rows.map((r) => r.employeeName), ["Asha Patel", "Bimal Shah"]);
    const monthly = await ok<{ period: string; totals: { netPaise: number; payableDays: number; bonusPaise: number; advancePaise: number }; mealsBillPaise: null }>(await monthlyRoute(req("GET", `${base}/reports/monthly`, "clerk"), ctx()));
    assert.deepEqual([monthly.period, monthly.totals.netPaise, monthly.totals.payableDays, monthly.totals.bonusPaise, monthly.totals.advancePaise, monthly.mealsBillPaise], ["2026-09", 5_270_000, 59, 150_000, 200_000, null]);
    const refs = await ok<{ code: string; providesFood: boolean }[]>(await refsRoute(req("GET", "/api/v1/payroll/company-refs", "clerk")));
    assert.deepEqual(refs.map((r) => [r.code, r.providesFood]), [["HP01", false]]);
  });

  test("the payments list pages on request (the summary still counts the whole month); without a page every row, as before", async () => {
    await september();
    const all = await ok<PaymentMonth & { page?: unknown }>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09`, "clerk"), ctx()));
    assert.deepEqual([all.rows.length, all.page], [2, undefined]);
    const first = await ok<PaymentMonth & { page: { page: number; pageSize: number; total: number } }>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09&page=1&pageSize=10`, "clerk"), ctx()));
    assert.deepEqual([first.rows.length, first.page], [2, { page: 1, pageSize: 10, total: 2 }]);
    const beyond = await ok<PaymentMonth & { page: { total: number } }>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09&page=2&pageSize=10`, "clerk"), ctx()));
    assert.deepEqual([beyond.rows.length, beyond.page.total, beyond.summary.total, beyond.summary.netPaise], [0, 2, 2, all.summary.netPaise]);
    // the page sizes are the allowed set
    assert.equal((await paymentsRoute(req("GET", `${base}/payments?page=1&pageSize=7`, "clerk"), ctx())).status, 422);
    // filter, search and sort come before paging; page.total counts what the filter keeps, the summary still the whole month
    const sorted = await ok<PaymentMonth & { page: { total: number } }>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09&page=1&pageSize=10&sort=net&dir=desc`, "clerk"), ctx()));
    assert.deepEqual(sorted.rows.map((r) => r.employeeName), ["Asha Patel", "Bimal Shah"]);
    const up = await ok<PaymentMonth>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09&sort=net`, "clerk"), ctx()));
    assert.deepEqual(up.rows.map((r) => r.employeeName), ["Bimal Shah", "Asha Patel"]);
    const found = await ok<PaymentMonth & { page: { total: number } }>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09&page=1&pageSize=10&search=e-2`, "clerk"), ctx()));
    assert.deepEqual([found.rows.map((r) => r.employeeName), found.page.total, found.summary.total], [["Bimal Shah"], 1, 2]);
    const none = await ok<PaymentMonth & { page: { total: number } }>(await paymentsRoute(req("GET", `${base}/payments?period=2026-09&page=1&pageSize=10&status=Paid`, "clerk"), ctx()));
    assert.deepEqual([none.rows.length, none.page.total], [0, 0]);
    assert.equal((await paymentsRoute(req("GET", `${base}/payments?status=Done`, "clerk"), ctx())).status, 422);
    assert.equal((await paymentsRoute(req("GET", `${base}/payments?sort=salary`, "clerk"), ctx())).status, 422);
  });

  test("slips, advances and bonuses page like Payments: period, search, status and sort before paging; the summary never follows them", async () => {
    const { a } = await september();
    type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
    const statusZero = { Pending: 0, Processing: 0, "On Hold": 0, "Partially Paid": 0, Paid: 0, Failed: 0 };
    // slips: without the new parameters the old answer (page fields at the top) plus the summary
    type Slips = Paged<SalaryRecord> & { summary: Record<string, unknown> };
    const slips = async (qs = ""): Promise<Slips> => ok<Slips>(await slipsRoute(req("GET", `${base}/slips${qs}`, "clerk"), ctx()));
    const plain = await slips();
    const whole = { period: null, slips: 2, people: 2, netPaise: 5_270_000, paidPaise: 0, outstandingPaise: 5_270_000, byStatus: { ...statusZero, Pending: 2 }, latestPeriod: "2026-09", latestNetPaise: 5_270_000, periods: 1 };
    assert.deepEqual([plain.items.length, plain.total, plain.page, plain.pageSize, plain.summary], [2, 2, 1, 25, whole]);
    assert.deepEqual((await slips("?sort=net&dir=desc")).items.map((r) => r.employeeName), ["Asha Patel", "Bimal Shah"]);
    assert.deepEqual((await slips("?sort=net")).items.map((r) => r.employeeName), ["Bimal Shah", "Asha Patel"]);
    assert.deepEqual((await slips("?sort=employee&dir=desc&pageSize=10&page=1")).items.map((r) => r.employeeName), ["Bimal Shah", "Asha Patel"]);
    const found = await slips("?search=e-2");
    assert.deepEqual([found.items.map((r) => r.employeeName), found.total, found.summary.slips], [["Bimal Shah"], 1, 2]);
    const asha = plain.items.find((r) => r.employeeId === a)!;
    await ok(await paymentRoute(req("PATCH", `${base}/payments/${asha.id}`, "clerk", { status: "Paid", paidPaise: null, paidOn: "", reference: "", remarks: "" }), ctx({ id: asha.id })));
    const paid = await slips("?status=Paid&period=2026-09");
    assert.deepEqual([paid.items.map((r) => r.employeeName), paid.total, paid.summary], [["Asha Patel"], 1, { ...whole, period: "2026-09", paidPaise: 2_800_000, outstandingPaise: 2_470_000, byStatus: { ...statusZero, Pending: 1, Paid: 1 } }]);
    assert.deepEqual((await slips("?sort=status")).items.map((r) => r.employeeName), ["Bimal Shah", "Asha Patel"], "Pending before Paid, the natural order of a payment");
    assert.deepEqual((await slips("?sort=status&dir=desc")).items.map((r) => r.employeeName), ["Asha Patel", "Bimal Shah"]);
    const august = await slips("?period=2026-08");
    assert.deepEqual([august.items.length, august.total, august.summary.slips, august.summary.latestPeriod, august.summary.latestNetPaise, august.summary.periods], [0, 0, 0, null, 0, 0]);
    const beyond = await slips("?page=2&pageSize=10");
    assert.deepEqual([beyond.items.length, beyond.total, beyond.summary.slips], [0, 2, 2]);
    for (const bad of ["status=Done", "sort=salary", "dir=up", "pageSize=7", "period=2026-13"]) assert.equal((await slipsRoute(req("GET", `${base}/slips?${bad}`, "clerk"), ctx())).status, 422, bad);

    // advances: #1 (August, settled by September's run) and #2 (its carry-forward, dated 1 October)
    const advances = async (qs = ""): Promise<AdvanceList> => ok<AdvanceList>(await listAdvancesRoute(req("GET", `${base}/advances${qs}`, "admin"), ctx()));
    const everything = await advances();
    const figures = { issuedPaise: 500_000, recoveredPaise: 200_000, outstandingPaise: 300_000, open: 1 };
    assert.deepEqual([everything.page.items.map((x) => x.entryNo), everything.summary, everything.counts], [["2", "1"], figures, { all: 2, open: 1, settled: 1 }]);
    const open = await advances("?status=open&page=1&pageSize=10");
    assert.deepEqual([open.page.items.map((x) => x.entryNo), open.page.total, open.summary, open.counts], [["2"], 1, figures, everything.counts]);
    assert.deepEqual((await advances("?sort=entryNo")).page.items.map((x) => x.entryNo), ["1", "2"]);
    assert.deepEqual((await advances("?sort=amount&dir=desc")).page.items.map((x) => x.entryNo), ["1", "2"]);
    assert.deepEqual((await advances("?sort=outstanding")).page.items.map((x) => x.entryNo), ["1", "2"]);
    assert.deepEqual((await advances("?sort=recovered&dir=desc")).page.items.map((x) => x.entryNo), ["1", "2"], "recovered so far: #1 has 2,000.00, #2 none");
    assert.deepEqual((await advances("?sort=recovery")).page.items.length, 2, "recovery is a known sort id");
    const carry = await advances("?search=carry");
    assert.deepEqual([carry.page.items.map((x) => x.entryNo), carry.page.total, carry.summary, carry.counts], [["2"], 1, figures, everything.counts]);
    const aug = await advances("?period=2026-08");
    assert.deepEqual([aug.page.items.map((x) => x.entryNo), aug.summary, aug.counts], [["1"], { issuedPaise: 500_000, recoveredPaise: 200_000, outstandingPaise: 0, open: 0 }, { all: 1, open: 0, settled: 1 }]);
    const oct = await advances("?period=2026-10");
    assert.deepEqual([oct.page.items.map((x) => x.entryNo), oct.summary], [["2"], { issuedPaise: 0, recoveredPaise: 0, outstandingPaise: 300_000, open: 1 }]);
    for (const bad of ["status=Bonus", "sort=type", "period=26-10"]) assert.equal((await listAdvancesRoute(req("GET", `${base}/advances?${bad}`, "admin"), ctx())).status, 422, bad);

    // bonuses: B's September bonus and an October incentive for A
    await ok(await createBonusRoute(req("POST", `${base}/bonuses`, "clerk", { employeeId: a, date: "2026-10-05", type: "Incentive", amountPaise: 1_000, remarks: "Diwali rush" }), ctx()), 201);
    const bonuses = async (qs = ""): Promise<BonusList> => ok<BonusList>(await listBonusRoute(req("GET", `${base}/bonuses${qs}`, "admin"), ctx()));
    const both = await bonuses();
    assert.deepEqual([both.page.items.map((x) => x.type), both.summary, both.counts], [["Incentive", "Bonus"], { bonusPaise: 150_000, incentivePaise: 1_000, people: 2 }, { all: 2, Bonus: 1, Incentive: 1 }]);
    const inc = await bonuses("?status=Incentive");
    assert.deepEqual([inc.page.items.map((x) => x.employeeName), inc.page.total, inc.summary, inc.counts], [["Asha Patel"], 1, both.summary, both.counts]);
    assert.deepEqual((await bonuses("?sort=amount&dir=desc")).page.items.map((x) => x.amountPaise), [150_000, 1_000]);
    assert.deepEqual((await bonuses("?sort=employee")).page.items.map((x) => x.employeeName), ["Asha Patel", "Bimal Shah"]);
    const sept = await bonuses("?period=2026-09&search=navratri");
    assert.deepEqual([sept.page.items.map((x) => x.employeeName), sept.summary, sept.counts], [["Bimal Shah"], { bonusPaise: 150_000, incentivePaise: 0, people: 1 }, { all: 1, Bonus: 1, Incentive: 0 }]);
    const none = await bonuses("?search=diwali&status=Bonus");
    assert.deepEqual([none.page.items.length, none.page.total, none.summary], [0, 0, both.summary]);
    for (const bad of ["status=open", "sort=outstanding"]) assert.equal((await listBonusRoute(req("GET", `${base}/bonuses?${bad}`, "admin"), ctx())).status, 422, bad);
  });

  test("the pay screens' lean staff picker: name or code prefix, at most 50, four fields; the same payroll access as the full picker, others may not", async () => {
    const a = await employee("Asha Patel", "E-1", 3_000_000);
    await employee("Bimal Shah", "E-2", 2_400_000);
    const byName = await ok<unknown[]>(await staffLookupRoute(req("GET", `${base}/staff/lookup?q=as`, "clerk"), ctx()));
    assert.deepEqual(byName, [{ id: a, name: "Asha Patel", code: "E-1", designation: "Chef" }]);
    const byCode = await ok<{ code: string }[]>(await staffLookupRoute(req("GET", `${base}/staff/lookup?q=E-&limit=1`, "clerk"), ctx()));
    assert.deepEqual(byCode.map((x) => x.code), ["E-1"]);
    assert.equal((await staffLookupRoute(req("GET", `${base}/staff/lookup?limit=51`, "clerk"), ctx())).status, 422);
    assert.equal((await staffLookupRoute(req("GET", `${base}/staff/lookup`, "outsider"), ctx())).status, 403);
  });

  test("the full staff list (/staff): one read of the whole company in name order (no COUNT, capped at 5,000), active people unless activeOnly=false; an array as before", async () => {
    const a = await employee("Asha Patel", "E-1", 3_000_000);
    const b = await employee("Bimal Shah", "E-2", 2_400_000);
    hotel.store.dataFor(HOTEL_A).employees.find((e) => e.id === b)!.isActive = false;
    const active = await ok<{ id: string; name: string }[]>(await staffRoute(req("GET", `${base}/staff`, "clerk"), ctx()));
    assert.deepEqual(active.map((e) => e.id), [a]);
    const all = await ok<{ id: string; name: string }[]>(await staffRoute(req("GET", `${base}/staff?activeOnly=false`, "clerk"), ctx()));
    assert.deepEqual(all.map((e) => e.name), ["Asha Patel", "Bimal Shah"]);
    assert.equal((await staffRoute(req("GET", `${base}/staff`, "outsider"), ctx())).status, 403);
  });
});

describe("the payroll documents as PDFs (MJ #22)", () => {
  const magic = async (res: Response): Promise<string> => Buffer.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toString("latin1");

  test("slip, register and both reports open as inline application/pdf with the screen's permission; the figures are the DTO's", async () => {
    await september();
    const slips = await ok<{ items: SalaryRecord[] }>(await slipsRoute(req("GET", `${base}/slips?period=2026-09`, "clerk"), ctx()));
    const slip = slips.items.find((x) => x.employeeName === "Asha Patel")!;
    const calls: [string, Response][] = [
      ["slip", await slipPdfRoute(req("GET", `${base}/slips/${slip.id}/pdf`, "clerk"), ctx({ id: slip.id }))],
      ["register", await registerPdfRoute(req("GET", `${base}/payments/pdf?period=2026-09`, "clerk"), ctx())],
      ["monthly", await monthlyPdfRoute(req("GET", `${base}/reports/monthly/pdf?period=2026-09`, "clerk"), ctx())],
      ["period", await periodPdfRoute(req("GET", `${base}/reports/period/pdf?from=2026-09-01&to=2026-09-30`, "clerk"), ctx())],
    ];
    for (const [name, res] of calls) {
      assert.equal(res.status, 200, name);
      assert.deepEqual([res.headers.get("content-type"), res.headers.get("cache-control"), res.headers.get("content-disposition")?.startsWith("inline; filename=")], ["application/pdf", "no-store", true], name);
      assert.equal(await magic(res), "%PDF-", name);
    }
    const file = await getPayrollDocuments().slip(sessions.get("clerk")!, HP, slip.id);
    const text = (await createDocumentRenderer().render("payrollDoc", file)).text.join("\n");
    for (const must of ["Hotel Pallav", "Ring Road, Rajkot, Gujarat", "Salary Slip", "Pay period Sep 2026", "Asha Patel", "E-1", formatINR(slip.netPaise), formatINR(slip.attendanceSalaryPaise), "Net payable salary (A - B)"]) assert.ok(text.includes(must), `slip is missing: ${must}`);
    assert.equal(file.filename, "salary-slip-E-1-2026-09");
    const register = (await createDocumentRenderer().render("payrollDoc", await getPayrollDocuments().register(sessions.get("clerk")!, HP, "2026-09"))).text.join("\n");
    assert.ok(register.includes("Salary Payment Register") && register.includes("Bimal Shah (E-2)"));
  });

  test("the advance and bonus vouchers: the list's figures, the company's header, inline PDF; a missing one is 404, no permission 403", async () => {
    const { advanceId } = await september();
    const bonuses = await ok<{ page: { items: { id: string; amountPaise: number }[] } }>(await listBonusRoute(req("GET", `${base}/bonuses`, "clerk"), ctx()));
    const bonusId = bonuses.page.items[0].id;
    for (const [name, res] of [["advance", await advancePdfRoute(req("GET", `${base}/advances/${advanceId}/pdf`, "clerk"), ctx({ id: advanceId }))], ["bonus", await bonusPdfRoute(req("GET", `${base}/bonuses/${bonusId}/pdf`, "clerk"), ctx({ id: bonusId }))]] as const) {
      assert.equal(res.status, 200, name);
      assert.deepEqual([res.headers.get("content-type"), await magic(res)], ["application/pdf", "%PDF-"], name);
    }
    const voucher = (await createDocumentRenderer().render("payrollDoc", await getPayrollDocuments().advanceVoucher(sessions.get("clerk")!, HP, advanceId))).text.join("\n");
    for (const must of ["Hotel Pallav", "Advance Voucher", "Asha Patel", formatINR(500_000), "Advance amount", "Rupees Five Thousand Only"]) assert.ok(voucher.includes(must), `voucher is missing: ${must} in ${JSON.stringify(voucher)}`);
    assert.equal((await advancePdfRoute(req("GET", `${base}/advances/${id(999)}/pdf`, "clerk"), ctx({ id: id(999) }))).status, 404);
    assert.equal((await bonusPdfRoute(req("GET", `${base}/bonuses/${bonusId}/pdf`, "outsider"), ctx({ id: bonusId }))).status, 403);
  });

  test("a person without the slip permission gets 403 as JSON; a slip of another company or a missing one is 404; an invalid period is 422", async () => {
    await september();
    assert.equal((await slipPdfRoute(req("GET", `${base}/slips/${id(999)}/pdf`, "clerk"), ctx({ id: id(999) }))).status, 404);
    assert.equal((await slipPdfRoute(req("GET", `${base}/slips/${id(999)}/pdf`, null), ctx({ id: id(999) }))).status, 401);
    assert.equal((await registerPdfRoute(req("GET", `${base}/payments/pdf?period=nope`, "clerk"), ctx())).status, 422);
    const denied = await monthlyPdfRoute(req("GET", `${base}/reports/monthly/pdf`, "outsider"), ctx());
    assert.deepEqual([denied.status, denied.headers.get("content-type")?.startsWith("application/json")], [403, true]);
  });
});
