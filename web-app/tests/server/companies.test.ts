// Companies, Customers, Email Marketing and the Company Ledger, end to end through the REAL route files, the wrapper, the services and ONE in-memory hotel
// store shared with billing (the ledger reads Bill Master). Expected behaviour: docs/specs/companies.md (each rule cites Pallav).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { Campaign, CompanyProfile, Customer, LedgerLine, LedgerSummary, MarketingOverview } from "@shared/dashboards/companies";
import { GET as accountRoute } from "../../src/app/api/v1/companies/[id]/ledger/route";
import { DELETE as purgeRoute } from "../../src/app/api/v1/companies/[id]/purge/route";
import { POST as restoreRoute } from "../../src/app/api/v1/companies/[id]/restore/route";
import { DELETE as deleteCompanyRoute, GET as getCompanyRoute, PATCH as updateCompanyRoute } from "../../src/app/api/v1/companies/[id]/route";
import { GET as companyPdfRoute } from "../../src/app/api/v1/companies/[id]/pdf/route";
import { GET as customerPdfRoute } from "../../src/app/api/v1/companies/customers/[id]/pdf/route";
import { GET as ledgerPdfRoute } from "../../src/app/api/v1/companies/ledger/pdf/route";
import { GET as ageingCsvRoute } from "../../src/app/api/v1/companies/ledger/ageing/csv/route";
import { GET as ageingRoute } from "../../src/app/api/v1/companies/ledger/ageing/route";
import { GET as statementCsvRoute } from "../../src/app/api/v1/companies/[id]/statement/csv/route";
import { GET as statementPdfRoute } from "../../src/app/api/v1/companies/[id]/statement/pdf/route";
import { GET as statementRoute } from "../../src/app/api/v1/companies/[id]/statement/route";
import { POST as resetLoginRoute } from "../../src/app/api/v1/companies/customers/[id]/reset-login/route";
import { POST as revealIdRoute } from "../../src/app/api/v1/companies/customers/[id]/id-number/route";
import { DELETE as deleteCustomerRoute, GET as getCustomerRoute, PATCH as updateCustomerRoute } from "../../src/app/api/v1/companies/customers/[id]/route";
import { GET as listCustomersRoute, POST as createCustomerRoute } from "../../src/app/api/v1/companies/customers/route";
import { GET as overviewRoute } from "../../src/app/api/v1/companies/ledger/route";
import { GET as lookupRoute } from "../../src/app/api/v1/companies/lookup/route";
import { GET as optionsRoute } from "../../src/app/api/v1/companies/options/route";
import { GET as listCompaniesRoute, POST as createCompanyRoute } from "../../src/app/api/v1/companies/route";
import { GET as marketingRoute } from "../../src/app/api/v1/companies/marketing/route";
import { POST as createCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/route";
import { DELETE as deleteCampaignRoute, PATCH as updateCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/[id]/route";
import { POST as sendCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/[id]/send/route";
import { GET as estimateCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/[id]/estimate/route";
import { POST as pauseCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/[id]/pause/route";
import { POST as resumeCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/[id]/resume/route";
import { POST as cancelCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/[id]/cancel/route";
import { POST as testCampaignRoute } from "../../src/app/api/v1/companies/marketing/campaigns/[id]/test/route";
import { GET as unsubscribeRoute, POST as unsubscribePost } from "../../src/app/api/v1/public/unsubscribe/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureCompanies, getCompanies, getCompanyLedger, getCustomers } from "../../src/server/compose/companies";
import { createMarketingService, templateOf, unsubscribeToken, type MarketingPorts } from "../../src/server/services/companies/marketingService";
import { feedCampaigns, FEED_AHEAD, type FeedPorts } from "../../src/server/services/companies/campaignFeed";
import type { CampaignRunRecord } from "../../src/server/repos/auth";
import type { MailPayload } from "../../src/server/services/auth/mail";
import type { StayRecord } from "../../src/server/repos/frontOffice";
import { createDocumentRenderer } from "../../src/server/documents";
import { formatINR } from "@shared/dashboards/format";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { AdvanceRecord, BillRecord, DebitSlot } from "../../src/server/repos/billing";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { createCompanyService } from "../../src/server/services/companies/companyService";
import type { GuestAccounts } from "../../src/server/services/companies/context";
import { createCustomerService } from "../../src/server/services/companies/customerService";
import { createLedgerService } from "../../src/server/services/companies/ledgerService";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { clerk: id(1), editor: id(2), admin: id(4), superAdmin: id(5), staffer: id(7) };
const people = new Map<string, Person>([
  [U.clerk, { id: U.clerk, name: "Chetan Clerk", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.editor, { id: U.editor, name: "Esha Editor", roleKey: "editor", roleLevel: 2, deleted: false }],
  [U.admin, { id: U.admin, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }],
  [U.superAdmin, { id: U.superAdmin, name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }],
  [U.staffer, { id: U.staffer, name: "Sam Sales", roleKey: "editor", roleLevel: 2, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", id(3), { grants: [grant("companies", "view"), grant("companies.ledger", "view")] });
mk("clerk", U.clerk, { grants: [grant("companies", "edit"), grant("companies.ledger", "view")] });
mk("editor", U.editor, { grants: [grant("companies", "full")] });
mk("admin", U.admin, { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("companies", "full"), grant("companies.ledger", "view"), grant("users", "full")] });
mk("super", U.superAdmin, { accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("companies", "full"), grant("companies.ledger", "view"), grant("users", "full")] });
mk("nobody", id(6), {});
mk("ledgerOnly", id(9), { grants: [grant("companies.ledger", "view")] });
mk("adminB", id(8), { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("companies", "full"), grant("companies.ledger", "view"), grant("users", "full")] });

let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
let issued: string[] = [];
let resets: string[] = [];
let failLog = false;
/** What the marketing ports were asked to queue (the platform outbox's double). */
let queued: { hotelId: string; to: string; template: string; payload: MailPayload }[] = [];
/** The platform's side of the campaign engine (0130): suppressed addresses, the hotel's hold, the running list, the templates cancelled, what may still go today. */
let suppressed = new Set<string>();
let heldWhy: string | null = null;
let runs: CampaignRunRecord[] = [];
let cancelledTemplates: string[] = [];
let allowance = Infinity;
let feedPorts: FeedPorts;
const SECRET = Buffer.alloc(32, 7);
const emails = new Map<string, string>([[U.clerk, "chetan@hotel.test"], [U.admin, "hari@hotel.test"]]);

function wire(): void {
  hotel = createMemoryHotel();
  issued = [];
  resets = [];
  queued = [];
  suppressed = new Set();
  heldWhy = null;
  runs = [];
  cancelledTemplates = [];
  allowance = Infinity;
  const guestAccounts: GuestAccounts = {
    issue: async (_h, c) => (issued.push(c.id), { emailed: c.email !== null }),
    reset: async (_h, c) => (resets.push(c.id), { emailed: true }),
    lastLogins: async (_h, ids) => new Map(ids.slice(0, 1).map((x) => [x, new Date("2026-10-01T05:00:00Z")])),
  };
  const base = hotel.unit;
  // while failLog is set, the system log cannot be written: whatever the action did in the same unit must be rolled back
  const unit = { run: <T>(s: Parameters<typeof base.run>[0], work: Parameters<typeof base.run<T>>[1]) => base.run(s, (repos) => work(failLog ? { ...repos, systemLogs: { write: async () => { throw new Error("log table is down"); } } } : repos)) } as typeof base;
  const deps = {
    unit,
    people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) },
    audit: { record: async () => undefined },
    catalog,
    now: () => clock,
    guestAccounts,
  };
  const ports: MarketingPorts = {
    enqueue: async (hotelId, to, template, payload) => void queued.push({ hotelId, to, template, payload }),
    // every queued mail counts as sent, but one address per campaign fails (so the counts are told apart)
    deliveries: async (hotelId, templates) => {
      const out = new Map<string, { pending: number; sent: number; failed: number }>();
      for (const t of templates) {
        const mine = queued.filter((q) => q.hotelId === hotelId && q.template === t);
        if (mine.length) out.set(t, { pending: 0, sent: mine.length - (mine.length > 1 ? 1 : 0), failed: mine.length > 1 ? 1 : 0 });
      }
      return out;
    },
    emailOf: async (userId) => emails.get(userId) ?? null,
    publicUrl: "https://hms.test/",
    secret: () => SECRET,
    suppressedAmong: async (_h, list) => new Set(list.filter((e) => suppressed.has(e))),
    heldReason: async () => heldWhy,
    limits: async () => ({ perSecond: 2, perDay: 500 }),
    runs: {
      start: async (hotelId, campaignId) => {
        runs = [...runs.filter((r) => r.campaignId !== campaignId), { hotelId, campaignId, state: "sending", startedAt: clock }];
      },
      setState: async (_h, campaignId, state) => void runs.forEach((r) => r.campaignId === campaignId && (r.state = state)),
      end: async (_h, campaignId) => void (runs = runs.filter((r) => r.campaignId !== campaignId)),
    },
    cancelQueued: async (_h, template) => (cancelledTemplates.push(template), 0),
  };
  feedPorts = {
    publicUrl: ports.publicUrl, secret: ports.secret, suppressedAmong: ports.suppressedAmong, runs: async () => runs.map((r) => ({ ...r })), setRunState: ports.runs.setState, endRun: ports.runs.end,
    held: async (ids) => new Set(heldWhy ? ids : []), waiting: async () => new Map(), allowance: async () => allowance, pending: async () => 0,
    enqueue: async (hotelId, rows) => void rows.forEach((r) => queued.push({ hotelId, to: r.to, template: r.template, payload: r.payload })),
    hotel: unit,
  };
  const companies = createCompanyService(deps);
  const customers = createCustomerService(deps);
  configureCompanies({ companies, customers, marketing: createMarketingService(deps, ports), ledger: createLedgerService(deps, companies) });
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  hotel.store.dataFor(HOTEL_A).idProofTypes = [{ name: "Passport", active: true }, { name: "Aadhaar", active: true }];
  hotel.store.dataFor(HOTEL_A).options = { company_contact_role: [{ value: "Accounts", label: "Accounts", isDefault: false }] };
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
const data = (h = HOTEL_A) => hotel.store.dataFor(h);

const companyInput = (over: Record<string, unknown> = {}) => ({
  name: "Infosys Rajkot", gstNumber: "24ABCDE1234F1Z5", mobile: "9876543210", phone: "", email: "accounts@infosys.example", address: "Ring Road", country: "India", pincode: "360005",
  nationality: "Indian", discountPct: 10, gstPct: 12, tcsPct: null, tdsPct: 2, instruction: "", contacts: [{ role: "Accounts", name: "Priya", email: "", mobile: "" }, { role: "", name: "", email: "", mobile: "" }], ...over,
});
async function company(over: Record<string, unknown> = {}, who = "clerk"): Promise<CompanyProfile> {
  const res = await createCompanyRoute(req("POST", "/api/v1/companies", who, companyInput(over)));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
}
const customerInput = (over: Record<string, unknown> = {}) => ({ name: "Ravi Mehta", mobile: "+91 98765-43210", email: "ravi@example.com", address: "", city: "Rajkot", idProofType: "Aadhaar", idProofNumber: "1234 5678 9012", notes: "", isActive: true, ...over });

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  failLog = false;
  wire();
});

describe("the system log is in the same unit as the change", () => {
  test("a log line that cannot be written rolls back a company or customer add, edit and delete; nothing is half done", async () => {
    const c = await company();
    const base = { companies: data().companyProfiles.length, customers: data().customers.length, logs: data().systemLogs.length };
    failLog = true;
    assert.equal((await createCompanyRoute(req("POST", "/api/v1/companies", "clerk", companyInput({ name: "Wipro Pune", gstNumber: "27ABCDE1234F1Z5", email: "wipro@example.com", mobile: "9876500001" })))).status, 500);
    assert.equal((await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput()))).status, 500);
    assert.equal((await updateCompanyRoute(req("PATCH", `/api/v1/companies/${c.id}`, "clerk", companyInput({ name: "Renamed Co" })), ctx({ id: c.id }))).status, 500);
    assert.equal((await deleteCompanyRoute(req("DELETE", `/api/v1/companies/${c.id}`, "super"), ctx({ id: c.id }))).status, 500);
    assert.deepEqual([data().companyProfiles.length, data().customers.length, data().systemLogs.length], [base.companies, base.customers, base.logs]);
    const kept = data().companyProfiles.find((x) => x.id === c.id);
    assert.deepEqual([kept?.name, kept?.deletedAt ?? null], ["Infosys Rajkot", null], "the edit and the delete did not stick");
  });
});

describe("company profiles (CompanyProfileController)", () => {
  test("added with contacts tidied (empty rows dropped); percentages kept as typed; the creator's name; logged", async () => {
    const c = await company();
    assert.equal(c.contacts.length, 1);
    assert.deepEqual([c.discountPct, c.gstPct, c.tcsPct], [10, 12, null]);
    assert.equal(c.createdBy, "Chetan Clerk");
    assert.equal(data().systemLogs[0].summary, "Added Company: Infosys Rajkot");
    assert.deepEqual(data().systemLogs[0].details, { "GST number": "24ABCDE1234F1Z5", Email: "accounts@infosys.example", Mobile: "9876543210", People: 1 });
    const sample: CompanyProfile = { id: "x", name: "x", gstNumber: "x", mobile: "x", phone: "x", email: "x", address: "x", country: "x", pincode: "x", nationality: "x", discountPct: null, gstPct: null, tcsPct: null, tdsPct: null, instruction: "x", contacts: [{ role: "x", name: "x", email: "x", mobile: "x" }], createdAt: "x", createdBy: "x" };
    assertMatchesContract(c, sample);
  });
  test("Pallav's words: a contact person needed, every contact needs a name, rates 0-100, the name and the GST number unique", async () => {
    let res = await createCompanyRoute(req("POST", "/api/v1/companies", "clerk", companyInput({ name: "", contacts: [{ role: "", name: "", email: "", mobile: "" }], gstPct: 101 })));
    assert.deepEqual(await fields(res), { name: "The name field is required.", gstPct: "The gst percentage field must be between 0 and 100.", contacts: "Add at least one person to contact." });
    res = await createCompanyRoute(req("POST", "/api/v1/companies", "clerk", companyInput({ contacts: [{ role: "", name: "", email: "x@y.in", mobile: "" }] })));
    assert.deepEqual(await fields(res), { "contacts.0.name": "Every contact person needs a name." });
    await company();
    res = await createCompanyRoute(req("POST", "/api/v1/companies", "clerk", companyInput({ name: "INFOSYS RAJKOT", gstNumber: "" })));
    assert.deepEqual(await fields(res), { name: "The name has already been taken." });
    res = await createCompanyRoute(req("POST", "/api/v1/companies", "clerk", companyInput({ name: "Other" })));
    assert.deepEqual(await fields(res), { gstNumber: "A company with this GST number already exists." });
  });
  test("edit: the SuperAdmin, an Admin or whoever added it; delete: Full Access and an Admin, never over a SuperAdmin's company", async () => {
    const c = await company();
    let res = await updateCompanyRoute(req("PATCH", `/api/v1/companies/${c.id}`, "editor", companyInput({ instruction: "x" })), ctx({ id: c.id }));
    assert.equal((await json(res)).error.message, "Only an Admin or whoever added this company can edit it.");
    res = await updateCompanyRoute(req("PATCH", `/api/v1/companies/${c.id}`, "admin", companyInput({ phone: "0281 245" })), ctx({ id: c.id }));
    assert.equal(res.status, 200);
    assert.equal(data().systemLogs.at(-1)?.summary, "Changed Company: Infosys Rajkot (Phone number)");
    assert.equal((await json(await deleteCompanyRoute(req("DELETE", `/api/v1/companies/${c.id}`, "editor"), ctx({ id: c.id })))).error.message, "Only an Admin can delete a company.");
    const supers = await company({ name: "Super Co", gstNumber: "" }, "super");
    assert.equal((await deleteCompanyRoute(req("DELETE", `/api/v1/companies/${supers.id}`, "admin"), ctx({ id: supers.id }))).status, 403);
    assert.equal((await deleteCompanyRoute(req("DELETE", `/api/v1/companies/${c.id}`, "admin"), ctx({ id: c.id }))).status, 200);
    assert.equal((await getCompanyRoute(req("GET", `/api/v1/companies/${c.id}`, "admin"), ctx({ id: c.id }))).status, 404);
    // the name is free again while it sits in the recycle bin; restoring would clash
    await company({ gstNumber: "" });
    assert.equal((await json(await restoreRoute(req("POST", `/api/v1/companies/${c.id}/restore`, "super"), ctx({ id: c.id })))).error.message, "The name has already been taken.");
  });
  test("recycle bin: restore and purge for recycle-bin users; a company bills still name is never purged", async () => {
    const c = await company();
    await deleteCompanyRoute(req("DELETE", `/api/v1/companies/${c.id}`, "admin"), ctx({ id: c.id }));
    assert.equal((await restoreRoute(req("POST", `/api/v1/companies/${c.id}/restore`, "admin"), ctx({ id: c.id }))).status, 403);
    assert.equal((await restoreRoute(req("POST", `/api/v1/companies/${c.id}/restore`, "super"), ctx({ id: c.id }))).status, 200);
    await deleteCompanyRoute(req("DELETE", `/api/v1/companies/${c.id}`, "super"), ctx({ id: c.id }));
    data().advances.push({ id: id(900), companyId: c.id, deletedAt: null } as unknown as AdvanceRecord);
    assert.equal((await purgeRoute(req("DELETE", `/api/v1/companies/${c.id}/purge`, "super"), ctx({ id: c.id }))).status, 409);
  });
  test("list: newest first, every word or a \"quoted phrase\", the numbers on top; lookup by prefix capped at 50; options from the hotel's data", async () => {
    await company({ name: "Alpha Hotels Ltd", gstNumber: "" });
    // a later moment: "newest first" ties are broken by a random id, so two rows made at one instant would swap now and then
    clock = new Date(clock.getTime() + 60_000);
    await company({ name: "Beta Travel", gstNumber: "", contacts: [{ role: "Owner", name: "Kiran Shah", email: "", mobile: "" }] });
    const names = async (q: string) => (await json(await listCompaniesRoute(req("GET", `/api/v1/companies?search=${encodeURIComponent(q)}`, "viewer")))).data.page.items.map((c: CompanyProfile) => c.name);
    assert.deepEqual(await names(""), ["Beta Travel", "Alpha Hotels Ltd"]);
    assert.deepEqual(await names("kiran"), ["Beta Travel"]);
    assert.deepEqual(await names('"hotels ltd"'), ["Alpha Hotels Ltd"]);
    assert.deepEqual(await names('"ltd hotels"'), []);
    const list = (await json(await listCompaniesRoute(req("GET", "/api/v1/companies", "viewer")))).data;
    assert.deepEqual(list.stats, { total: 2, withGst: 0, contacts: 2, addedThisMonth: 2 });
    const look = (await json(await lookupRoute(req("GET", "/api/v1/companies/lookup?q=al&limit=5", "viewer")))).data;
    assert.deepEqual(look.map((x: { label: string }) => x.label), ["Alpha Hotels Ltd"]);
    assert.equal((await lookupRoute(req("GET", "/api/v1/companies/lookup?q=a&limit=51", "viewer"))).status, 422);
    const opts = (await json(await optionsRoute(req("GET", "/api/v1/companies/options", "viewer")))).data;
    assert.deepEqual(opts, { idTypes: ["Aadhaar", "Passport"], contactRoles: ["Accounts"] });
  });
});

describe("customers (CustomerController)", () => {
  test("mobile stored as digits; the ID proof number comes back as its last 4 only (decision 74); a portal login issued through the platform port", async () => {
    const res = await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput()));
    assert.equal(res.status, 201);
    const { customer, emailed } = (await json(res)).data;
    assert.equal(customer.mobile, "919876543210");
    assert.deepEqual([customer.idProofNumber, customer.idProofMasked], ["\u2022\u2022\u2022\u20229012", true]);
    assert.ok(!JSON.stringify(customer).includes("1234 5678"), "the whole number is not in the answer");
    assert.equal(emailed, true);
    assert.deepEqual(issued, [customer.id]);
    const row = data().customers[0];
    assert.equal(row.idProofNumber, "1234 5678 9012");
    const sample: Customer = { id: "x", name: "x", mobile: "x", email: "x", address: "x", city: "x", idProofType: "x", idProofNumber: "x", idProofMasked: true, notes: "x", isActive: true, source: "admin", lastLoginAt: null, createdAt: "x", createdBy: null };
    assertMatchesContract(customer, sample);
  });
  test("Pallav's words for the mobile; unique; an edit keeps the stored number unless a new one is sent; the masked text sent back keeps it too", async () => {
    let res = await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ mobile: "12345" })));
    assert.deepEqual(await fields(res), { mobile: "Enter the mobile number as digits only, 10 to 15 of them." });
    const c = (await json(await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput())))).data.customer;
    res = await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ name: "Other", mobile: "919876543210" })));
    assert.deepEqual(await fields(res), { mobile: "A customer with this mobile number already exists." });
    const { idProofNumber: _drop, ...noNumber } = customerInput({ city: "Ahmedabad" });
    void _drop;
    const edited = (await json(await updateCustomerRoute(req("PATCH", `/api/v1/companies/customers/${c.id}`, "clerk", noNumber), ctx({ id: c.id })))).data;
    assert.deepEqual([edited.city, edited.idProofNumber], ["Ahmedabad", "\u2022\u2022\u2022\u20229012"]);
    assert.equal(data().customers[0].idProofNumber, "1234 5678 9012", "an edit without the number leaves the stored number");
    // the screen sends back what it was shown: that keeps the stored number, never saves the mask as the number
    const same = await updateCustomerRoute(req("PATCH", `/api/v1/companies/customers/${c.id}`, "clerk", customerInput({ idProofNumber: "\u2022\u2022\u2022\u20229012" })), ctx({ id: c.id }));
    assert.equal(same.status, 200);
    assert.equal(data().customers[0].idProofNumber, "1234 5678 9012");
    // a mask that is not this customer's is refused, and nothing changes
    res = await updateCustomerRoute(req("PATCH", `/api/v1/companies/customers/${c.id}`, "clerk", customerInput({ idProofNumber: "\u2022\u2022\u2022\u20220000" })), ctx({ id: c.id }));
    assert.deepEqual(await fields(res), { idProofNumber: "Type the whole ID number again, or leave it as it is." });
    assert.equal(data().customers[0].idProofNumber, "1234 5678 9012");
    // a new number replaces it, and "" removes it
    await updateCustomerRoute(req("PATCH", `/api/v1/companies/customers/${c.id}`, "clerk", customerInput({ idProofNumber: "P7654321" })), ctx({ id: c.id }));
    assert.equal(data().customers[0].idProofNumber, "P7654321");
    const removed = (await json(await updateCustomerRoute(req("PATCH", `/api/v1/companies/customers/${c.id}`, "clerk", customerInput({ idProofNumber: "" })), ctx({ id: c.id })))).data;
    assert.deepEqual([data().customers[0].idProofNumber, removed.idProofNumber, removed.idProofMasked], [null, "", false]);
  });
  test("Show (decision 74): the whole number for someone who may edit, one Activity line per Show with no number in it; refused to others; list and PDF stay masked", async () => {
    const c = (await json(await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput())))).data.customer;
    const before = data().systemLogs.length;
    const shown = await revealIdRoute(req("POST", `/api/v1/companies/customers/${c.id}/id-number`, "clerk"), ctx({ id: c.id }));
    assert.equal(shown.status, 200);
    assert.deepEqual((await json(shown)).data, { idProofNumber: "1234 5678 9012" });
    assert.equal(data().systemLogs.length, before + 1);
    assert.equal(data().systemLogs.at(-1)?.summary, "ID number shown for Ravi Mehta");
    assert.ok(!JSON.stringify(data().systemLogs).includes("1234 5678"), "the number is never written to the log");
    // an Admin may; a colleague who did not add it may not; a viewer has no edit permission
    assert.equal((await revealIdRoute(req("POST", `/api/v1/companies/customers/${c.id}/id-number`, "admin"), ctx({ id: c.id }))).status, 200);
    const other = await revealIdRoute(req("POST", `/api/v1/companies/customers/${c.id}/id-number`, "editor"), ctx({ id: c.id }));
    assert.equal(other.status, 403);
    assert.equal((await revealIdRoute(req("POST", `/api/v1/companies/customers/${c.id}/id-number`, "viewer"), ctx({ id: c.id }))).status, 403);
    assert.equal((await revealIdRoute(req("POST", `/api/v1/companies/customers/${c.id}/id-number`, "adminB"), ctx({ id: c.id }))).status, 404, "another hotel's customer");
    const refused = data().systemLogs.length;
    assert.equal(refused, before + 2, "a refused Show writes no line");
    // nothing that reads the customer returns the whole number
    const list = await (await listCustomersRoute(req("GET", "/api/v1/companies/customers", "viewer"))).text();
    const one = await (await getCustomerRoute(req("GET", `/api/v1/companies/customers/${c.id}`, "viewer"), ctx({ id: c.id }))).text();
    for (const text of [list, one]) assert.ok(!text.includes("1234 5678 9012") && text.includes("9012"));
    // a customer with no number: a plain refusal
    const none = (await json(await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ name: "No Id", mobile: "9000000009", email: "", idProofNumber: "" }))))).data.customer;
    const res = await revealIdRoute(req("POST", `/api/v1/companies/customers/${none.id}/id-number`, "clerk"), ctx({ id: none.id }));
    assert.equal(res.status, 409);
  });
  test("edit only by an Admin or whoever added it; reset login needs an email; delete only an Admin", async () => {
    const c = (await json(await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ email: "" }))))).data.customer;
    let res = await updateCustomerRoute(req("PATCH", `/api/v1/companies/customers/${c.id}`, "editor", customerInput()), ctx({ id: c.id }));
    assert.equal((await json(res)).error.message, "Only an Admin or whoever added this customer can edit it.");
    res = await resetLoginRoute(req("POST", `/api/v1/companies/customers/${c.id}/reset-login`, "clerk"), ctx({ id: c.id }));
    assert.equal((await json(res)).error.message, "Add an email address for Ravi Mehta first: the new password is sent there.");
    await updateCustomerRoute(req("PATCH", `/api/v1/companies/customers/${c.id}`, "clerk", customerInput()), ctx({ id: c.id }));
    const ok = (await json(await resetLoginRoute(req("POST", `/api/v1/companies/customers/${c.id}/reset-login`, "clerk"), ctx({ id: c.id })))).data;
    assert.equal(ok.message, "A new login was emailed to ravi@example.com.");
    assert.equal(data().systemLogs.at(-1)?.summary, "Login reset for Ravi Mehta");
    assert.equal((await json(await deleteCustomerRoute(req("DELETE", `/api/v1/companies/customers/${c.id}`, "editor"), ctx({ id: c.id })))).error.message, "Only an Admin can delete a customer.");
    assert.equal((await deleteCustomerRoute(req("DELETE", `/api/v1/companies/customers/${c.id}`, "admin"), ctx({ id: c.id }))).status, 200);
    assert.equal(data().customers.length, 0);
  });
  test("list: tabs active/off, the numbers on top, last sign-in from the platform", async () => {
    await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput()));
    await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ name: "Neha", mobile: "9000000001", email: "", isActive: false, idProofNumber: "" })));
    const body = (await json(await listCustomersRoute(req("GET", "/api/v1/companies/customers", "viewer")))).data;
    assert.deepEqual(body.counts, { all: 2, active: 1, off: 1 });
    assert.deepEqual(body.stats, { total: 2, selfSignup: 0, withEmail: 1, addedThisMonth: 2 });
    assert.ok(body.page.items.some((c: Customer) => c.lastLoginAt !== null));
    const off = (await json(await listCustomersRoute(req("GET", "/api/v1/companies/customers?tab=off", "viewer")))).data;
    assert.deepEqual(off.page.items.map((c: Customer) => c.name), ["Neha"]);
  });
});

describe("email marketing (campaigns through the hotel's own mail server)", () => {
  const campaignInput = (over: Record<string, unknown> = {}) => ({ subject: "Diwali offer", body: "Dear {name}, 15% off every room from 18 to 24 October.", audience: "all", ...over });
  async function campaign(over: Record<string, unknown> = {}, who = "clerk"): Promise<Campaign> {
    const res = await createCampaignRoute(req("POST", "/api/v1/companies/marketing/campaigns", who, campaignInput(over)));
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    return (await json(res)).data;
  }
  const stay = (guestName: string, email: string | null): StayRecord => ({ id: `s-${guestName}`, guestName, email, status: "checked_out" } as unknown as StayRecord);
  /** The hotel's reachable people: two active customers (one without an email), an inactive one, a company with a contact, two stays (one address shared with a customer). */
  async function people(): Promise<void> {
    await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ name: "Ravi Mehta", mobile: "9876543210", email: "Ravi@Example.com" })));
    await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ name: "No Mail", mobile: "9876543211", email: "" })));
    await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput({ name: "Gone", mobile: "9876543212", email: "gone@example.com", isActive: false })));
    await company({ email: "accounts@infosys.example", contacts: [{ role: "Accounts", name: "Priya", email: "priya@infosys.example", mobile: "" }] });
    data().stays.push(stay("Ravi Mehta", "ravi@example.com"), stay("Meera Patel", "meera@example.com"), stay("Walk In", null));
  }
  const mailOn = () => {
    data().settings.set("email.host", "smtp.hotel.test");
    data().settings.set("email.from_address", "news@hotel.test");
  };

  test("the page: audience sizes (active customers with an email, companies and their contacts, the stays' guests; each address once; opt-outs out), whether mail can go out, where a test goes; contract shape", async () => {
    await people();
    let res = await marketingRoute(req("GET", "/api/v1/companies/marketing", "viewer"));
    assert.equal(res.status, 200);
    let page: MarketingOverview = (await json(res)).data;
    assert.deepEqual(page.audience, { customers: 1, companies: 2, guests: 2, all: 4 });
    // a hotel needs no mail setup of its own: its mail goes out through the platform's Amazon SES
    assert.deepEqual([page.mailReady, page.myEmail, page.optOuts, page.campaigns], [true, null, 0, []]);
    mailOn();
    res = await marketingRoute(req("GET", "/api/v1/companies/marketing", "clerk"));
    page = (await json(res)).data;
    assert.deepEqual([page.mailReady, page.myEmail], [true, "chetan@hotel.test"]);
    const c = await campaign();
    const sample: Campaign = { id: "x", subject: "s", body: "b", audience: "all", status: "draft", recipients: 0, queued: 0, leftOut: 0, delivered: 0, failed: 0, pending: 0, sentAt: null, finishedAt: null, createdAt: "t", createdBy: "n" };
    assertMatchesContract(c, sample);
    assert.deepEqual([c.status, c.recipients, c.createdBy, c.audience], ["draft", 0, "Chetan Clerk", "all"]);
    assert.equal((await json(await marketingRoute(req("GET", "/api/v1/companies/marketing", "viewer")))).data.campaigns[0].id, c.id);
    assert.equal((await createCampaignRoute(req("POST", "/api/v1/companies/marketing/campaigns", "viewer", campaignInput()))).status, 403, "a viewer cannot write");
    assert.equal((await marketingRoute(req("GET", "/api/v1/companies/marketing", "nobody"))).status, 403);
  });

  test("a draft: subject and message needed and bounded; edited and deleted while a draft only; every change logged", async () => {
    let res = await createCampaignRoute(req("POST", "/api/v1/companies/marketing/campaigns", "clerk", campaignInput({ subject: "  ", body: "" })));
    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(await fields(res)).sort(), ["body", "subject"]);
    res = await createCampaignRoute(req("POST", "/api/v1/companies/marketing/campaigns", "clerk", campaignInput({ subject: "x".repeat(151) })));
    assert.equal(res.status, 422);
    assert.ok((await fields(res)).subject);
    const c = await campaign();
    res = await updateCampaignRoute(req("PATCH", `/api/v1/companies/marketing/campaigns/${c.id}`, "clerk", campaignInput({ subject: "Diwali week", audience: "guests" })), ctx({ id: c.id }));
    assert.equal(res.status, 200);
    const edited = (await json(res)).data;
    assert.deepEqual([edited.subject, edited.audience], ["Diwali week", "guests"]);
    const logs = data().systemLogs.filter((l) => l.entity === "Campaign").map((l) => l.summary);
    assert.deepEqual(logs, ["Added Campaign: Diwali offer", "Changed Campaign: Diwali week (Subject, Audience)"]);
    res = await deleteCampaignRoute(req("DELETE", `/api/v1/companies/marketing/campaigns/${c.id}`, "clerk"), ctx({ id: c.id }));
    assert.equal(res.status, 200);
    assert.equal((await json(await marketingRoute(req("GET", "/api/v1/companies/marketing", "clerk")))).data.campaigns.length, 0);
    assert.equal((await deleteCampaignRoute(req("DELETE", `/api/v1/companies/marketing/campaigns/${c.id}`, "clerk"), ctx({ id: c.id }))).status, 404);
  });

  const post = (route: typeof sendCampaignRoute, c: Campaign, action: string, body?: unknown) => route(req("POST", `/api/v1/companies/marketing/campaigns/${c.id}/${action}`, "clerk", body), ctx({ id: c.id }));
  const feed = () => feedCampaigns(feedPorts, () => clock);

  test("estimate and send: refused without a mail server or an audience; the confirmed number must still be right; the platform's suppressed addresses are left out; nothing is queued until the feeder runs; once", async () => {
    await people();
    const c = await campaign({ audience: "companies" });
    let res: Response;
    mailOn();
    const empty = await campaign({ audience: "customers" });
    data().customers.length = 0;
    res = await post(sendCampaignRoute, empty, "send", { expected: 1 });
    assert.equal(res.status, 422);
    assert.ok((await fields(res)).audience, "nobody to send to");
    // the estimate: 2 addresses, at the service's pace (2 a second, 500 a day)
    res = await estimateCampaignRoute(req("GET", `/api/v1/companies/marketing/campaigns/${c.id}/estimate`, "clerk"), ctx({ id: c.id }));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.deepEqual((await json(res)).data, { recipients: 2, leftOut: 0, perSecond: 2, perDay: 500, minutes: 1, days: 1, held: false });
    // a suppressed address leaves the audience: the confirmed 2 is now wrong
    suppressed.add("accounts@infosys.example");
    res = await post(sendCampaignRoute, c, "send", { expected: 2 });
    assert.equal(res.status, 409);
    assert.match(String((await fields(res)).expected), /it is 1 now/);
    assert.equal((await post(sendCampaignRoute, c, "send", {})).status, 422, "the confirmation is required");
    res = await post(sendCampaignRoute, c, "send", { expected: 1 });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const sending: Campaign = (await json(res)).data;
    assert.deepEqual([sending.status, sending.recipients, sending.queued, sending.leftOut, sending.finishedAt], ["sending", 1, 0, 1, null]);
    assert.ok(sending.sentAt);
    assert.equal(queued.length, 0, "nothing is queued by the send itself");
    assert.deepEqual(runs.map((r) => [r.hotelId, r.campaignId, r.state]), [[HOTEL_A, c.id, "sending"]]);
    assert.ok(data().systemLogs.some((l) => l.summary === 'Started sending "Diwali offer" to 1 address (1 left out)'));
    assert.equal((await post(sendCampaignRoute, c, "send", { expected: 1 })).status, 409, "once");
    assert.equal((await updateCampaignRoute(req("PATCH", `/api/v1/companies/marketing/campaigns/${c.id}`, "clerk", campaignInput()), ctx({ id: c.id }))).status, 409, "a campaign that began is kept as it is");
    assert.equal((await deleteCampaignRoute(req("DELETE", `/api/v1/companies/marketing/campaigns/${c.id}`, "clerk"), ctx({ id: c.id }))).status, 409);

    // the feeder: one mail per address through the hotel (greeting, {name}, sign-off, unsubscribe link); then, with nothing waiting, the campaign is sent and leaves the list
    assert.deepEqual(await feed(), { fed: 1, finished: 0, skipped: 0 });
    assert.deepEqual(queued.map((q) => [q.hotelId, q.to, q.template]), [[HOTEL_A, "priya@infosys.example", templateOf(c.id)]]);
    const mail = queued[0].payload;
    assert.equal(mail.subject, "Diwali offer");
    assert.ok(mail.text?.startsWith("Dear Priya, 15% off"), mail.text);
    assert.ok(mail.text?.endsWith("Warm regards,\nHotel Pallav"), mail.text);
    assert.equal(mail.unsubscribeUrl, `https://hms.test/api/v1/public/unsubscribe?h=${HOTEL_A}&e=priya%40infosys.example&t=${unsubscribeToken(SECRET, HOTEL_A, "priya@infosys.example")}`);
    assert.deepEqual(await feed(), { fed: 0, finished: 1, skipped: 0 });
    assert.deepEqual(runs, []);
    const page: MarketingOverview = (await json(await marketingRoute(req("GET", "/api/v1/companies/marketing", "clerk")))).data;
    const done = page.campaigns.find((x) => x.id === c.id) as Campaign;
    assert.deepEqual([done.status, done.recipients, done.queued, done.leftOut, done.delivered, done.failed, done.pending], ["sent", 1, 1, 1, 1, 0, 0]);
    assert.ok(done.finishedAt);
    assert.equal(queued.length, 1, "nothing more was queued");
    const plain = await campaign({ audience: "guests", body: "15% off every room." });
    assert.equal((await post(sendCampaignRoute, plain, "send", { expected: 2 })).status, 200);
    await feed();
    assert.deepEqual(queued.slice(1).map((q) => q.to), ["meera@example.com", "ravi@example.com"], "the stays' guests, each address once");
    assert.ok(queued[1].payload.text?.startsWith("Hello Meera Patel,\n\n15% off every room."), "a message without a greeting gets one");
  });

  test("the feeder: never more than FEED_AHEAD at once nor more than the hotel may send today; skips who unsubscribed or was suppressed meanwhile; a held hotel gets nothing", async () => {
    mailOn();
    for (let i = 0; i < FEED_AHEAD + 80; i += 1) data().stays.push(stay(`Guest ${String(i).padStart(3, "0")}`, `g${String(i).padStart(3, "0")}@x.in`));
    const c = await campaign({ audience: "guests" });
    assert.equal((await post(sendCampaignRoute, c, "send", { expected: FEED_AHEAD + 80 })).status, 200);
    heldWhy = "bounces 7.5% of 400 mails";
    assert.deepEqual(await feed(), { fed: 0, finished: 0, skipped: 0 }, "held: nothing");
    heldWhy = null;
    allowance = 50;
    assert.equal((await feed()).fed, 50, "what the hotel may still send today");
    allowance = Infinity;
    assert.equal((await feed()).fed, FEED_AHEAD, "at most FEED_AHEAD a round");
    // meanwhile one address unsubscribed and one was suppressed
    data().optOuts.add("g250@x.in");
    suppressed.add("g251@x.in");
    assert.deepEqual(await feed(), { fed: FEED_AHEAD + 80 - 50 - FEED_AHEAD - 2, finished: 0, skipped: 2 });
    assert.deepEqual(await feed(), { fed: 0, finished: 1, skipped: 0 });
    const page: MarketingOverview = (await json(await marketingRoute(req("GET", "/api/v1/companies/marketing", "clerk")))).data;
    const done = page.campaigns.find((x) => x.id === c.id) as Campaign;
    assert.deepEqual([done.status, done.recipients, done.queued, done.leftOut], ["sent", FEED_AHEAD + 80, FEED_AHEAD + 78, 2]);
    assert.equal(new Set(queued.map((q) => q.to)).size, queued.length, "nobody got it twice");
  });

  test("pause, resume and cancel: only from the right state; a paused campaign gets nothing; a cancelled one closes its waiting mails and leaves the list; each logged", async () => {
    await people();
    mailOn();
    const c = await campaign({ audience: "guests" });
    assert.equal((await post(pauseCampaignRoute, c, "pause")).status, 409, "a draft cannot be paused");
    assert.equal((await post(sendCampaignRoute, c, "send", { expected: 2 })).status, 200);
    assert.equal((await post(resumeCampaignRoute, c, "resume")).status, 409, "only a paused one resumes");
    let res = await post(pauseCampaignRoute, c, "pause");
    assert.equal(res.status, 200);
    assert.equal((await json(res)).data.status, "paused");
    assert.deepEqual(runs.map((r) => r.state), ["paused"]);
    assert.deepEqual(await feed(), { fed: 0, finished: 0, skipped: 0 });
    res = await post(resumeCampaignRoute, c, "resume");
    assert.equal((await json(res)).data.status, "sending");
    allowance = 1;
    assert.equal((await feed()).fed, 1);
    res = await post(cancelCampaignRoute, c, "cancel");
    assert.equal(res.status, 200);
    const cancelled: Campaign = (await json(res)).data;
    assert.deepEqual([cancelled.status, cancelled.queued, cancelled.recipients], ["cancelled", 1, 2]);
    assert.ok(cancelled.finishedAt);
    assert.deepEqual(cancelledTemplates, [templateOf(c.id)]);
    assert.deepEqual(runs, []);
    assert.equal((await post(cancelCampaignRoute, c, "cancel")).status, 409, "once");
    allowance = Infinity;
    assert.equal((await feed()).fed, 0, "the rest never goes");
    assert.deepEqual(data().systemLogs.filter((l) => l.entity === "Campaign").map((l) => l.summary).slice(-4), [
      'Started sending "Diwali offer" to 2 addresses', 'Paused "Diwali offer"', 'Resumed "Diwali offer"', 'Cancelled "Diwali offer" after 1 of 2 were queued',
    ]);
  });
  test("a test mail goes to the signed-in person's own address (none on the account: refused); the unsubscribe link records the opt-out once and the address leaves every audience; a forged link is refused", async () => {
    await people();
    mailOn();
    const c = await campaign();
    let res = await testCampaignRoute(req("POST", `/api/v1/companies/marketing/campaigns/${c.id}/test`, "clerk"), ctx({ id: c.id }));
    assert.equal(res.status, 200);
    assert.deepEqual((await json(res)).data, { to: "chetan@hotel.test" });
    assert.deepEqual(queued.map((q) => [q.to, q.template, q.payload.name]), [["chetan@hotel.test", "campaign-test", "Chetan Clerk"]]);
    res = await testCampaignRoute(req("POST", `/api/v1/companies/marketing/campaigns/${c.id}/test`, "editor"), ctx({ id: c.id }));
    assert.equal(res.status, 422, "Esha has no email on the platform");
    const token = unsubscribeToken(SECRET, HOTEL_A, "meera@example.com");
    const link = `/api/v1/public/unsubscribe?h=${HOTEL_A}&e=meera%40example.com&t=${token}`;
    // opening the link only ASKS (a link scanner opening every link unsubscribes nobody; security review L3): one button that posts to the same address
    res = await unsubscribeRoute(req("GET", link, null));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    const asked = await res.text();
    assert.ok(asked.includes("meera@example.com") && asked.includes(`<form method="post" action="${link.replace(/&/g, "&amp;")}">`));
    const before: MarketingOverview = (await json(await marketingRoute(req("GET", "/api/v1/companies/marketing", "clerk")))).data;
    assert.equal(before.optOuts, 0, "nothing recorded by opening the link");
    // the button (or a mail program's one-click POST) records it; twice is fine
    res = await unsubscribePost(req("POST", link, null));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /You are unsubscribed/);
    assert.equal((await unsubscribePost(req("POST", link, null))).status, 200, "twice is fine");
    assert.equal((await unsubscribeRoute(req("GET", `/api/v1/public/unsubscribe?h=${HOTEL_A}&e=ravi%40example.com&t=${token}`, null))).status, 404, "another address with this signature");
    assert.equal((await unsubscribePost(req("POST", `/api/v1/public/unsubscribe?h=${HOTEL_A}&e=ravi%40example.com&t=${token}`, null))).status, 404);
    const page: MarketingOverview = (await json(await marketingRoute(req("GET", "/api/v1/companies/marketing", "clerk")))).data;
    assert.deepEqual([page.optOuts, page.audience.guests, page.audience.all], [1, 1, 3]);
  });
});

describe("the company ledger (CompanyLedgerController)", () => {
  const slot = (date: string | null = null, h: number | null = null): DebitSlot => ({ date, hotelPaise: h === null ? null : BigInt(h), foodPaise: null, hotelMode: date ? "Cash" : null, foodMode: null });
  function bill(n: number, companyId: string, over: Partial<BillRecord> = {}): void {
    data().bills.push({
      id: id(1000 + n), entryNo: n, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)), companyId, billNumber: `2026 / ${n}`, billDate: "2026-09-10", guestName: "G", roomNumber: null, instruction: null,
      totalHotelAmountPaise: BigInt(100000), totalFoodAmountPaise: BigInt(0), hotelModeOfPayment: "Debit", foodModeOfPayment: null, advanceId: null, advanceReceiptNumber: null,
      advanceHotelAmountPaise: BigInt(0), advanceFoodAmountPaise: BigInt(0), debit: [slot(), slot(), slot(), slot(), slot()], debitInstruction: null, balanceHotelAmountPaise: BigInt(100000), balanceFoodAmountPaise: BigInt(0), deletedAt: null, ...over,
    } as unknown as BillRecord);
  }
  test("overview from one aggregate: who owes most first, then in credit, then quiet ones; counts, stats, paid percent; contract shape", async () => {
    const owes = await company({ name: "Owes Ltd", gstNumber: "" });
    const credit = await company({ name: "Credit Co", gstNumber: "" });
    await company({ name: "Quiet Co", gstNumber: "" });
    bill(1, owes.id);
    bill(2, owes.id, { debit: [slot("2026-09-20", 40000), slot(), slot(), slot(), slot()] });
    data().advances.push({ id: id(2001), entryNo: 1, createdAt: new Date(), receiptNumber: "2026 / 9", companyId: credit.id, paymentDate: "2026-10-02", hotelAmountPaise: BigInt(25000), foodAmountPaise: BigInt(0), refundPaymentDate: null, deletedAt: null } as unknown as AdvanceRecord);
    const o = (await json(await overviewRoute(req("GET", "/api/v1/companies/ledger", "viewer")))).data;
    assert.deepEqual(o.page.items.map((r: LedgerSummary) => [r.companyName, r.state, r.balancePaise]), [["Owes Ltd", "owing", 160000], ["Credit Co", "credit", -25000], ["Quiet Co", "settled", 0]]);
    assert.deepEqual(o.counts, { all: 3, owing: 1, credit: 1, settled: 1 });
    assert.deepEqual(o.stats, { owedPaise: 160000, owing: 1, heldPaise: 25000, holding: 1, monthBilledPaise: 0, monthReceivedPaise: 25000 });
    assert.equal(o.page.items[0].paidPercent, 20);
    assert.equal(o.page.items[2].paidPercent, null);
    const sample: LedgerSummary = { companyId: "x", companyName: "x", gstNumber: "x", billedPaise: 1, receivedPaise: 1, refundedPaise: 1, balancePaise: 1, state: "owing", paidPercent: null, entries: 1, bills: 1, openBills: 1, lastDate: null };
    for (const r of o.page.items) assertMatchesContract(r, sample);
    assert.deepEqual((await json(await overviewRoute(req("GET", "/api/v1/companies/ledger?show=credit", "viewer")))).data.page.items.map((r: LedgerSummary) => r.companyName), ["Credit Co"]);
  });
  test("one account: opens on the LAST page, a period carries its opening, search keeps the running balance", async () => {
    const c = await company({ gstNumber: "" });
    for (let i = 1; i <= 30; i++) bill(i, c.id, { billDate: `2026-09-${String(i).padStart(2, "0")}` });
    const acc = (await json(await accountRoute(req("GET", `/api/v1/companies/${c.id}/ledger?pageSize=25`, "viewer"), ctx({ id: c.id })))).data;
    assert.deepEqual([acc.page.page, acc.page.items.length, acc.page.total], [2, 5, 30]);
    assert.equal(acc.closingPaise, 3000000);
    assert.equal(acc.openBills, 30);
    const period = (await json(await accountRoute(req("GET", `/api/v1/companies/${c.id}/ledger?from=2026-09-21&to=2026-09-10`, "viewer"), ctx({ id: c.id })))).data;
    assert.deepEqual([period.period, period.from, period.to, period.openingPaise, period.periodLines.length], ["custom", "2026-09-10", "2026-09-21", 900000, 12], "an end before the start is swapped");
    const found = (await json(await accountRoute(req("GET", `/api/v1/companies/${c.id}/ledger?search=%230007`, "viewer"), ctx({ id: c.id })))).data;
    assert.deepEqual(found.page.items.map((l: LedgerLine) => l.balancePaise), [700000]);
  });
  test("the statement: opening, rows with the server's running balance, closing, totals; from after to, too long and over 5,000 rows refused", async () => {
    const c = await company({ gstNumber: "" });
    bill(1, c.id, { billDate: "2026-08-01" });
    bill(2, c.id, { billDate: "2026-09-05", debit: [slot("2026-09-06", 30000), slot(), slot(), slot(), slot()] });
    const s = (await json(await statementRoute(req("GET", `/api/v1/companies/${c.id}/statement?from=2026-09-01&to=2026-09-30`, "viewer"), ctx({ id: c.id })))).data;
    assert.deepEqual([s.openingBalancePaise, s.rows.length, s.closingBalancePaise, s.totals], [100000, 2, 170000, { debitPaise: 100000, creditPaise: 30000 }]);
    assert.deepEqual(s.rows.map((r: LedgerLine) => r.balancePaise), [200000, 170000]);
    assert.equal((await json(await statementRoute(req("GET", `/api/v1/companies/${c.id}/statement?from=2026-09-30&to=2026-09-01`, "viewer"), ctx({ id: c.id })))).error.message, "The to date must be on or after the from date.");
    assert.equal((await json(await statementRoute(req("GET", `/api/v1/companies/${c.id}/statement?from=2020-01-01&to=2026-01-01`, "viewer"), ctx({ id: c.id })))).error.message, "Choose a period of at most three years.");
    for (let i = 3; i <= 5003; i++) bill(i, c.id, { billDate: "2026-07-15" });
    const big = await statementRoute(req("GET", `/api/v1/companies/${c.id}/statement?from=2026-07-01&to=2026-07-31`, "viewer"), ctx({ id: c.id }));
    assert.equal(big.status, 422);
    assert.equal((await json(big)).error.message, "This period has 5,001 entries, more than 5,000: choose a shorter period.");
  });
  test("the statement as a PDF (MJ #22): inline application/pdf with the statement's permission and limits; the figures are the statement's, with the hotel's header", async () => {
    const c = await company({ gstNumber: "24ABCDE1234F1Z5" });
    bill(1, c.id, { billDate: "2026-08-01" });
    bill(2, c.id, { billDate: "2026-09-05", debit: [slot("2026-09-06", 30000), slot(), slot(), slot(), slot()] });
    const url = `/api/v1/companies/${c.id}/statement/pdf?from=2026-09-01&to=2026-09-30`;
    const res = await statementPdfRoute(req("GET", url, "ledgerOnly"), ctx({ id: c.id }));
    assert.equal(res.status, 200);
    assert.deepEqual([res.headers.get("content-type"), res.headers.get("cache-control"), res.headers.get("content-disposition")?.startsWith("inline; filename=")], ["application/pdf", "no-store", true]);
    assert.equal(Buffer.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toString("latin1"), "%PDF-");
    const file = await getCompanyLedger().statementDocument(sessions.get("viewer")!, c.id, { from: "2026-09-01", to: "2026-09-30" });
    const text = (await createDocumentRenderer().render("payrollDoc", file)).text.join("|");
    for (const must of ["Statement of Account", "24ABCDE1234F1Z5", "01 Sep 2026 to 30 Sep 2026", formatINR(100000), formatINR(170000), "Closing balance due"]) assert.ok(text.includes(must), `missing: ${must}`);
    assert.equal((await statementPdfRoute(req("GET", url, "nobody"), ctx({ id: c.id }))).status, 403);
    assert.equal((await statementPdfRoute(req("GET", url, "adminB"), ctx({ id: c.id }))).status, 404);
    assert.equal((await statementPdfRoute(req("GET", `/api/v1/companies/${c.id}/statement/pdf?from=2026-09-30&to=2026-09-01`, "viewer"), ctx({ id: c.id }))).status, 422);
  });
  test("receivables by age (H8): open bills in 30-day buckets from the bill date as of today, most owed first, totals; the CSV; nothing for a settled company", async () => {
    const a = await company({ name: "Aged Ltd", gstNumber: "" });
    const b = await company({ name: "Fresh Co", gstNumber: "" });
    await company({ name: "Quiet Co", gstNumber: "" });
    // today is 2026-10-05: 5 Oct = 0 days, 1 Sep = 34 days, 1 Aug = 65 days, 1 Jun = 126 days
    bill(1, a.id, { billDate: "2026-06-01" });
    bill(2, a.id, { billDate: "2026-08-01", balanceHotelAmountPaise: BigInt(50000) });
    bill(3, a.id, { billDate: "2026-09-01", balanceHotelAmountPaise: BigInt(0), balanceFoodAmountPaise: BigInt(0) });
    bill(4, b.id, { billDate: "2026-09-01", balanceHotelAmountPaise: BigInt(20000), balanceFoodAmountPaise: BigInt(5000) });
    bill(5, b.id, { billDate: "2026-10-05" });
    const r = (await json(await ageingRoute(req("GET", "/api/v1/companies/ledger/ageing", "ledgerOnly")))).data;
    assert.equal(r.asOf, "2026-10-05");
    assert.deepEqual(r.rows, [
      { companyId: a.id, companyName: "Aged Ltd", currentPaise: 0, days31to60Paise: 0, days61to90Paise: 50000, over90Paise: 100000, totalPaise: 150000, openBills: 2 },
      { companyId: b.id, companyName: "Fresh Co", currentPaise: 100000, days31to60Paise: 25000, days61to90Paise: 0, over90Paise: 0, totalPaise: 125000, openBills: 2 },
    ]);
    assert.deepEqual(r.totals, { currentPaise: 100000, days31to60Paise: 25000, days61to90Paise: 50000, over90Paise: 100000, totalPaise: 275000, openBills: 4 });
    const csv = await ageingCsvRoute(req("GET", "/api/v1/companies/ledger/ageing/csv", "viewer"));
    assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
    const text = new TextDecoder().decode(new Uint8Array(await csv.arrayBuffer()).subarray(3));
    assert.deepEqual(text.trim().split("\r\n"), [
      '"Company","0 to 30 days (Rs)","31 to 60 days (Rs)","61 to 90 days (Rs)","Over 90 days (Rs)","Total due (Rs)","Open bills"',
      '"Aged Ltd","0.00","0.00","500.00","1000.00","1500.00",2',
      '"Fresh Co","1000.00","250.00","0.00","0.00","1250.00",2',
      '"Total","1000.00","250.00","500.00","1000.00","2750.00",4',
    ]);
    assert.equal((await ageingRoute(req("GET", "/api/v1/companies/ledger/ageing", "nobody"))).status, 403);
    assert.deepEqual((await json(await ageingRoute(req("GET", "/api/v1/companies/ledger/ageing", "adminB")))).data.rows, [], "another hotel sees nothing of this one");
  });
  test("the statement as a CSV download: BOM, header, opening, every row with its balance, totals, closing; the statement's permission and limits", async () => {
    const c = await company({ gstNumber: "" });
    bill(1, c.id, { billDate: "2026-08-01" });
    bill(2, c.id, { billDate: "2026-09-05", debit: [slot("2026-09-06", 30000), slot(), slot(), slot(), slot()] });
    const url = `/api/v1/companies/${c.id}/statement/csv?from=2026-09-01&to=2026-09-30`;
    const res = await statementCsvRoute(req("GET", url, "ledgerOnly"), ctx({ id: c.id }));
    assert.equal(res.status, 200);
    assert.deepEqual([res.headers.get("content-type"), res.headers.get("content-disposition")?.startsWith("attachment; filename=")], ["text/csv; charset=utf-8", true]);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "a UTF-8 BOM for Excel");
    const text = new TextDecoder().decode(bytes.subarray(3));
    assert.ok(text.startsWith("\"Date\",\"Entry\",\"Ref\",\"Guest\",\"Room\",\"Mode\",\"Note\",\"Debit (Rs)\",\"Credit (Rs)\",\"Balance (Rs)\"\r\n"), text.slice(0, 120));
    const rows = text.trim().split("\r\n");
    assert.equal(rows.length, 1 + 1 + 2 + 2, "header, opening, two entries, totals, closing");
    assert.ok(rows[1].startsWith('"2026-09-01","Opening balance",,,,,,,,"1000.00"'), rows[1]);
    assert.ok(rows[2].endsWith('"2000.00"') && rows[3].endsWith('"1700.00"'), `${rows[2]} / ${rows[3]}`);
    assert.ok(rows[4].includes('"Totals",,,,,,"1000.00","300.00",'), rows[4]);
    assert.ok(rows[5].startsWith('"2026-09-30","Closing balance"') && rows[5].endsWith('"1700.00"'), rows[5]);
    assert.equal((await statementCsvRoute(req("GET", url, "nobody"), ctx({ id: c.id }))).status, 403);
    assert.equal((await statementCsvRoute(req("GET", url, "adminB"), ctx({ id: c.id }))).status, 404);
    assert.equal((await statementCsvRoute(req("GET", `/api/v1/companies/${c.id}/statement/csv?from=2026-09-30&to=2026-09-01`, "viewer"), ctx({ id: c.id }))).status, 422);
  });
  test("the company profile, the guest profile and the ledger summary as PDFs: the screens' fields and permissions; the guest's ID number as its last 4 (decision 74)", async () => {
    const c = await company({ gstNumber: "24ABCDE1234F1Z5", instruction: "Invoice to head office" });
    bill(1, c.id, { billDate: "2026-09-05" });
    const customer = (await json(await createCustomerRoute(req("POST", "/api/v1/companies/customers", "clerk", customerInput())))).data.customer;
    const pdf = async (route: typeof companyPdfRoute, url: string, who: string, id?: string) => route(req("GET", url, who), ctx(id ? { id } : {}));
    for (const [route, url, id] of [[companyPdfRoute, `/api/v1/companies/${c.id}/pdf`, c.id], [customerPdfRoute, `/api/v1/companies/customers/${customer.id}/pdf`, customer.id], [ledgerPdfRoute, "/api/v1/companies/ledger/pdf", undefined]] as const) {
      const res = await pdf(route as typeof companyPdfRoute, url, "viewer", id);
      assert.equal(res.status, 200, url);
      assert.deepEqual([res.headers.get("content-type"), res.headers.get("cache-control")], ["application/pdf", "no-store"]);
      assert.equal(Buffer.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toString("latin1"), "%PDF-");
      assert.equal((await pdf(route as typeof companyPdfRoute, url, "nobody", id)).status, 403, url);
      assert.equal((await pdf(route as typeof companyPdfRoute, url, "adminB", id)).status, id ? 404 : 200, url);
    }
    const renderer = createDocumentRenderer({ timeoutMs: 90_000 });
    const text = async (file: unknown) => (await renderer.render("payrollDoc", file as never)).text.join("|");
    const company_ = await text(await getCompanies().profileDocument(sessions.get("viewer")!, c.id));
    for (const must of ["Company profile", c.name, "24ABCDE1234F1Z5", "Invoice to head office"]) assert.ok(company_.includes(must), `missing: ${must}`);
    const guest = await text(await getCustomers().profileDocument(sessions.get("viewer")!, customer.id));
    assert.ok(guest.includes("Ravi Mehta") && guest.includes("9012") && !guest.includes("1234 5678 9012"), "the ID number prints as its last 4 only");
    const summary = await text(await getCompanyLedger().summaryDocument(sessions.get("viewer")!, { show: "all" }));
    for (const must of ["Company ledger summary", c.name, "Owed to the hotel"]) assert.ok(summary.includes(must), `missing: ${must}`);
  });
  test("the ledger needs the companies.ledger part (the module spreads to it); the part alone does not open the company list; isolation", async () => {
    const c = await company();
    assert.equal((await overviewRoute(req("GET", "/api/v1/companies/ledger", "nobody"))).status, 403);
    assert.equal((await overviewRoute(req("GET", "/api/v1/companies/ledger", "ledgerOnly"))).status, 200);
    assert.equal((await accountRoute(req("GET", `/api/v1/companies/${c.id}/ledger`, "ledgerOnly"), ctx({ id: c.id }))).status, 200);
    assert.equal((await listCompaniesRoute(req("GET", "/api/v1/companies", "ledgerOnly"))).status, 403);
    assert.equal((await overviewRoute(req("GET", "/api/v1/companies/ledger", "editor"))).status, 200, "Full Access on the module spreads to its parts");
    assert.equal((await statementRoute(req("GET", `/api/v1/companies/${c.id}/statement?from=2026-09-01&to=2026-09-30`, "adminB"), ctx({ id: c.id }))).status, 404);
    assert.equal((await getCompanyRoute(req("GET", `/api/v1/companies/${c.id}`, "adminB"), ctx({ id: c.id }))).status, 404);
    assert.equal((await listCompaniesRoute(req("GET", "/api/v1/companies", "nobody"))).status, 403);
  });
});

const MYSQL = "needs the MySQL companies repositories (Worker A, M3): un-skipped when they land";
describe("companies on MySQL (skipped until the repositories exist)", () => {
  test("summaryByCompany() in SQL equals totals(build()) for every company (the same property as the in-memory double)", { skip: MYSQL }, () => {});
  test("EXPLAIN: bill_master_bills(company_id, bill_date) and bill_master_advances(company_id, payment_date) serve the overview and one account", { skip: MYSQL }, () => {});
  test("the company name is unique among LIVE rows (functional unique index); the customer mobile is unique", { skip: MYSQL }, () => {});
  test("the real GuestAccounts port: a platform user linked by user_hotels.subject_id, a temporary password through the outbox, must change at first sign-in", { skip: MYSQL }, () => {});
});
