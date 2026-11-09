// The recycle bin's cash and payroll kinds (compose/recycle.ts), over the REAL cash entry engine and payroll services: Pallav's keys and labels
// (Support/RecycleBin.php), the entry number as the title, restore and removal by the module's own service (its SuperAdmin rule, its log line), and
// the nightly clean-up as the system. Plus the cash receipt PDFs (deposit and expense) and the dev mail log.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import type { DepositInput, ExpenseInput } from "@shared/dashboards/cash";
import { GET as depositPdfRoute } from "../../src/app/api/v1/revenue/deposits/[id]/pdf/route";
import { GET as expensePdfRoute } from "../../src/app/api/v1/expense/entries/[id]/pdf/route";
import { DELETE as deleteAdvanceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/[id]/route";
import { POST as createAdvanceRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/advances/route";
import { DELETE as deleteEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/route";
import { POST as createEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/route";
import { DELETE as deleteMealPeriodRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/meals/periods/[id]/route";
import { POST as startMealsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/meals/staff/[employeeId]/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices } from "../../src/server/compose/admin";
import { configureCashExpenses, configureCashRevenue } from "../../src/server/compose/cash";
import { configureCashReceipts } from "../../src/server/compose/cashReceipts";
import { devMailLogPath, logMailSender } from "../../src/server/compose/mail";
import { buildPayrollServices, configurePayroll, getPayrollAdjustments, getPayrollEmployees, getPayrollMeals, getPayrollSeparations } from "../../src/server/compose/payrollCore";
import { cashRecycleSources, payrollRecycleSources } from "../../src/server/compose/recycle";
import { configureDocumentRenderer, createDocumentRenderer } from "../../src/server/documents";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import { createMemoryAdminUsers } from "../../src/server/repos/memory/adminUsers";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryCash } from "../../src/server/repos/memory/cashDeposit";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { PayrollCompanyRecord } from "../../src/server/repos/payrollCore";
import { createExpenseService } from "../../src/server/services/cash/expenseService";
import type { Person } from "../../src/server/services/cash/ports";
import { createCashReceiptService } from "../../src/server/services/cash/receiptService";
import { createRevenueService } from "../../src/server/services/cash/revenueService";
import { createPayFigures } from "../../src/server/services/payrollPay/paymentService";
import { createSalaryRun } from "../../src/server/services/payrollPay/salaryRun";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SUPER = id(5);
const people = new Map<string, Person>([[SUPER, { id: SUPER, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const directory = { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) };
const sessions = new Map<string, VerifiedSession>([
  ["super", makeSession({ userId: SUPER, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("revenue", "full"), grant("expense", "full"), grant("payroll", "full"), grant("users", "full")] })],
  ["admin", makeSession({ userId: id(4), accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("revenue", "full"), grant("expense", "full"), grant("payroll", "full")] })],
  ["viewer", makeSession({ userId: id(6), grants: [grant("revenue", "view")] })],
  ["superB", makeSession({ userId: SUPER, hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("revenue", "full"), grant("expense", "full")] })],
]);
const S = (name: string): VerifiedSession => sessions.get(name) as VerifiedSession;
const meta = { ip: null, userAgent: null, traceId: "t" } as never;
const DAY = 86_400_000;

let clock = new Date();
let cash = createMemoryCash();
let hotel = createMemoryHotel();
let revenue: ReturnType<typeof createRevenueService>;
let expenses: ReturnType<typeof createExpenseService>;
const HP = id(101);

const ORIGIN = "https://hms.test";
function req(method: string, p: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const json = async (res: Response) => (await res.json()) as any;

function bin(sources: Parameters<typeof buildAdminServices>[4]) {
  const deps = { unit: hotel.unit, people: directory, audit: { record: async () => undefined }, catalog, now: () => clock };
  return buildAdminServices(deps as never, createMemoryAdminPlatform().unit, { unit: createMemoryAdminUsers(createMemoryAuth()).unit, credentials: {} as never }, undefined, sources).recycle;
}

beforeEach(() => {
  // the in-memory repositories stamp a deletion with the real time, so the clock starts there
  clock = new Date();
  cash = createMemoryCash();
  hotel = createMemoryHotel();
  for (const h of [HOTEL_A, HOTEL_B]) {
    const data = cash.store.dataFor(h);
    data.lists = { revenue_depositor_hotel: ["Front desk"], revenue_depositor_food: ["Chef"], cash_person_hotel: ["Ramesh (Kitchen)"], cash_person_food: ["Hitesh"] };
    data.years = [{ id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }];
  }
  const deps = { unit: cash.unit, people: directory, audit: { record: async () => undefined }, catalog, now: () => clock };
  revenue = createRevenueService(deps);
  expenses = createExpenseService(deps);
  configureCashRevenue(revenue);
  configureCashExpenses(expenses);
  configureCashReceipts(createCashReceiptService({ revenue: () => revenue, expenses: () => expenses, header: async () => ({ name: "Hotel Sunrise", foodName: "Sunrise Food" }) }));
  configureDocumentRenderer(createDocumentRenderer({ timeoutMs: 60_000 }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

const deposit = (over: Partial<DepositInput> = {}): DepositInput => ({ book: "hotel", depositor: "Front desk", amountPaise: 150000, instruction: "", stamp: null, ...over }) as DepositInput;
const withdrawal = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({ kind: "withdrawal", book: "food", withdrawer: "Hitesh", employeeId: "", yearMonth: "", amountPaise: 120000, lines: [], instruction: "", stamp: null, ...over }) as ExpenseInput;

describe("the recycle bin's six cash kinds", () => {
  test("a deleted deposit and withdrawal are listed under Pallav's keys and labels, titled by entry number", async () => {
    const d = await revenue.create(S("super"), deposit(), meta);
    const w = await expenses.create(S("super"), withdrawal(), meta);
    await revenue.remove(S("super"), d.id, d.version, meta);
    await expenses.remove(S("super"), w.id, w.version as number, meta);
    const recycle = bin(cashRecycleSources({ unit: cash.unit, revenue: () => revenue, expenses: () => expenses }));
    const page = await recycle.list(S("super"), { page: 1, pageSize: 25 });
    assert.deepEqual(page.items.map((i) => [i.key, i.kind, i.label]).sort(), [["food-withdrawal", "Food cash withdrawal", "0001"], ["hotel-deposit", "Hotel cash deposit", "0001"]]);
    const dep = page.items.find((i) => i.key === "hotel-deposit");
    assert.match(dep?.detail ?? "", /^Front desk · .*1,500.* on /);
    assert.equal(dep?.deletedBy, "Sonal Super");
    await assert.rejects(recycle.list(S("admin"), { page: 1, pageSize: 25 }), /FORBIDDEN|SuperAdmin/);
    // another hotel's bin is its own
    assert.equal((await recycle.list(S("superB"), { page: 1, pageSize: 25 })).total, 0);
  });

  test("restore goes through the cash engine (its recycle-bin log line); remove for good; the clean-up purges as the system", async () => {
    const d = await revenue.create(S("super"), deposit(), meta);
    const w = await expenses.create(S("super"), withdrawal(), meta);
    await revenue.remove(S("super"), d.id, d.version, meta);
    await expenses.remove(S("super"), w.id, w.version as number, meta);
    const recycle = bin(cashRecycleSources({ unit: cash.unit, revenue: () => revenue, expenses: () => expenses }));
    assert.equal((await recycle.restore(S("super"), "hotel-deposit", d.id, meta)).message, "Hotel cash deposit 0001 restored.");
    assert.equal((await revenue.get(S("super"), d.id)).id, d.id);
    assert.equal(cash.store.dataFor(HOTEL_A).systemLogs.filter((l) => l.module === "recycle-bin").length, 1);
    await assert.rejects(recycle.restore(S("super"), "food-deposit", w.id, meta), /NOT_FOUND|not in the recycle bin/);
    const w2 = await expenses.create(S("super"), withdrawal({ book: "hotel", withdrawer: "Ramesh (Kitchen)" }), meta);
    await expenses.remove(S("super"), w2.id, w2.version as number, meta);
    assert.equal((await recycle.purge(S("super"), "hotel-withdrawal", w2.id, meta)).message, "Hotel cash withdrawal 0001 removed for good.");
    clock = new Date(clock.getTime() + 31 * DAY);
    assert.equal(await recycle.purgeExpired(HOTEL_A), 1);
    assert.equal((await recycle.list(S("super"), { page: 1, pageSize: 25 })).total, 0);
  });
});

describe("cash receipt PDFs", () => {
  test("a deposit's revenue receipt and a withdrawal's receipt are real PDFs with the same data as the preview; same permission as the screen", async () => {
    const d = await revenue.create(S("super"), deposit({ depositor: "Front desk" }), meta);
    const w = await expenses.create(S("super"), withdrawal(), meta);
    let res = await depositPdfRoute(req("GET", `/api/v1/revenue/deposits/${d.id}/pdf`, "viewer"), ctx({ id: d.id }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    res = await expensePdfRoute(req("GET", `/api/v1/expense/entries/${w.id}/pdf`, "super"), ctx({ id: w.id }));
    assert.equal(res.status, 200);
    assert.equal((await expensePdfRoute(req("GET", `/api/v1/expense/entries/${w.id}/pdf`, "viewer"), ctx({ id: w.id }))).status, 403);
    assert.equal((await depositPdfRoute(req("GET", `/api/v1/revenue/deposits/${d.id}/pdf`, "superB"), ctx({ id: d.id }))).status, 404);
    assert.equal((await depositPdfRoute(req("GET", "/api/v1/revenue/deposits/x/pdf", "super"), ctx({ id: "x" }))).status, 422);
  });

  test("the receipt names the book's business and draws the shared preview's rows", async () => {
    const receipts = createCashReceiptService({ revenue: () => revenue, expenses: () => expenses, header: async () => ({ name: "Hotel Sunrise", foodName: "Sunrise Food" }) });
    const w = await expenses.create(S("super"), withdrawal(), meta);
    const r = await receipts.expense(S("super"), w.id);
    assert.deepEqual([r.hotelName, r.title, r.kind, r.number, r.totalPaise], ["Sunrise Food", "Food Expense Receipt", "Cash withdrawal", "0001", 120000]);
    const doc = await createDocumentRenderer({ timeoutMs: 60_000 }).render("cashReceipt", r);
    assert.ok(doc.text.some((t) => t.includes("Hitesh")));
  });
});

describe("the recycle bin's payroll kinds", () => {
  const base = `/api/v1/payroll/companies/${HP}`;
  const pctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve({ companyId: HP, ...params }) });
  // a payroll-log line that cannot be written (when set): the unit throws and the in-memory store rolls it back, as the transaction does
  let failPayrollLog = false;
  function wirePayroll(): void {
    const now = () => clock;
    failPayrollLog = false;
    const unit = {
      run: (session: Parameters<typeof hotel.unit.run>[0], work: (repos: never) => Promise<unknown>) =>
        hotel.unit.run(session, (repos) =>
          work({
            ...repos,
            payrollLog: {
              record: async (entry: never) => {
                if (failPayrollLog) throw new Error("the log could not be written");
                await (repos as unknown as { payrollLog: { record(e: never): Promise<void> } }).payrollLog.record(entry);
              },
            },
          } as never),
        ),
    };
    configurePayroll(
      buildPayrollServices({
        unit: unit as never, people: directory, audit: { record: async () => undefined }, catalog, now,
        mail: { staffDetails: async () => ({ queued: true }), offerLetter: async () => ({ queued: true }) }, renderer: { render: async () => ({ status: "pending" }) },
        salaryRun: createSalaryRun({ now }), payFigures: createPayFigures(),
      }),
    );
    const at = new Date("2026-01-01T00:00:00Z");
    const company: PayrollCompanyRecord = {
      id: HP, name: "Hotel Pallav", code: "HP01", isActive: true, logoPath: null, signatureImagePath: null, updatedBy: null, createdAt: at, updatedAt: at,
      ownerName: null, mobileNumber: null, email: null, address: "Ring Road", city: "Rajkot", state: "Gujarat", pincode: null, panNumber: null, tanNumber: null, pfRegistrationNumber: null,
      esicRegistrationNumber: null, professionalTaxRegistrationNumber: null, authorizedPersonName: null, authorizedDesignation: null, authorizedMobile: null, authorizedEmail: null,
      bankName: null, accountNumber: null, ifscCode: null, branchName: null,
    };
    hotel.store.dataFor(HOTEL_A).payrollCompanies.push(company);
  }
  const ok = async (res: Response, status = 200) => {
    assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
    return (await json(res)).data;
  };
  async function employee(name: string, code: string): Promise<string> {
    const body = {
      name, dateOfBirth: "", gender: "", contactNumber: "98765 43210", contactCountry: "91", email: `${code.toLowerCase()}@example.com`, address: "", nationality: "", countryAndPincode: "",
      emergencyContactName: "", emergencyContactRelation: "", emergencyContactNumber: "", emergencyContactCountry: "91", employeeCode: code, designation: "Chef", department: "Kitchen",
      shift: "", joiningDate: "2026-01-01", dailyWorkingHours: 8, qualification: "", qualificationInstitution: "", skills: "", responsibilities: "", salaryPaise: 1_500_000, paymentMode: "Cash",
      bankName: "", accountHolderName: "", ifscCode: "", branchName: "", deductions: [], idProofType: "",
    };
    return (await ok(await createEmployeeRoute(req("POST", `${base}/employees`, "super", body), pctx()), 201)).employee.id;
  }

  test("a deleted employee, staff advance and meal period are listed with Pallav's labels, restored by their module and removed for good", async () => {
    wirePayroll();
    const kept = await employee("Asha Cook", "E001");
    const gone = await employee("Bimal Shah", "E002");
    const adv = await ok(await createAdvanceRoute(req("POST", `${base}/advances`, "super", { employeeId: kept, date: "2026-08-10T10:00:00+05:30", amountPaise: 500_000, recoveryType: "Monthly", instalmentPaise: 200_000, remarks: "Festival" }), pctx()), 201);
    await ok(await deleteAdvanceRoute(req("DELETE", `${base}/advances/${adv.id}`, "super"), pctx({ id: adv.id })));
    await ok(await deleteEmployeeRoute(req("DELETE", `${base}/employees/${gone}`, "super"), pctx({ id: gone })));
    const period = await ok(await startMealsRoute(req("POST", `${base}/meals/staff/${kept}`, "super", { startsOn: "2026-09-01", endsOn: "" }), pctx({ employeeId: kept })), 201);
    await ok(await deleteMealPeriodRoute(req("DELETE", `${base}/meals/periods/${period.id}`, "super"), pctx({ id: period.id })));

    const recycle = bin(payrollRecycleSources({ unit: hotel.unit as never, employees: getPayrollEmployees, adjustments: getPayrollAdjustments, separations: getPayrollSeparations, meals: getPayrollMeals }));
    const page = await recycle.list(S("super"), { page: 1, pageSize: 25 });
    assert.deepEqual(page.items.map((i) => [i.key, i.kind, i.label]).sort(), [["employee", "Staff", "Bimal Shah"], ["meal-period", "Meal period", "Asha Cook (E001)"], ["payroll-advance", "Staff advance", "0001"]]);
    assert.equal(page.items.find((i) => i.key === "employee")?.deletedBy, "Sonal Super");

    assert.equal((await recycle.restore(S("super"), "meal-period", period.id, meta)).message, "Meal period Asha Cook (E001) restored.");
    assert.equal((await hotel.unit.run(S("super"), (r) => r.meals.periodsOf([kept]))).length, 1);
    assert.equal((await recycle.restore(S("super"), "payroll-advance", adv.id, meta)).message, "Staff advance 0001 restored.");
    assert.equal((await recycle.purge(S("super"), "employee", gone, meta)).message, "Staff Bimal Shah removed for good.");
    assert.equal((await recycle.list(S("super"), { page: 1, pageSize: 25 })).total, 0);
    await assert.rejects(recycle.restore(S("super"), "employee", gone, meta), /NOT_FOUND|not in the recycle bin/);
  });

  test("a meal period restore keeps the meals rules: SuperAdmin only, and no overlap with a live record", async () => {
    wirePayroll();
    const e = await employee("Asha Cook", "E001");
    const first = await ok(await startMealsRoute(req("POST", `${base}/meals/staff/${e}`, "super", { startsOn: "2026-09-01", endsOn: "" }), pctx({ employeeId: e })), 201);
    await ok(await deleteMealPeriodRoute(req("DELETE", `${base}/meals/periods/${first.id}`, "super"), pctx({ id: first.id })));
    await assert.rejects(getPayrollMeals().restoreMealPeriod(S("admin"), HP, first.id, meta), /FORBIDDEN|SuperAdmin/);
    await ok(await startMealsRoute(req("POST", `${base}/meals/staff/${e}`, "super", { startsOn: "2026-09-15", endsOn: "" }), pctx({ employeeId: e })), 201);
    await assert.rejects(getPayrollMeals().restoreMealPeriod(S("super"), HP, first.id, meta), /run into another record/);
    clock = new Date(clock.getTime() + 31 * DAY);
    const recycle = bin(payrollRecycleSources({ unit: hotel.unit as never, employees: getPayrollEmployees, adjustments: getPayrollAdjustments, separations: getPayrollSeparations, meals: getPayrollMeals }));
    assert.equal(await recycle.purgeExpired(HOTEL_A), 1);
  });

  test("the clean-up never removes a person a separation or a meal period still names (deleted or not), and the kinds after Staff still go", async () => {
    wirePayroll();
    const kept = await employee("Asha Cook", "E001");
    const separated = await employee("Deepa Rao", "E003");
    const eats = await employee("Chirag Vyas", "E004");
    const free = await employee("Esha Patel", "E005");
    // a separation names Deepa (the database's ON DELETE RESTRICT); Chirag's meal period is itself in the bin
    await hotel.unit.run(S("super"), (r) => r.separations.create(HP, { employeeId: separated, separationType: "Resignation", resignationDate: "2026-08-01", lastWorkingDate: "2026-08-31", reason: "Moving city", remarks: null, status: "Relieved", documentPath: null } as never, SUPER));
    const period = await ok(await startMealsRoute(req("POST", `${base}/meals/staff/${eats}`, "super", { startsOn: "2026-09-01", endsOn: "" }), pctx({ employeeId: eats })), 201);
    await ok(await deleteMealPeriodRoute(req("DELETE", `${base}/meals/periods/${period.id}`, "super"), pctx({ id: period.id })));
    const adv = await ok(await createAdvanceRoute(req("POST", `${base}/advances`, "super", { employeeId: kept, date: "2026-08-10T10:00:00+05:30", amountPaise: 500_000, recoveryType: "Monthly", instalmentPaise: 200_000, remarks: "Festival" }), pctx()), 201);
    await ok(await deleteAdvanceRoute(req("DELETE", `${base}/advances/${adv.id}`, "super"), pctx({ id: adv.id })));
    // a separation or a meal period does not stop the soft delete (Pallav's five blockers only)
    for (const e of [separated, eats, free]) await ok(await deleteEmployeeRoute(req("DELETE", `${base}/employees/${e}`, "super"), pctx({ id: e })));

    clock = new Date(clock.getTime() + 31 * DAY);
    const recycle = bin(payrollRecycleSources({ unit: hotel.unit as never, employees: getPayrollEmployees, adjustments: getPayrollAdjustments, separations: getPayrollSeparations, meals: getPayrollMeals }));
    assert.equal(await recycle.purgeExpired(HOTEL_A), 3, "Esha, the staff advance and the meal period");
    const left = (await recycle.list(S("super"), { page: 1, pageSize: 25 })).items.map((i) => [i.key, i.label]).sort();
    assert.deepEqual(left, [["employee", "Chirag Vyas"], ["employee", "Deepa Rao"]]);
    // the next night Chirag's meal period is gone, so he goes too; Deepa stays while her separation names her
    assert.equal(await recycle.purgeExpired(HOTEL_A), 1);
    assert.deepEqual((await recycle.list(S("super"), { page: 1, pageSize: 25 })).items.map((i) => i.label), ["Deepa Rao"]);
    // removed by hand from the bin: Pallav's 409 sentence, not a raw database error
    await assert.rejects(recycle.purge(S("super"), "employee", separated, meta), (e: { code?: string; message?: string }) => e.code === "CONFLICT" && /already used in Separation Management/.test(e.message ?? ""));
  });

  test("a meal period removed for good writes its payroll-log line in the same unit; a failing log write takes the removal back", async () => {
    wirePayroll();
    const e = await employee("Asha Cook", "E001");
    const period = await ok(await startMealsRoute(req("POST", `${base}/meals/staff/${e}`, "super", { startsOn: "2026-09-01", endsOn: "" }), pctx({ employeeId: e })), 201);
    await ok(await deleteMealPeriodRoute(req("DELETE", `${base}/meals/periods/${period.id}`, "super"), pctx({ id: period.id })));
    const logs = () => hotel.store.dataFor(HOTEL_A).payrollLogs.filter((l) => l.entity === "Meals Record" && l.action === "deleted" && /removed for good/.test(l.summary));
    const inBin = async () => (await hotel.unit.run(S("super"), (r) => r.meals.deletedPeriods(HP))).length;
    // the log write fails: nothing is removed and no line stays
    failPayrollLog = true;
    await assert.rejects(getPayrollMeals().purgeMealPeriod(S("super"), HP, period.id, meta), /log could not be written/);
    failPayrollLog = false;
    assert.equal(await inBin(), 1, "the removal was taken back");
    assert.equal(logs().length, 0);
    await getPayrollMeals().purgeMealPeriod(S("super"), HP, period.id, meta);
    assert.equal(await inBin(), 0);
    assert.equal(logs().length, 1);
    assert.equal(logs()[0].summary, "The meals record for Asha Cook was removed for good");
  });
});

describe("the dev mail log", () => {
  test("outside production the log driver appends each mail (with the code) to common/db/.dev-mail.log at the repository root", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hms-mail-"));
    const cwd = process.cwd();
    const info = console.info;
    try {
      mkdirSync(path.join(root, "common", "db", "migrations"), { recursive: true });
      mkdirSync(path.join(root, "web-app"));
      assert.equal(devMailLogPath(path.join(root, "web-app")), path.join(root, "common", "db", ".dev-mail.log"));
      assert.equal(devMailLogPath(root), path.join(root, "common", "db", ".dev-mail.log"));
      assert.equal(devMailLogPath(tmpdir()), null);
      process.chdir(path.join(root, "web-app"));
      console.info = () => undefined;
      await logMailSender.send({ to: "a@example.com", subject: "Your HMS sign-in code", text: "Your sign-in code is 123456." });
      await logMailSender.send({ to: "b@example.com", subject: "Second", text: "Two" });
      const text = readFileSync(path.join(root, "common", "db", ".dev-mail.log"), "utf8");
      assert.match(text, /To: a@example\.com\nSubject: Your HMS sign-in code\n\nYour sign-in code is 123456\./);
      assert.match(text, /To: b@example\.com/);
    } finally {
      console.info = info;
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the root .gitignore keeps common/db/.dev-mail.log out of git", () => {
    const ignore = readFileSync(path.join(process.cwd(), "..", ".gitignore"), "utf8").split(/\r?\n/);
    assert.ok(ignore.includes("common/db/.dev-mail.log"));
  });
});
