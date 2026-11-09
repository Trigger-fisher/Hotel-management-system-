// The Group Hotel Admin's payments page on the REAL PostgreSQL: each member hotel is read on its own and read only, the totals add up, the newest payments of all hotels come first, a hotel that
// cannot be read is listed and the others still show, and a guest's phone or email is never in the answer.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import { pgAdminRepos } from "../../src/server/repos/postgres/admin";
import { pgRazorpayDisputeRepo } from "../../src/server/repos/postgres/razorpay";
import { createGroupPaymentsService } from "../../src/server/services/razorpay/groupPaymentsService";
import { makeSession } from "../server/helpers/session";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let goa: CreatedHotel;
let pune: CreatedHotel;
let database: Database;

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  goa = await createTestHotel(owner, "Group Goa");
  pune = await createTestHotel(owner, "Group Pune");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 6 });
  const put = async (h: CreatedHotel, ref: string, status: string, amount: number, refunded: number, at: string, contact: string) =>
    owner.query(`INSERT INTO "${h.schema}".razorpay_records (kind, business, ref, status, amount_paise, amount_refunded_paise, occurred_at, created_at, contact, email, description, method) VALUES ('payment', 'hotel', $1, $2, $3, $4, $5, $5, $6, 'secret.guest@example.com', 'Advance', 'upi')`, [ref, status, amount, refunded, at, contact]);
  await put(goa, "pay_GoaToday00001", "captured", 1000000, 0, "2026-11-02T05:00:00Z", "+919800000001"); // today (IST)
  await put(goa, "pay_GoaMonth00001", "captured", 500000, 200000, "2026-11-01T05:00:00Z", "+919800000002"); // this month, part refunded
  await put(goa, "pay_GoaFailed0001", "failed", 300000, 0, "2026-11-02T06:00:00Z", "+919800000003");
  await put(pune, "pay_PuneToday0001", "captured", 250000, 0, "2026-11-02T07:00:00Z", "+919800000004");
  await put(pune, "pay_PuneOld000001", "captured", 900000, 0, "2026-10-05T05:00:00Z", "+919800000005"); // last month
  // one problem waiting at Goa
  const pay = String((await owner.query(`SELECT id FROM "${goa.schema}".razorpay_records WHERE ref = 'pay_GoaToday00001'`)).rows[0].id);
  const cust = newId();
  await owner.query(`INSERT INTO "${goa.schema}".customers (id, name, mobile) VALUES ($1, 'Ravi', '9800000001')`, [cust]);
  await owner.query(`INSERT INTO "${goa.schema}".razorpay_records (kind, business, ref, parent_id, parent_ref, reason, status, customer_id, title, message) VALUES ('dispute', 'hotel', 'RD-GROUP001', $1, 'pay_GoaToday00001', 'dispute', 'open', $2, 'Charged twice', 'Two debits')`, [pay, cust]);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
  await releaseTestLock?.();
});

const session = makeSession({ hotelId: "", userId: newId(), accountRole: "hotel_admin", roleKey: "group_admin" });
const service = (hotels: { id: string; name: string }[]) => createGroupPaymentsService({ hotels: async () => hotels, readHotel: (hotelId, work) => database.withHotel({ hotelId, readOnly: true }, (tx) => work({ razorpay: pgAdminRepos(tx).razorpay, disputes: pgRazorpayDisputeRepo(tx) })), now: () => new Date("2026-11-02T10:30:00+05:30") });

describe("group payments overview", () => {
  test("each hotel's money, failures, refunds and waiting problems; totals add up; the newest payments of all hotels come first", async () => {
    const out = await service([{ id: goa.id, name: "Group Goa" }, { id: pune.id, name: "Group Pune" }]).overview(session);
    const by = Object.fromEntries(out.hotels.map((h) => [h.hotelName, h]));
    assert.deepEqual([by["Group Goa"].todayPaise, by["Group Goa"].monthPaise, by["Group Goa"].failed, by["Group Goa"].refundedPaise, by["Group Goa"].payments, by["Group Goa"].openProblems], [1000000, 1500000, 1, 200000, 3, 1]);
    assert.deepEqual([by["Group Pune"].todayPaise, by["Group Pune"].monthPaise, by["Group Pune"].failed, by["Group Pune"].payments, by["Group Pune"].openProblems], [250000, 250000, 0, 2, 0]);
    assert.deepEqual(out.totals, { todayPaise: 1250000, monthPaise: 1750000, failed: 1, refundedPaise: 200000, openProblems: 1 });
    assert.deepEqual(out.recent.map((p) => p.paymentId), ["pay_PuneToday0001", "pay_GoaFailed0001", "pay_GoaToday00001", "pay_GoaMonth00001", "pay_PuneOld000001"], "newest first, across both hotels");
    assert.deepEqual(out.recent.map((p) => p.hotelName).slice(0, 2), ["Group Pune", "Group Goa"]);
    assert.deepEqual(out.unavailable, []);
  });

  test("a guest's phone or email is never in the answer", async () => {
    const text = JSON.stringify(await service([{ id: goa.id, name: "Group Goa" }]).overview(session));
    assert.equal(/secret\.guest|\+9198000|9800000001/.test(text), false);
  });

  test("a hotel that cannot be read is listed as unavailable and the others still show", async () => {
    const out = await service([{ id: goa.id, name: "Group Goa" }, { id: newId(), name: "Gone Hotel" }]).overview(session);
    assert.deepEqual(out.hotels.map((h) => h.hotelName), ["Group Goa"]);
    assert.deepEqual(out.unavailable.map((u) => u.hotelName), ["Gone Hotel"]);
    assert.equal(out.totals.todayPaise, 1000000);
  });

  test("a group with no hotels answers an empty page", async () => {
    const out = await service([]).overview(session);
    assert.deepEqual([out.hotels, out.recent, out.unavailable, out.totals.monthPaise], [[], [], [], 0]);
  });

  test("the read is read only: the hotel's own data cannot be changed through it", async () => {
    await assert.rejects(database.withHotel({ hotelId: goa.id, readOnly: true }, (tx) => tx.query("UPDATE razorpay_records SET status = 'refunded'")), /read-only/i);
  });
});