// Razorpay for the hotel's Super Admin: what is set up (flags, never a value), payments kept from the signed webhook, refunds, payment links, settlements and "check this
// payment", all through the REAL route files, the in-memory hotel store and a fake Razorpay (no network). SuperAdmin only.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { GET as overviewRoute } from "../../src/app/api/v1/admin/razorpay/route";
import { GET as linksRoute, POST as linkRoute } from "../../src/app/api/v1/admin/razorpay/payment-links/route";
import { POST as resendLinkRoute } from "../../src/app/api/v1/admin/razorpay/payment-links/[business]/[linkId]/resend/route";
import { POST as cancelLinkRoute } from "../../src/app/api/v1/admin/razorpay/payment-links/[business]/[linkId]/cancel/route";
import { GET as statusRoute } from "../../src/app/api/v1/admin/razorpay/payments/[business]/[paymentId]/status/route";
import { POST as refreshRoute } from "../../src/app/api/v1/admin/razorpay/payments/[business]/[paymentId]/status/refresh/route";
import { POST as refundRoute } from "../../src/app/api/v1/admin/razorpay/payments/[business]/[paymentId]/refund/route";
import { GET as refundsRoute } from "../../src/app/api/v1/admin/razorpay/refunds/route";
import { GET as settlementsRoute } from "../../src/app/api/v1/admin/razorpay/settlements/route";
import { POST as webhookRoute } from "../../src/app/api/v1/webhooks/razorpay/[hotelId]/[business]/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin, getAdminSettings } from "../../src/server/compose/admin";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { FetchLike } from "../../src/server/payments/razorpay";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";
import { platformSetupSession } from "../../src/server/auth/secretSettings";
import type { MailQueue } from "../../src/server/services/auth/mail";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
sessions.set("super", makeSession({ userId: id(1), client: "web", accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] }));
sessions.set("admin", makeSession({ userId: id(2), client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("masters", "full")] }));
sessions.set("billsView", makeSession({ userId: id(3), client: "web", accountRole: "hotel_user", roleKey: "front", roleLevel: 1, grants: [grant("bills.bills", "view")] }));
sessions.set("billsEdit", makeSession({ userId: id(4), client: "web", accountRole: "hotel_user", roleKey: "front", roleLevel: 1, grants: [grant("bills.bills", "edit")] }));
let hotel = createMemoryHotel();
let sent: { method: string; url: string; body: unknown }[] = [];
let mailed: Parameters<MailQueue["queue"]>[0][] = [];
let answers: Record<string, { status: number; body: unknown }> = {};

// a fake Razorpay: the answer for "METHOD /path" comes from `answers`; every call is kept
const fakeFetch: FetchLike = async (url, init) => {
  const path = url.replace("https://api.razorpay.com/v1", "").replace(/\?.*$/, "");
  sent.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined });
  const hit = answers[`${init.method} ${path}`] ?? { status: 404, body: { error: { description: "The requested URL was not found" } } };
  return { status: hit.status, text: async () => JSON.stringify(hit.body) };
};

beforeEach(() => {
  hotel = createMemoryHotel();
  sent = [];
  mailed = [];
  answers = {};
  configureAdmin(
    buildAdminServices({
      unit: hotel.unit,
      people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) },
      audit: { record: async () => undefined },
      catalog,
      now: () => new Date("2026-10-05T10:00:00+05:30"),
      razorpayFetch: fakeFetch,
      razorpayMail: { queue: async (m) => void mailed.push(m) },
    }),
  );
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});

const call = (route: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>, method: string, who: string | null, params: Record<string, string> = {}, body?: unknown, query = "") =>
  route(
    new Request(`https://hms.test/api/v1/admin/razorpay${query}`, {
      method,
      headers: { host: "hms.test", origin: "https://hms.test", ...(who ? { "x-test-session": who } : {}), ...(body ? { "content-type": "application/json", "idempotency-key": crypto.randomUUID() } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve(params) },
  );
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const json = async (res: Response) => (await res.json()) as any;
const settings = () => hotel.store.dataFor(HOTEL_A).appSettings;
const put = (key: string, value: string, secret = false) => settings().set(key, { key, value, secret });
const ready = (book = "hotel") => {
  put(`razorpay_${book}.enabled`, "1");
  put(`razorpay_${book}.key_id`, "rzp_test_ABCDEF123456");
  put(`razorpay_${book}.key_secret`, "TopSecretValue", true);
  put(`razorpay_${book}.webhook_secret`, "HookSecretValue", true);
};
const link = { business: "hotel", amountPaise: 50000, description: "Advance", name: "Rohan Mehta" };

const payment = (over: Record<string, unknown> = {}) => ({
  id: "pay_Qx81aL02kPd9Zt", order_id: "order_Qx80zT7uYpLm3W", status: "captured", method: "upi", amount: 12500_00, amount_refunded: 0, currency: "INR", fee: 250_00, tax: 45_00,
  email: "rohan@example.com", contact: "+919820011452", description: "Advance BK-20418", notes: { bill_no: "INV-20418" }, created_at: 1_790_000_000, ...over,
});
const hook = (event: string, entity: unknown, over: { secret?: string; eventId?: string; signature?: string } = {}) => {
  const raw = JSON.stringify({ event, payload: { payment: { entity } } });
  const sig = over.signature ?? createHmac("sha256", over.secret ?? "HookSecretValue").update(raw).digest("hex");
  return webhookRoute(
    new Request("https://hms.test/api/v1/webhooks/razorpay/x/hotel", { method: "POST", headers: { host: "hms.test", "x-razorpay-signature": sig, "x-razorpay-event-id": over.eventId ?? `evt_${Math.random().toString(36).slice(2)}` }, body: raw }),
    { params: Promise.resolve({ hotelId: HOTEL_A, business: "hotel" }) },
  );
};

describe("Razorpay set-up and the list", () => {
  test("nothing saved: both businesses not set up, webhook addresses carry the hotel and are not ready, an empty list", async () => {
    const res = await call(overviewRoute, "GET", "super");
    assert.equal(res.status, 200);
    const d = (await json(res)).data;
    assert.deepEqual(d.setup.map((s: { business: string; ready: boolean; keyIdSet: boolean }) => [s.business, s.ready, s.keyIdSet]), [["hotel", false, false], ["food", false, false]]);
    assert.deepEqual([d.page.items, d.page.total, d.counts], [[], 0, { hotel: 0, food: 0 }]);
    assert.ok(d.hooks[0].url.endsWith(`/api/v1/webhooks/razorpay/${HOTEL_A}/hotel`), d.hooks[0].url);
    assert.equal(d.hooks[0].ready, false);
  });

  test("saved keys show as flags only: no key, secret or webhook secret is ever in an answer", async () => {
    ready();
    const body = await json(await call(overviewRoute, "GET", "super"));
    const hotelSetup = body.data.setup[0];
    assert.deepEqual([hotelSetup.enabled, hotelSetup.keyIdSet, hotelSetup.keySecretSet, hotelSetup.webhookSecretSet, hotelSetup.ready, hotelSetup.mode], [true, true, true, true, true, "test"]);
    assert.equal(body.data.setup[1].ready, false);
    assert.equal(body.data.hooks[0].ready, true);
    const text = JSON.stringify(body);
    for (const secret of ["rzp_test_ABCDEF123456", "TopSecretValue", "HookSecretValue"]) assert.ok(!text.includes(secret), secret);
  });

  test("link, refund, status, settlements: 409 'Razorpay is not set up yet.' until that business has both keys and is switched on", async () => {
    const notSet = async (res: Response) => assert.deepEqual([res.status, (await json(res)).error.message], [409, "Razorpay is not set up yet."]);
    const pay = { business: "hotel", paymentId: "pay_ABC123" };
    await notSet(await call(linkRoute, "POST", "super", {}, link));
    await notSet(await call(refreshRoute, "POST", "super", pay));
    await notSet(await call(refundRoute, "POST", "super", pay, { amountPaise: 1000, reason: "Charged twice" }));
    await notSet(await call(settlementsRoute, "GET", "super", {}, undefined, "?business=hotel"));
    put("razorpay_hotel.key_id", "rzp_test_x");
    put("razorpay_hotel.key_secret", "s", true);
    await notSet(await call(linkRoute, "POST", "super", {}, link));
    ready();
    await notSet(await call(linkRoute, "POST", "super", {}, { ...link, business: "food" }));
  });

  test("settings tabs and messages use the hotel's own names, never the project's seed names", async () => {
    hotel.store.dataFor(HOTEL_A).profile = { name: "Hotel Demo", foodName: "Demo Kitchen", address: null, phone: null, gstin: null, foodGstin: null };
    const food = await getAdminSettings().overview(platformSetupSession(makeSession({ userId: id(1), hotelId: "", client: "web", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 }), HOTEL_A), "razorpay_food");
    assert.equal(food.groups.find((g) => g.key === "razorpay_food")!.label, "Razorpay · Demo Kitchen");
    const setup = (await json(await call(overviewRoute, "GET", "super"))).data.setup;
    assert.deepEqual(setup.map((x: { name: string }) => x.name), ["Hotel Demo", "Demo Kitchen"]);
  });

  test("bad input is 422: amounts are whole paise of at least one rupee, names are needed, a payment id is plain", async () => {
    ready();
    for (const bad of [{ ...link, business: "spa" }, { ...link, amountPaise: 5 }, { ...link, amountPaise: 10.5 }, { ...link, extra: 1 }, { ...link, name: "" }, { ...link, validDays: 2 }]) assert.equal((await call(linkRoute, "POST", "super", {}, bad)).status, 422, JSON.stringify(bad));
    assert.equal((await call(statusRoute, "GET", "super", { business: "hotel", paymentId: "bad id!" })).status, 422);
    assert.equal((await call(refreshRoute, "POST", "super", { business: "hotel", paymentId: "bad id!" })).status, 422);
    assert.equal((await call(refundRoute, "POST", "super", { business: "hotel", paymentId: "pay_1" }, { amountPaise: 50, reason: "x" })).status, 422);
    assert.equal((await call(overviewRoute, "GET", "super", {}, undefined, "?status=weird")).status, 422);
  });

  test("Bills staff: view reads the panel but cannot refund or make links; edit may reach them (409 until the keys are saved)", async () => {
    const pay = { business: "hotel", paymentId: "pay_1" };
    assert.equal((await call(overviewRoute, "GET", "billsView")).status, 200);
    assert.equal((await call(linksRoute, "GET", "billsView", {}, undefined, "?business=hotel")).status, 409);
    assert.equal((await call(linkRoute, "POST", "billsView", {}, link)).status, 403);
    assert.equal((await call(refundRoute, "POST", "billsView", pay, { amountPaise: 1000, reason: "Charged twice" })).status, 403);
    assert.equal((await call(statusRoute, "GET", "billsView", pay)).status, 404, "view may read the stored payment (none kept yet)");
    assert.equal((await call(refreshRoute, "POST", "billsView", pay)).status, 403, "checking with Razorpay is an edit");
    assert.equal((await call(linkRoute, "POST", "billsEdit", {}, link)).status, 409);
    assert.equal((await call(refundRoute, "POST", "billsEdit", pay, { amountPaise: 1000, reason: "Charged twice" })).status, 409);
  });

  test("a person without Bills access gets 403 on every route, a stranger 401", async () => {
    for (const who of ["admin", null]) {
      const want = who ? 403 : 401;
      const pay = { business: "hotel", paymentId: "pay_1" };
      assert.equal((await call(overviewRoute, "GET", who)).status, want);
      assert.equal((await call(linkRoute, "POST", who, {}, link)).status, want);
      assert.equal((await call(linksRoute, "GET", who, {}, undefined, "?business=hotel")).status, want);
      assert.equal((await call(statusRoute, "GET", who, pay)).status, want);
      assert.equal((await call(refreshRoute, "POST", who, pay)).status, want);
      assert.equal((await call(refundRoute, "POST", who, pay, { amountPaise: 1000, reason: "x" })).status, want);
      assert.equal((await call(refundsRoute, "GET", who, {}, undefined, "?business=hotel")).status, want);
      assert.equal((await call(settlementsRoute, "GET", who, {}, undefined, "?business=hotel")).status, want);
    }
  });
});

describe("the webhook", () => {
  test("a signed event keeps the payment; the list, the totals and the last-event time show it", async () => {
    ready();
    const res = await hook("payment.captured", payment());
    assert.equal(res.status, 200);
    const d = (await json(await call(overviewRoute, "GET", "super"))).data;
    assert.equal(d.page.total, 1);
    const p = d.page.items[0];
    assert.deepEqual([p.paymentId, p.status, p.method, p.amountPaise, p.feePaise, p.taxPaise, p.notes.bill_no], ["pay_Qx81aL02kPd9Zt", "captured", "upi", 1250000, 25000, 4500, "INV-20418"]);
    assert.deepEqual(d.counts, { hotel: 1, food: 0 });
    assert.ok(d.hooks[0].last);
    assert.equal(d.stats.rejected, 0);
  });

  test("a wrong signature is 403, kept as rejected and changes nothing; a missing secret is refused the same way", async () => {
    ready();
    assert.equal((await hook("payment.captured", payment(), { signature: "00".repeat(32) })).status, 403);
    assert.equal((await hook("payment.captured", payment(), { secret: "someone else" })).status, 403);
    let d = (await json(await call(overviewRoute, "GET", "super"))).data;
    assert.deepEqual([d.page.total, d.stats.rejected], [0, 2]);
    put("razorpay_hotel.webhook_secret", "", true);
    assert.equal((await hook("payment.captured", payment())).status, 403);
    d = (await json(await call(overviewRoute, "GET", "super"))).data;
    assert.equal(d.page.total, 0);
  });

  test("the same event twice changes nothing the second time; a later event updates the payment and a refund never lowers the refunded amount", async () => {
    ready();
    await hook("payment.captured", payment(), { eventId: "evt_1" });
    assert.equal((await hook("payment.failed", payment({ status: "failed" }), { eventId: "evt_1" })).status, 200);
    let p = (await json(await call(overviewRoute, "GET", "super"))).data.page.items[0];
    assert.equal(p.status, "captured", "the repeat was ignored");
    await hook("refund.processed", payment({ status: "refunded", amount_refunded: 1250000 }), { eventId: "evt_2" });
    await hook("payment.captured", payment({ amount_refunded: 0 }), { eventId: "evt_3" });
    p = (await json(await call(overviewRoute, "GET", "super"))).data.page.items[0];
    assert.equal(p.amountRefundedPaise, 1250000);
  });

  test("filters: business, status, method and words narrow the list; failed shows the reason", async () => {
    ready();
    await hook("payment.captured", payment());
    await hook("payment.failed", payment({ id: "pay_Fail00000000001", status: "failed", method: "card", amount: 820000, email: "vikram@raoco.in", error_code: "BAD_REQUEST_ERROR", error_description: "Card declined by the bank" }));
    const list = async (q: string) => (await json(await call(overviewRoute, "GET", "super", {}, undefined, q))).data;
    assert.equal((await list("?status=failed")).page.total, 1);
    assert.equal((await list("?status=attention")).page.total, 1);
    assert.equal((await list("?method=upi")).page.items[0].paymentId, "pay_Qx81aL02kPd9Zt");
    assert.equal((await list("?search=vikram")).page.total, 1);
    assert.equal((await list("?search=12500")).page.total, 1);
    assert.equal((await list("?business=food")).page.total, 0);
    assert.equal((await list("?status=failed")).page.items[0].errorDescription, "Card declined by the bank");
    assert.equal((await list("")).stats.failed, 1);
  });
});

describe("refunds, links, settlements and checking a payment", () => {
  const stored = async () => { ready(); await hook("payment.captured", payment()); };
  const pay = { business: "hotel", paymentId: "pay_Qx81aL02kPd9Zt" };
  const rfnd = (over: Record<string, unknown> = {}) => ({ id: "rfnd_1", payment_id: pay.paymentId, amount: 500000, status: "processed", speed_processed: "normal", notes: { reason: "Guest cancelled", by: "Sonal Super" }, created_at: 1_790_000_100, ...over });

  test("a part refund goes to Razorpay with the amount, speed and reason, is kept, and is in the log; the rest can still be refunded", async () => {
    await stored();
    answers[`POST /payments/${pay.paymentId}/refund`] = { status: 200, body: rfnd() };
    const res = await call(refundRoute, "POST", "super", pay, { amountPaise: 500000, reason: "Guest cancelled", note: "Cancelled at the desk", instant: true });
    assert.equal(res.status, 200);
    const d = (await json(res)).data;
    assert.equal(d.payment.amountRefundedPaise, 500000);
    assert.equal(d.payment.status, "captured");
    const call1 = sent.find((s) => s.method === "POST")!;
    assert.deepEqual(call1.body, { amount: 500000, speed: "optimum", notes: { reason: "Guest cancelled", by: "Sonal Super", note: "Cancelled at the desk" } });
    const log = hotel.store.dataFor(HOTEL_A).systemLogs ?? [];
    assert.ok(JSON.stringify(log).includes("Refunded 5000 rupees"));
    // the rest, then nothing more
    answers[`POST /payments/${pay.paymentId}/refund`] = { status: 200, body: rfnd({ id: "rfnd_2", amount: 750000 }) };
    const tooMuch = await call(refundRoute, "POST", "super", pay, { amountPaise: 800000, reason: "x1", note: "" });
    assert.equal(tooMuch.status, 422);
    assert.match((await json(tooMuch)).error.message, /At most 7500/);
    const last = await json(await call(refundRoute, "POST", "super", pay, { amountPaise: 750000, reason: "Rest", note: "" }));
    assert.equal(last.data.payment.status, "refunded");
    assert.equal((await call(refundRoute, "POST", "super", pay, { amountPaise: 100, reason: "again", note: "" })).status, 409);
  });

  test("Razorpay refusing a refund shows its words; wrong keys say so; Razorpay down says to try again", async () => {
    await stored();
    const ask = () => call(refundRoute, "POST", "super", pay, { amountPaise: 100000, reason: "Charged twice", note: "" });
    answers[`POST /payments/${pay.paymentId}/refund`] = { status: 400, body: { error: { description: "The refund amount is greater than the amount available" } } };
    assert.match((await json(await ask())).error.message, /greater than the amount available/);
    answers[`POST /payments/${pay.paymentId}/refund`] = { status: 401, body: { error: { description: "Authentication failed" } } };
    assert.match((await json(await ask())).error.message, /did not accept the saved keys/);
    answers[`POST /payments/${pay.paymentId}/refund`] = { status: 502, body: {} };
    assert.equal((await ask()).status, 500);
    assert.equal((await json(await call(overviewRoute, "GET", "super"))).data.page.items[0].amountRefundedPaise, 0, "nothing was kept for a refund Razorpay did not make");
  });

  test("a payment that did not succeed cannot be refunded; one HMS has not seen asks to be checked first", async () => {
    ready();
    await hook("payment.failed", payment({ status: "failed" }));
    assert.equal((await call(refundRoute, "POST", "super", pay, { amountPaise: 100000, reason: "x1", note: "" })).status, 409);
    assert.equal((await call(refundRoute, "POST", "super", { business: "hotel", paymentId: "pay_Unknown00001" }, { amountPaise: 100000, reason: "x1", note: "" })).status, 404);
  });

  test("check with Razorpay (POST refresh) keeps what Razorpay says, so a payment whose webhook never came shows up", async () => {
    ready();
    answers["GET /payments/pay_Late0000000001"] = { status: 200, body: payment({ id: "pay_Late0000000001" }) };
    const res = await call(refreshRoute, "POST", "super", { business: "hotel", paymentId: "pay_Late0000000001" });
    assert.equal(res.status, 200);
    assert.equal((await json(res)).data.payment.status, "captured");
    assert.equal((await json(await call(overviewRoute, "GET", "super"))).data.page.total, 1);
    assert.equal((await call(refreshRoute, "POST", "super", { business: "hotel", paymentId: "pay_Nothing000001" })).status, 404);
  });

  test("GET status is a read: the stored payment in the same shape, nothing asked of Razorpay and nothing written; 404 when HMS has not kept it", async () => {
    await stored();
    const asked = sent.length;
    const res = await call(statusRoute, "GET", "billsView", pay);
    assert.equal(res.status, 200);
    const d = (await json(res)).data;
    assert.deepEqual([d.payment.paymentId, d.payment.status, typeof d.message], [pay.paymentId, "captured", "string"]);
    assert.equal(sent.length, asked, "no call to Razorpay");
    assert.equal((await json(await call(overviewRoute, "GET", "super"))).data.page.total, 1, "no new row");
    answers["GET /payments/pay_Unseen0000001"] = { status: 200, body: payment({ id: "pay_Unseen0000001" }) };
    assert.equal((await call(statusRoute, "GET", "super", { business: "hotel", paymentId: "pay_Unseen0000001" })).status, 404);
    assert.equal(sent.length, asked, "a GET never reaches Razorpay, even for a payment it could fetch");
  });

  test("a payment link: made with the guest, amount, validity and what to send; listed; cancelled", async () => {
    ready();
    answers["POST /payment_links"] = { status: 200, body: { id: "plink_Abc123", short_url: "https://rzp.io/i/Abc", status: "created", amount: 50000, description: "Advance", customer: { name: "Rohan Mehta", contact: "+919820011452" }, notes: { business: "hotel" }, created_at: 1_790_000_000, expire_by: 1_790_086_400 } };
    const res = await call(linkRoute, "POST", "super", {}, { ...link, contact: "+91 98200 11452", sms: true, validDays: 3 });
    assert.equal(res.status, 200);
    const made = sent.find((s) => s.url.endsWith("/payment_links"))!.body as Record<string, unknown>;
    assert.deepEqual([made.amount, made.currency, (made.notify as Record<string, boolean>).sms, (made.notify as Record<string, boolean>).email], [50000, "INR", true, false]);
    assert.equal((await json(res)).data.link.url, "https://rzp.io/i/Abc");
    assert.equal((await call(linkRoute, "POST", "super", {}, { ...link, sms: true })).status, 422, "SMS needs a phone number");
    answers["GET /payment_links"] = { status: 200, body: { items: [{ id: "plink_Abc123", short_url: "https://rzp.io/i/Abc", status: "paid", amount: 50000, customer: { name: "Rohan Mehta" }, notes: { business: "hotel" }, created_at: 1_790_000_000, updated_at: 1_790_003_600 }] } };
    const list = (await json(await call(linksRoute, "GET", "super", {}, undefined, "?business=hotel"))).data;
    assert.deepEqual([list.items[0].status, list.items[0].name, list.items[0].business], ["paid", "Rohan Mehta", "hotel"]);
    answers["POST /payment_links/plink_Abc123/cancel"] = { status: 200, body: { id: "plink_Abc123", status: "cancelled", short_url: "https://rzp.io/i/Abc", amount: 50000 } };
    assert.equal((await json(await call(cancelLinkRoute, "POST", "super", { business: "hotel", linkId: "plink_Abc123" }, {}))).data.link.status, "cancelled");
  });

  test("a link's email goes from the hotel's own mail, not from Razorpay (Razorpay is told not to send it); a resend by email does the same, a resend by SMS stays with Razorpay", async () => {
    ready();
    answers["POST /payment_links"] = { status: 200, body: { id: "plink_Mail01", short_url: "https://rzp.io/i/Mail", status: "created", amount: 50000, description: "Advance", customer: { name: "Rohan Mehta", email: "rohan@example.in" }, notes: { business: "hotel" }, created_at: 1_790_000_000, expire_by: 1_790_086_400 } };
    const res = await call(linkRoute, "POST", "super", {}, { ...link, email: "rohan@example.in", mail: true, validDays: 3 });
    assert.equal(res.status, 200);
    const made = sent.find((s) => s.url.endsWith("/payment_links"))!.body as Record<string, unknown>;
    assert.equal((made.notify as Record<string, boolean>).email, false, "Razorpay does not send the email");
    assert.equal(mailed.length, 1);
    assert.deepEqual([mailed[0].kind, mailed[0].toEmail, mailed[0].hotelId, mailed[0].payload.link, mailed[0].payload.subject], ["notification", "rohan@example.in", HOTEL_A, "https://rzp.io/i/Mail", "Please pay ₹500.00"]);
    assert.match((await json(res)).data.message, /emailed from the hotel/);
    // a resend by email is the hotel's mail again, read from the link as Razorpay has it
    answers["GET /payment_links/plink_Mail01"] = { status: 200, body: { id: "plink_Mail01", short_url: "https://rzp.io/i/Mail", status: "created", amount: 50000, description: "Advance", customer: { name: "Rohan Mehta", email: "rohan@example.in" }, notes: { business: "hotel" } } };
    const resend = (medium: string) => call(resendLinkRoute, "POST", "super", { business: "hotel", linkId: "plink_Mail01" }, { medium });
    assert.equal((await resend("email")).status, 200);
    assert.equal(mailed.length, 2);
    assert.ok(!sent.some((s) => s.url.endsWith("/notify_by/email")), "never asked Razorpay to send the email");
    answers["POST /payment_links/plink_Mail01/notify_by/sms"] = { status: 200, body: { success: true } };
    assert.equal((await resend("sms")).status, 200);
    assert.ok(sent.some((s) => s.url.endsWith("/notify_by/sms")), "SMS is Razorpay's");
    answers["GET /payment_links/plink_Mail01"] = { status: 200, body: { id: "plink_Mail01", short_url: "https://rzp.io/i/Mail", status: "paid", amount: 50000, customer: { name: "Rohan Mehta", email: "rohan@example.in" }, notes: { business: "hotel" } } };
    assert.equal((await resend("email")).status, 409, "a paid link is not sent again");
  });

  test("settlements and refunds are read from Razorpay for the business asked", async () => {
    ready();
    answers["GET /settlements"] = { status: 200, body: { items: [{ id: "setl_1", amount: 5883400, fees: 122500, tax: 22100, status: "processed", utr: "HDFCR52026110100423", created_at: 1_790_000_000 }] } };
    const s = (await json(await call(settlementsRoute, "GET", "super", {}, undefined, "?business=hotel"))).data.items[0];
    assert.deepEqual([s.amountPaise, s.feePaise, s.utr, s.status], [5883400, 122500, "HDFCR52026110100423", "processed"]);
    await hook("payment.captured", payment());
    answers["GET /refunds"] = { status: 200, body: { items: [rfnd(), rfnd({ id: "rfnd_2", payment_id: "pay_NotInHms00001" })] } };
    const refunds = (await json(await call(refundsRoute, "GET", "super", {}, undefined, "?business=hotel"))).data.items;
    const r = refunds[0];
    assert.deepEqual([r.id, r.amountPaise, r.reason, r.by], ["rfnd_1", 500000, "Guest cancelled", "Sonal Super"]);
    assert.deepEqual(refunds.map((x: { payer: string | null }) => x.payer), ["+919820011452", null], "the payer is the stored payment's contact (one read for the page); a payment HMS has not kept has none");
    assert.ok(sent.every((x) => x.url.startsWith("https://api.razorpay.com/v1/")));
  });
});
