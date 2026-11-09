// The Razorpay webhook of the LIVE service (services/admin/razorpayService.ts) on the REAL PostgreSQL, everything in the ONE razorpay_records table: the signature first, a rejected delivery
// stored without its body or event id, a repeat changing nothing, a late event never moving a payment backwards, refunds in parts kept as rows of their own, orders and payment links
// marked paid, and one hotel's secret never opening another hotel's door.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import { createPgHotelUnit } from "../../src/server/repos/postgres/hotel";
import { createRazorpayService, type RazorpayService } from "../../src/server/services/admin/razorpayService";
import { catalog, makeSession } from "../server/helpers/session";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotelA: CreatedHotel;
let hotelB: CreatedHotel;
let database: Database;
let razorpay: RazorpayService;
const SECRET_A = "whsec_hotel_a";
const SECRET_B = "whsec_hotel_b";
const PAY = "pay_Qx81aL02kPd9Zt";

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotelA = await createTestHotel(owner, "Razorpay Hotel A");
  hotelB = await createTestHotel(owner, "Razorpay Hotel B");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  const unit = createPgHotelUnit(database.withHotel);
  razorpay = createRazorpayService({ unit, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-11-02T10:00:00+05:30"), publicUrl: "https://hms.test" } as never);
  for (const [h, secret] of [[hotelA, SECRET_A], [hotelB, SECRET_B]] as const) await unit.run({ hotelId: h.id, userId: newId() }, (r) => r.adminSettings.set([{ key: "razorpay_hotel.webhook_secret", value: secret, secret: true }], newId()));
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

const sign = (raw: string, key: string): string => createHmac("sha256", key).update(raw).digest("hex");
const payment = (status: string, extra: Record<string, unknown> = {}) => ({ id: PAY, order_id: "order_Qx80zT7uYpLm3W", status, method: "upi", amount: 1250000, amount_refunded: 0, currency: "INR", fee: 25000, tax: 4500, email: "rohan.m@gmail.com", contact: "+919820011452", description: "Advance", created_at: 1788000000, ...extra });
const send = (h: CreatedHotel, body: unknown, over: { eventId?: string | null; key?: string; business?: "hotel" | "food" } = {}) => {
  const raw = JSON.stringify(body);
  const key = over.key ?? (h === hotelA ? SECRET_A : SECRET_B);
  return razorpay.receiveWebhook({ hotelId: h.id, business: over.business ?? "hotel", rawBody: raw, signature: sign(raw, key), eventId: over.eventId === undefined ? `evt_${Math.random().toString(36).slice(2, 12)}` : over.eventId, ip: "1.2.3.4" });
};
const rows = async (h: CreatedHotel, sql: string, params: unknown[] = []) => (await owner.query(sql.replaceAll("{s}", `"${h.schema}"`), params)).rows;
const count = async (h: CreatedHotel, kind: string) => (await rows(h, `SELECT count(*)::int AS n FROM {s}.razorpay_records WHERE kind = $1`, [kind]))[0].n as number;

describe("Razorpay webhook storage, in the one razorpay_records table", () => {
  test("a wrong signature is stored as rejected with no body and no event id, and changes nothing", async () => {
    const result = await send(hotelA, { event: "payment.captured", payload: { payment: { entity: payment("captured") } } }, { eventId: "evt_forged_0001", key: "not-the-secret" });
    assert.equal(result.accepted, false);
    const events = await rows(hotelA, "SELECT ref, signature_ok, payload FROM {s}.razorpay_records WHERE kind = 'event'");
    assert.deepEqual(events.map((e) => [e.ref, e.signature_ok, e.payload]), [[null, false, null]]);
    assert.equal(await count(hotelA, "payment"), 0);
  });

  test("a verified payment.captured is stored once; the same event again changes nothing; a captured payment is not undone by a late 'authorized'", async () => {
    const body = { event: "payment.captured", payload: { payment: { entity: payment("captured") } } };
    assert.equal((await send(hotelA, body, { eventId: "evt_cap_0001" })).accepted, true);
    assert.equal((await send(hotelA, body, { eventId: "evt_cap_0001" })).accepted, true);
    assert.equal((await send(hotelA, { event: "payment.authorized", payload: { payment: { entity: payment("authorized") } } }, { eventId: "evt_auth_0001" })).accepted, true);
    const p = (await rows(hotelA, "SELECT status, amount_paise::int AS amount, fee_paise::int AS fee, occurred_at IS NOT NULL AS paid, parent_ref FROM {s}.razorpay_records WHERE kind = 'payment'"))[0];
    assert.deepEqual([p.status, p.amount, p.fee, p.paid, p.parent_ref], ["captured", 1250000, 25000, true, "order_Qx80zT7uYpLm3W"]);
    assert.equal(await count(hotelA, "payment"), 1, "one payment, not three");
    assert.equal((await rows(hotelA, "SELECT count(*)::int AS n FROM {s}.razorpay_records WHERE kind = 'event' AND ref = 'evt_cap_0001'"))[0].n, 1, "the repeat was kept once");
  });

  test("refunds in parts are rows of their own and the payment follows; a failed refund is kept but does not add; the last part makes it 'refunded'", async () => {
    const refund = (id: string, amount: number, status: string, paid: Record<string, unknown>) => ({ event: status === "failed" ? "refund.failed" : "refund.processed", payload: { refund: { entity: { id, payment_id: PAY, amount, status, speed_processed: "normal", notes: { reason: "Guest cancelled" } } }, payment: { entity: payment(paid.status as string, paid) } } });
    await send(hotelA, refund("rfnd_PART0001", 300000, "processed", { status: "captured", amount_refunded: 300000 }));
    let p = (await rows(hotelA, "SELECT status, amount_refunded_paise::int AS refunded FROM {s}.razorpay_records WHERE kind = 'payment'"))[0];
    assert.deepEqual([p.status, p.refunded], ["captured", 300000]);
    await send(hotelA, refund("rfnd_FAIL0001", 100000, "failed", { status: "captured", amount_refunded: 300000 }));
    p = (await rows(hotelA, "SELECT status, amount_refunded_paise::int AS refunded FROM {s}.razorpay_records WHERE kind = 'payment'"))[0];
    assert.equal(p.refunded, 300000, "a failed refund adds nothing");
    await send(hotelA, refund("rfnd_REST0001", 950000, "processed", { status: "refunded", amount_refunded: 1250000 }));
    p = (await rows(hotelA, "SELECT status, amount_refunded_paise::int AS refunded FROM {s}.razorpay_records WHERE kind = 'payment'"))[0];
    assert.deepEqual([p.status, p.refunded], ["refunded", 1250000]);
    const r = await rows(hotelA, "SELECT ref, status, amount_paise::int AS amount, reason, parent_ref FROM {s}.razorpay_records WHERE kind = 'refund' ORDER BY ref");
    assert.deepEqual(r.map((x) => [x.ref, x.status, x.amount, x.reason, x.parent_ref]), [
      ["rfnd_FAIL0001", "failed", 100000, "Guest cancelled", PAY],
      ["rfnd_PART0001", "processed", 300000, "Guest cancelled", PAY],
      ["rfnd_REST0001", "processed", 950000, "Guest cancelled", PAY],
    ]);
    // a refund row points at its payment row
    assert.equal((await rows(hotelA, "SELECT count(*)::int AS n FROM {s}.razorpay_records r JOIN {s}.razorpay_records p ON p.id = r.parent_id AND p.kind = 'payment' WHERE r.kind = 'refund'"))[0].n, 3);
  });

  test("order.paid and payment_link.paid mark the order paid; a refund of a payment HMS does not know is not kept", async () => {
    for (const ref of ["order_Qx80zT7uYpLm3W", "plink_Abc123Def456"]) await owner.query(`INSERT INTO "${hotelA.schema}".razorpay_records (kind, business, ref, amount_paise, status) VALUES ('order', 'hotel', $1, 1250000, 'created')`, [ref]);
    await send(hotelA, { event: "order.paid", payload: { order: { entity: { id: "order_Qx80zT7uYpLm3W" } }, payment: { entity: payment("captured") } } });
    await send(hotelA, { event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_Abc123Def456" } } } });
    assert.deepEqual((await rows(hotelA, "SELECT ref, status FROM {s}.razorpay_records WHERE kind = 'order' ORDER BY ref")).map((o) => [o.ref, o.status]), [["order_Qx80zT7uYpLm3W", "paid"], ["plink_Abc123Def456", "paid"]]);
    await send(hotelA, { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_NOPAY0001", payment_id: "pay_Unknown00001", amount: 5000, status: "processed" } } } });
    assert.equal((await rows(hotelA, "SELECT count(*)::int AS n FROM {s}.razorpay_records WHERE ref = 'rfnd_NOPAY0001'"))[0].n, 0);
  });

  test("hotel A's secret on hotel B's address is rejected and hotel B stays empty", async () => {
    const result = await send(hotelB, { event: "payment.captured", payload: { payment: { entity: payment("captured") } } }, { eventId: "evt_cross_0001", key: SECRET_A });
    assert.equal(result.accepted, false);
    assert.equal(await count(hotelB, "payment"), 0);
  });

  test("no webhook secret saved: refused with a reason, nothing stored; the food account has none either", async () => {
    const raw = JSON.stringify({ event: "payment.captured", payload: {} });
    const result = await razorpay.receiveWebhook({ hotelId: hotelA.id, business: "food", rawBody: raw, signature: sign(raw, SECRET_A), eventId: null, ip: null });
    assert.deepEqual([result.accepted, result.reason], [false, "No webhook secret is saved for this business."]);
    assert.equal((await rows(hotelA, "SELECT count(*)::int AS n FROM {s}.razorpay_records WHERE kind = 'event' AND signature_ok AND business = 'food'"))[0].n, 0);
  });

  test("the Super Admin screen's list reads payments only, not the events, refunds or orders in the same table", async () => {
    const unit = createPgHotelUnit(database.withHotel);
    const session = { hotelId: hotelA.id, userId: newId() };
    const all = await unit.run(session, (r) => r.razorpay.list({ page: 1, pageSize: 25 }));
    assert.equal(all.total, 1);
    assert.deepEqual([all.items[0].paymentId, all.items[0].status, all.items[0].amountPaise, all.items[0].amountRefundedPaise], [PAY, "refunded", 1250000, 1250000]);
    assert.equal((await unit.run(session, (r) => r.razorpay.list({ status: "failed", page: 1, pageSize: 25 }))).total, 0);
    assert.equal((await unit.run(session, (r) => r.razorpay.list({ search: "rohan advance", page: 1, pageSize: 25 }))).total, 1);
    assert.deepEqual((await unit.run(session, (r) => r.razorpay.getMany("hotel", [PAY, "pay_NotKept0000001"]))).map((p) => p.paymentId), [PAY], "one read for many ids; unknown ids are absent");
    assert.deepEqual(await unit.run(session, (r) => r.razorpay.getMany("food", [PAY])), [], "the other business's row is not it");
    assert.equal((await count(hotelA, "event")) >= 5, true, "the events are there too, just not in the payment list");
  });

  test("a payment link made for a company and a bill carries them to Razorpay in its notes; the payment that comes back is linked to that company and bill; a note naming nobody is ignored", async () => {
    const s = `"${hotelA.schema}"`;
    const acme = String((await owner.query(`INSERT INTO ${s}.company_profiles (name) VALUES ('Acme Textiles') RETURNING id`)).rows[0].id);
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const unit = createPgHotelUnit(database.withHotel);
    const session = makeSession({ hotelId: hotelA.id, userId: newId(), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
    await unit.run(session, (r) => r.adminSettings.set([{ key: "razorpay_hotel.enabled", value: "1", secret: false }, { key: "razorpay_hotel.mode", value: "test", secret: false }, { key: "razorpay_hotel.key_id", value: "rzp_test_ABCDEF123456", secret: false }, { key: "razorpay_hotel.key_secret", value: "TopSecretValue", secret: true }], newId()));
    const fake = createRazorpayService({
      unit, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-11-02T10:00:00+05:30"), publicUrl: "https://hms.test",
      fetch: async (url: string, init: { body?: string }) => {
        sent.push({ url, body: init.body ? JSON.parse(init.body) : {} });
        return { status: 200, text: async () => JSON.stringify({ id: "plink_Acme000001", short_url: "https://rzp.io/i/Acme", status: "created", amount: 750000, description: "Bill 88", customer: { name: "Acme" }, notes: {}, created_at: 1_790_000_000, expire_by: 1_790_086_400 }) };
      },
    } as never);
    const meta = { ip: "1.2.3.4", traceId: "trace-link-0001" };
    const link = { business: "hotel" as const, amountPaise: 750000, description: "Bill 88", name: "Acme", validDays: 1 as const, sms: false, mail: false };
    await fake.createPaymentLink(session, meta, { ...link, companyId: acme, billRef: "B-2026-0088" });
    const notes = (sent[0].body as { notes: Record<string, string> }).notes;
    assert.deepEqual([notes.hms_company, notes.hms_bill], [acme, "B-2026-0088"], "the company and the bill travel in the link's notes");
    const order = (await rows(hotelA, "SELECT ref, company_id, bill_ref, status, url FROM {s}.razorpay_records WHERE kind = 'order' AND ref = 'plink_Acme000001'"))[0];
    assert.deepEqual([order.company_id, order.bill_ref, order.status, order.url], [acme, "B-2026-0088", "created", "https://rzp.io/i/Acme"]);
    await assert.rejects(fake.createPaymentLink(session, meta, { ...link, companyId: newId() }), (e) => (e as { code?: string }).code === "VALIDATION_FAILED");
    await assert.rejects(fake.createPaymentLink(session, meta, { ...link, companyId: acme, customerId: newId() }), (e) => (e as { code?: string }).code === "VALIDATION_FAILED");
    assert.equal(sent.length, 1, "a refused link was never sent to Razorpay");

    // the payment comes back with the notes Razorpay copied from the link
    await send(hotelA, { event: "payment.captured", payload: { payment: { entity: payment("captured", { id: "pay_AcmeLinked0001", contact: "+910000000001", notes: { hms_company: acme, hms_bill: "B-2026-0088" } }) } } });
    const p = (await rows(hotelA, "SELECT company_id, customer_id, bill_ref FROM {s}.razorpay_records WHERE kind = 'payment' AND ref = 'pay_AcmeLinked0001'"))[0];
    assert.deepEqual([p.company_id, p.customer_id, p.bill_ref], [acme, null, "B-2026-0088"]);
    // a note that names a company this hotel does not have is not believed
    await send(hotelA, { event: "payment.captured", payload: { payment: { entity: payment("captured", { id: "pay_Forged0000001", contact: "+910000000002", notes: { hms_company: newId(), hms_customer: "not-a-uuid" } }) } } });
    const f = (await rows(hotelA, "SELECT company_id, customer_id FROM {s}.razorpay_records WHERE kind = 'payment' AND ref = 'pay_Forged0000001'"))[0];
    assert.deepEqual([f.company_id, f.customer_id], [null, null]);
  });

  test("a refund, a check with Razorpay and a cancelled link made from HMS go through the real database: the refund is a row of its own, the payment follows, and each step is in the system log", async () => {
    const unit = createPgHotelUnit(database.withHotel);
    const session = makeSession({ hotelId: hotelB.id, userId: newId(), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
    await unit.run(session, (r) => r.adminSettings.set([{ key: "razorpay_hotel.enabled", value: "1", secret: false }, { key: "razorpay_hotel.mode", value: "test", secret: false }, { key: "razorpay_hotel.key_id", value: "rzp_test_ABCDEF123456", secret: false }, { key: "razorpay_hotel.key_secret", value: "TopSecretValue", secret: true }], newId()));
    const sent: { method: string; url: string; headers: Record<string, string> }[] = [];
    const answers: Record<string, unknown> = {
      [`POST /payments/${PAY}/refund`]: { id: "rfnd_HmsMade00001", payment_id: PAY, amount: 300000, status: "processed", speed_processed: "normal", created_at: 1_790_000_100 },
      [`GET /payments/${PAY}`]: payment("captured", { amount_refunded: 300000 }),
      "POST /payment_links/plink_Cancel00001/cancel": { id: "plink_Cancel00001", status: "cancelled", short_url: "https://rzp.io/i/C", amount: 50000 },
    };
    const fake = createRazorpayService({
      unit, people: { get: async () => new Map() }, audit: { record: async () => undefined }, catalog, now: () => new Date("2026-11-02T10:00:00+05:30"), publicUrl: "https://hms.test",
      fetch: async (url: string, init: { method: string; headers: Record<string, string> }) => {
        sent.push({ method: init.method, url, headers: init.headers });
        const hit = answers[`${init.method} ${url.replace("https://api.razorpay.com/v1", "")}`];
        return { status: hit ? 200 : 404, text: async () => JSON.stringify(hit ?? { error: { description: "not found" } }) };
      },
    } as never);
    const meta = { ip: "1.2.3.4", traceId: "trace-refund-0001" };
    await send(hotelB, { event: "payment.captured", payload: { payment: { entity: payment("captured") } } });
    const out = await fake.refund(session, meta, "hotel", PAY, { amountPaise: 300000, reason: "Guest cancelled", note: "Called the front desk", instant: false });
    assert.equal(out.payment.amountRefundedPaise, 300000);
    assert.equal(sent.at(-1)!.headers["x-refund-idempotency"], `hms-${PAY}-0-300000`);
    const r = (await rows(hotelB, "SELECT ref, status, amount_paise::int AS amount, reason, note, created_by, parent_ref FROM {s}.razorpay_records WHERE kind = 'refund'"))[0];
    assert.deepEqual([r.ref, r.status, r.amount, r.reason, r.note, r.parent_ref], ["rfnd_HmsMade00001", "processed", 300000, "Guest cancelled", "Called the front desk", PAY]);
    assert.equal(r.created_by, session.userId, "the refund row names who gave it");
    assert.equal((await fake.paymentStatus(session, "hotel", PAY)).payment.status, "captured");
    await fake.cancelPaymentLink(session, meta, "hotel", "plink_Cancel00001");
    const log = await rows(hotelB, "SELECT entity, summary FROM {s}.system_logs WHERE module = 'payments' ORDER BY created_at, id");
    assert.deepEqual(log.map((l) => l.entity), ["Online payment", "Payment link"]);
  });
});