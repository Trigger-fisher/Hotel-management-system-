// The Billing repositories on the REAL PostgreSQL instance (repos/postgres/billing.ts), through the unit the billing services get. The in-memory
// double (repos/memory/billing.ts) is the reference; the same table rules and the same screen filters are proven here against the database.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { BillFields, BillingRepos, DebitSlot, NewAdvance, NewBill } from "../../src/server/repos/billing";
import { createPgBillingUnit } from "../../src/server/repos/postgres/billing";
import { RepoError, type Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";

// the year a new hotel starts with (db/seeds/hotel/0002): the financial year of today in India, 1 April to 31 March
const istNow = (): Date => new Date(Date.now() + 330 * 60_000);
const currentYearFrom = (): number => (istNow().getUTCMonth() + 1 >= 4 ? istNow().getUTCFullYear() : istNow().getUTCFullYear() - 1);
const currentYearLabel = (): string => `${currentYearFrom()}-${String(currentYearFrom() + 1).slice(-2)}`;
const currentYearStart = (): string => `${currentYearFrom()}-04-01`;
const currentYearEnd = (): string => `${currentYearFrom() + 1}-03-31`;
let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<BillingRepos>;
const USER = newId();
const ACTOR = newId();
const run = <T>(work: (r: BillingRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: USER }, work);
const Z = BigInt(0);
let acme: string;
let globex: string;

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Billing Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 8 });
  unit = createPgBillingUnit(database.withHotel);
  acme = String((await owner.query(`INSERT INTO "${hotel.schema}".company_profiles (name) VALUES ('Acme Textiles') RETURNING id`)).rows[0].id);
  globex = String((await owner.query(`INSERT INTO "${hotel.schema}".company_profiles (name) VALUES ('Globex') RETURNING id`)).rows[0].id);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

const advance = (over: Partial<NewAdvance> = {}): NewAdvance => ({
  receiptNumber: `2026 / ${Math.random().toString(36).slice(2, 8)}`, guestName: "Asha Rao", mobileNumber: "9876543210", roomNumber: "101", companyId: null, reservationId: null,
  paymentDate: "2026-03-04", hotelAmountPaise: BigInt(100_000), foodAmountPaise: BigInt(50_000), hotelMode: "Cash", foodMode: "UPI", referenceName: null, referenceMobileNumber: null, instruction: null,
  hotelBalancePaise: BigInt(100_000), foodBalancePaise: BigInt(50_000), totalPaise: BigInt(150_000), hotelRefundAmountPaise: null, foodRefundAmountPaise: null, hotelRefundMode: null,
  foodRefundMode: null, refundPaymentDate: null, refundGuestName: null, refundMobileNumber: null, refundInstruction: null, createdBy: ACTOR, ...over,
});
const slot = (over: Partial<DebitSlot> = {}): DebitSlot => ({ date: null, hotelMode: null, foodMode: null, hotelPaise: null, foodPaise: null, ...over });
const bill = (over: Partial<BillFields> = {}): NewBill => ({
  billNumber: `B-${Math.random().toString(36).slice(2, 8)}`, billDate: "2026-03-04", companyId: null, guestName: "Asha Rao", mobileNumber: null, roomNumber: "101", grNumber: null, guestAddress: null,
  guestGstin: null, persons: 2, arrivalAt: null, departureAt: null, hotelPlan: null, hotelAmountPaise: Z, hotelPlanAmountPaise: Z, hotelExtraBedAmountPaise: Z, hotelLaundryAmountPaise: Z,
  hotelOtherAmountPaise: Z, hotelGstPaise: Z, hotelModeOfPayment: "Cash", foodAmountPaise: Z, foodPlanAmountPaise: Z, foodLaundryAmountPaise: Z, foodGstPaise: Z, foodModeOfPayment: null,
  totalHotelAmountPaise: BigInt(200_000), totalFoodAmountPaise: Z, balanceHotelAmountPaise: Z, balanceFoodAmountPaise: Z, referenceName: null, referenceMobileNumber: null, instruction: null,
  invoicePdfPath: null, foodInvoicePdfPath: null, staySegments: null, planFoodAmountPaise: Z, hotelGstPercent: null, foodGstPercent: null, hotelSac: "996311", foodSac: "996331", advanceId: null, advanceReceiptNumber: null,
  advanceGuestName: null, advanceHotelAmountSnapshot: null, advanceFoodAmountSnapshot: null, advanceDateSnapshot: null, advanceCompanySnapshot: null, advanceHotelAmountPaise: Z,
  advanceFoodAmountPaise: Z, advanceDeleteHotelAmountPaise: Z, advanceDeleteFoodAmountPaise: Z, debit: [slot(), slot(), slot(), slot(), slot()], debitHotelAdvance: null, debitFoodAdvance: null,
  debitReferenceName: null, debitReferenceMobileNumber: null, debitInstruction: null, formattedAdvanceReceiptNumber: null, ...over,
} as NewBill);

const cleanTables = async (): Promise<void> => {
  await owner.query(`DELETE FROM "${hotel.schema}".bill_master_bills`);
  await owner.query(`DELETE FROM "${hotel.schema}".bill_master_advances`);
};

describe("advances", () => {
  before(cleanTables);

  test("create gives entry numbers MAX+1 (a binned row keeps its number); every field reads back exactly", async () => {
    const a = await run((r) => r.advances.create(advance({ receiptNumber: "2026 / 1", companyId: acme, referenceName: "Ref", instruction: "Deposit", hotelRefundAmountPaise: null })));
    const b = await run((r) => r.advances.create(advance({ receiptNumber: "2026 / 2", hotelAmountPaise: BigInt("9007199254740993"), hotelBalancePaise: BigInt("9007199254740993") })));
    assert.deepEqual([a.entryNo, b.entryNo, a.version], [1, 2, 1]);
    assert.deepEqual([a.companyId, a.paymentDate, a.hotelAmountPaise, a.referenceName, a.hotelRefundAmountPaise, a.refundPaymentDate, a.createdBy, a.deletedAt], [acme, "2026-03-04", BigInt(100_000), "Ref", null, null, ACTOR, null]);
    assert.equal(b.hotelAmountPaise, BigInt("9007199254740993"));
    assert.deepEqual(await run((r) => r.advances.get(a.id)), a);
    const del = await run((r) => r.advances.softDelete(b.id, 1, ACTOR));
    assert.ok(del.ok);
    const c = await run((r) => r.advances.create(advance({ receiptNumber: "2026 / 3" })));
    assert.equal(c.entryNo, 3);
  });

  test("a receipt number is unique among LIVE rows; a binned one frees it, and restoring over a live one is refused", async () => {
    const first = await run((r) => r.advances.create(advance({ receiptNumber: "R-UNIQ" })));
    await assert.rejects(() => run((r) => r.advances.create(advance({ receiptNumber: "R-UNIQ" }))), (e) => e instanceof RepoError && e.kind === "unique");
    await run((r) => r.advances.softDelete(first.id, 1, ACTOR));
    const second = await run((r) => r.advances.create(advance({ receiptNumber: "R-UNIQ" })));
    await assert.rejects(() => run((r) => r.advances.restore(first.id, 2, ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal((await run((r) => r.advances.byReceipt("R-UNIQ")))?.id, second.id);
    assert.equal((await run((r) => r.advances.allByReceipt("R-UNIQ"))).length, 1);
  });

  test("a balance below zero is refused by the table; a stale version is a conflict; update, soft delete, restore and purge follow the version rules", async () => {
    const a = await run((r) => r.advances.create(advance({ receiptNumber: "R-VER" })));
    await assert.rejects(() => run((r) => r.advances.update(a.id, 1, { hotelBalancePaise: BigInt(-1) }, ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    const ok = await run((r) => r.advances.update(a.id, 1, { guestName: "Changed", hotelBalancePaise: BigInt(40_000) }, ACTOR));
    assert.ok(ok.ok && ok.record.version === 2 && ok.record.guestName === "Changed" && ok.record.updatedBy === ACTOR && ok.record.hotelBalancePaise === BigInt(40_000));
    assert.deepEqual(await run((r) => r.advances.update(a.id, 1, { guestName: "Late" }, ACTOR)), { ok: false, reason: "conflict", currentVersion: 2 });
    assert.deepEqual(await run((r) => r.advances.update(newId(), 1, {}, ACTOR)), { ok: false, reason: "not_found" });
    assert.ok((await run((r) => r.advances.softDelete(a.id, 2, ACTOR))).ok);
    assert.equal(await run((r) => r.advances.get(a.id)), null);
    assert.equal((await run((r) => r.advances.get(a.id, { deleted: true })))?.id, a.id);
    assert.equal(await run((r) => r.advances.purge(a.id)), true);
    assert.equal(await run((r) => r.advances.purge(a.id)), false);
  });

  describe("the list screen's filters, states, figures and menus", () => {
    const ids: Record<string, string> = {};
    before(async () => {
      await cleanTables();
      const make = async (key: string, over: Partial<NewAdvance>) => void (ids[key] = (await run((r) => r.advances.create(advance(over)))).id);
      await make("old-open", { receiptNumber: "2025 / 9", guestName: "Old Guest", paymentDate: "2025-12-01", hotelMode: "Cash", foodMode: null, hotelAmountPaise: BigInt(1000), hotelBalancePaise: BigInt(1000), foodAmountPaise: Z, foodBalancePaise: Z, totalPaise: BigInt(1000) });
      await make("old-used", { receiptNumber: "2025 / 8", guestName: "Used Guest", paymentDate: "2025-11-01", hotelBalancePaise: Z, foodBalancePaise: Z });
      await make("unused", { receiptNumber: "2026 / 10", guestName: "Fresh Guest", paymentDate: "2026-03-02", companyId: acme, hotelMode: "Card", foodMode: null });
      await make("partly", { receiptNumber: "2026 / 11", guestName: "Part Guest", paymentDate: "2026-03-03", hotelBalancePaise: BigInt(50_000), roomNumber: "202" });
      await make("refunded", { receiptNumber: "2026 / 12", guestName: "Refund Guest", paymentDate: "2026-03-04", hotelBalancePaise: Z, foodBalancePaise: Z, hotelRefundAmountPaise: BigInt(100_000), foodRefundAmountPaise: BigInt(50_000), refundPaymentDate: "2026-03-10", companyId: globex });
    });
    const list = (over: Record<string, unknown> = {}) => run((r) => r.advances.list({ page: 1, pageSize: 20, sort: "paymentDate", dir: "asc", ...over } as never));
    const names = async (over: Record<string, unknown> = {}) => (await list(over)).rows.map((x) => x.guestName);

    test("the year window carries older OPEN advances in; month, mode, company and side narrow it", async () => {
      assert.deepEqual(await names({ from: "2026-03-01", to: "2026-03-31" }), ["Old Guest", "Fresh Guest", "Part Guest", "Refund Guest"], "the older advance with money left is carried in, the used one is not");
      assert.deepEqual(await names({ month: "2026-03" }), ["Fresh Guest", "Part Guest", "Refund Guest"]);
      assert.deepEqual(await names({ mode: "CARD" }), ["Fresh Guest"], "modes compare case-insensitively");
      assert.deepEqual(await names({ company: acme }), ["Fresh Guest"]);
      assert.deepEqual(await names({ company: "walkin", month: "2026-03" }), ["Part Guest"]);
      assert.deepEqual(await names({ side: "food" }), ["Used Guest", "Fresh Guest", "Part Guest", "Refund Guest"], "an advance with no food amount is not on the food side");
    });

    test("words: every word must appear in the receipt, guest, mobile, room, company name or walk-in, the modes or the amount as 1500.00", async () => {
      assert.deepEqual(await names({ words: ["acme"] }), ["Fresh Guest"]);
      assert.deepEqual(await names({ words: ["walk-in", "part"] }), ["Part Guest"]);
      assert.deepEqual(await names({ words: ["1500.00", "fresh"] }), ["Fresh Guest"]);
      assert.deepEqual(await names({ words: ["2026", "/", "11"] }), ["Part Guest"]);
      assert.deepEqual(await names({ words: ["nobody"] }), []);
      assert.deepEqual(await names({ words: ["%"] }), [], "a percent sign is an ordinary character");
    });

    test("states and their counts, the numbers on top, the filter menus and the next receipt suggestion", async () => {
      assert.deepEqual(await names({ state: "unused", from: "2026-03-01" }), ["Old Guest", "Fresh Guest"]);
      assert.deepEqual(await names({ state: "partly" }), ["Part Guest"]);
      assert.deepEqual(await names({ state: "used" }), ["Used Guest"]);
      assert.deepEqual(await names({ state: "refunded" }), ["Refund Guest"]);
      assert.deepEqual(await run((r) => r.advances.countByState({})), { unused: 2, partly: 1, used: 1, refunded: 1 });
      const f = await run((r) => r.advances.figures("2026-03-01", "2026-03-31"));
      assert.deepEqual(f, { monthTakenPaise: BigInt(450_000), heldPaise: BigInt(1000 + 150_000 + 100_000), unusedCount: 2, refundedPaise: BigInt(150_000), all: 5 });
      const o = await run((r) => r.advances.options());
      assert.deepEqual([o.modes, o.months], [["Card", "Cash", "UPI"], ["2026-03", "2025-12", "2025-11"]]);
      assert.deepEqual(o.companyIds.sort(), [acme, globex].sort());
      assert.equal(await run((r) => r.advances.highestTyped("2026 / ")), 12);
      assert.equal(await run((r) => r.advances.highestTyped("2027 / ")), 0);
    });

    test("sorting by each column in both directions with ties by entry number, paging, and the open advances picker", async () => {
      assert.deepEqual(await names({ sort: "guestName", dir: "asc" }), ["Fresh Guest", "Old Guest", "Part Guest", "Refund Guest", "Used Guest"]);
      assert.equal((await list({ sort: "totalAmountPaise", dir: "desc" })).rows[0].guestName, "Refund Guest", "four advances tie at 150 000: the tie goes by entry number, newest first when descending");
      assert.deepEqual((await list({ sort: "balancePaise", dir: "asc", pageSize: 2, page: 2 })).rows.length, 2);
      assert.equal((await list({ pageSize: 2 })).total, 5);
      assert.deepEqual((await run((r) => r.advances.open(10))).map((x) => x.guestName), ["Fresh Guest", "Old Guest", "Part Guest"]);
      await assert.rejects(() => list({ sort: "x; drop" }), /Not a sort column/);
    });

    test("advances taken against a reservation, by payment date", async () => {
      const reservation = String((await insertRow(owner, hotel.schema, "pms_reservations", {})).id);
      await run((r) => r.advances.create(advance({ receiptNumber: "RES-2", reservationId: reservation, paymentDate: "2026-03-09" })));
      await run((r) => r.advances.create(advance({ receiptNumber: "RES-1", reservationId: reservation, paymentDate: "2026-03-05" })));
      const map = await run((r) => r.advances.byReservation([reservation, newId()]));
      assert.deepEqual(map.get(reservation)?.map((x) => x.receiptNumber), ["RES-1", "RES-2"]);
      assert.equal([...map.values()].filter((v) => v.length === 0).length, 1, "an unknown reservation has an empty list");
    });
  });
});

describe("bills", () => {
  before(cleanTables);

  test("create round-trips every kind of field: debit slots, stay segments with exact paise, GST percent text, arrival and departure moments", async () => {
    const stay = [{ from: "2026-03-01", to: "2026-03-03", plan: "CP", persons: 2, nights: 2, ratePaise: BigInt(150_000), amountPaise: BigInt(600_000) }, { from: "2026-03-03", to: "2026-03-04", plan: "EP", persons: 2, nights: 1, ratePaise: null, amountPaise: BigInt("9007199254740993") }];
    const debit: BillFields["debit"] = [slot({ date: "2026-03-20", hotelMode: "Cash", hotelPaise: BigInt(50_000), foodPaise: Z }), slot({ date: "2026-03-25", foodMode: "UPI", foodPaise: BigInt(-500) }), slot(), slot(), slot()];
    const a = await run((r) => r.bills.create(bill({ billNumber: "B-1", staySegments: stay, hotelGstPercent: "2.5", foodGstPercent: "5", arrivalAt: new Date("2026-03-01T06:30:00Z"), departureAt: new Date("2026-03-04T06:30:00Z"), debit, companyId: acme, hotelAmountPaise: BigInt(-250) })));
    const back = await run((r) => r.bills.get(a.id));
    assert.deepEqual(back, a);
    assert.deepEqual([a.entryNo, a.version, a.hotelGstPercent, a.foodGstPercent, a.arrivalAt?.toISOString(), a.hotelAmountPaise], [1, 1, "2.5", "5", "2026-03-01T06:30:00.000Z", BigInt(-250)]);
    assert.deepEqual(a.staySegments, stay);
    assert.deepEqual(a.debit[1], slot({ date: "2026-03-25", foodMode: "UPI", foodPaise: BigInt(-500) }));
    assert.equal(a.debit[0].hotelPaise, BigInt(50_000));
  });

  test("the SAC codes are stored with the bill (hotel 0061): written ones round-trip, an edit leaves them, a code that is not 4-8 digits is refused", async () => {
    const a = await run((r) => r.bills.create(bill({ billNumber: "B-SAC", hotelSac: "996311", foodSac: "996331" })));
    assert.deepEqual([a.hotelSac, a.foodSac], ["996311", "996331"]);
    const upd = await run((r) => r.bills.update(a.id, 1, { guestName: "Edited" }, ACTOR));
    assert.ok(upd.ok && upd.record.hotelSac === "996311" && upd.record.foodSac === "996331");
    await assert.rejects(() => run((r) => r.bills.create(bill({ billNumber: "B-SAC-BAD", hotelSac: "99A311" }))), (e) => e instanceof RepoError && e.kind === "check");
  });

  test("the bill number is unique among live rows; the table refuses a negative balance and a departure before the arrival; stale versions conflict", async () => {
    const first = await run((r) => r.bills.create(bill({ billNumber: "B-UNIQ" })));
    await assert.rejects(() => run((r) => r.bills.create(bill({ billNumber: "B-UNIQ" }))), (e) => e instanceof RepoError && e.kind === "unique");
    await assert.rejects(() => run((r) => r.bills.create(bill({ balanceHotelAmountPaise: BigInt(-1) }))), (e) => e instanceof RepoError && e.kind === "check");
    await assert.rejects(() => run((r) => r.bills.create(bill({ arrivalAt: new Date("2026-03-05T00:00:00Z"), departureAt: new Date("2026-03-04T00:00:00Z") }))), (e) => e instanceof RepoError && e.kind === "check");
    const upd = await run((r) => r.bills.update(first.id, 1, { guestName: "New Name", debit: [slot({ date: "2026-04-01", hotelPaise: BigInt(5) }), slot(), slot(), slot(), slot()] }, ACTOR));
    assert.ok(upd.ok && upd.record.guestName === "New Name" && upd.record.debit[0].date === "2026-04-01" && upd.record.version === 2);
    assert.deepEqual(await run((r) => r.bills.update(first.id, 1, {}, ACTOR)), { ok: false, reason: "conflict", currentVersion: 2 });
    assert.ok((await run((r) => r.bills.softDelete(first.id, 2, ACTOR))).ok);
    assert.equal(await run((r) => r.bills.byNumber("B-UNIQ")), null);
    assert.ok((await run((r) => r.bills.restore(first.id, 3, ACTOR))).ok);
    assert.equal((await run((r) => r.bills.byNumber("B-UNIQ")))?.id, first.id);
    assert.equal(await run((r) => r.bills.purge(first.id)), false, "a live bill is never purged");
  });

  describe("the list screen's filters, states, figures and advance links", () => {
    let adv: string;
    before(async () => {
      await cleanTables();
      adv = (await run((r) => r.advances.create(advance({ receiptNumber: "ADV-1" })))).id;
      const make = (over: Partial<BillFields>) => run((r) => r.bills.create(bill(over)));
      await make({ billNumber: "P-1", guestName: "Paid Guest", billDate: "2026-03-02", totalHotelAmountPaise: BigInt(100_000), advanceId: adv, advanceHotelAmountPaise: BigInt(30_000), advanceFoodAmountPaise: BigInt(1_000) });
      await make({ billNumber: "D-OLD", guestName: "Old Debtor", billDate: "2025-12-05", hotelModeOfPayment: "Debit", totalHotelAmountPaise: BigInt(70_000), balanceHotelAmountPaise: BigInt(70_000), companyId: acme });
      await make({ billNumber: "D-NEW", guestName: "New Debtor", billDate: "2026-03-03", hotelModeOfPayment: "Debit", foodModeOfPayment: "Debit", totalHotelAmountPaise: BigInt(10_000), totalFoodAmountPaise: BigInt(5_000), balanceHotelAmountPaise: BigInt(10_000), balanceFoodAmountPaise: BigInt(5_000), advanceId: adv, advanceHotelAmountPaise: BigInt(2_000) });
      await make({ billNumber: "S-1", guestName: "Settled Guest", billDate: "2026-03-04", hotelModeOfPayment: "Debit", totalHotelAmountPaise: BigInt(40_000), debit: [slot({ date: "2026-03-20", hotelPaise: BigInt(25_000) }), slot({ date: "2026-03-22", hotelPaise: BigInt(15_000) }), slot(), slot(), slot()] });
    });
    const list = (over: Record<string, unknown> = {}) => run((r) => r.bills.list({ page: 1, pageSize: 20, sort: "billDate", dir: "asc", ...over } as never));
    const names = async (over: Record<string, unknown> = {}) => (await list(over)).rows.map((x) => x.guestName);

    test("the window carries older unsettled debit bills in; states paid, due and settled; mode, company and words", async () => {
      assert.deepEqual(await names({ from: "2026-03-01", to: "2026-03-31" }), ["Old Debtor", "Paid Guest", "New Debtor", "Settled Guest"]);
      assert.deepEqual(await names({ state: "due" }), ["Old Debtor", "New Debtor"]);
      assert.deepEqual(await names({ state: "settled" }), ["Settled Guest"]);
      assert.deepEqual(await names({ state: "paid" }), ["Paid Guest"]);
      assert.deepEqual(await run((r) => r.bills.countByState({})), { paid: 1, due: 2, settled: 1 });
      assert.deepEqual(await names({ mode: "debit", month: "2026-03" }), ["New Debtor", "Settled Guest"]);
      assert.deepEqual(await names({ company: acme }), ["Old Debtor"]);
      assert.deepEqual(await names({ words: ["acme", "old"] }), ["Old Debtor"]);
      assert.deepEqual(await names({ words: ["150.00"] }), ["New Debtor"], "the total of both sides as 150.00");
      assert.deepEqual(await names({ side: "food" }), ["New Debtor"]);
    });

    test("figures, menus, sorting and the links between bills and the advance they took money from", async () => {
      const f = await run((r) => r.bills.figures("2026-03-01", "2026-03-31"));
      assert.deepEqual(f, { monthCount: 3, monthBilledPaise: BigInt(100_000 + 15_000 + 40_000), owedPaise: BigInt(70_000 + 15_000), dueCount: 2, settledPaise: BigInt(40_000), all: 4 });
      const o = await run((r) => r.bills.options());
      assert.deepEqual([o.modes, o.months, o.companyIds], [["Cash", "Debit"], ["2026-03", "2025-12"], [acme]]);
      assert.deepEqual(await names({ sort: "totalPaise", dir: "desc" }), ["Paid Guest", "Old Debtor", "Settled Guest", "New Debtor"]);
      assert.deepEqual(await names({ sort: "balancePaise", dir: "desc", pageSize: 1 }), ["Old Debtor"]);
      assert.equal(await run((r) => r.bills.highestTyped("P-")), 1);
      const numbers = await run((r) => r.bills.numbersByAdvance([adv, newId()]));
      assert.deepEqual(numbers.get(adv)?.sort(), ["D-NEW", "P-1"]);
      assert.deepEqual(await run((r) => r.bills.takenFromAdvance(adv)), { hotelPaise: BigInt(32_000), foodPaise: BigInt(1_000) });
      const one = (await run((r) => r.bills.byNumber("S-1"))) as { id: string };
      const many = await run((r) => r.bills.getMany([one.id, newId()]));
      assert.deepEqual([...many.keys()], [one.id]);
      assert.deepEqual((await run((r) => r.bills.getMany([]))).size, 0);
    });
  });

  test("forUpdate reads the row and keeps it locked until the unit ends: a second writer waits, then sees the first one's result", async () => {
    const made = await run((r) => r.bills.create(bill({ billNumber: "B-LOCK" })));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = run(async (r) => {
      const row = await r.bills.get(made.id, { forUpdate: true });
      await held;
      return r.bills.update(made.id, (row as { version: number }).version, { guestName: "First" }, ACTOR);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = run(async (r) => {
      const row = await r.bills.get(made.id, { forUpdate: true });
      return (row as { guestName: string }).guestName;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    assert.ok((await first).ok);
    assert.equal(await second, "First");
  });
});

describe("the word search of bills and advances (the global search and both list screens), on a fixed data set", () => {
  // The rule since migration 0025: per word, the row's own columns OR its company's name (looked up once) OR "walk-in" OR the amount; it must find
  // exactly what the old single condition over concat_ws(' ', ..., COALESCE(company, 'walk-in'), ..., amount) found, in the same order.
  const rup = (a: string, b: string) => `trim(to_char((${a} + ${b})::numeric / 100, 'FM999999999990.00'))`;
  const OLD = {
    bills: `concat_ws(' ', b.bill_number, b.gr_number, b.guest_name, b.mobile_number, b.room_number, COALESCE(c.name, 'walk-in'), b.hotel_mode_of_payment, b.food_mode_of_payment, ${rup("b.total_hotel_amount_paise", "b.total_food_amount_paise")})`,
    advances: `concat_ws(' ', b.receipt_number, b.guest_name, b.mobile_number, b.room_number, COALESCE(c.name, 'walk-in'), b.hotel_mode, b.food_mode, ${rup("b.hotel_amount_paise", "b.food_amount_paise")})`,
  };
  const oldIds = async (kind: "bills" | "advances", words: string[], deleted: "no" | "only"): Promise<string[]> => {
    const params: unknown[] = [];
    const cond = words.map((w) => (params.push(w.toLowerCase()), `position($${params.length}::text in lower(${OLD[kind]})) > 0`)).join(" AND ");
    const table = kind === "bills" ? "bill_master_bills" : "bill_master_advances";
    const order = kind === "bills" ? "b.bill_date DESC, b.entry_no DESC" : "b.payment_date DESC, b.entry_no DESC";
    const r = await owner.query(`SELECT b.id FROM "${hotel.schema}".${table} b LEFT JOIN "${hotel.schema}".company_profiles c ON c.id = b.company_id WHERE b.deleted_at IS ${deleted === "only" ? "NOT NULL" : "NULL"} AND ${cond} ORDER BY ${order}`, params);
    return r.rows.map((x) => String(x.id));
  };
  const WORDS: string[][] = [
    ["ravi"], ["walk"], ["walk-in"], ["k-i"], ["acme"], ["textiles", "asha"], ["gone"], ["1500.00"], ["150"], [".5"], ["0.50"], ["-"], ["99.99"], ["%"], ["_"], ["\\"],
    ["9876"], ["upi"], ["co"], ["ravi", "1500"], ["zz"], ["101"], ["2026"], ["/"], ["walk", "cash"], ["acme", "upi", "asha"],
  ];
  let gone: string;
  before(async () => {
    await cleanTables();
    // a binned company keeps its name in the search, as the old join did (it never looked at deleted_at)
    gone = String((await owner.query(`INSERT INTO "${hotel.schema}".company_profiles (name, deleted_at) VALUES ('Gone Travels Co', now()) RETURNING id`)).rows[0].id);
    const b = (over: Partial<BillFields>) => run((r) => r.bills.create(bill(over)));
    const a = (over: Partial<NewAdvance>) => run((r) => r.advances.create(advance(over)));
    await b({ billNumber: "2026 / 1", guestName: "Ravi Mehta", mobileNumber: "9876501234", roomNumber: "101", billDate: "2026-03-05", totalHotelAmountPaise: BigInt(150_000) });
    await b({ billNumber: "2026 / 2", guestName: "Asha Rao", companyId: acme, hotelModeOfPayment: "UPI", billDate: "2026-03-05", totalHotelAmountPaise: BigInt(200_000), totalFoodAmountPaise: BigInt(25_050) });
    await b({ billNumber: "2026 / 3", guestName: "Walker Shah", companyId: globex, hotelModeOfPayment: "Card", billDate: "2026-03-06", totalHotelAmountPaise: BigInt(9_999) });
    await b({ billNumber: "2026 / 4", guestName: "Neha", companyId: gone, billDate: "2026-03-04", totalHotelAmountPaise: BigInt(50) });
    await b({ billNumber: "2026 / 5", guestName: "Ravi Kumar", billDate: "2026-03-05", totalHotelAmountPaise: BigInt(150_000), foodModeOfPayment: "Cash" });
    const binned = await b({ billNumber: "2026 / 6", guestName: "Ravi Binned", billDate: "2026-03-07", companyId: acme });
    assert.ok((await run((r) => r.bills.softDelete(binned.id, 1, ACTOR))).ok);
    await a({ receiptNumber: "2026 / 1", guestName: "Ravi Mehta", mobileNumber: "9876501234", roomNumber: "101", paymentDate: "2026-03-05" });
    await a({ receiptNumber: "2026 / 2", guestName: "Asha Rao", companyId: acme, hotelMode: "UPI", paymentDate: "2026-03-05", hotelAmountPaise: BigInt(50), hotelBalancePaise: BigInt(50), foodAmountPaise: Z, foodBalancePaise: Z });
    await a({ receiptNumber: "2026 / 3", guestName: "Walker Shah", companyId: globex, paymentDate: "2026-03-06", hotelAmountPaise: BigInt(9_999), hotelBalancePaise: BigInt(9_999), foodAmountPaise: Z, foodBalancePaise: Z });
    await a({ receiptNumber: "2026 / 4", guestName: "Neha", companyId: gone, paymentDate: "2026-03-04" });
    const binnedA = await a({ receiptNumber: "2026 / 6", guestName: "Ravi Binned", paymentDate: "2026-03-07" });
    assert.ok((await run((r) => r.advances.softDelete(binnedA.id, 1, ACTOR))).ok);
  });
  const billList = (words: string[], over: Record<string, unknown> = {}) => run((r) => r.bills.list({ words, page: 1, pageSize: 50, sort: "billDate", dir: "desc", deleted: "no", ...over } as never));
  const advanceList = (words: string[], over: Record<string, unknown> = {}) => run((r) => r.advances.list({ words, page: 1, pageSize: 50, sort: "paymentDate", dir: "desc", deleted: "no", ...over } as never));

  test("every word list finds exactly the rows the old single condition found, in the same order, live and binned; the totals and state counts agree", async () => {
    for (const words of WORDS) {
      for (const deleted of ["no", "only"] as const) {
        const bills = await billList(words, { deleted });
        const old = await oldIds("bills", words, deleted);
        assert.deepEqual(bills.rows.map((x) => x.id), old, `bills ${deleted} ${JSON.stringify(words)}`);
        assert.equal(bills.total, old.length);
        const states = await run((r) => r.bills.countByState({ words, deleted }));
        assert.equal(states.paid + states.due + states.settled, old.length);
        const advances = await advanceList(words, { deleted });
        const oldA = await oldIds("advances", words, deleted);
        assert.deepEqual(advances.rows.map((x) => x.id), oldA, `advances ${deleted} ${JSON.stringify(words)}`);
        assert.equal(advances.total, oldA.length);
      }
    }
  });

  test("what the words find, pinned: names, walk-in, a binned company's name, the amount as rupees, newest first with ties by entry number", async () => {
    const guests = async (words: string[]) => (await billList(words)).rows.map((x) => x.guestName);
    assert.deepEqual(await guests(["ravi"]), ["Ravi Kumar", "Ravi Mehta"], "same day: the newer entry first; the binned bill is not live");
    assert.deepEqual(await guests(["walk"]), ["Walker Shah", "Ravi Kumar", "Ravi Mehta"], "Walker by name, the two without a company as walk-in");
    assert.deepEqual(await guests(["k-i"]), ["Ravi Kumar", "Ravi Mehta"], "a piece of walk-in");
    assert.deepEqual(await guests(["textiles", "asha"]), ["Asha Rao"], "the company's name and the guest, two words");
    assert.deepEqual(await guests(["gone"]), ["Neha"], "a binned company's name still finds its bills");
    assert.deepEqual(await guests(["1500.00"]), ["Ravi Kumar", "Ravi Mehta"]);
    assert.deepEqual(await guests(["2250.50"]), ["Asha Rao"], "the hotel and food totals together");
    assert.deepEqual(await guests(["0.50"]), ["Asha Rao", "Neha"], "0.50 is also inside 2250.50");
    assert.deepEqual(await guests(["walk", "cash"]), ["Ravi Kumar", "Ravi Mehta"]);
    assert.deepEqual(await guests(["%"]), [], "a percent sign is an ordinary character");
    assert.deepEqual((await billList(["ravi"], { deleted: "only" })).rows.map((x) => x.guestName), ["Ravi Binned"]);
    assert.deepEqual((await advanceList(["walk"])).rows.map((x) => x.guestName), ["Walker Shah", "Ravi Mehta"]);
    assert.deepEqual((await advanceList(["0.50"])).rows.map((x) => x.guestName), ["Asha Rao"]);
  });

  test("countTotal false (the global search): the same page, no count (total -1); left out it counts", async () => {
    for (const words of [["ravi"], ["walk"], ["zz"]]) {
      const counted = await billList(words, { pageSize: 1 });
      const page = await billList(words, { pageSize: 1, countTotal: false });
      assert.deepEqual(page.rows, counted.rows);
      assert.equal(page.total, -1);
      assert.equal(counted.total, (await oldIds("bills", words, "no")).length);
      const a = await advanceList(words, { pageSize: 1, countTotal: false });
      assert.deepEqual([a.rows, a.total], [(await advanceList(words, { pageSize: 1 })).rows, -1]);
    }
  });

  test("migration 0025 made the newest-first indexes over the live rows", async () => {
    const r = await owner.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE '%_live_%_entry_no_idx' ORDER BY indexname", [hotel.schema]);
    assert.deepEqual(r.rows.map((x) => String(x.indexname)), ["bill_master_advances_live_payment_date_entry_no_idx", "bill_master_bills_live_bill_date_entry_no_idx"]);
    for (const x of r.rows) assert.match(String(x.indexdef), /DESC, entry_no DESC\) WHERE \(deleted_at IS NULL\)/);
  });
});

describe("the read-only neighbours", () => {
  test("companies (a deleted company keeps its name), meal plan rates oldest first, the hotel's header, Master Data lists, accounting years", async () => {
    assert.deepEqual(await run((r) => r.companies.exists(acme)), true);
    assert.equal(await run((r) => r.companies.exists(newId())), false);
    await owner.query(`UPDATE "${hotel.schema}".company_profiles SET deleted_at = now() WHERE id = $1`, [globex]);
    assert.equal(await run((r) => r.companies.exists(globex)), true, "Laravel `exists` ignores deleted_at");
    assert.deepEqual([...(await run((r) => r.companies.names([acme, globex]))).values()].sort(), ["Acme Textiles", "Globex"]);
    assert.deepEqual((await run((r) => r.companies.list(10))).map((c) => c.name), ["Acme Textiles"], "the picker lists live companies only");
    await owner.query(`INSERT INTO "${hotel.schema}".meal_plan_rates (plan, rate_per_person_paise, effective_from) VALUES ('CP', 150000, '2026-04-01'), ('CP', 120000, '2025-04-01')`);
    assert.deepEqual((await run((r) => r.mealPlanRates.table())).map((x) => [x.plan, x.effectiveFrom, x.ratePaise]), [["CP", "2025-04-01", BigInt(120_000)], ["CP", "2026-04-01", BigInt(150_000)]]);
    const before = await run((r) => r.hotelProfile.header());
    assert.deepEqual([before.name, before.foodName, before.address, before.gstin], ["Billing Hotel", "Billing Hotel Food", null, null], "a new hotel is named after itself");
    await owner.query(`INSERT INTO "${hotel.schema}".app_settings (key, value) VALUES ('general.site_name', 'Grand Billing'), ('general.address', '1 Main Road'), ('billing.hotel_gstin', '24ABCDE1234F1Z5')`);
    const after = await run((r) => r.hotelProfile.header());
    assert.deepEqual([after.name, after.address, after.gstin, after.foodGstin], ["Grand Billing", "1 Main Road", "24ABCDE1234F1Z5", null]);
    const set = await owner.query(`SELECT key FROM "${hotel.schema}".option_sets LIMIT 1`);
    assert.ok((await run((r) => r.optionLists.items(String(set.rows[0].key)))).length > 0);
    assert.deepEqual((await run((r) => r.accountingYears.list())).map((y) => [y.label, y.startsOn, y.endsOn]), [[currentYearLabel(), currentYearStart(), currentYearEnd()]], "a new hotel starts with the year it is in (seed 0002)");
  });
});

after(async () => {
  await releaseTestLock?.();
});
