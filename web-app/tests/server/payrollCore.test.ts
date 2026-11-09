// Payroll core end to end through the REAL route files, the wrapper, the services and ONE in-memory hotel store (shared with billing).
// Expected behaviour: docs/specs/payroll-core.md (each rule cites Pallav; Pallav's own tests named where a case comes from them).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { AttendanceSheet, AttendanceStatus, Deduction, Employee, PayrollCompanyRow, PayrollDashboard, PayrollOptions, StaffEmail } from "@shared/dashboards/payrollCore";
import { POST as generateRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/generate/route";
import { POST as regenerateRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/regenerate/route";
import { GET as sheetRoute, PUT as saveRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/route";
import { POST as unlockRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance/[month]/unlock/route";
import { DELETE as deleteStatusRoute, PATCH as updateStatusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance-statuses/[id]/route";
import { POST as toggleStatusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance-statuses/[id]/toggle/route";
import { GET as listStatusesRoute, POST as createStatusRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/attendance-statuses/route";
import { GET as dashboardRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/dashboard/route";
import { DELETE as deleteDeductionRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/deductions/[id]/route";
import { GET as listDeductionsRoute, POST as createDeductionRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/deductions/route";
import { POST as offerLetterRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/offer-letter/route";
import { DELETE as purgeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/purge/route";
import { POST as restoreRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/restore/route";
import { DELETE as deleteEmployeeRoute, GET as getEmployeeRoute, PATCH as updateEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/route";
import { POST as toggleEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/toggle/route";
import { GET as lookupRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/lookup/route";
import { GET as listEmployeesRoute, POST as createEmployeeRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/route";
import { GET as optionsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/options/route";
import { GET as companyPdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/pdf/route";
import { GET as getCompanyRoute, PATCH as updateCompanyRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/route";
import { GET as feedRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/staff-emails/feed/route";
import { GET as recipientsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/staff-emails/recipients/route";
import { GET as listEmailsRoute, POST as sendEmailsRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/staff-emails/route";
import { GET as listCompaniesRoute } from "../../src/app/api/v1/payroll/companies/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { GET as employeePdfRoute } from "../../src/app/api/v1/payroll/companies/[companyId]/employees/[id]/pdf/route";
import { buildPayrollServices, configurePayroll, getPayrollCompanies, pdfRenderer } from "../../src/server/compose/payrollCore";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { PayrollCompanyRecord } from "../../src/server/repos/payrollCore";
import type { Unit } from "../../src/server/repos/types";
import type { Person } from "../../src/server/services/cash/ports";
import type { PayrollMail, PayrollUnitRepos, SalaryRun } from "../../src/server/services/payrollCore/context";
import { createDocumentRenderer } from "../../src/server/documents";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { clerk: id(1), editor: id(2), viewer: id(3), admin: id(4), superAdmin: id(5) };
const people = new Map<string, Person>([
  [U.clerk, { id: U.clerk, name: "Chetan Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.editor, { id: U.editor, name: "Esha Editor", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", U.viewer, { grants: [grant("payroll.staff", "view"), grant("payroll.attendance", "view"), grant("payroll.dashboard", "view")] });
mk("clerk", U.clerk, { roleKey: "editor", roleLevel: 2, grants: [grant("payroll", "full")] });
mk("editor", U.editor, { roleKey: "editor", roleLevel: 2, grants: [grant("payroll", "full")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("payroll", "full"), grant("users", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("payroll", "full"), grant("users", "full")] });
mk("statusOnly", id(6), { grants: [grant("payroll.attendance-status", "full")] });
mk("nobody", id(7), {});
mk("adminB", id(8), { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("payroll", "full"), grant("users", "full")] });
// the same admin signed in on another device: another session id
sessions.set("adminElsewhere", { ...sessions.get("admin")!, sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });


let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
let mailed: { kind: string; to: string; subject: string }[] = [];
let mailWorks = true;
let salaryRuns: string[] = [];
let entriesCalls = 0;
let services = null as unknown as ReturnType<typeof buildPayrollServices>;
const HP = id(101);
const PF = id(102);
const HB = id(103);

function companyRecord(cid: string, code: string, name: string): PayrollCompanyRecord {
  const at = new Date("2026-01-01T00:00:00Z");
  return {
    id: cid, name, code, isActive: true, logoPath: null, signatureImagePath: null, updatedBy: null, createdAt: at, updatedAt: at,
    ownerName: null, mobileNumber: null, email: null, address: null, city: null, state: null, pincode: null, panNumber: null, tanNumber: null, pfRegistrationNumber: null,
    esicRegistrationNumber: null, professionalTaxRegistrationNumber: null, authorizedPersonName: null, authorizedDesignation: null, authorizedMobile: null, authorizedEmail: null,
    bankName: null, accountNumber: null, ifscCode: null, branchName: null,
  };
}

let failLog = false;
function wire(options: { salaryRun?: boolean } = {}): void {
  failLog = false;
  hotel = createMemoryHotel();
  mailed = [];
  mailWorks = true;
  salaryRuns = [];
  entriesCalls = 0;
  // counts the grid's reads: ONE per page, never per person
  const unit: Unit<PayrollUnitRepos> = {
    run: (session, work) =>
      hotel.unit.run(session, (repos) =>
        work({
          ...repos,
          attendance: { ...repos.attendance, entries: (monthId, ids) => ((entriesCalls += 1), repos.attendance.entries(monthId, ids)) },
          // a log line that cannot be written rolls the whole unit back, as the transaction does
          payrollLog: { ...repos.payrollLog, record: async (entry) => (failLog ? Promise.reject(new Error("the log could not be written")) : repos.payrollLog.record(entry)) },
        }),
      ),
  };
  const mail: PayrollMail = {
    staffDetails: async (_h, m) => (mailWorks ? (mailed.push({ kind: "staff", to: m.to, subject: m.subject }), { queued: true }) : { queued: false }),
    offerLetter: async (_h, m) => (mailWorks ? (mailed.push({ kind: "offer", to: m.to, subject: m.subject }), { queued: true }) : { queued: false }),
  };
  const salaryRun: SalaryRun = { generate: async (_r, m) => void salaryRuns.push(`${m.year}-${m.month}`) };
  services = buildPayrollServices({
    unit,
    people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) },
    audit: { record: async () => undefined },
    catalog,
    now: () => clock,
    mail,
    renderer: { render: async () => ({ status: "pending" }) },
    salaryRun: options.salaryRun ? salaryRun : null,
    payFigures: null,
  });
  configurePayroll(services);
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  const a = hotel.store.dataFor(HOTEL_A);
  // provisioning seeds the two fixed companies (in reverse here: the list must put them in the fixed order)
  a.payrollCompanies.push(companyRecord(PF, "PF01", "Pallav Food"), companyRecord(HP, "HP01", "Hotel Pallav"));
  a.payrollMasterItems.push(
    { id: id(301), payrollCompanyId: null, list: "share_emails", label: "Accounts", value: "accounts@pallav.example", isActive: true, sortOrder: 0 },
    { id: id(302), payrollCompanyId: PF, list: "share_emails", label: "Food office", value: "food@pallav.example", isActive: true, sortOrder: 0 },
    { id: id(303), payrollCompanyId: null, list: "share_emails", label: "Old", value: "old@pallav.example", isActive: false, sortOrder: 0 },
  );
  hotel.store.dataFor(HOTEL_B).payrollCompanies.push(companyRecord(HB, "HP01", "Other Hotel"));
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const fields = async (res: Response) => (await json(res)).error.details.fields;
const message = async (res: Response) => (await json(res)).error.message;
const data = (h = HOTEL_A) => hotel.store.dataFor(h);
const base = (cid = HP) => `/api/v1/payroll/companies/${cid}`;

const employeeInput = (over: Record<string, unknown> = {}) => ({
  name: "Manoj Yadav", dateOfBirth: "1990-04-12", gender: "Male", contactNumber: "98765 43210", contactCountry: "91", email: "Manoj@Example.com ", address: "Rajkot",
  nationality: "Indian", countryAndPincode: "India - 360001", emergencyContactName: "", emergencyContactRelation: "", emergencyContactNumber: "", emergencyContactCountry: "91",
  employeeCode: "E-1", designation: "Chef", department: "Kitchen", shift: "", joiningDate: "2026-04-01", dailyWorkingHours: 8, qualification: "", qualificationInstitution: "",
  skills: "", responsibilities: "", salaryPaise: 2_500_000, paymentMode: "Cash", bankName: "", accountHolderName: "", ifscCode: "", branchName: "", deductions: [],
  idProofType: "Aadhaar Card", idProofNumber: "1234 5678 9012", ...over,
});
async function employee(over: Record<string, unknown> = {}, who = "clerk", cid = HP): Promise<Employee> {
  const res = await createEmployeeRoute(req("POST", `${base(cid)}/employees`, who, employeeInput(over)), ctx({ companyId: cid }));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data.employee;
}
async function status(over: Record<string, unknown> = {}, cid = HP): Promise<AttendanceStatus> {
  const res = await createStatusRoute(req("POST", `${base(cid)}/attendance-statuses`, "clerk", { name: "Present", shortcutKey: "p", color: "#22C55E", attendancePercentage: 100, statusType: "Paid", skipsFood: false, ...over }), ctx({ companyId: cid }));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
}
const sheet = async (month: string, who = "clerk", query = ""): Promise<AttendanceSheet> => {
  const res = await sheetRoute(req("GET", `${base()}/attendance/${month}${query}`, who), ctx({ companyId: HP, month }));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const save = (month: string, rows: unknown[], who = "clerk") => saveRoute(req("PUT", `${base()}/attendance/${month}`, who, { rows }), ctx({ companyId: HP, month }));
const monthAction = (route: typeof generateRoute, action: string, month: string, who: string) => route(req("POST", `${base()}/attendance/${month}/${action}`, who), ctx({ companyId: HP, month }));
const full = (n: number, key: string): string[] => Array.from({ length: n }, () => key);

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("the payroll log is in the same unit as the change", () => {
  test("a log line that cannot be written rolls back an employee add, edit and delete, and a new attendance status", async () => {
    const e = await employee();
    const counts = () => [data().employees.length, data().attendanceStatuses.length, data().payrollLogs.length];
    const before = counts();
    failLog = true;
    assert.equal((await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ name: "Second Person", employeeCode: "E-2", contactNumber: "98765 11111", email: "second@example.com", idProofNumber: "9999 8888 7777" })), ctx({ companyId: HP }))).status, 500);
    assert.equal((await createStatusRoute(req("POST", `${base()}/attendance-statuses`, "clerk", { name: "Present", shortcutKey: "p", color: "#22C55E", attendancePercentage: 100, statusType: "Paid", skipsFood: false }), ctx({ companyId: HP }))).status, 500);
    assert.deepEqual(counts(), before, "nothing was left behind");
    assert.equal(data().employees.find((x) => x.id === e.id)?.deletedAt ?? null, null);
  });
});

describe("the company context (PayrollContext, PayrollScope, FixedCompaniesTest)", () => {
  test("the list is the fixed companies in the fixed order with staff counts; a read never creates one; any payroll part opens it", async () => {
    await employee();
    const res = await listCompaniesRoute(req("GET", "/api/v1/payroll/companies", "statusOnly"));
    assert.equal(res.status, 200);
    const rows: PayrollCompanyRow[] = (await json(res)).data;
    assert.deepEqual(rows.map((r) => [r.code, r.staffCount, r.activeStaffCount]), [["HP01", 1, 1], ["PF01", 0, 0]]);
    assert.equal(data().payrollCompanies.length, 2);
    assert.equal((await listCompaniesRoute(req("GET", "/api/v1/payroll/companies", "nobody"))).status, 403);
    const sample: PayrollCompanyRow = { id: "x", name: "x", code: "x", ownerName: "x", mobileNumber: "x", email: "x", address: "x", city: "x", state: "x", pincode: "x", panNumber: "x", tanNumber: "x", pfRegistrationNumber: "x", esicRegistrationNumber: "x", professionalTaxRegistrationNumber: "x", authorizedPersonName: "x", authorizedDesignation: "x", authorizedMobile: "x", authorizedEmail: "x", bankName: "x", branchName: "x", accountNumber: null, ifscCode: "x", isActive: true, staffCount: 1, activeStaffCount: 1 };
    assertMatchesContract(rows[0], sample);
  });

  test("page search (decision 51): words over name, code and owner, case ignored, every word must match; nothing matching is an empty list; over 200 characters is 422", async () => {
    const names = async (qs: string) => (await json(await listCompaniesRoute(req("GET", `/api/v1/payroll/companies${qs}`, "statusOnly")))).data.map((r: PayrollCompanyRow) => r.code);
    assert.deepEqual(await names(""), ["HP01", "PF01"]);
    assert.deepEqual(await names("?search=hp01"), ["HP01"], "the code, any case");
    assert.deepEqual(await names("?search=PF01%20HP01"), [], "every word has to match the same company");
    assert.deepEqual(await names("?search=zzzz"), []);
    assert.equal((await listCompaniesRoute(req("GET", `/api/v1/payroll/companies?search=${"a".repeat(201)}`, "statusOnly"))).status, 422);
    assert.equal((await listCompaniesRoute(req("GET", "/api/v1/payroll/companies?search=a&search=b", "statusOnly"))).status, 422);
    assert.equal((await listCompaniesRoute(req("GET", "/api/v1/payroll/companies?q=a", "statusOnly"))).status, 422, "only `search`");
  });

  test("another hotel's or an unknown company is 404 (\"Select a company first.\"); so is an inactive one", async () => {
    let res = await listEmployeesRoute(req("GET", `${base(HB)}/employees`, "clerk"), ctx({ companyId: HB }));
    assert.equal(res.status, 404);
    assert.equal(await message(res), "Select a company first.");
    data().payrollCompanies.find((c) => c.id === PF)!.isActive = false;
    res = await listEmployeesRoute(req("GET", `${base(PF)}/employees`, "clerk"), ctx({ companyId: PF }));
    assert.equal(res.status, 404);
    // hotel B sees only its own
    const rows = (await json(await listCompaniesRoute(req("GET", "/api/v1/payroll/companies", "adminB")))).data;
    assert.deepEqual(rows.map((r: PayrollCompanyRow) => r.name), ["Other Hotel"]);
  });

  test("another company's employee, status or deduction reads as absent (CompanyIsolationTest)", async () => {
    const e = await employee({}, "clerk", PF);
    assert.equal((await getEmployeeRoute(req("GET", `${base()}/employees/${e.id}`, "clerk"), ctx({ companyId: HP, id: e.id }))).status, 404);
    assert.equal((await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "admin", employeeInput()), ctx({ companyId: HP, id: e.id }))).status, 404);
    assert.equal((await deleteEmployeeRoute(req("DELETE", `${base()}/employees/${e.id}`, "admin"), ctx({ companyId: HP, id: e.id }))).status, 404);
    const s = await status({}, PF);
    assert.equal((await deleteStatusRoute(req("DELETE", `${base()}/attendance-statuses/${s.id}`, "admin"), ctx({ companyId: HP, id: s.id }))).status, 404);
    // an employee cannot be given another company's deduction
    const d = (await json(await createDeductionRoute(req("POST", `${base(PF)}/deductions`, "clerk", { name: "PF", standardAmountPaise: 18000 }), ctx({ companyId: PF })))).data as Deduction;
    const res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ deductions: [{ deductionId: d.id, type: "Monthly", amountPaise: 100 }] })), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { "deductions.0": "The selected deductions.0.deduction id is invalid." });
  });

  test("details only: name and code never change, the account number is kept as typed and returned in full, the payroll module's edit is needed", async () => {
    const body = { name: "Renamed", code: "ZZ", isActive: false, ownerName: "Pallav Shah", mobileNumber: "9876543210", email: "", address: "Ring Road", city: "Rajkot", state: "Gujarat", pincode: "", panNumber: "", tanNumber: "", pfRegistrationNumber: "", esicRegistrationNumber: "", professionalTaxRegistrationNumber: "", authorizedPersonName: "Pallav Shah", authorizedDesignation: "Owner", authorizedMobile: "", authorizedEmail: "", bankName: "SBI", branchName: "", accountNumber: "001234567890", ifscCode: "SBIN0001234" };
    assert.equal((await updateCompanyRoute(req("PATCH", base(), "statusOnly", body), ctx({ companyId: HP }))).status, 403);
    let res = await updateCompanyRoute(req("PATCH", base(), "clerk", { ...body, city: "", authorizedDesignation: "" }), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { city: "The city field is required.", authorizedDesignation: "The authorized designation field is required." });
    res = await updateCompanyRoute(req("PATCH", base(), "clerk", body), ctx({ companyId: HP }));
    const c: PayrollCompanyRow = (await json(res)).data;
    assert.deepEqual([c.name, c.code, c.isActive, c.accountNumber, c.ifscCode], ["Hotel Pallav", "HP01", true, "001234567890", "SBIN0001234"]);
    const stored = data().payrollCompanies.find((x) => x.id === HP)!;
    assert.ok(JSON.stringify(stored).includes("001234567890"), "stored as typed: no encryption");
    // absent = keep
    const { accountNumber: _drop, ...kept } = body;
    void _drop;
    c.accountNumber = null;
    res = await updateCompanyRoute(req("PATCH", base(), "clerk", kept), ctx({ companyId: HP }));
    assert.equal((await json(res)).data.accountNumber, "001234567890");
    assert.equal((await json(await getCompanyRoute(req("GET", base(), "viewer"), ctx({ companyId: HP })))).data.city, "Rajkot");
  });

  test("the company's details as a PDF: the screen's permission; the account number in full, as Pallav's PDF", async () => {
    const res = await companyPdfRoute(req("GET", `${base()}/pdf`, "viewer"), ctx({ companyId: HP }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toString("latin1"), "%PDF-");
    data().payrollCompanies.find((x) => x.id === HP)!.accountNumber = "001234567890";
    const file = await getPayrollCompanies().document(sessions.get("viewer")!, HP);
    const text = (await createDocumentRenderer({ timeoutMs: 90_000 }).render("payrollDoc", file)).text.join("|");
    assert.ok(text.includes("Company details"));
    assert.ok(text.includes("001234567890"), "the account number prints in full, as Pallav's payroll company PDF does");
    assert.equal((await companyPdfRoute(req("GET", `${base()}/pdf`, "nobody"), ctx({ companyId: HP }))).status, 403);
    assert.equal((await companyPdfRoute(req("GET", `${base()}/pdf`, null), ctx({ companyId: HP }))).status, 401);
  });
});

describe("staff (EmployeeController, PhoneNumberTest, StaffFormTest, PayrollRulesTest)", () => {
  test("added with the number normalised, the email lower-cased, numbers kept as typed and returned in full; the record matches the contract", async () => {
    const e = await employee({ contactNumber: "+971 50 123 4567", contactCountry: "91", emergencyContactName: "Uncle", emergencyContactNumber: "+44 7400 123456" });
    assert.deepEqual([e.contactCountry, e.contactNumber, e.display.contact], ["971", "501234567", "+971 501234567"]);
    assert.equal(e.email, "manoj@example.com");
    assert.equal(e.idProofNumber, "1234 5678 9012");
    assert.equal(e.emergencyContactNumber, "7400123456");
    assert.equal(e.display.emergency, "+44 7400123456");
    assert.equal(e.canEdit, true);
    assert.equal(e.canDelete, false);
    const stored = JSON.stringify(data().employees[0], (_k, v) => (typeof v === "bigint" ? String(v) : v));
    assert.ok(stored.includes("1234 5678 9012") && stored.includes("7400123456"), "stored as typed: no encryption");
    const sample: Employee = {
      id: "x", companyId: "x", name: "x", dateOfBirth: "x", gender: "x", contactNumber: "x", contactCountry: "x", email: "x", address: "x", nationality: "x", countryAndPincode: "x",
      emergencyContactName: "x", emergencyContactRelation: "x", emergencyContactNumber: "x", emergencyContactCountry: "x", employeeCode: "x", designation: "x", department: "x", shift: "x",
      joiningDate: "x", dailyWorkingHours: 1, qualification: "x", qualificationInstitution: "x", skills: "x", responsibilities: "x", salaryPaise: 1, paymentMode: "x", bankName: "x",
      accountHolderName: "x", accountNumber: null, ifscCode: "x", branchName: "x", deductions: [{ id: "x", deductionId: "x", type: "Monthly", amountPaise: 1 }], idProofType: "x",
      idProofNumber: null, resumeFileName: null, isActive: true, canEdit: true, canDelete: true, createdAt: "x", display: { contact: "x", emergency: "x" },
    };
    assertMatchesContract(e, sample);
    // the list carries them too, as Pallav shows them
    const page = (await json(await listEmployeesRoute(req("GET", `${base()}/employees`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual([page.items[0].emergencyContactNumber, page.items[0].ifscCode, page.items[0].idProofNumber], ["7400123456", "", "1234 5678 9012"]);
  });

  test("Pallav's words: the mobile and email needed, India's 6-9 rule, each country's length, unknown codes, the bank details when paid by Bank", async () => {
    let res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ contactNumber: "", email: "", employeeCode: "", paymentMode: "Bank" })), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), {
      employeeCode: "The employee code field is required.",
      contactNumber: "A mobile number is needed.",
      bankName: "Bank name is required when the payment mode is Bank.",
      accountHolderName: "Account holder name is required when the payment mode is Bank.",
      accountNumber: "Account number is required when the payment mode is Bank.",
      ifscCode: "IFSC code is required when the payment mode is Bank.",
      email: "An email address is needed - the appointment letter is sent to it.",
    });
    res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ contactNumber: "5876543210" })), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { contactNumber: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9." });
    res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ contactCountry: "971", contactNumber: "5012345" })), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { contactNumber: "Enter a valid United Arab Emirates number of 9 digits." });
    res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ contactCountry: "999" })), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { contactCountry: "The selected contact country is invalid.", contactNumber: "Choose a country code from the list." });
    res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ paymentMode: "Cheque", gender: "Robot", dailyWorkingHours: 0.25 })), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { dailyWorkingHours: "The daily working hours field must be at least 0.5.", paymentMode: "The selected payment mode is invalid.", gender: "The selected gender is invalid." });
    // an Indian number typed with its code but no "+" is still understood; ten digits starting 91 are not mistaken for a code
    assert.equal((await employee({ contactNumber: "919876543210" })).contactNumber, "9876543210");
    assert.equal((await employee({ contactNumber: "9198765432", employeeCode: "E-2", email: "b@example.com" })).contactNumber, "9198765432");
  });

  test("the employee ID and email are unique within the company only (StaffFormTest)", async () => {
    await employee();
    let res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ employeeCode: "e-1", email: "MANOJ@example.com" })), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { employeeCode: "This Employee ID is already used within the selected company.", email: "Another employee in this company already uses this email address." });
    await employee({}, "clerk", PF);
    res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ employeeCode: "E-9" })), ctx({ companyId: HP }));
    assert.equal(res.status, 422);
  });

  test("plain numbers: absent keeps, \"\" empties", async () => {
    const e = await employee({ paymentMode: "Bank", bankName: "SBI", accountHolderName: "Manoj", accountNumber: "001234567890", ifscCode: "SBIN0001234" });
    assert.equal(e.accountNumber, "001234567890");
    const rest: Record<string, unknown> = employeeInput({ paymentMode: "Bank", bankName: "SBI", accountHolderName: "Manoj", ifscCode: "SBIN0001234" });
    delete rest.accountNumber;
    delete rest.idProofNumber;
    let res = await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "clerk", rest), ctx({ companyId: HP, id: e.id }));
    let out: Employee = (await json(res)).data;
    assert.deepEqual([out.accountNumber, out.idProofNumber, out.ifscCode], ["001234567890", "1234 5678 9012", "SBIN0001234"]);
    res = await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "clerk", { ...rest, paymentMode: "Cash", accountNumber: "", idProofNumber: "" }), ctx({ companyId: HP, id: e.id }));
    out = (await json(res)).data;
    assert.deepEqual([out.accountNumber, out.idProofNumber], [null, null]);
    // with the stored one removed, Bank asks again
    res = await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "clerk", rest), ctx({ companyId: HP, id: e.id }));
    assert.deepEqual(await fields(res), { accountNumber: "Account number is required when the payment mode is Bank." });
  });

  test("edit: an Admin or whoever added the person; delete: an Admin, never while attendance names them; recycle bin for the SuperAdmin", async () => {
    const e = await employee();
    let res = await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "editor", employeeInput({ designation: "Head chef" })), ctx({ companyId: HP, id: e.id }));
    assert.equal(res.status, 403);
    assert.equal(await message(res), "Only an Admin or whoever added this person can edit their record.");
    assert.equal((await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "admin", employeeInput({ designation: "Head chef" })), ctx({ companyId: HP, id: e.id }))).status, 200);
    assert.equal(data().payrollLogs.at(-1)?.summary, "Employee updated: Manoj Yadav (E-1)");
    assert.deepEqual(data().payrollLogs.at(-1)?.details, { Designation: "Chef → Head chef" });
    // a save that changes nothing is not logged (PayrollLogTest)
    const logs = data().payrollLogs.length;
    await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "admin", employeeInput({ designation: "Head chef" })), ctx({ companyId: HP, id: e.id }));
    assert.equal(data().payrollLogs.length, logs);

    res = await deleteEmployeeRoute(req("DELETE", `${base()}/employees/${e.id}`, "clerk"), ctx({ companyId: HP, id: e.id }));
    assert.equal(await message(res), "Only an Admin can delete a staff record.");
    const s = await status();
    await sheet("2026-10");
    assert.equal((await save("2026-10", [{ employeeId: e.id, days: ["P"] }])).status, 200);
    res = await deleteEmployeeRoute(req("DELETE", `${base()}/employees/${e.id}`, "admin"), ctx({ companyId: HP, id: e.id }));
    assert.equal(res.status, 409);
    assert.equal(await message(res), "This employee is already used in Attendance Management and cannot be deleted. Remove the dependent records first, or mark the employee Inactive.");
    void s;

    const other = await employee({ employeeCode: "E-2", email: "x@example.com" });
    assert.equal((await deleteEmployeeRoute(req("DELETE", `${base()}/employees/${other.id}`, "admin"), ctx({ companyId: HP, id: other.id }))).status, 200);
    assert.equal((await getEmployeeRoute(req("GET", `${base()}/employees/${other.id}`, "admin"), ctx({ companyId: HP, id: other.id }))).status, 404);
    assert.equal((await listEmployeesRoute(req("GET", `${base()}/employees?deleted=true`, "admin"), ctx({ companyId: HP }))).status, 403);
    const bin = (await json(await listEmployeesRoute(req("GET", `${base()}/employees?deleted=true`, "super"), ctx({ companyId: HP })))).data;
    assert.deepEqual(bin.items.map((x: Employee) => x.employeeCode), ["E-2"]);
    assert.equal((await restoreRoute(req("POST", `${base()}/employees/${other.id}/restore`, "admin"), ctx({ companyId: HP, id: other.id }))).status, 403);
    assert.equal((await restoreRoute(req("POST", `${base()}/employees/${other.id}/restore`, "super"), ctx({ companyId: HP, id: other.id }))).status, 200);
    await deleteEmployeeRoute(req("DELETE", `${base()}/employees/${other.id}`, "admin"), ctx({ companyId: HP, id: other.id }));
    assert.equal((await purgeRoute(req("DELETE", `${base()}/employees/${other.id}/purge`, "super"), ctx({ companyId: HP, id: other.id }))).status, 200);
    assert.equal(data().employees.length, 1);
  });

  test("deductions are synced: kept by id, new ones added, the rest removed; the list carries each person's in one read", async () => {
    const d1 = (await json(await createDeductionRoute(req("POST", `${base()}/deductions`, "clerk", { name: "PF", standardAmountPaise: 18000 }), ctx({ companyId: HP })))).data as Deduction;
    const d2 = (await json(await createDeductionRoute(req("POST", `${base()}/deductions`, "clerk", { name: "Canteen", standardAmountPaise: 0 }), ctx({ companyId: HP })))).data as Deduction;
    const e = await employee({ deductions: [{ deductionId: d1.id, type: "Monthly", amountPaise: 18000 }, { deductionId: d2.id, amountPaise: null }, { deductionId: "" }] });
    assert.deepEqual(e.deductions.map((x) => [x.deductionId, x.type, x.amountPaise]), [[d1.id, "Monthly", 18000], [d2.id, "Monthly", 0]]);
    const keep = e.deductions[0];
    const res = await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "clerk", employeeInput({ deductions: [{ id: keep.id, deductionId: d1.id, type: "One Time", amountPaise: 500 }] })), ctx({ companyId: HP, id: e.id }));
    const out: Employee = (await json(res)).data;
    assert.deepEqual(out.deductions, [{ id: keep.id, deductionId: d1.id, type: "One Time", amountPaise: 500 }]);
    const list = (await json(await listDeductionsRoute(req("GET", `${base()}/deductions`, "clerk"), ctx({ companyId: HP })))).data as Deduction[];
    assert.deepEqual(list.map((d) => [d.name, d.assignedCount]), [["Canteen", 0], ["PF", 1]]);
    const del = await deleteDeductionRoute(req("DELETE", `${base()}/deductions/${d1.id}`, "admin"), ctx({ companyId: HP, id: d1.id }));
    assert.equal(await message(del), "This deduction is already assigned to an employee and cannot be deleted.");
    const dup = await createDeductionRoute(req("POST", `${base()}/deductions`, "clerk", { name: "pf", standardAmountPaise: 1 }), ctx({ companyId: HP }));
    assert.deepEqual(await fields(dup), { name: "A deduction with this name already exists for this company." });
  });

  test("the appointment letter: queued after the save, its outcome beside the record, never instead of it (StaffFormTest)", async () => {
    let res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ sendOfferLetter: true })), ctx({ companyId: HP }));
    assert.equal(res.status, 201);
    assert.deepEqual((await json(res)).data.letter, { sent: false, message: "No active joining letter template is set up, so no letter was sent." });
    data().joiningLetters.push({ payrollCompanyId: HP, isActive: true });
    res = await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ employeeCode: "E-2", email: "two@example.com", sendOfferLetter: true })), ctx({ companyId: HP }));
    assert.deepEqual((await json(res)).data.letter, { sent: true, message: "Appointment letter emailed to two@example.com." });
    assert.deepEqual(mailed, [{ kind: "offer", to: "two@example.com", subject: "Your appointment letter from Hotel Pallav" }]);
    mailWorks = false;
    const e: Employee = (await json(await createEmployeeRoute(req("POST", `${base()}/employees`, "clerk", employeeInput({ employeeCode: "E-3", email: "three@example.com", sendOfferLetter: true })), ctx({ companyId: HP })))).data.employee;
    assert.equal(data().employees.length, 3);
    // re-sent from the list; a failure is answered and logged, not thrown
    res = await offerLetterRoute(req("POST", `${base()}/employees/${e.id}/offer-letter`, "clerk"), ctx({ companyId: HP, id: e.id }));
    assert.deepEqual((await json(res)).data, { sent: false, message: "The letter could not be emailed. Check the mail settings, or download it and send it yourself." });
    assert.equal(data().payrollLogs.at(-1)?.status, "failed");
    // editing never sends
    mailWorks = true;
    await updateEmployeeRoute(req("PATCH", `${base()}/employees/${e.id}`, "clerk", employeeInput({ employeeCode: "E-3", email: "three@example.com", sendOfferLetter: true })), ctx({ companyId: HP, id: e.id }));
    assert.equal(mailed.length, 1);
  });

  test("options from Payroll Master (else Pallav's defaults); lookup by prefix; toggle", async () => {
    data().payrollMasterItems.push({ id: id(310), payrollCompanyId: HP, list: "designations", label: "Commis Chef", value: null, isActive: true, sortOrder: 0 });
    const opts: PayrollOptions = (await json(await optionsRoute(req("GET", `${base()}/options`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual([opts.genders, opts.paymentModes, opts.designations, opts.idProofTypes.length, opts.phoneCountries.length, opts.hasJoiningTemplate], [["Male", "Female", "Other"], ["Cash", "Bank"], ["Commis Chef"], 5, 41, false]);
    assert.deepEqual(opts.phoneCountries[0], { iso: "IN", name: "India", dial: "91", min: 10, max: 10, lead: "[6-9]", sample: "98765 43210", pattern: "[6-9][0-9]{9,9}", message: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9." });
    const e = await employee();
    const look = (await json(await lookupRoute(req("GET", `${base()}/employees/lookup?q=e-`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual(look, [{ id: e.id, label: "Manoj Yadav", hint: "E-1" }]);
    const off: Employee = (await json(await toggleEmployeeRoute(req("POST", `${base()}/employees/${e.id}/toggle`, "clerk"), ctx({ companyId: HP, id: e.id })))).data;
    assert.equal(off.isActive, false);
    // the picker offers active staff only: switched off, the person is gone from it
    assert.deepEqual((await json(await lookupRoute(req("GET", `${base()}/employees/lookup?q=e-`, "viewer"), ctx({ companyId: HP })))).data, []);
  });
});

describe("attendance marks (AttendanceStatusController)", () => {
  test("the key upper-cased; key, colour unique per company; Pallav's percentages; used ones cannot go; skips food follows open months only", async () => {
    const p = await status();
    assert.equal(p.shortcutKey, "P");
    let res = await createStatusRoute(req("POST", `${base()}/attendance-statuses`, "clerk", { name: "Paid leave", shortcutKey: "P", color: "#22C55E", attendancePercentage: 60, statusType: "Paid" }), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { shortcutKey: "This shortcut key is already used by another attendance status.", color: "This colour is already used by another attendance status.", attendancePercentage: "Attendance percentage can only be 0, 25, 50, 75 or 100." });
    // another company may use the same key
    await status({}, PF);
    const e = await employee();
    await save("2026-09", [{ employeeId: e.id, days: ["p"] }]).catch(() => undefined);
    await sheet("2026-09");
    assert.equal((await save("2026-09", [{ employeeId: e.id, days: ["p"] }])).status, 200);
    await sheet("2026-10");
    assert.equal((await save("2026-10", [{ employeeId: e.id, days: ["P"] }])).status, 200);
    // September locked: changing "skips food" leaves its days alone
    data().attendanceMonths.find((m) => m.month === 9)!.isLocked = true;
    res = await updateStatusRoute(req("PATCH", `${base()}/attendance-statuses/${p.id}`, "clerk", { name: "Present", shortcutKey: "P", color: "#22C55E", attendancePercentage: 100, statusType: "Paid", skipsFood: true }), ctx({ companyId: HP, id: p.id }));
    assert.equal((await json(res)).data.usedCount, 2);
    const byMonth = [...data().attendanceEntries.values()].map((x) => [data().attendanceMonths.find((m) => m.id === x.monthId)!.month, x.skipsFood]);
    assert.deepEqual(byMonth.sort(), [[10, true], [9, false]].sort());
    res = await deleteStatusRoute(req("DELETE", `${base()}/attendance-statuses/${p.id}`, "admin"), ctx({ companyId: HP, id: p.id }));
    assert.equal(await message(res), "This attendance status is already used in Attendance Management and cannot be deleted.");
    const list = (await json(await listStatusesRoute(req("GET", `${base()}/attendance-statuses`, "statusOnly"), ctx({ companyId: HP })))).data as AttendanceStatus[];
    assert.deepEqual(list.map((s) => [s.shortcutKey, s.usedCount]), [["P", 2]]);
    const toggled = (await json(await toggleStatusRoute(req("POST", `${base()}/attendance-statuses/${p.id}/toggle`, "clerk"), ctx({ companyId: HP, id: p.id })))).data as AttendanceStatus;
    assert.equal(toggled.isActive, false);
  });
});

describe("attendance (AttendanceController, AttendanceMonth)", () => {
  async function staff(n: number): Promise<Employee[]> {
    const out: Employee[] = [];
    for (let i = 1; i <= n; i += 1) out.push(await employee({ name: `Person ${String.fromCharCode(64 + i)}`, employeeCode: `E-${i}`, email: `p${i}@example.com` }));
    return out;
  }

  test("the sheet: a later month is this month; people by name, paged; their days in ONE read per page; progress against days so far", async () => {
    await status();
    await status({ name: "Half day", shortcutKey: "HD", color: "#F59E0B", attendancePercentage: 50 });
    const people = await staff(3);
    let s = await sheet("2027-01");
    assert.equal(s.month, "2026-10");
    assert.equal(s.lock, "editable");
    await save("2026-10", [{ employeeId: people[0].id, days: ["p", "hd", "", "P"], overtime: [0, 0, 2.5, 1] }]);
    entriesCalls = 0;
    s = await sheet("2026-10", "viewer", "?page=1&pageSize=2");
    assert.equal(entriesCalls, 1);
    assert.deepEqual(s.rows.map((r) => r.employeeName), ["Person A", "Person B"]);
    assert.deepEqual(s.page, { total: 3, page: 1, pageSize: 2 });
    const a = s.rows[0];
    assert.deepEqual([a.keys.slice(0, 5), a.overtime.slice(0, 5), a.overtimeHours], [["P", "HD", null, "P", null], [0, 0, 2.5, 1, 0], 3.5]);
    assert.equal(a.days.length, 31);
    assert.deepEqual(s.progress, { filled: 3, expected: 15, required: 93 });
    assert.deepEqual(s.incomplete, ["Person A", "Person B", "Person C"]);
    assert.deepEqual([s.daysElapsed, s.monthOver], [5, false]);
  });

  test("a save: unknown or inactive keys fail it whole (Pallav's words); another company's people are refused; overtime omitted is kept", async () => {
    await status();
    const leave = await status({ name: "Leave", shortcutKey: "L", color: "#3B82F6" });
    await toggleStatusRoute(req("POST", `${base()}/attendance-statuses/${leave.id}/toggle`, "clerk"), ctx({ companyId: HP, id: leave.id }));
    const [a] = await staff(1);
    await sheet("2026-10");
    const res = await save("2026-10", [{ employeeId: a.id, days: ["P", "x", "l", "X", "zz"] }]);
    assert.equal(res.status, 422);
    assert.equal(await message(res), "Unknown attendance status shortcut key(s): X, L, ZZ. Only keys configured in Attendance Status Master are allowed.");
    assert.equal(data().attendanceEntries.size, 0);
    const foreign = await employee({}, "clerk", PF);
    assert.equal((await save("2026-10", [{ employeeId: foreign.id, days: ["P"] }])).status, 404);
    await save("2026-10", [{ employeeId: a.id, days: ["P", ""], overtime: [1.5, 2] }]);
    await save("2026-10", [{ employeeId: a.id, days: ["", "P"] }]);
    const s = await sheet("2026-10");
    assert.deepEqual([s.rows[0].keys.slice(0, 2), s.rows[0].overtime.slice(0, 2)], [[null, "P"], [1.5, 2]]);
    // nothing typed and no overtime clears the day
    await save("2026-10", [{ employeeId: a.id, days: ["", ""], overtime: [0, 0] }]);
    assert.equal(data().attendanceEntries.size, 0);
    assert.equal(data().payrollLogs.at(-1)?.summary, "Attendance saved for 10/2026");
    // a month never opened, or still to come, cannot be saved
    assert.equal((await save("2026-08", [{ employeeId: a.id, days: ["P"] }])).status, 404);
    assert.equal((await save("2026-11", [{ employeeId: a.id, days: ["P"] }])).status, 404);
  });

  test("generate: the month over, everyone complete; until Payroll Pay it answers 422 (reason); with the run it locks the month (identity from the session)", async () => {
    await status();
    const [a, b] = await staff(2);
    await sheet("2026-10");
    let res = await monthAction(generateRoute, "generate", "2026-10", "clerk");
    assert.equal(await message(res), "Salary can only be generated once the attendance month is over.");
    await sheet("2026-09");
    await save("2026-09", [{ employeeId: a.id, days: full(30, "P") }, { employeeId: b.id, days: full(29, "P") }]);
    res = await monthAction(generateRoute, "generate", "2026-09", "clerk");
    assert.equal(await message(res), "Salary Generation cannot be completed. Please complete attendance entries for all active employees before generating salary: Person B.");
    await save("2026-09", [{ employeeId: b.id, days: full(30, "P") }]);
    res = await monthAction(generateRoute, "generate", "2026-09", "clerk");
    assert.equal(res.status, 422);
    const body = await json(res);
    assert.deepEqual([body.error.message, body.error.details.fields], ["Salary generation arrives with Payroll Pay.", { reason: "Salary generation arrives with Payroll Pay." }]);

    wire({ salaryRun: true });
    await status();
    const [c] = await staff(1);
    await sheet("2026-09");
    await save("2026-09", [{ employeeId: c.id, days: full(30, "P") }]);
    res = await monthAction(generateRoute, "generate", "2026-09", "clerk");
    let s: AttendanceSheet = (await json(res)).data;
    assert.equal(s.lock, "locked");
    assert.deepEqual(salaryRuns, ["2026-9"]);
    assert.equal((await monthAction(generateRoute, "generate", "2026-09", "clerk").then(message)), "Salary has already been generated for this month. An Admin must unlock attendance to re-generate.");
    assert.equal(await message(await save("2026-09", [{ employeeId: c.id, days: ["A"] }])), "This attendance month is locked. An Admin must unlock it before changes can be made.");
    // only Admins unlock or re-generate (never from a field: the schema refuses one)
    assert.equal(await message(await monthAction(unlockRoute, "unlock", "2026-09", "clerk")), "Only Admin users can unlock attendance.");
    assert.equal((await unlockRoute(req("POST", `${base()}/attendance/2026-09/unlock`, "clerk", { isAdmin: true }), ctx({ companyId: HP, month: "2026-09" }))).status, 403);
    s = (await json(await monthAction(unlockRoute, "unlock", "2026-09", "admin"))).data;
    assert.equal(s.lock, "unlocked");
    assert.equal(await message(await monthAction(unlockRoute, "unlock", "2026-09", "admin")), "This attendance month is not locked.");
    // the unlock belongs to the session that made it: another session opening the month puts the lock back
    assert.equal((await sheet("2026-09", "admin")).lock, "unlocked");
    const elsewhere = (await json(await sheetRoute(req("GET", `${base()}/attendance/2026-09`, "adminElsewhere"), ctx({ companyId: HP, month: "2026-09" })))).data;
    assert.equal(elsewhere.lock, "locked");
    await monthAction(unlockRoute, "unlock", "2026-09", "admin");
    assert.equal(await message(await monthAction(regenerateRoute, "regenerate", "2026-09", "clerk")), "Only Admin users can re-generate salary.");
    s = (await json(await monthAction(regenerateRoute, "regenerate", "2026-09", "admin"))).data;
    assert.equal(s.lock, "locked");
    assert.equal(data().attendanceMonths.find((m) => m.month === 9)?.generationCount, 2);
  });
});

describe("staff emails (StaffEmailController, StaffShareMailer, StaffEmailsTest)", () => {
  test("each send is recorded first, by the session's person, and queued; a recipient not on the list is recorded not sent", async () => {
    const e = await employee();
    const recipients = (await json(await recipientsRoute(req("GET", `${base()}/staff-emails/recipients`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual(recipients, [{ id: id(301), name: "Accounts", email: "accounts@pallav.example" }]);
    let res = await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "clerk", { recipientId: "", employeeIds: [] }), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { recipientId: "Choose who to send it to.", employeeIds: "Choose at least one member of staff." });
    assert.equal((await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "clerk", { recipientId: id(301), employeeIds: [e.id], sentBy: "Someone else" }), ctx({ companyId: HP }))).status, 422);
    const foreign = await employee({}, "clerk", PF);
    res = await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "clerk", { recipientId: id(301), employeeIds: [foreign.id] }), ctx({ companyId: HP }));
    assert.deepEqual(await fields(res), { "employeeIds.0": "The selected employees.0 is invalid." });

    res = await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "clerk", { recipientId: id(301), employeeIds: [e.id] }), ctx({ companyId: HP }));
    const sent = (await json(res)).data;
    assert.deepEqual([sent.queued, sent.failed, sent.message], [1, 0, "Manoj Yadav's details emailed to Accounts (accounts@pallav.example)."]);
    const card: StaffEmail = sent.items[0];
    assert.deepEqual([card.state, card.sentBy, card.subject, card.employeeCode], ["sending", "Chetan Clerk", "Staff details: Manoj Yadav (Hotel Pallav)", "E-1"]);
    assert.deepEqual(mailed, [{ kind: "staff", to: "accounts@pallav.example", subject: "Staff details: Manoj Yadav (Hotel Pallav)" }]);
    const sample: StaffEmail = { id: "x", companyId: "x", employeeId: "x", employeeName: "x", employeeCode: "x", designation: "x", recipientName: null, recipientEmail: "x", subject: "x", message: "x", state: "sent", error: null, sentBy: "x", createdAt: "x", finishedAt: null, durationMs: null, attachmentKb: null };
    assertMatchesContract(card, sample);

    // the worker finishes it
    await services.staffEmails.complete(HOTEL_A, card.id, { sent: true, error: null, attachmentBytes: 20480, durationMs: 900 });
    // another company's recipient, and an inactive one, are not on this company's list
    for (const r of [id(302), id(303)]) {
      res = await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "clerk", { recipientId: r, employeeIds: [e.id] }), ctx({ companyId: HP }));
      const out = (await json(res)).data;
      assert.deepEqual([out.queued, out.failed, out.message, out.items[0].state], [0, 1, "That recipient is not on the list for this company. Ask the SuperAdmin to add it under Payroll Master.", "failed"]);
    }
    const list = (await json(await listEmailsRoute(req("GET", `${base()}/staff-emails`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual(list.summary, { total: 3, sent: 1, failed: 2, today: 3 });
    const done = list.page.items.find((x: StaffEmail) => x.id === card.id);
    assert.deepEqual([done.state, done.attachmentKb, done.message], ["sent", 20, "Manoj Yadav's details emailed to Accounts (accounts@pallav.example)."]);
    assert.equal((await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "viewer", { recipientId: id(301), employeeIds: [e.id] }), ctx({ companyId: HP }))).status, 403);
  });

  test("a send never finished reads as stalled and counts as failed; the feed brings new records and the watched ones", async () => {
    const e = await employee();
    const first = (await json(await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "clerk", { recipientId: id(301), employeeIds: [e.id] }), ctx({ companyId: HP })))).data.items[0] as StaffEmail;
    clock = new Date(clock.getTime() + 6 * 60_000);
    let list = (await json(await listEmailsRoute(req("GET", `${base()}/staff-emails?status=failed`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual(list.page.items.map((x: StaffEmail) => x.state), ["stalled"]);
    list = (await json(await listEmailsRoute(req("GET", `${base()}/staff-emails?status=sending`, "viewer"), ctx({ companyId: HP })))).data;
    assert.equal(list.page.total, 0);
    const after = clock.toISOString();
    clock = new Date(clock.getTime() + 1000);
    const second = (await json(await sendEmailsRoute(req("POST", `${base()}/staff-emails`, "clerk", { recipientId: id(301), employeeIds: [e.id] }), ctx({ companyId: HP })))).data.items[0] as StaffEmail;
    const feed = (await json(await feedRoute(req("GET", `${base()}/staff-emails/feed?after=${encodeURIComponent(after)}&watch=${first.id}`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual(feed.items.map((x: StaffEmail) => x.id), [first.id, second.id]);
    assert.equal(feed.summary.total, 2);
  });
});

describe("the dashboard (PayrollDashboardController, PayrollPagesTest)", () => {
  test("a new company is told what to set up, in Pallav's order and words; counts only the open company", async () => {
    await employee({}, "clerk", PF);
    let d: PayrollDashboard = (await json(await dashboardRoute(req("GET", `${base()}/dashboard`, "viewer"), ctx({ companyId: HP })))).data;
    assert.deepEqual(d.attention.map((a) => a.text), [
      "No attendance statuses yet - attendance cannot be recorded until there is at least one.",
      "No staff on the payroll yet.",
      "No deductions are configured, so none can be assigned to staff.",
      "No joining letter template, so letters cannot be issued.",
      "No experience letter template, so leavers cannot be issued one.",
    ]);
    assert.equal(d.kpis.find((k) => k.id === "staff")?.value, 0);
    await status();
    const a = await employee();
    await sheet("2026-10");
    await save("2026-10", [{ employeeId: a.id, days: ["P", "P", "P"] }]);
    d = (await json(await dashboardRoute(req("GET", `${base()}/dashboard`, "viewer"), ctx({ companyId: HP })))).data;
    // 3 of 1 person x 5 days so far = 60
    assert.deepEqual(d.attendance, { filled: 3, expected: 5, percent: 60, locked: false });
    assert.deepEqual([d.payrollMonth, d.netPaise, d.paidPaise, d.recent], [null, 0, 0, []]);
    assert.equal(d.attention.length, 3);
  });
});

describe("the staff record sheet as a PDF and the mail attachments (MJ #22)", () => {
  test("the sheet opens as inline application/pdf with the staff permission; the mail renderer makes it for the sender and the numbers print masked", async () => {
    const e = await employee({ paymentMode: "Bank", bankName: "SBI", accountHolderName: "Manoj", accountNumber: "001234567890", ifscCode: "SBIN0001234", responsibilities: "Kitchen lead" });
    const res = await employeePdfRoute(req("GET", `${base()}/employees/${e.id}/pdf`, "viewer"), ctx({ companyId: HP, id: e.id }));
    assert.equal(res.status, 200);
    assert.deepEqual([res.headers.get("content-type"), res.headers.get("cache-control"), res.headers.get("content-disposition")], ["application/pdf", "no-store", 'inline; filename="employee-E-1.pdf"']);
    assert.equal(Buffer.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toString("latin1"), "%PDF-");
    assert.equal((await employeePdfRoute(req("GET", `${base()}/employees/${e.id}/pdf`, "nobody"), ctx({ companyId: HP, id: e.id }))).status, 403);
    assert.equal((await employeePdfRoute(req("GET", `${base()}/employees/${id(998)}/pdf`, "viewer"), ctx({ companyId: HP, id: id(998) }))).status, 404);
    const text = (await createDocumentRenderer().render("payrollDoc", await services.documents.employee(sessions.get("viewer")!, HP, e.id))).text.join("\n");
    for (const must of ["Employee Record", "Manoj Yadav", "E-1", "Bank details", "001234567890", "Kitchen lead"]) assert.ok(text.includes(must), `missing: ${must}`);
    assert.ok(!text.includes("XXXX7890"), "numbers print in full, as Pallav does");
    const made = await pdfRenderer.render("employee", { employeeId: e.id, companyId: HP }, sessions.get("viewer")!);
    assert.equal(made.status, "ready");
    assert.equal(Buffer.from((made as { bytes: Uint8Array }).bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
    // without a sender there is nothing to authorise the render with
    assert.deepEqual(await pdfRenderer.render("employee", { employeeId: e.id, companyId: HP }), { status: "pending" });
  });
});
