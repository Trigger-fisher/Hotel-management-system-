// The Razorpay safety rules, through the REAL route files, the in-memory hotel store and a fake Razorpay (no network, no real money):
//   - Test Mode first: a live setting is refused unless the server allows live, and a key must match the mode;
//   - a forged webhook never uses up a real event's id and leaves no body behind;
//   - a late, older event never moves a payment backwards;
//   - a refund carries Razorpay's idempotency key: the same refund asked twice is the same key.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, test } from "node:test";
import { GET as overviewRoute } from "../../src/app/api/v1/admin/razorpay/route";
import { POST as refundRoute } from "../../src/app/api/v1/admin/razorpay/payments/[business]/[paymentId]/refund/route";
import { POST as webhookRoute } from "../../src/app/api/v1/webhooks/razorpay/[hotelId]/[business]/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { FetchLike } from "../../src/server/payments/razorpay";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([[id(1), { id: id(1), name: "Sonal Super", roleKey: "super_admin", roleLevel: 4, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>([["super", makeSession({ userId: id(1), client: "web", accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("masters", "full")] })]]);
let hotel = createMemoryHotel();
let sent: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};
const PAY = "pay_Qx81aL02kPd9Zt";

const fakeFetch: FetchLike = async (url, init) => {
  const path = url.replace("https://api.razorpay.com/v1", "").replace(/\?.*$/, "");
  sent.push({ method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
  const hit = answers[`${init.method} ${path}`] ?? { status: 404, body: { error: { description: "not found" } } };
  return { status: hit.status, text: async () => JSON.stringify(hit.body) };
};

beforeEach(() => {
  hotel = createMemoryHotel();
  sent = [];
  answers = {};
  configureAdmin(buildAdminServices({ unit: hotel.unit, people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-10-05T10:00:00+05:30"), razorpayFetch: fakeFetch }));
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
});
afterEach(() => {
  delete process.env.HMS_RAZORPAY_LIVE;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const json = async (res: Response) => (await res.json()) as any;
const settings = () => hotel.store.dataFor(HOTEL_A).appSettings;
const put = (key: string, value: string, secret = false) => settings().set(key, { key, value, secret });
const ready = (keyId = "rzp_test_ABCDEF123456", mode = "test") => {
  put("razorpay_hotel.enabled", "1");
  put("razorpay_hotel.mode", mode);
  put("razorpay_hotel.key_id", keyId);
  put("razorpay_hotel.key_secret", "TopSecretValue", true);
  put("razorpay_hotel.webhook_secret", "HookSecretValue", true);
};
const entity = (status: string, over: Record<string, unknown> = {}) => ({ id: PAY, order_id: "order_Qx80zT7uYpLm3W", status, method: "upi", amount: 12500_00, amount_refunded: 0, currency: "INR", fee: 250_00, tax: 45_00, email: "rohan@example.com", contact: "+919820011452", description: "Advance", notes: {}, created_at: 1_790_000_000, ...over });
const hook = (event: string, ent: unknown, over: { secret?: string; eventId?: string } = {}) => {
  const raw = JSON.stringify({ event, payload: { payment: { entity: ent } } });
  return webhookRoute(
    new Request("https://hms.test/api/v1/webhooks/razorpay/x/hotel", { method: "POST", headers: { host: "hms.test", "x-razorpay-signature": createHmac("sha256", over.secret ?? "HookSecretValue").update(raw).digest("hex"), "x-razorpay-event-id": over.eventId ?? `evt_${Math.random().toString(36).slice(2)}` }, body: raw }),
    { params: Promise.resolve({ hotelId: HOTEL_A, business: "hotel" }) },
  );
};
const overview = async () => (await json(await overviewRoute(new Request("https://hms.test/api/v1/admin/razorpay", { headers: { host: "hms.test", origin: "https://hms.test", "x-test-session": "super" } }), { params: Promise.resolve({}) }))).data;
const refund = (amountPaise: number) =>
  refundRoute(new Request("https://hms.test/api/v1/admin/razorpay/refund", { method: "POST", headers: { host: "hms.test", origin: "https://hms.test", "x-test-session": "super", "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ amountPaise, reason: "Charged twice" }) }), {
    params: Promise.resolve({ business: "hotel", paymentId: PAY }),
  });

describe("Razorpay safety rules", () => {
  test("a forged call with a real event's id leaves no body, does not use the id up, and the real call afterwards is applied", async () => {
    ready();
    const forged = await hook("payment.captured", entity("captured"), { secret: "wrong-secret", eventId: "evt_real_0001" });
    assert.equal(forged.status, 403);
    const events = hotel.store.dataFor(HOTEL_A).razorpayEvents;
    assert.deepEqual(events.map((e) => [e.eventId, e.signatureOk, e.payload]), [[null, false, null]], "kept as evidence, with no event id and no body");
    assert.equal((await overview()).page.total, 0, "a forged call changes nothing");
    assert.equal((await hook("payment.captured", entity("captured"), { eventId: "evt_real_0001" })).status, 200);
    assert.equal((await overview()).page.total, 1, "the real call with the same id was not read as a repeat");
  });

  test("a late 'authorized' does not undo a captured payment; a repeat of the same event is accepted and changes nothing", async () => {
    ready();
    await hook("payment.captured", entity("captured"), { eventId: "evt_cap_0001" });
    await hook("payment.authorized", entity("authorized"), { eventId: "evt_auth_0001" });
    assert.equal((await overview()).page.items[0].status, "captured");
    assert.equal((await hook("payment.captured", entity("captured"), { eventId: "evt_cap_0001" })).status, 200);
    assert.equal((await overview()).page.total, 1);
  });

  test("a refund.processed event (it carries the payment) shows the part-refunded amount, and the last part makes the payment 'refunded'", async () => {
    ready();
    await hook("payment.captured", entity("captured"), { eventId: "evt_cap_0003" });
    await hook("refund.processed", entity("captured", { amount_refunded: 3000_00 }), { eventId: "evt_ref_0001" });
    let item = (await overview()).page.items[0];
    assert.deepEqual([item.status, item.amountRefundedPaise], ["captured", 3000_00]);
    await hook("refund.processed", entity("refunded", { amount_refunded: 12500_00 }), { eventId: "evt_ref_0002" });
    item = (await overview()).page.items[0];
    assert.deepEqual([item.status, item.amountRefundedPaise], ["refunded", 12500_00]);
  });

  test("Live Mode is refused unless the server allows it, and nothing is sent to Razorpay", async () => {
    ready("rzp_live_ABCDEF123456", "live");
    await hook("payment.captured", entity("captured"));
    const res = await refund(1000_00);
    assert.deepEqual([res.status, (await json(res)).error.message], [409, "Live payments are switched off on this server. Use Test Mode."]);
    assert.equal(sent.length, 0);
  });

  test("a key that does not belong to the chosen mode is refused", async () => {
    ready("rzp_live_ABCDEF123456", "test");
    await hook("payment.captured", entity("captured"));
    const res = await refund(1000_00);
    assert.equal(res.status, 409);
    assert.match((await json(res)).error.message, /not a test key/);
    assert.equal(sent.length, 0);
  });

  test("a refund carries Razorpay's idempotency key, and asking again for the same refund sends the same key; after it succeeds the next refund has a new one", async () => {
    ready();
    await hook("payment.captured", entity("captured"), { eventId: "evt_cap_0002" });
    const ok = { status: 200, body: { id: "rfnd_ABCDEF1", payment_id: PAY, amount: 1000_00, status: "processed", created_at: 1_790_000_100 } };
    answers[`POST /payments/${PAY}/refund`] = { status: 500, body: { error: { description: "boom" } } };
    assert.notEqual((await refund(1000_00)).status, 200, "Razorpay failed the first try");
    answers[`POST /payments/${PAY}/refund`] = ok;
    assert.equal((await refund(1000_00)).status, 200);
    const keys = sent.filter((s) => s.method === "POST").map((s) => s.headers["x-refund-idempotency"]);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1], "the retry after a failure is the same refund");
    assert.match(keys[0], /^hms-pay_Qx81aL02kPd9Zt-0-100000$/);
    assert.equal((await refund(500_00)).status, 200);
    const third = sent.filter((s) => s.method === "POST").at(-1)!.headers["x-refund-idempotency"];
    assert.notEqual(third, keys[0], "a different amount after the first refund is a different refund");
  });
});
