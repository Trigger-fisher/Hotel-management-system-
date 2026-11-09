// Mail routing (MJ, 17 Oct 2026): system mail goes from the PLATFORM email, invoices and every mail that carries a hotel's data go from THAT HOTEL's own email.
// This file proves the rule table (and that a new kind with no route fails here), the guard on the outbox, "Email bill" / "Email receipt" for staff and "Email me a copy" for the
// guest (own bill only, rate limited), the PDF made at send time, the hotel's sender versus the platform's (with the hotel as the sender name when it has no server of its own),
// and the reason a mail failed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { before, beforeEach, describe, test } from "node:test";
import nodemailer from "nodemailer";
import { POST as advanceEmailRoute } from "../../src/app/api/v1/billing/advances/[id]/email/route";
import { POST as advanceCreateRoute } from "../../src/app/api/v1/billing/advances/route";
import { POST as billEmailRoute } from "../../src/app/api/v1/billing/bills/[id]/email/route";
import { POST as billCreateRoute } from "../../src/app/api/v1/billing/bills/route";
import { POST as guestEmailRoute } from "../../src/app/api/v1/guest/bills/[id]/email/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { attachmentLines, attachmentsOf } from "../../src/server/compose/mail";
import { configureBillingAdvances, configureBillingBills } from "../../src/server/compose/billing";
import { configureDocumentRenderer, createDocumentRenderer } from "../../src/server/documents";
import { AppError } from "../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { MAIL_FAILURE_TEXT } from "../../src/server/mail/failure";
import { createHotelMailRouter } from "../../src/server/mail/hotelSmtp";
import { assertMailRoute, MAIL_KINDS, MAIL_ROUTE, MailRouteError } from "../../src/server/mail/routes";
import { sealSmtpSecret, type SmtpTransport } from "../../src/server/mail/smtp";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import { createAdvanceService } from "../../src/server/services/billing/advanceService";
import { createBillService } from "../../src/server/services/billing/billService";
import { createMailQueue, queueMail, renderMail, runOutboxOnce, type MailAttachment, type MailMessage, type MailSender } from "../../src/server/services/auth/mail";
import type { Person } from "../../src/server/services/cash/ports";
import { advance as advanceRow, bill as billRow, ctx as pctx, customer, pid, req as preq, wirePortal } from "./helpers/portalWorld";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const KEY = randomBytes(32);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
describe("the rule table", () => {
  test("every kind the database allows has a route, and the table has no kind the database does not know: a new kind with no route fails here", () => {
    const dir = path.join(process.cwd(), "..", "common", "db", "migrations", "platform");
    let allowed: string[] = [];
    for (const f of readdirSync(dir).sort()) {
      const sql = readFileSync(path.join(dir, f), "utf8");
      // the LAST migration that (re)defines outbox_kind_known wins
      const m = /ADD CONSTRAINT outbox_kind_known CHECK \(kind IN \(([^)]*)\)\)/.exec(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n"));
      if (m) allowed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    }
    assert.ok(allowed.length >= 21, `found ${allowed.length} kinds in the migrations`);
    assert.deepEqual(allowed.filter((k) => !(k in MAIL_ROUTE)), [], "a kind with no route");
    assert.deepEqual(MAIL_KINDS.filter((k) => !allowed.includes(k)), [], "a route for a kind the database does not allow");
    for (const kind of MAIL_KINDS) assert.doesNotThrow(() => renderMail(kind, { name: "N", hotelName: "H", number: "1" }), `${kind} has a subject and a text`);
  });

  test("the table is MJ's rule: system mail from the platform; invoices, receipts, enquiry answers, the daily summary and campaigns from the hotel", () => {
    assert.deepEqual(Object.entries(MAIL_ROUTE).filter(([, r]) => r === "hotel").map(([k]) => k).sort(), ["advance_receipt", "bill_invoice", "campaign", "daily_summary", "enquiry_confirmed", "enquiry_declined", "enquiry_new", "notification"]);
    for (const k of ["login_code", "reset_code", "reset_link", "password_changed", "email_changed", "account_locked", "account_blocked", "new_device", "temp_password", "admin_reset", "invitation", "onboarding_waiting", "onboarding_approved", "onboarding_rejected"]) assert.equal(MAIL_ROUTE[k as keyof typeof MAIL_ROUTE], "platform", k);
  });

  test("the outbox refuses a hotel kind without a hotel, a platform kind with one, and an unknown kind, before anything is written", async () => {
    const auth = createMemoryAuth();
    const at = new Date("2026-10-17T10:00:00Z");
    const q = (kind: string, hotelId: string | null) => auth.unit.run((r) => queueMail(r, { userId: null, kind: kind as never, toEmail: "a@b.in", payload: { name: "A" }, hotelId }, at));
    await assert.rejects(() => q("bill_invoice", null), (e: unknown) => e instanceof MailRouteError && /must name its hotel/.test((e as Error).message));
    await assert.rejects(() => q("login_code", HOTEL_A), (e: unknown) => e instanceof MailRouteError && /must not name a hotel/.test((e as Error).message));
    await assert.rejects(() => q("pigeon", null), (e: unknown) => e instanceof MailRouteError && /no route/.test((e as Error).message));
    assert.equal(auth.data().outbox.length, 0);
    await q("bill_invoice", HOTEL_A);
    await q("login_code", null);
    assert.equal(auth.data().outbox.length, 2);
    assert.throws(() => assertMailRoute("campaign", ""), MailRouteError);
  });

  test("every place in the code that queues a mail with a literal kind gives a hotel kind its hotel and a platform kind none", () => {
    const root = path.join(process.cwd(), "src", "server");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (/\.ts$/.test(e.name)) files.push(path.join(dir, e.name));
      }
    };
    walk(root);
    let checked = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/(queueMail|outbox\.enqueue|\.queue)\(([^;]{0,600}?)(?:\bnow\b|\);|\}, )/g)) {
        const kind = /kind: "([a-z_]+)"/.exec(m[2])?.[1];
        if (!kind || !(kind in MAIL_ROUTE)) continue;
        checked += 1;
        const names = /hotelId(?!: null)/.test(m[2]);
        assert.equal(names, MAIL_ROUTE[kind as keyof typeof MAIL_ROUTE] === "hotel", `${path.relative(root, f)}: ${kind} ${names ? "names" : "does not name"} a hotel`);
      }
    }
    assert.ok(checked >= 12, `checked ${checked} queue sites`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(4), { id: id(4), name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("viewer", id(1), { grants: [grant("bills.bills", "view"), grant("bills.advances", "view")] });
mk("clerk", id(2), { grants: [grant("bills.bills", "create"), grant("bills.advances", "create")] });
mk("nobody", id(6), {});
mk("admin", id(4), { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("bills", "full")] });
mk("adminB", id(8), { hotelId: HOTEL_B, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("bills", "full")] });

let clock = new Date("2026-10-17T10:00:00+05:30");
let hotel = createMemoryHotel();
let auth = createMemoryAuth();
const now = () => clock;
const ORIGIN = "https://hms.test";
const call = (route: (r: Request, c: ReturnType<typeof pctx>) => Promise<Response>, method: string, who: string | null, body?: unknown, params: Record<string, string> = {}) => route(preq(method, "/x", who, body), pctx(params));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const jsonOf = async (res: Response) => (await res.json()) as any;
const hotelPart = { plan: "CP", roomPaise: 400000, planPaise: 50000, extraBedPaise: 80000, laundryPaise: 15050, vpoPaise: 7500, gstPaise: 66000, mode: "Cash" };
const foodPart = { foodPaise: 120000, planPaise: 0, laundryPaise: 0, gstPaise: 6000, mode: "Cash" };
const billInput = (over: Record<string, unknown> = {}) => ({
  billNo: "1188", billDate: "2026-10-05", grNo: "GR-77", advanceId: null, guestName: "Ravi Mehta", mobile: "9876543210", address: "Rajkot", gstin: "", companyId: null, roomNo: "204", persons: 2,
  arrivalAt: "2026-10-02T12:00:00Z", departureAt: "2026-10-05T05:30:00Z", hotel: hotelPart, food: foodPart, stay: [{ from: "2026-10-08", to: "2026-10-12", plan: "CP", persons: 2 }], referenceName: "", referenceMobile: "", instruction: "", ...over,
});
const advanceInput = () => ({ receiptNo: "814", paymentDate: "2026-10-01", guestName: "Ravi Mehta", mobile: "9876543210", companyId: null, roomNo: "", covers: "hotel", hotelPaise: 500000, foodPaise: null, hotelMode: "UPI", foodMode: null, referenceName: "", referenceMobile: "", instruction: "", });

before(() => configureDocumentRenderer(createDocumentRenderer({ timeoutMs: 90_000 })));
beforeEach(() => {
  clock = new Date("2026-10-17T10:00:00+05:30");
  hotel = createMemoryHotel();
  auth = createMemoryAuth();
  const deps = { unit: hotel.unit, people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async () => undefined }, catalog, now, mail: createMailQueue(auth.unit, now) };
  configureBillingBills(createBillService(deps));
  configureBillingAdvances(createAdvanceService(deps));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  for (const h of [HOTEL_A, HOTEL_B]) {
    const d = hotel.store.dataFor(h);
    d.profile = { name: h === HOTEL_A ? "Hotel Sunrise" : "Hotel Pearl", foodName: "Food", address: "150 Feet Ring Road, Rajkot", phone: "0281 245 6789", gstin: null, foodGstin: null };
    d.years = [{ id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }];
    d.mealPlanRates = [{ plan: "CP", effectiveFrom: "2026-01-01", ratePaise: BigInt(25000) }];
  }
  hotel.store.dataFor(HOTEL_A).customers.push(customer({ id: id(500), name: "Ravi Mehta", mobile: "9876543210", email: "Ravi@Example.com" }));
});

async function newBill(over: Record<string, unknown> = {}): Promise<string> {
  const res = await billCreateRoute(preq("POST", "/x", "clerk", billInput(over)), pctx());
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await jsonOf(res)).data.id as string;
}
const queued = () => auth.data().outbox;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
describe("staff: Email bill / Email receipt", () => {
  test("queues a bill_invoice for THIS hotel with no amount and no document in the row; the address defaults to the guest's email and can be typed; a log line has a shortened address", async () => {
    const billId = await newBill();
    let res = await call(billEmailRoute, "POST", "viewer", {}, { id: billId });
    assert.equal(res.status, 202, JSON.stringify(await res.clone().json()));
    assert.deepEqual((await jsonOf(res)).data, { queued: true, to: "ravi@example.com" });
    res = await call(billEmailRoute, "POST", "viewer", { to: " Other@Example.com " }, { id: billId });
    assert.equal((await jsonOf(res)).data.to, "other@example.com");
    assert.deepEqual(queued().map((o) => [o.kind, o.hotelId, o.toEmail, o.status]), [["bill_invoice", HOTEL_A, "ravi@example.com", "pending"], ["bill_invoice", HOTEL_A, "other@example.com", "pending"]]);
    const payload = JSON.parse(String(queued()[0].payload));
    assert.deepEqual(Object.keys(payload).sort(), ["billId", "hotelName", "name", "number"]);
    assert.equal(payload.billId, billId);
    assert.ok(!JSON.stringify(payload).includes("500000") && !JSON.stringify(payload).includes("Rajkot"), "no amount and no address in the outbox");
    const log = JSON.stringify(hotel.store.dataFor(HOTEL_A).systemLogs.at(-1));
    assert.ok(log.includes("o***@example.com") && !log.includes("other@example.com"));
  });

  test("errors: no address to send to (422 on `to`), a bad address, a bill that is not this hotel's (404), no permission (403), not signed in (401); nothing is queued", async () => {
    const billId = await newBill({ mobile: "9000000001" });
    const none = await call(billEmailRoute, "POST", "viewer", {}, { id: billId });
    assert.deepEqual([none.status, Object.keys((await jsonOf(none)).error.details.fields)], [422, ["to"]]);
    assert.equal((await call(billEmailRoute, "POST", "viewer", { to: "nope" }, { id: billId })).status, 422);
    assert.equal((await call(billEmailRoute, "POST", "viewer", { to: "a@b.in", extra: 1 }, { id: billId })).status, 422);
    assert.equal((await call(billEmailRoute, "POST", "adminB", { to: "a@b.in" }, { id: billId })).status, 404, "another hotel's staff");
    assert.equal((await call(billEmailRoute, "POST", "nobody", { to: "a@b.in" }, { id: billId })).status, 403);
    assert.equal((await call(billEmailRoute, "POST", null, { to: "a@b.in" }, { id: billId })).status, 401);
    assert.equal((await call(billEmailRoute, "POST", "viewer", { to: "a@b.in" }, { id: id(999) })).status, 404);
    assert.equal(queued().length, 0);
  });

  test("an advance receipt is queued the same way (advance_receipt)", async () => {
    const res = await advanceCreateRoute(preq("POST", "/x", "clerk", advanceInput()), pctx());
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    const advanceId = (await jsonOf(res)).data.id as string;
    const sent = await call(advanceEmailRoute, "POST", "viewer", {}, { id: advanceId });
    assert.deepEqual((await jsonOf(sent)).data, { queued: true, to: "ravi@example.com" });
    assert.deepEqual(queued().map((o) => [o.kind, o.hotelId]), [["advance_receipt", HOTEL_A]]);
    assert.equal(JSON.parse(String(queued()[0].payload)).advanceId, advanceId);
    assert.equal((await call(advanceEmailRoute, "POST", "adminB", { to: "a@b.in" }, { id: advanceId })).status, 404);
  });

  test("30 a person an hour", async () => {
    const billId = await newBill();
    const codes: number[] = [];
    for (let i = 0; i < 31; i += 1) codes.push((await call(billEmailRoute, "POST", "viewer", { to: "a@b.in" }, { id: billId })).status);
    assert.deepEqual([codes.filter((c) => c === 202).length, codes.at(-1)], [30, 429]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
interface Sent {
  via: string;
  from: string;
  to: string;
  subject: string;
  replyTo?: string;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}
function worker(options: { hotelRows?: Record<string, Record<string, string>>; pausedOf?: (hotelId: string) => Promise<boolean>; settingsTtlMs?: number; failWith?: Error; attach?: typeof attachmentsOf; createTransport?: (o: Record<string, unknown>) => SmtpTransport }) {
  const sent: Sent[] = [];
  const platformSent: MailMessage[] = [];
  const platform: MailSender = { send: async (m) => void platformSent.push(m) };
  const createTransport = options.createTransport ?? ((o: Record<string, unknown>): SmtpTransport => ({
    async sendMail(m) {
      if (options.failWith) throw options.failWith;
      sent.push({ via: String(o.host), ...m } as Sent);
      return {};
    },
    close: () => undefined,
  }));
  const router = createHotelMailRouter({
    platform,
    secretKey: KEY,
    pausedOf: options.pausedOf,
    settingsTtlMs: options.settingsTtlMs,
    settingsOf: async (hotelId) => {
      const values = options.hotelRows?.[hotelId];
      return { rows: Object.entries(values ?? {}).map(([key, value]) => ({ key, value, secret: key === "email.password" })), hotelName: hotelId === HOTEL_A ? "Hotel Sunrise" : "Hotel Pearl" };
    },
    createTransport,
  });
  return { sent, platformSent, run: () => runOutboxOnce({ unit: auth.unit, sender: router, now, attach: options.attach ?? attachmentsOf }), close: () => router.close() };
}
const SUNRISE = { "email.host": "smtp.sunrise.in", "email.port": "587", "email.encryption": "tls", "email.username": "mailer@sunrise.in", "email.password": sealSmtpSecret(KEY, "pw-1", HOTEL_A), "email.from_address": "front@sunrise.in", "email.from_name": "{hotel}" };

describe("the worker: the hotel's email for the invoice, the platform's for system mail", () => {
  test("an invoice goes through the HOTEL's own server with the bill as a real PDF made at send time; a sign-in code in the same pass goes through the platform sender only", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", {}, { id: billId });
    await auth.unit.run((r) => queueMail(r, { userId: null, kind: "login_code", toEmail: "staff@example.com", payload: { name: "S", code: "123456", minutes: 10 }, hotelId: null }, clock));
    const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE } });
    assert.equal(await w.run(), 2);
    assert.equal(w.sent.length, 1, "only the invoice went through a hotel server");
    const m = w.sent[0];
    assert.deepEqual([m.via, m.from, m.to, m.subject], ["smtp.sunrise.in", '"Hotel Sunrise" <front@sunrise.in>', "ravi@example.com", "Your invoice 2026 / 1188 from Hotel Sunrise"]);
    assert.equal(m.attachments?.length, 1);
    assert.equal(m.attachments?.[0].contentType, "application/pdf");
    assert.match(m.attachments?.[0].filename ?? "", /\.pdf$/);
    assert.equal(Buffer.from(m.attachments?.[0].content ?? []).subarray(0, 4).toString(), "%PDF");
    assert.deepEqual(w.platformSent.map((x) => [x.subject, x.hotelId ?? null, x.attachments?.length ?? 0]), [["Your Easy Hotel Solutions sign-in code", null, 0]]);
    assert.ok(auth.data().outbox.every((o) => o.status === "sent" && o.payload === null && o.lastError === null));
    w.close();
  });

  test("a hotel with no mail server of its own: the invoice still goes, through the platform sender, with the hotel's name as the sender name, its address as the reply-to, and the PDF", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", {}, { id: billId });
    const w = worker({ hotelRows: { [HOTEL_A]: { "email.from_name": "Sunrise Front Desk", "email.from_address": "front@sunrise.in" } } });
    assert.equal(await w.run(), 1);
    assert.equal(w.sent.length, 0);
    const m = w.platformSent[0];
    assert.deepEqual([m.hotelId, m.fromName, m.replyTo, m.to], [HOTEL_A, "Sunrise Front Desk", "front@sunrise.in", "ravi@example.com"]);
    assert.equal(Buffer.from(m.attachments?.[0].content ?? []).subarray(0, 4).toString(), "%PDF");
    w.close();
  });

  test("an advance receipt is a PDF too", async () => {
    const created = await advanceCreateRoute(preq("POST", "/x", "clerk", advanceInput()), pctx());
    await call(advanceEmailRoute, "POST", "viewer", {}, { id: (await jsonOf(created)).data.id });
    const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE } });
    assert.equal(await w.run(), 1);
    assert.equal(w.sent[0].attachments?.[0].content.subarray(0, 4).toString(), "%PDF");
    assert.match(w.sent[0].subject, /^Your receipt .* from Hotel Sunrise$/);
    w.close();
  });
});

describe("why a mail failed", () => {
  const fail = (code: string, extra: object = {}) => Object.assign(new Error("535 secret text for ravi@example.com"), { code, ...extra });

  test("the reason is kept as a CODE on the row (never the server's words) and shown for the hotel; a later success clears it", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", {}, { id: billId });
    const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE }, failWith: fail("EAUTH", { responseCode: 535 }) });
    assert.equal(await w.run(), 0);
    const row = auth.data().outbox[0];
    assert.deepEqual([row.status, row.attempts, row.lastError], ["pending", 1, "AUTH"]);
    assert.ok(!JSON.stringify(row).includes("secret text"));
    assert.deepEqual((await auth.unit.run((r) => r.outbox.lastFailure(HOTEL_A)))?.code, "AUTH");
    assert.equal(await auth.unit.run((r) => r.outbox.lastFailure(HOTEL_B)), null, "another hotel sees nothing");
    w.close();
    // the server is fixed: the retry goes and the failure is gone
    clock = new Date(clock.getTime() + 5 * 60_000);
    const ok = worker({ hotelRows: { [HOTEL_A]: SUNRISE } });
    assert.equal(await ok.run(), 1);
    assert.deepEqual([auth.data().outbox[0].status, auth.data().outbox[0].lastError], ["sent", null]);
    assert.equal(await auth.unit.run((r) => r.outbox.lastFailure(HOTEL_A)), null);
    ok.close();
  });

  test("the codes: login refused, server unreachable, TLS, recipient refused, an invoice that cannot be made (RENDER), no sender at all; every code has a plain sentence", async () => {
    const billId = await newBill();
    const reasons: [Error | null, string][] = [
      [fail("EAUTH"), "AUTH"], [fail("ECONNECTION"), "CONNECT"], [fail("ETLS"), "TLS"], [fail("EENVELOPE", { responseCode: 550 }), "RECIPIENT"], [new Error("odd"), "UNKNOWN"],
    ];
    for (const [error, code] of reasons) {
      auth.data().outbox.length = 0;
      await call(billEmailRoute, "POST", "viewer", { to: "a@b.in" }, { id: billId });
      const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE }, failWith: error ?? undefined });
      await w.run();
      assert.equal(auth.data().outbox[0].lastError, code);
      w.close();
    }
    auth.data().outbox.length = 0;
    await call(billEmailRoute, "POST", "viewer", { to: "a@b.in" }, { id: billId });
    const render = worker({ hotelRows: { [HOTEL_A]: SUNRISE }, attach: async () => { throw new Error("bill gone"); } });
    await render.run();
    assert.equal(auth.data().outbox[0].lastError, "RENDER");
    render.close();
    auth.data().outbox.length = 0;
    await call(billEmailRoute, "POST", "viewer", { to: "a@b.in" }, { id: billId });
    assert.equal(await runOutboxOnce({ unit: auth.unit, sender: { send: async () => assert.fail("not reached") }, now }), 0, "no attachment maker: the invoice cannot be made");
    assert.equal(auth.data().outbox[0].lastError, "RENDER");
    for (const text of Object.values(MAIL_FAILURE_TEXT)) assert.ok(text.length > 10 && !/@|535/.test(text));
  });

  test("after the last try the row is given up with its reason, and its payload is gone", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", { to: "a@b.in" }, { id: billId });
    const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE }, failWith: fail("EAUTH") });
    for (let i = 0; i < 5; i += 1) {
      await w.run();
      clock = new Date(clock.getTime() + 6 * 60_000);
    }
    const row = auth.data().outbox[0];
    assert.deepEqual([row.status, row.attempts, row.lastError, row.payload], ["failed", 5, "AUTH", null]);
    assert.equal((await auth.unit.run((r) => r.outbox.lastFailure(HOTEL_A)))?.code, "AUTH");
    w.close();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
describe("the guest: Email me a copy", () => {
  const CUST_A = pid(11);
  const CUST_B = pid(12);
  const B1 = pid(31);
  const B3 = pid(33);
  const gs = new Map<string, VerifiedSession>();
  const guest = (name: string, customerId: string, userId: string) => gs.set(name, makeSession({ userId, hotelId: HOTEL_A, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: customerId } }));
  guest("amit", CUST_A, pid(901));
  guest("bina", CUST_B, pid(902));
  guest("noMail", pid(13), pid(903));
  gs.set("staff", makeSession({ userId: pid(982), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, client: "web" }));
  let world: ReturnType<typeof wirePortal>;
  const email = (who: string, billId: string) => guestEmailRoute(preq("POST", `/api/v1/guest/bills/${billId}/email`, who), pctx({ id: billId }));

  const seed = (withMail: boolean): void => {
    world = wirePortal(gs, now, new Map(), withMail ? { mail: createMailQueue(auth.unit, now) } : {});
    configureRoutes({ resolveSession: async (r) => gs.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
    const a = world.hotel.store.dataFor(HOTEL_A);
    a.customers.push(customer({ id: CUST_A, mobile: "9876543210", email: "amit@example.com" }), customer({ id: CUST_B, name: "Bina Shah", mobile: "9123456780", email: "bina@example.com" }), customer({ id: pid(13), name: "No Mail", mobile: "9555500001", email: null }));
    a.bills.push(billRow({ id: B1, billNumber: "2026 / 0412", billDate: "2026-08-14", mobileNumber: "+91 98765 43210" }), billRow({ id: B3, billNumber: "2026 / 0414", billDate: "2026-09-01", guestName: "Bina Shah", mobileNumber: "9123456780" }), billRow({ id: pid(34), billNumber: "2026 / 0415", billDate: "2026-09-02", guestName: "No Mail", mobileNumber: "9555500001" }));
    void advanceRow;
  };
  beforeEach(() => seed(true));

  test("the guest's own issued bill is queued as an invoice from the hotel, to the email on their own record; the answer shows a shortened address", async () => {
    const res = await email("amit", `${B1}.hotel`);
    assert.equal(res.status, 202, JSON.stringify(await res.clone().json()));
    assert.deepEqual((await jsonOf(res)).data, { sentTo: "a***@example.com" });
    assert.deepEqual(queued().map((o) => [o.kind, o.hotelId, o.toEmail]), [["bill_invoice", HOTEL_A, "amit@example.com"]]);
    assert.equal(JSON.parse(String(queued()[0].payload)).billId, B1, "the stored bill, without the .hotel / .food suffix");
  });

  test("another guest's bill is 404, a running stay bill is 409, no email on the record is 422, staff are refused, no sign-in is 401; nothing is queued for any of them", async () => {
    assert.equal((await email("amit", `${B3}.hotel`)).status, 404);
    assert.equal((await email("amit", `stay.${pid(41)}.hotel`)).status, 404, "no such running bill for this guest");
    assert.equal((await email("noMail", `${pid(34)}.hotel`)).status, 422);
    assert.equal((await email("staff", `${B1}.hotel`)).status, 403);
    assert.equal((await guestEmailRoute(preq("POST", "/x", null), pctx({ id: `${B1}.hotel` }))).status, 401);
    assert.equal(queued().length, 0);
  });

  test("10 an hour per person", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) codes.push((await email("amit", `${B1}.hotel`)).status);
    assert.deepEqual([codes.filter((c) => c === 202).length, codes.at(-1)], [10, 429]);
  });

  test("without a mail queue configured the answer is a plain sentence (409), not an error", async () => {
    seed(false);
    const r = await email("amit", `${B1}.hotel`);
    assert.equal(r.status, 409);
    assert.match((await jsonOf(r)).error.message, /not available/);
  });
});

describe("a mail whose hotel cannot be opened never breaks the pass and is never retried", () => {
  const gone = async (): Promise<never> => { throw new AppError("FORBIDDEN", "Hotel is not available"); };

  test("the invoice of a hotel that is not available is failed at once with NO_HOTEL (one try, no payload kept); the other mails of the same pass still go", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", { to: "gone@b.in" }, { id: billId });
    await auth.unit.run((r) => queueMail(r, { userId: null, kind: "login_code", toEmail: "staff@example.com", payload: { name: "S", code: "123456", minutes: 10 }, hotelId: null }, clock));
    const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE }, attach: gone });
    assert.equal(await w.run(), 1, "the sign-in code was sent, the invoice was not");
    const [invoice, code] = auth.data().outbox;
    assert.deepEqual([invoice.kind, invoice.status, invoice.attempts, invoice.lastError, invoice.payload], ["bill_invoice", "failed", 1, "NO_HOTEL", null]);
    assert.deepEqual([code.kind, code.status], ["login_code", "sent"]);
    assert.equal(await w.run(), 0, "nothing is due again");
    assert.match(MAIL_FAILURE_TEXT.NO_HOTEL, /not available/);
    w.close();
  });

  test("a hotel mail row with no hotel at all (it cannot come in through the queue, so it is put straight into the table) fails the same way, without a sender call", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", { to: "a@b.in" }, { id: billId });
    auth.data().outbox[0].hotelId = null;
    const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE }, attach: async () => assert.fail("not reached") });
    assert.equal(await w.run(), 0);
    assert.deepEqual([auth.data().outbox[0].status, auth.data().outbox[0].lastError], ["failed", "NO_HOTEL"]);
    assert.equal(w.sent.length + w.platformSent.length, 0);
    w.close();
  });

  test("the router, when the hotel's settings cannot be read, does not throw: the mail goes through the platform sender", async () => {
    const platformSent: MailMessage[] = [];
    const router = createHotelMailRouter({ platform: { send: async (m) => void platformSent.push(m) }, secretKey: KEY, settingsOf: async () => { throw new AppError("FORBIDDEN", "Hotel is not available"); } });
    await router.send({ to: "a@b.in", subject: "s", text: "t", hotelId: HOTEL_A });
    router.close();
    assert.deepEqual(platformSent.map((m) => [m.to, m.hotelId]), [["a@b.in", HOTEL_A]]);
  });
});

describe("the real MIME message of an emailed bill (nodemailer in-memory transport, nothing leaves the machine)", () => {
  /** The real nodemailer builds the message and returns it as bytes instead of sending it. */
  const mimeTransport = (raw: string[]) => (): SmtpTransport => {
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    return { sendMail: async (m) => { const info = (await t.sendMail(m as never)) as unknown as { message: Buffer }; raw.push(info.message.toString("latin1")); return {}; }, close: () => undefined };
  };
  const GMAIL_HOTEL = { "email.host": "smtp.gmail.com", "email.port": "587", "email.encryption": "tls", "email.username": "front@sunrise.in", "email.password": sealSmtpSecret(KEY, "pw-1", HOTEL_A), "email.from_name": "{hotel}", "email.reply_to": "desk@sunrise.in" };
  const headerOf = (raw: string, name: string): string => new RegExp(`^${name}: ([^\\n]*(?:\\n[ \\t][^\\n]*)*)`, "mi").exec(raw)?.[1].replace(/\n[ \t]+/g, " ") ?? "";

  test("Email bill: exactly one application/pdf part whose decoded body is a non-empty PDF, with the hotel's From and Reply-To", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", {}, { id: billId });
    const raw: string[] = [];
    const w = worker({ hotelRows: { [HOTEL_A]: GMAIL_HOTEL }, createTransport: mimeTransport(raw) });
    assert.equal(await w.run(), 1);
    assert.equal(raw.length, 1);
    const mime = raw[0];
    assert.match(headerOf(mime, "From"), /Hotel Sunrise/);
    assert.match(headerOf(mime, "From"), /<front@sunrise\.in>/);
    assert.match(headerOf(mime, "Reply-To"), /desk@sunrise\.in/);
    assert.equal(headerOf(mime, "To"), "ravi@example.com");
    const pdfParts = [...mime.matchAll(/Content-Type: application\/pdf[^\n]*\n(?:[^\n]+\n)*?\n([A-Za-z0-9+/=\n]+)/g)];
    assert.equal(pdfParts.length, 1, "exactly one application/pdf attachment");
    assert.match(mime, /Content-Disposition: attachment; filename=/i);
    const body = Buffer.from(pdfParts[0][1].replace(/\n/g, ""), "base64");
    assert.ok(body.length > 1000, `PDF has ${body.length} bytes`);
    assert.equal(body.subarray(0, 4).toString(), "%PDF");
    w.close();
  });

  test("the dev log driver writes one line per attachment: its name and size, never the content", () => {
    const content = Buffer.from("%PDF-1.4 secret-looking-bytes");
    const line = attachmentLines({ attachments: [{ filename: "bill-2026-1188.pdf", contentType: "application/pdf", content }] });
    assert.equal(line, `\nattachment: bill-2026-1188.pdf (${content.byteLength} bytes)`);
    assert.ok(!line.includes("%PDF") && !line.includes("secret"));
    assert.equal(attachmentLines({}), "");
  });

  test("Email receipt: the same, for an advance receipt", async () => {    const created = await advanceCreateRoute(preq("POST", "/x", "clerk", advanceInput()), pctx());
    await call(advanceEmailRoute, "POST", "viewer", {}, { id: (await jsonOf(created)).data.id });
    const raw: string[] = [];
    const w = worker({ hotelRows: { [HOTEL_A]: GMAIL_HOTEL }, createTransport: mimeTransport(raw) });
    assert.equal(await w.run(), 1);
    const parts = [...raw[0].matchAll(/Content-Type: application\/pdf[^\n]*\n(?:[^\n]+\n)*?\n([A-Za-z0-9+/=\n]+)/g)];
    assert.equal(parts.length, 1);
    assert.equal(Buffer.from(parts[0][1].replace(/\n/g, ""), "base64").subarray(0, 4).toString(), "%PDF");
    assert.match(headerOf(raw[0], "Reply-To"), /desk@sunrise\.in/);
    w.close();
  });
});

void ORIGIN;
void ({} as MailAttachment);

describe("a paused hotel's mail waits in the queue", () => {
  test("it is not sent, keeps its pending status and its try count, and is looked at again in ten minutes; after the pause it goes out", async () => {
    const billId = await newBill();
    await call(billEmailRoute, "POST", "viewer", { to: "guest@b.in" }, { id: billId });
    let paused = true;
    const w = worker({ hotelRows: { [HOTEL_A]: SUNRISE }, pausedOf: async () => paused, settingsTtlMs: 0 });
    assert.equal(await w.run(), 0);
    const row = auth.data().outbox[0];
    assert.deepEqual([row.status, row.attempts, row.lastError], ["pending", 0, "PAUSED"]);
    assert.ok(row.nextAttemptAt && row.nextAttemptAt.getTime() - clock.getTime() === 10 * 60_000, "looked at again in ten minutes");
    assert.equal(w.sent.length + w.platformSent.length, 0);
    paused = false;
    clock = new Date(clock.getTime() + 11 * 60_000);
    assert.equal(await w.run(), 1, "after the pause the mail goes out");
    assert.equal(auth.data().outbox[0].status, "sent");
    w.close();
  });
});