// Payroll pay, part b (B6b) end to end through the REAL route files, the wrapper, the services and ONE in-memory hotel store: staff meals (price,
// records, the live bill and the monthly report's meals bill), the joining and experience letters, and resignations with rejoin. Expected
// behaviour: docs/specs/payroll-pay.md §11-13 (each rule cites Pallav). The arithmetic is golden in payrollMeals.golden / payrollLetters.golden.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { MealPeriod, PayrollDoc, Separation, SeparationSummary } from "@shared/dashboards/payrollPay";
import type { MealsOverviewOut } from "../../src/server/services/payrollPay/mealsService";
import { POST as generateRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/generate/route";
import { GET as sheetRoute, PUT as saveRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/route";
import { POST as createStatusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance-statuses/route";
import { GET as dashboardRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/dashboard/route";
import { GET as joiningLetterRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/joining-letter/route";
import { GET as getEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/route";
import { POST as createEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/route";
import { GET as getLetterRoute, PUT as saveLetterRoute, DELETE as deleteLetterRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/letters/[kind]/route";
import { POST as toggleLetterRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/letters/[kind]/toggle/route";
import { DELETE as deleteMealPeriodRoute, PATCH as stopMealsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/meals/periods/[id]/route";
import { DELETE as deletePriceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/meals/prices/[id]/route";
import { POST as addPriceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/meals/prices/route";
import { GET as mealsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/meals/route";
import { POST as startMealsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/meals/staff/[employeeId]/route";
import { GET as monthlyRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/reports/monthly/route";
import { GET as experienceLetterRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/separations/[id]/experience-letter/route";
import { POST as rejoinRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/separations/[id]/rejoin/route";
import { POST as restoreSeparationRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/separations/[id]/restore/route";
import { DELETE as deleteSeparationRoute, PATCH as updateSeparationRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/separations/[id]/route";
import { GET as listSeparationsRoute, POST as createSeparationRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/separations/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildPayrollServices, configurePayroll } from "../../src/server/compose/payrollCore";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { PayrollCompanyRecord } from "../../src/server/repos/payrollCore";
import type { Person } from "../../src/server/services/cash/ports";
import { createPayFigures } from "../../src/server/services/payrollPay/paymentService";
import { createSalaryRun } from "../../src/server/services/payrollPay/salaryRun";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { clerk: id(1), other: id(2), admin: id(4), superAdmin: id(5) };
const people = new Map<string, Person>([
  [U.clerk, { id: U.clerk, name: "Chetan Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.other, { id: U.other, name: "Esha Editor", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("clerk", U.clerk, { roleKey: "editor", roleLevel: 2, grants: [grant("payroll", "full")] });
mk("other", U.other, { roleKey: "editor", roleLevel: 2, grants: [grant("payroll", "full")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("payroll", "full"), grant("users", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("payroll", "full"), grant("users", "full")] });
mk("viewer", id(6), { grants: [grant("payroll.food-charge", "view")] });
mk("nobody", id(7), {});


let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
const HP = id(101);
const PF = id(102);

function company(cid: string, code: string, name: string): PayrollCompanyRecord {
  const at = new Date("2026-01-01T00:00:00Z");
  return {
    id: cid, name, code, isActive: true, logoPath: null, signatureImagePath: null, updatedBy: null, createdAt: at, updatedAt: at, ownerName: null, mobileNumber: null, email: null,
    address: "Ring Road", city: "Rajkot", state: "Gujarat", pincode: null, panNumber: null, tanNumber: null, pfRegistrationNumber: null, esicRegistrationNumber: null,
    professionalTaxRegistrationNumber: null, authorizedPersonName: "Pallav Shah", authorizedDesignation: "Owner", authorizedMobile: null, authorizedEmail: null, bankName: null,
    accountNumber: null, ifscCode: null, branchName: null,
  };
}

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
  hotel.store.dataFor(HOTEL_A).payrollCompanies.push(company(HP, "HP01", "Hotel Pallav"), company(PF, "PF01", "Pallav Food"));
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}, cid = HP) => ({ params: Promise.resolve({ companyId: cid, ...params }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const fields = async (res: Response) => (await json(res)).error.details.fields;
const message = async (res: Response) => (await json(res)).error.message;
const data = () => hotel.store.dataFor(HOTEL_A);
const base = (cid = HP) => `/api/v1/payroll/companies/${cid}`;
const ok = async <T>(res: Response, status = 200): Promise<T> => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data as T;
};

async function employee(name: string, code: string, over: Record<string, unknown> = {}, cid = HP): Promise<string> {
  const body = {
    name, dateOfBirth: "", gender: "", contactNumber: "98765 43210", contactCountry: "91", email: `${code.toLowerCase()}@example.com`, address: "Rajkot", nationality: "", countryAndPincode: "",
    emergencyContactName: "", emergencyContactRelation: "", emergencyContactNumber: "", emergencyContactCountry: "91", employeeCode: code, designation: "Chef", department: "Kitchen",
    shift: "", joiningDate: "2026-01-01", dailyWorkingHours: 8, qualification: "", qualificationInstitution: "", skills: "", responsibilities: "Run the kitchen", salaryPaise: 3_000_000,
    paymentMode: "Cash", bankName: "", accountHolderName: "", ifscCode: "", branchName: "", deductions: [], idProofType: "", ...over,
  };
  return (await ok<{ employee: { id: string } }>(await createEmployeeRoute(req("POST", `${base(cid)}/employees`, "clerk", body), ctx({}, cid)), 201)).employee.id;
}
const price = (cid: string, monthlyPaise: number | null, effectiveFrom: string, who = "clerk") => addPriceRoute(req("POST", `${base(cid)}/meals/prices`, who, { monthlyPaise, effectiveFrom }), ctx({}, cid));
const start = (employeeId: string, startsOn: string, endsOn = "", who = "clerk", cid = HP) => startMealsRoute(req("POST", `${base(cid)}/meals/staff/${employeeId}`, who, { startsOn, endsOn }), ctx({ employeeId }, cid));
const stop = (periodId: string, endsOn: string, who = "clerk") => stopMealsRoute(req("PATCH", `${base()}/meals/periods/${periodId}`, who, { endsOn }), ctx({ id: periodId }));
const overview = async (period?: string, who = "clerk", cid = HP): Promise<MealsOverviewOut> => ok(await mealsRoute(req("GET", `${base(cid)}/meals${period ? `?period=${period}` : ""}`, who), ctx({}, cid)));
const sepInput = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, type: "Resignation", resignationDate: "2026-09-28", lastWorkingDate: "2026-10-27", reason: "Moving away", remarks: "", status: "Pending", ...over });
const separate = (employeeId: string, over: Record<string, unknown> = {}, who = "clerk") => createSeparationRoute(req("POST", `${base()}/separations`, who, sepInput(employeeId, over)), ctx());
const full = (n: number, key = "P"): string[] => Array.from({ length: n }, () => key);

/** September for the hotel: A (days 3 and 4 marked "off", which leaves meals out) and B fully present, salary generated on 5 October. */
async function september(): Promise<{ a: string; b: string }> {
  await ok(await createStatusRoute(req("POST", `${base()}/attendance-statuses`, "clerk", { name: "Present", shortcutKey: "P", color: "#22C55E", attendancePercentage: 100, statusType: "Paid" }), ctx()), 201);
  await ok(await createStatusRoute(req("POST", `${base()}/attendance-statuses`, "clerk", { name: "Off", shortcutKey: "O", color: "#EF4444", attendancePercentage: 100, statusType: "Paid", skipsFood: true }), ctx()), 201);
  const a = await employee("Asha Patel", "E-1");
  const b = await employee("Bimal Shah", "E-2");
  await sheetRoute(req("GET", `${base()}/attendance/2026-09`, "clerk"), ctx({ month: "2026-09" }));
  const daysA = full(30);
  daysA[2] = "O";
  daysA[3] = "O";
  await ok(await saveRoute(req("PUT", `${base()}/attendance/2026-09`, "clerk", { rows: [{ employeeId: a, days: daysA }, { employeeId: b, days: full(30) }] }), ctx({ month: "2026-09" })));
  return { a, b };
}
const generate = (month: string) => generateRoute(req("POST", `${base()}/attendance/${month}/generate`, "clerk"), ctx({ month }));

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("the meal price (FoodPriceController)", () => {
  test("only Pallav Food sets it; today or earlier; the same day is replaced; closed once any salary is generated", async () => {
    assert.equal((await price(HP, 300_000, "2026-09-01")).status, 404);
    let res = await price(PF, 300_000, "2026-10-06");
    assert.deepEqual(await fields(res), { effectiveFrom: "A price cannot start after today. Choose today or an earlier day in an open month." });
    res = await price(PF, null, "");
    assert.deepEqual(await fields(res), { monthlyPaise: "The monthly amount field is required.", effectiveFrom: "The effective from field is required." });
    const first = await ok<{ effectiveFrom: string; message: string }>(await price(PF, 300_000, "2026-09-01"));
    assert.equal(first.message, "The price is now Rs 3,000.00 per employee from 1 September 2026. The earlier price stays on record.");
    await ok(await price(PF, 310_000, "2026-09-01"));
    await ok(await price(PF, 350_000, "2026-09-15"));
    assert.equal(data().mealPrices.length, 2);
    const o = await overview("2026-09", "clerk", HP);
    assert.deepEqual(o.prices.map((p) => [p.effectiveFrom, p.monthlyPaise, p.previousPaise, p.inForce, p.locked]), [["2026-09-15", 350_000, 310_000, true, false], ["2026-09-01", 310_000, null, false, false]]);
    assert.deepEqual([o.canSetPrice, o.currentPricePaise, (await overview(undefined, "clerk", PF)).canSetPrice], [false, 350_000, true]);

    await september();
    await ok(await generate("2026-09"));
    res = await price(PF, 360_000, "2026-09-20");
    assert.deepEqual(await fields(res), { effectiveFrom: "Salary has already been generated for September 2026, so its meal price is closed. A new price can start from October 2026 onwards." });
    const closed = (await overview("2026-09", "clerk", HP)).prices.find((p) => p.effectiveFrom === "2026-09-15")!;
    assert.equal(closed.locked, true);
    res = await deletePriceRoute(req("DELETE", `${base(PF)}/meals/prices/${closed.id}`, "clerk"), ctx({ id: closed.id }, PF));
    assert.deepEqual([res.status, await message(res)], [409, "Salary has already been generated for September 2026, so its meal price is closed. A new price can start from October 2026 onwards."]);
    const open = await ok<{ effectiveFrom: string }>(await price(PF, 360_000, "2026-10-01"));
    const id2 = data().mealPrices.find((p) => p.effectiveFrom === open.effectiveFrom)!.id;
    const gone = await ok<{ id: string; message: string }>(await deletePriceRoute(req("DELETE", `${base(PF)}/meals/prices/${id2}`, "clerk"), ctx({ id: id2 }, PF)));
    assert.equal(gone.message, "That price was removed. Days it covered fall back to the price before it.");
    assert.equal((await price(PF, 1, "2026-10-01", "nobody")).status, 403);
  });
});

describe("meals records and the bill (FoodChargeController, FoodCharges)", () => {
  test("Pallav's words for start, overlap and stop; the live bill counts the days, each at that day's price, leaving out skipped days", async () => {
    const { a } = await september();
    await ok(await price(PF, 300_000, "2026-01-01"));
    let res = await start(a, "2025-12-31");
    assert.deepEqual(await fields(res), { startsOn: "Asha Patel joined on 1 January 2026, so meals cannot start before that." });
    assert.deepEqual(await fields(await start(a, "2026-10-06")), { startsOn: "Meals cannot start after today." });
    assert.deepEqual(await fields(await start(a, "2026-09-10", "2026-09-05")), { endsOn: "The end date cannot be before the start date." });
    const p1 = await ok<MealPeriod>(await start(a, "2026-09-01"), 201);
    assert.deepEqual([p1.startsOn, p1.endsOn, p1.createdBy], ["2026-09-01", null, "Chetan Clerk"]);
    res = await start(a, "2026-09-10");
    assert.deepEqual(await fields(res), { startsOn: "Asha Patel already has meals recorded for 01 Sep 2026 - ongoing. Stop that first, or start after it." });
    res = await stop(p1.id, "2026-09-31");
    assert.equal(res.status, 422);
    const stopped = await ok<MealPeriod>(await stop(p1.id, "2026-09-20"));
    assert.equal(stopped.endsOn, "2026-09-20");
    await ok(await start(a, "2026-09-25"), 201);

    // 1-20 and 25-30 = 26 days, less days 3 and 4 marked "off" = 24 days of 30 at Rs 3,000
    let o = await overview("2026-09");
    assert.deepEqual(o.bill, [{ employeeId: a, employeeName: "Asha Patel", designation: "Chef", days: 24, amountPaise: 240_000 }]);
    assert.deepEqual([o.billTotalPaise, o.billFinal, o.staff.find((s) => s.employee.id === a)?.onMealsToday], [240_000, false, true]);
    assert.deepEqual(o.staff.map((s) => [s.employee.name, s.periods.length]), [["Asha Patel", 2], ["Bimal Shah", 0]]);
    // a price change mid-month: each day at the price in force that day (days 21+ at Rs 3,500)
    await ok(await price(PF, 350_000, "2026-09-21"));
    o = await overview("2026-09");
    // 18 days (1-20 less the two off days) at Rs 100 a day, then 6 days (25-30) at Rs 3,500 / 30 = Rs 116.67: Rs 2,500.00
    assert.equal(o.billTotalPaise, 250_000);
    // the running month counts to today: A's ongoing record covers 1-5 October at the price then in force (Rs 3,500 over 31 days)
    assert.deepEqual((await overview("2026-10")).bill.map((r) => [r.employeeName, r.days, r.amountPaise]), [["Asha Patel", 5, 56_452]]);

    // no bill in the monthly report until the salary is generated; then it is final and Hotel Pallav owes it
    await ok(await generate("2026-09"));
    const report = await ok<{ mealsBillPaise: number | null }>(await monthlyRoute(req("GET", `${base()}/reports/monthly`, "clerk"), ctx()));
    assert.equal(report.mealsBillPaise, (await overview("2026-09")).billTotalPaise);
    assert.equal((await overview("2026-09")).billFinal, true);

    // the month is closed: nothing can change from its days on
    res = await start(a, "2026-09-27", "", "clerk");
    assert.equal(res.status, 422);
    const b = data().employees.find((e) => e.name === "Bimal Shah")!.id;
    res = await start(b, "2026-09-28");
    assert.deepEqual(await fields(res), { startsOn: "Salary has already been generated for September 2026, so its meals bill is closed. Changes can start from October 2026 onwards." });
    res = await stop(stopped.id, "2026-09-22");
    assert.equal((await fields(res)).endsOn, "Salary has already been generated for September 2026, so its meals bill is closed. Changes can start from October 2026 onwards.");
    res = await deleteMealPeriodRoute(req("DELETE", `${base()}/meals/periods/${stopped.id}`, "clerk"), ctx({ id: stopped.id }));
    assert.deepEqual([res.status, await message(res)], [409, "Salary has already been generated for September 2026, so its meals bill is closed. Changes can start from October 2026 onwards. To stop meals from a later day instead, end the record rather than removing it."]);
    // October is open: a record can start, end and be removed
    const oct = await ok<MealPeriod>(await start(b, "2026-10-02"), 201);
    assert.equal((await ok<{ message: string }>(await deleteMealPeriodRoute(req("DELETE", `${base()}/meals/periods/${oct.id}`, "clerk"), ctx({ id: oct.id })))).message, "The meals record for Bimal Shah was removed.");
    // a relieved person stops being charged after their last day (an open record), a dated one is honoured
    assert.equal((await mealsRoute(req("GET", `${base()}/meals`, "nobody"), ctx())).status, 403);
    assert.equal((await mealsRoute(req("GET", `${base()}/meals`, "viewer"), ctx())).status, 200);
  });

  test("a relieved person's open record stops at their last working day; their meals are still billed after leaving", async () => {
    const { a, b } = await september();
    await ok(await price(PF, 300_000, "2026-01-01"));
    await ok(await start(a, "2026-09-01"), 201);
    await ok(await start(b, "2026-09-01", "2026-09-30"), 201);
    await ok(await createSeparationRoute(req("POST", `${base()}/separations`, "clerk", sepInput(a, { resignationDate: "2026-09-01", lastWorkingDate: "2026-09-12", status: "Relieved" })), ctx()), 201);
    const o = await overview("2026-09");
    // A: days 1-12 less days 3 and 4 = 10 days; B: a dated record is honoured in full (30 days)
    assert.deepEqual(o.bill.map((r) => [r.employeeName, r.days, r.amountPaise]), [["Asha Patel", 10, 100_000], ["Bimal Shah", 30, 300_000]]);
    // the person is inactive now but still listed (active first, then by name)
    assert.deepEqual(o.staff.map((s) => [s.employee.name, s.employee.isActive]), [["Bimal Shah", true], ["Asha Patel", false]]);
  });
});

describe("the letters (JoiningLetterController, ExperienceLetterController)", () => {
  test("one template per company: save, read with the company's signatory, switch, generate with the placeholders replaced, delete", async () => {
    const a = await employee("Asha Patel", "E-1");
    assert.equal(await ok(await getLetterRoute(req("GET", `${base()}/letters/joining`, "clerk"), ctx({ kind: "joining" }))), null);
    assert.equal((await joiningLetterRoute(req("GET", `${base()}/employees/${a}/joining-letter`, "clerk"), ctx({ id: a }))).status, 404);
    assert.equal(await message(await joiningLetterRoute(req("GET", `${base()}/employees/${a}/joining-letter`, "clerk"), ctx({ id: a }))), "No joining letter template configured for this company.");
    const body = {
      subject: "Appointment as {DESIGNATION}",
      sections: [
        { id: "introduction", label: "Introduction", text: "Dear {EMPLOYEE_NAME},\nWelcome to the {DEPARTMENT} team from {JOINING_DATE}." },
        { id: "responsibilities", label: "Roles", text: "{RESPONSIBILITIES}" },
        { id: "terms", label: "Terms", text: "Salary is paid monthly." },
        { id: "closing", label: "Closing", text: "Best wishes." },
        { id: "acceptance", label: "Acceptance", text: "I, {EMPLOYEE_NAME}, accept." },
      ],
      signatoryName: "",
      signatoryDesignation: "",
    };
    assert.deepEqual(await fields(await saveLetterRoute(req("PUT", `${base()}/letters/joining`, "clerk", { ...body, subject: "x".repeat(256) }), ctx({ kind: "joining" }))), { subject: "The subject field must not be greater than 255 characters." });
    const saved = await ok<{ subject: string; signatoryName: string; signatoryDesignation: string; isActive: boolean; sections: { id: string; text: string }[] }>(await saveLetterRoute(req("PUT", `${base()}/letters/joining`, "clerk", body), ctx({ kind: "joining" })));
    assert.deepEqual([saved.signatoryName, saved.signatoryDesignation, saved.isActive, saved.sections.map((s) => s.id)], ["Pallav Shah", "Owner", true, ["introduction", "responsibilities", "terms", "closing", "acceptance"]]);
    // the company's template of the OTHER company is not touched
    assert.equal(await ok(await getLetterRoute(req("GET", `${base(PF)}/letters/joining`, "clerk"), ctx({ kind: "joining" }, PF))), null);

    const doc = await ok<PayrollDoc>(await joiningLetterRoute(req("GET", `${base()}/employees/${a}/joining-letter`, "clerk"), ctx({ id: a })));
    assert.deepEqual([doc.title, doc.companyName], ["Joining Letter", "Hotel Pallav"]);
    const texts = doc.blocks.flatMap((b) => (b.kind === "para" || b.kind === "heading" ? [b.text] : []));
    assert.deepEqual(texts.slice(0, 4), ["Appointment as Chef", "Dear Asha Patel,", "Welcome to the Kitchen team from 01-01-2026.", "Run the kitchen"]);
    assert.ok(texts.includes("I, Asha Patel, accept."));
    assert.ok(doc.blocks.some((b) => b.kind === "signatures" && b.items[0].role === "Owner · Hotel Pallav"));

    const off = await ok<{ isActive: boolean }>(await toggleLetterRoute(req("POST", `${base()}/letters/joining/toggle`, "clerk"), ctx({ kind: "joining" })));
    assert.equal(off.isActive, false);
    assert.equal((await saveLetterRoute(req("PUT", `${base()}/letters/joining`, "nobody", body), ctx({ kind: "joining" }))).status, 403);
    assert.equal((await deleteLetterRoute(req("DELETE", `${base()}/letters/joining`, "clerk"), ctx({ kind: "joining" }))).status, 200);
    assert.equal(await ok(await getLetterRoute(req("GET", `${base()}/letters/joining`, "clerk"), ctx({ kind: "joining" }))), null);
    assert.equal((await deleteLetterRoute(req("DELETE", `${base()}/letters/joining`, "clerk"), ctx({ kind: "joining" }))).status, 404);
  });

  test("the experience letter needs the template and a person who has left, with the service worded as Carbon does", async () => {
    const a = await employee("Asha Patel", "E-1");
    const body = { subject: "Experience certificate", sections: [{ id: "body", label: "Body", text: "{EMPLOYEE_NAME} served as {DESIGNATION} for {DURATION} until {LAST_WORKING_DATE}." }], signatoryName: "Meera Iyer", signatoryDesignation: "HR" };
    const s = await ok<Separation>(await separate(a, { lastWorkingDate: "2026-09-30" }), 201);
    let res = await experienceLetterRoute(req("GET", `${base()}/separations/${s.id}/experience-letter`, "clerk"), ctx({ id: s.id }));
    assert.deepEqual([res.status, await message(res)], [404, "No experience letter template configured for this company."]);
    await ok(await saveLetterRoute(req("PUT", `${base()}/letters/experience`, "clerk", body), ctx({ kind: "experience" })));
    res = await experienceLetterRoute(req("GET", `${base()}/separations/${s.id}/experience-letter`, "clerk"), ctx({ id: s.id }));
    assert.deepEqual([res.status, await message(res)], [409, "An experience letter can only be issued once the employee is marked Relieved."]);
    await ok(await updateSeparationRoute(req("PATCH", `${base()}/separations/${s.id}`, "clerk", sepInput(a, { lastWorkingDate: "2026-09-30", status: "Relieved" })), ctx({ id: s.id })));
    const doc = await ok<PayrollDoc>(await experienceLetterRoute(req("GET", `${base()}/separations/${s.id}/experience-letter`, "clerk"), ctx({ id: s.id })));
    assert.equal(doc.title, "Experience Letter");
    // 1 Jan to 30 Sep 2026: 8 months and 29 days = 8 months 4 weeks
    assert.ok(doc.blocks.some((b) => b.kind === "para" && b.text === "Asha Patel served as Chef for 8 months 4 weeks until 30 Sep 2026."));
    assert.ok(doc.blocks.some((b) => b.kind === "kv" && b.items.some((i) => i.label === "Total service" && i.value === "8 months 4 weeks")));
  });
});

describe("resignations (SeparationController)", () => {
  test("Pallav's words; one open record per person; Relieved takes the person out of payroll; the status follows edits; who may edit and delete", async () => {
    const a = await employee("Asha Patel", "E-1");
    let res = await createSeparationRoute(req("POST", `${base()}/separations`, "clerk", sepInput(a, { type: "Quit", lastWorkingDate: "2026-09-01", reason: "", status: "Gone" })), ctx());
    assert.deepEqual(await fields(res), { type: "The selected separation type is invalid.", lastWorkingDate: "The last working day cannot be before the resignation date.", reason: "The reason field is required.", status: "The selected status is invalid." });
    const s = await ok<Separation & { canEdit: boolean; canDelete: boolean }>(await separate(a), 201);
    assert.deepEqual([s.entryNo, s.status, s.createdBy, s.canEdit, s.canDelete, s.documentName], ["1", "Pending", "Chetan Clerk", true, false, null]);
    res = await separate(a);
    assert.deepEqual([res.status, await message(res)], [409, "This employee already has an open separation record."]);
    assert.equal((await ok<{ isActive: boolean }>(await getEmployeeRoute(req("GET", `${base()}/employees/${a}`, "clerk"), ctx({ id: a })))).isActive, true);

    // edit: whoever recorded it or an Admin; the record never moves to another person
    res = await updateSeparationRoute(req("PATCH", `${base()}/separations/${s.id}`, "other", sepInput(a, { status: "Accepted" })), ctx({ id: s.id }));
    assert.deepEqual([res.status, await message(res)], [403, "Only an Admin or whoever recorded this separation can edit it."]);
    await ok(await updateSeparationRoute(req("PATCH", `${base()}/separations/${s.id}`, "admin", sepInput(a, { status: "Relieved" })), ctx({ id: s.id })));
    assert.equal((await ok<{ isActive: boolean }>(await getEmployeeRoute(req("GET", `${base()}/employees/${a}`, "clerk"), ctx({ id: a })))).isActive, false);
    await ok(await updateSeparationRoute(req("PATCH", `${base()}/separations/${s.id}`, "clerk", sepInput(a, { status: "Accepted" })), ctx({ id: s.id })));
    assert.equal((await ok<{ isActive: boolean }>(await getEmployeeRoute(req("GET", `${base()}/employees/${a}`, "clerk"), ctx({ id: a })))).isActive, true);

    // the lists: tab narrows the page, the figures cover every record
    const b = await employee("Bimal Shah", "E-2");
    await ok(await separate(b, { status: "Relieved", lastWorkingDate: "2026-08-31", resignationDate: "2026-08-01" }, "other"), 201);
    const list = await ok<{ page: { items: (Separation & { canEdit: boolean })[]; total: number }; summary: SeparationSummary }>(await listSeparationsRoute(req("GET", `${base()}/separations?tab=relieved`, "admin"), ctx()));
    assert.deepEqual([list.page.items.map((x) => x.employeeName), list.summary], [["Bimal Shah"], { inNotice: 1, relieved: 1, rejoined: 0, all: 2, byStatus: { Pending: 0, Accepted: 1, Relieved: 1 } }]);
    // the paging contract (BACKEND.md §7.6): period by last working day, status and sort before paging; the summary never follows them
    type SepList = { page: { items: Separation[]; total: number; page: number; pageSize: number }; summary: SeparationSummary & { byStatus: Record<string, number> } };
    const sepList = async (qs: string): Promise<SepList> => ok<SepList>(await listSeparationsRoute(req("GET", `${base()}/separations?${qs}`, "admin"), ctx()));
    const october = await sepList("period=2026-10");
    assert.deepEqual([october.page.items.map((x) => x.employeeName), october.page.total, october.summary], [["Asha Patel"], 1, { inNotice: 1, relieved: 0, rejoined: 0, all: 1, byStatus: { Pending: 0, Accepted: 1, Relieved: 0 } }]);
    const relievedOnly = await sepList("status=Relieved&page=1&pageSize=10");
    assert.deepEqual([relievedOnly.page.items.map((x) => x.employeeName), relievedOnly.page.total, relievedOnly.summary.all], [["Bimal Shah"], 1, 2]);
    assert.deepEqual((await sepList("sort=employee&dir=desc")).page.items.map((x) => x.employeeName), ["Bimal Shah", "Asha Patel"]);
    assert.deepEqual((await sepList("sort=lastWorkingDate")).page.items.map((x) => x.employeeName), ["Bimal Shah", "Asha Patel"]);
    const searched = await sepList("search=bimal");
    assert.deepEqual([searched.page.items.map((x) => x.employeeName), searched.page.total, searched.summary.all], [["Bimal Shah"], 1, 2]);
    const beyond = await sepList("page=2&pageSize=10");
    assert.deepEqual([beyond.page.items.length, beyond.page.total], [0, 2]);
    for (const bad of ["status=Gone", "sort=salary", "period=2026-13", "pageSize=7", "dir=up"]) assert.equal((await listSeparationsRoute(req("GET", `${base()}/separations?${bad}`, "admin"), ctx())).status, 422, bad);
    const all = await ok<{ page: { items: Separation[] } }>(await listSeparationsRoute(req("GET", `${base()}/separations`, "admin"), ctx()));
    assert.deepEqual(all.page.items.map((x) => x.entryNo), ["1", "2"].reverse().sort((x, y) => (all.page.items.find((i) => i.entryNo === x)!.lastWorkingDate < all.page.items.find((i) => i.entryNo === y)!.lastWorkingDate ? 1 : -1)));
    // the dashboard: a person on notice, and the leavers in the recent feed
    const d = await ok<{ attention: { text: string }[]; recent: { title: string; detail: string }[] }>(await dashboardRoute(req("GET", `${base()}/dashboard`, "clerk"), ctx()));
    assert.ok(d.attention.some((x) => x.text === "1 person is working their notice period."));
    assert.deepEqual(d.recent.map((r) => [r.title, r.detail]), [["Asha Patel", "Resignation - Accepted"], ["Bimal Shah", "Resignation - Relieved"]]);

    // delete: Admins only; the person goes back into active payroll; the recycle bin
    res = await deleteSeparationRoute(req("DELETE", `${base()}/separations/${(all.page.items.find((x) => x.employeeName === "Bimal Shah")!).id}`, "clerk"), ctx({ id: all.page.items.find((x) => x.employeeName === "Bimal Shah")!.id }));
    assert.deepEqual([res.status, await message(res)], [403, "Only Admin users can delete a separation record."]);
    const bs = all.page.items.find((x) => x.employeeName === "Bimal Shah")!;
    const gone = await ok<{ message: string }>(await deleteSeparationRoute(req("DELETE", `${base()}/separations/${bs.id}`, "admin"), ctx({ id: bs.id })));
    assert.equal(gone.message, "Separation record removed and the employee reactivated.");
    assert.equal((await ok<{ isActive: boolean }>(await getEmployeeRoute(req("GET", `${base()}/employees/${b}`, "clerk"), ctx({ id: b })))).isActive, true);
    assert.equal((await restoreSeparationRoute(req("POST", `${base()}/separations/${bs.id}/restore`, "admin"), ctx({ id: bs.id }))).status, 403);
    await ok(await restoreSeparationRoute(req("POST", `${base()}/separations/${bs.id}/restore`, "super"), ctx({ id: bs.id })));
    assert.equal((await ok<{ isActive: boolean }>(await getEmployeeRoute(req("GET", `${base()}/employees/${b}`, "clerk"), ctx({ id: b })))).isActive, false);
  });

  test("rejoin: the person is back on with new terms and their history intact; Pallav's phone and bank rules", async () => {
    const a = await employee("Asha Patel", "E-1");
    const s = await ok<Separation>(await separate(a, { status: "Relieved", lastWorkingDate: "2026-09-30" }), 201);
    const input = { joiningDate: "2026-10-01", designation: "Sous chef", department: "Kitchen", salaryPaise: 3_300_000, dailyWorkingHours: "9", phone: "+971 50 123 4567", paymentMode: "Bank", bankName: "SBI", accountHolderName: "Asha", accountNumber: "001234567890", ifscCode: "SBIN0001234" };
    const res = await rejoinRoute(req("POST", `${base()}/separations/${s.id}/rejoin`, "clerk", { ...input, phone: "123", bankName: "", ifscCode: "", accountNumber: "" }), ctx({ id: s.id }));
    assert.deepEqual(await fields(res), {
      phone: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.",
      bankName: "Bank name is required when the payment mode is Bank.",
      accountNumber: "Account number is required when the payment mode is Bank.",
      ifscCode: "IFSC code is required when the payment mode is Bank.",
    });
    const back = await ok<Separation>(await rejoinRoute(req("POST", `${base()}/separations/${s.id}/rejoin`, "clerk", input), ctx({ id: s.id })));
    assert.equal(back.rejoinedOn, "2026-10-01");
    const e = await ok<{ isActive: boolean; designation: string; joiningDate: string; salaryPaise: number; contactCountry: string; contactNumber: string; accountNumber: string; employeeCode: string }>(await getEmployeeRoute(req("GET", `${base()}/employees/${a}`, "clerk"), ctx({ id: a })));
    assert.deepEqual([e.isActive, e.designation, e.joiningDate, e.salaryPaise, e.contactCountry, e.contactNumber, e.accountNumber, e.employeeCode], [true, "Sous chef", "2026-10-01", 3_300_000, "971", "501234567", "001234567890", "E-1"]);
    // rejoined records no longer count as in notice or relieved, and a new open record can be made
    const list = await ok<{ summary: SeparationSummary }>(await listSeparationsRoute(req("GET", `${base()}/separations?tab=rejoined`, "clerk"), ctx()));
    assert.deepEqual(list.summary, { inNotice: 0, relieved: 0, rejoined: 1, all: 1, byStatus: { Pending: 0, Accepted: 0, Relieved: 1 } });
    await ok(await separate(a, { resignationDate: "2026-10-04", lastWorkingDate: "2026-11-04" }), 201);
  });
});
