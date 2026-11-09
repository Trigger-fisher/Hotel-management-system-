// Disputes in the single razorpay_records table, on the REAL PostgreSQL: a dispute is about one real payment of this hotel, a guest sees only their own, a company only its own, and staff see all.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let ravi: string;
let meera: string;
let acme: string;
let payId: string;

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Razorpay Disputes Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  const s = `"${hotel.schema}"`;
  ravi = newId();
  meera = newId();
  await owner.query(`INSERT INTO ${s}.customers (id, name, mobile) VALUES ($1, 'Ravi', '9820011452'), ($2, 'Meera', '9820022333')`, [ravi, meera]);
  acme = String((await owner.query(`INSERT INTO ${s}.company_profiles (name) VALUES ('Acme Textiles') RETURNING id`)).rows[0].id);
  payId = String((await owner.query(`INSERT INTO ${s}.razorpay_records (kind, business, ref, status, amount_paise) VALUES ('payment', 'hotel', 'pay_Dispute00001', 'captured', 500000) RETURNING id`)).rows[0].id);
  const raise = (number: string, customer: string | null, company: string | null, name: string) =>
    owner.query(`INSERT INTO ${s}.razorpay_records (kind, business, ref, parent_id, parent_ref, reason, status, customer_id, company_id, created_by, title, message) VALUES ('dispute', 'hotel', $1, $5, 'pay_Dispute00001', 'dispute', 'open', $2, $3, NULL, 'Charged twice by ' || $4, 'I see two debits')`, [number, customer, company, name, payId]);
  await raise("RD-0001", ravi, null, "Ravi");
  await raise("RD-0002", meera, null, "Meera");
  await raise("RD-0003", null, acme, "Acme Textiles");
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

const numbersFor = (scope?: { kind: "guest" | "company"; id: string }) =>
  database.withHotel({ hotelId: hotel.id, ...(scope ? { scope } : {}) }, async (tx) => (await tx.query("SELECT ref FROM razorpay_records WHERE kind = 'dispute' ORDER BY ref")).rows.map((r) => String(r.ref)));

describe("razorpay_records, disputes", () => {
  test("a guest sees only their own, a company only its own, staff see all; payments and events with no owner are hidden from both", async () => {
    assert.deepEqual(await numbersFor({ kind: "guest", id: ravi }), ["RD-0001"]);
    assert.deepEqual(await numbersFor({ kind: "guest", id: meera }), ["RD-0002"]);
    assert.deepEqual(await numbersFor({ kind: "company", id: acme }), ["RD-0003"]);
    assert.deepEqual(await numbersFor(), ["RD-0001", "RD-0002", "RD-0003"]);
    const all = (scope: { kind: "guest" | "company"; id: string }) => database.withHotel({ hotelId: hotel.id, scope }, async (tx) => (await tx.query("SELECT kind FROM razorpay_records")).rows.map((r) => String(r.kind)));
    assert.deepEqual(await all({ kind: "guest", id: ravi }), ["dispute"], "the payment itself has no owner yet, so a guest does not see it");
  });

  test("a dispute must point at a payment of the same business; a refund row or another dispute is not a payment", async () => {
    const s = `"${hotel.schema}"`;
    const row = (parent: string | null, business = "hotel") => owner.query(`INSERT INTO ${s}.razorpay_records (kind, business, ref, parent_id, reason, status, customer_id, title, message) VALUES ('dispute', $1, 'RD-' || substr(md5(random()::text), 1, 6), $2, 'dispute', 'open', $3, 'x', 'y')`, [business, parent, ravi]);
    await assert.rejects(row(null), /razorpay_records_parent_needed/);
    await assert.rejects(row(newId()), /must be a payment/);
    await assert.rejects(row(payId, "food"), /same business/);
    const dispute = String((await owner.query(`SELECT id FROM ${s}.razorpay_records WHERE ref = 'RD-0001'`)).rows[0].id);
    await assert.rejects(row(dispute), /same business/, "a dispute is not a payment");
  });

  test("a dispute needs someone to belong to and a message, an answer needs a reply, a reason must be one of three, and the payment cannot be deleted while a dispute is on it", async () => {
    const s = `"${hotel.schema}"`;
    const base = (extra: string, vals: unknown[]) => owner.query(`INSERT INTO ${s}.razorpay_records (kind, business, ref, parent_id, status, ${extra}) VALUES ('dispute', 'hotel', 'RD-' || substr(md5(random()::text), 1, 6), $1, 'open', ${vals.map((_, i) => `$${i + 2}`).join(", ")})`, [payId, ...vals]);
    await assert.rejects(base("reason, title, message", ["dispute", "x", "y"]), /razorpay_records_dispute_who/);
    await assert.rejects(base("reason, title, message, customer_id", ["dispute", " ", "y", ravi]), /razorpay_records_dispute_text/);
    await assert.rejects(base("reason, title, message, customer_id", ["shout", "x", "y", ravi]), /razorpay_records_dispute_reason/);
    await assert.rejects(owner.query(`UPDATE ${s}.razorpay_records SET status = 'answered' WHERE ref = 'RD-0001'`), /razorpay_records_answer_pair/);
    await assert.rejects(owner.query(`DELETE FROM ${s}.razorpay_records WHERE ref = 'pay_Dispute00001'`), /foreign key|violates/i);
  });

  test("the same payment id cannot be kept twice, but a payment and an order may share a reference space safely (unique per kind and business)", async () => {
    const s = `"${hotel.schema}"`;
    await assert.rejects(owner.query(`INSERT INTO ${s}.razorpay_records (kind, business, ref, status, amount_paise) VALUES ('payment', 'hotel', 'pay_Dispute00001', 'created', 100)`), /razorpay_records_ref_key|duplicate key/);
    await owner.query(`INSERT INTO ${s}.razorpay_records (kind, business, ref, status, amount_paise) VALUES ('payment', 'food', 'pay_Dispute00001', 'created', 100)`);
  });
});