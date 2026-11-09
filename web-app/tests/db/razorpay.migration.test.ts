// The move of the Razorpay data on the REAL PostgreSQL, the way a hosted database goes through it: a hotel built at migration 0053 (the old razorpay_payments and razorpay_events, with real-looking
// rows), then 0054 and 0055 applied by the migration runner. Nothing may be lost, a payment is linked to its guest, the old tables go, and a copy that is not complete stops the drop.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createHotel, type CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { runMigrations } from "../../../common/db/scripts/migrate";
import { newId } from "../../src/server/db/ids";
import { connectOwner, lockTestDatabase } from "./helpers/realDb";
import { hotelMigrations, hotelSeeds, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
const slug = () => `m-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
const OLD = (f: { version: string }) => f.version < "0054";

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
});
after(async () => {
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

/** A hotel as it was before 0054, with old-style Razorpay rows. */
async function oldHotel(name: string): Promise<{ hotel: CreatedHotel; ravi: string }> {
  const hotel = await createHotel({ owner, hotelMigrations: hotelMigrations().filter(OLD), hotelSeeds: hotelSeeds().filter(OLD) }, { name, slug: slug() });
  const s = `"${hotel.schema}"`;
  const ravi = newId();
  await owner.query(`INSERT INTO ${s}.customers (id, name, mobile) VALUES ($1, 'Ravi', '98200 11452')`, [ravi]);
  await owner.query(
    `INSERT INTO ${s}.razorpay_payments (legacy_id, business, payment_id, order_id, status, last_event, method, amount_paise, amount_refunded_paise, fee_paise, tax_paise, email, contact, description, notes, payload, paid_at, created_at)
     VALUES (11, 'hotel', 'pay_OldPaid000001', 'order_Old0000001', 'captured', 'payment.captured', 'upi', 1250000, 300000, 25000, 4500, 'ravi@example.com', '+919820011452', 'Advance', '{"room":"204"}', '{"id":"pay_OldPaid000001"}', '2026-10-01T10:00:00Z', '2026-10-01T09:59:00Z'),
            (12, 'food', 'pay_OldFood000002', NULL, 'failed', 'payment.failed', 'card', 184000, 0, NULL, NULL, NULL, '9000000000', 'Room service', NULL, NULL, NULL, '2026-10-02T12:00:00Z')`,
  );
  await owner.query(
    `INSERT INTO ${s}.razorpay_events (legacy_id, business, event_id, event, signature_ok, payload, ip_address, received_at)
     VALUES (5, 'hotel', 'evt_old_0001', 'payment.captured', true, '{"event":"payment.captured"}', '1.2.3.4', '2026-10-01T10:00:01Z'),
            (6, 'hotel', 'evt_old_0002', 'payment.authorized', true, '{"event":"payment.authorized"}', '1.2.3.4', '2026-10-01T10:00:00Z'),
            (7, 'hotel', NULL, 'payment.captured', false, NULL, '6.6.6.6', '2026-10-03T00:00:00Z'),
            (8, 'food', NULL, 'unknown', false, NULL, '6.6.6.7', '2026-10-03T00:00:01Z')`,
  );
  return { hotel, ravi };
}

const migrate = (schema: string) =>
  runMigrations({ client: owner, platformFiles: [], hotelFiles: hotelMigrations(), listHotelSchemas: async () => [schema], skipPlatform: true, appliedBy: "test" });

describe("moving the Razorpay data from the two old tables into razorpay_records", () => {
  test("every payment and webhook call is copied exactly, a payment is linked to its guest by phone, and the old tables are dropped", async () => {
    const { hotel, ravi } = await oldHotel("Razorpay Move Hotel");
    const s = `"${hotel.schema}"`;
    const result = await migrate(hotel.schema);
    assert.deepEqual(result.applied.map((a) => a.version).filter((v) => v >= "0054"), ["0054_razorpay_module", "0055_razorpay_old_tables_drop", "0056_razorpay_link_parties"]);

    const pays = (await owner.query(`SELECT * FROM ${s}.razorpay_records WHERE kind = 'payment' ORDER BY ref`)).rows;
    assert.equal(pays.length, 2);
    const a = pays[1]; // pay_OldPaid000001 sorts after pay_OldFood000002
    assert.deepEqual(
      [a.ref, a.business, a.parent_ref, a.status, a.event, a.method, Number(a.amount_paise), Number(a.amount_refunded_paise), Number(a.fee_paise), Number(a.tax_paise), a.email, a.contact, a.description, a.notes, a.legacy_id !== null],
      ["pay_OldPaid000001", "hotel", "order_Old0000001", "captured", "payment.captured", "upi", 1250000, 300000, 25000, 4500, "ravi@example.com", "+919820011452", "Advance", { room: "204" }, true],
    );
    assert.equal(new Date(String(a.occurred_at)).toISOString(), "2026-10-01T10:00:00.000Z");
    assert.equal(new Date(String(a.created_at)).toISOString(), "2026-10-01T09:59:00.000Z");
    assert.equal(a.customer_id, ravi, "linked to the guest whose phone it is");
    assert.equal(pays[0].customer_id, null, "a phone that is nobody's is linked to nobody");
    assert.deepEqual([pays[0].ref, pays[0].business, pays[0].status], ["pay_OldFood000002", "food", "failed"]);

    const events = (await owner.query(`SELECT ref, business, event, signature_ok, payload, ip_address FROM ${s}.razorpay_records WHERE kind = 'event' ORDER BY ref NULLS LAST, business`)).rows;
    assert.deepEqual(events.map((e) => [e.ref, e.business, e.event, e.signature_ok, e.payload]), [
      ["evt_old_0001", "hotel", "payment.captured", true, { event: "payment.captured" }],
      ["evt_old_0002", "hotel", "payment.authorized", true, { event: "payment.authorized" }],
      [null, "food", "unknown", false, null],
      [null, "hotel", "payment.captured", false, null],
    ]);

    const gone = (await owner.query(`SELECT to_regclass('${hotel.schema}.razorpay_payments') AS p, to_regclass('${hotel.schema}.razorpay_events') AS e`)).rows[0];
    assert.deepEqual([gone.p, gone.e], [null, null], "the old tables are dropped");
    assert.equal((await owner.query(`SELECT count(*)::int AS n FROM ${s}.schema_migrations WHERE version IN ('0054_razorpay_module', '0055_razorpay_old_tables_drop')`)).rows[0].n, 2);
  });

  test("running it again changes nothing (nothing pending)", async () => {
    const { hotel } = await oldHotel("Razorpay Move Again Hotel");
    await migrate(hotel.schema);
    const before = (await owner.query(`SELECT count(*)::int AS n FROM "${hotel.schema}".razorpay_records`)).rows[0].n;
    const again = await migrate(hotel.schema);
    assert.deepEqual(again.applied, []);
    assert.equal((await owner.query(`SELECT count(*)::int AS n FROM "${hotel.schema}".razorpay_records`)).rows[0].n, before);
  });

  test("0055 refuses to drop the old tables when a payment was not copied: it rolls back and the old data is still there", async () => {
    const { hotel } = await oldHotel("Razorpay Move Stop Hotel");
    const s = `"${hotel.schema}"`;
    // apply 0054 only, then lose a copied payment, as a bad copy would
    await runMigrations({ client: owner, platformFiles: [], hotelFiles: hotelMigrations().filter((f) => f.version <= "0054_razorpay_module"), listHotelSchemas: async () => [hotel.schema], skipPlatform: true, appliedBy: "test" });
    await owner.query(`DELETE FROM ${s}.razorpay_records WHERE kind = 'payment' AND ref = 'pay_OldPaid000001'`);
    await assert.rejects(migrate(hotel.schema), /FAILED|not dropping|0055/);
    assert.equal((await owner.query(`SELECT count(*)::int AS n FROM ${s}.razorpay_payments`)).rows[0].n, 2, "the old payments are untouched");
    assert.equal((await owner.query(`SELECT count(*)::int AS n FROM ${s}.razorpay_events`)).rows[0].n, 4, "the old events are untouched");
    assert.equal((await owner.query(`SELECT count(*)::int AS n FROM ${s}.schema_migrations WHERE version = '0055_razorpay_old_tables_drop'`)).rows[0].n, 0, "0055 is not recorded as applied");
  });

  test("a hotel with no Razorpay data at all moves cleanly", async () => {
    const hotel = await createHotel({ owner, hotelMigrations: hotelMigrations().filter(OLD), hotelSeeds: hotelSeeds().filter(OLD) }, { name: "Razorpay Empty Move Hotel", slug: slug() });
    await migrate(hotel.schema);
    assert.equal((await owner.query(`SELECT count(*)::int AS n FROM "${hotel.schema}".razorpay_records`)).rows[0].n, 0);
  });
});