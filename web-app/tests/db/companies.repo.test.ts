// The Companies repositories on the REAL PostgreSQL instance (repos/postgres/companies.ts): company profiles, customers, CRM, and the ledger's
// source, including the ONE-query overview summary, which is checked against the service's own ledger builder over generated data.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { BillFields, DebitSlot, NewAdvance, NewBill } from "../../src/server/repos/billing";
import type { CompaniesRepos, CompanyFields, CustomerFields } from "../../src/server/repos/companies";
import { createPgCompaniesUnit } from "../../src/server/repos/postgres/companies";
import { RepoError, type Unit } from "../../src/server/repos/types";
import { buildLedger, ledgerTotals } from "../../src/server/services/companies/ledger";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<CompaniesRepos>;
const USER = newId();
const ACTOR = newId();
const run = <T>(work: (r: CompaniesRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: USER }, work);
const Z = BigInt(0);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Companies Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 8 });
  unit = createPgCompaniesUnit(database.withHotel);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

const company = (over: Partial<CompanyFields> = {}): CompanyFields & { createdBy: string } => ({
  name: `Company ${Math.random().toString(36).slice(2, 7)}`, email: null, mobileNumber: null, phoneNumber: null, country: null, nationality: null, pincode: null, gstNumber: null, address: null,
  discountPercentage: null, gstPercentage: null, tcsPercentage: null, tdsPercentage: null, instruction: null, contacts: [], createdBy: ACTOR, ...over,
});
const customer = (over: Partial<CustomerFields> = {}): CustomerFields & { createdBy: string } => ({
  name: "Asha Rao", mobile: String(9_000_000_000 + Math.floor(Math.random() * 999_999_999)), email: null, address: null, city: null, idProofType: null, idProofNumber: null, notes: null, isActive: true, source: "admin", createdBy: ACTOR, ...over,
});

describe("company profiles", () => {
  test("create reads back every field (percentages as text, contacts as a list); the name is unique among LIVE companies without regard to case", async () => {
    const acme = await run((r) =>
      r.companyProfiles.create(company({ name: "Acme Textiles", email: "a@acme.test", gstNumber: "24ABCDE1234F1Z5", discountPercentage: "12.50", gstPercentage: "5.00", contacts: [{ role: "Accounts", name: "Ravi", email: "r@acme.test", mobile: "9000000001" }], address: "1 Main Road" })),
    );
    assert.deepEqual([acme.name, acme.discountPercentage, acme.gstPercentage, acme.tcsPercentage, acme.contacts[0].name, acme.deletedAt, acme.createdBy], ["Acme Textiles", "12.50", "5.00", null, "Ravi", null, ACTOR]);
    assert.deepEqual(await run((r) => r.companyProfiles.get(acme.id)), acme);
    await assert.rejects(() => run((r) => r.companyProfiles.create(company({ name: "ACME textiles" }))), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal(await run((r) => r.companyProfiles.nameTaken("acme TEXTILES")), true);
    assert.equal(await run((r) => r.companyProfiles.nameTaken("acme textiles", acme.id)), false, "its own name is not 'taken'");
    assert.equal((await run((r) => r.companyProfiles.withGstNumber("24ABCDE1234F1Z5")))?.id, acme.id);
    assert.equal(await run((r) => r.companyProfiles.withGstNumber("24ABCDE1234F1Z5", acme.id)), null);
    await assert.rejects(() => run((r) => r.companyProfiles.create(company({ discountPercentage: "101" }))), (e) => e instanceof RepoError && e.kind === "check");
  });

  test("update changes only live companies and returns the row; soft delete frees the name; restore over a live name is refused; purge only from the bin and never while bills name it", async () => {
    const first = await run((r) => r.companyProfiles.create(company({ name: "Globe Travel" })));
    const upd = await run((r) => r.companyProfiles.update(first.id, { email: "new@globe.test", contacts: [] }, ACTOR));
    assert.deepEqual([upd?.email, upd?.updatedBy], ["new@globe.test", ACTOR]);
    assert.equal(await run((r) => r.companyProfiles.update(newId(), { email: "x" }, ACTOR)), null);
    assert.equal(await run((r) => r.companyProfiles.softDelete(first.id, ACTOR)), true);
    assert.equal(await run((r) => r.companyProfiles.softDelete(first.id, ACTOR)), false);
    assert.equal(await run((r) => r.companyProfiles.get(first.id)), null);
    assert.equal((await run((r) => r.companyProfiles.get(first.id, { deleted: true })))?.deletedBy, ACTOR);
    assert.equal(await run((r) => r.companyProfiles.update(first.id, { email: "z" }, ACTOR)), null, "a binned company is not edited");
    const second = await run((r) => r.companyProfiles.create(company({ name: "GLOBE TRAVEL" })));
    await assert.rejects(() => run((r) => r.companyProfiles.restore(first.id, ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    await run((r) => r.companyProfiles.softDelete(second.id, ACTOR));
    const back = await run((r) => r.companyProfiles.restore(first.id, ACTOR));
    assert.ok(back && back.deletedAt === null);
    assert.equal(await run((r) => r.companyProfiles.purge(first.id)), false, "a live company is not purged");
    await run((r) => r.companyProfiles.softDelete(first.id, ACTOR));
    await run((r) => r.bills.create({ ...billInput({ companyId: first.id }) }));
    await assert.rejects(() => run((r) => r.companyProfiles.purge(first.id)), (e) => e instanceof RepoError && e.kind === "check", "bills still name it");
    assert.equal(await run((r) => r.companyProfiles.purge(second.id)), true);
  });

  test("the list is newest first with every word in any field or the contacts; counts, the numbers on top, byName and the typeahead", async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".bill_master_bills`);
    await owner.query(`DELETE FROM "${hotel.schema}".company_profiles`);
    const a = await run((r) => r.companyProfiles.create(company({ name: "Alpha Foods", gstNumber: "G1", contacts: [{ role: "Owner", name: "Zed Zebra", email: "z@x.test", mobile: "9" }, { role: "Cook", name: "Y", email: "y@x.test", mobile: "8" }] })));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await run((r) => r.companyProfiles.create(company({ name: "beta Hotels", email: "info@beta.test", address: "Park 100% Road" })));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const c = await run((r) => r.companyProfiles.create(company({ name: "Alpine Travel" })));
    const names = async (q: Record<string, unknown> = {}) => (await run((r) => r.companyProfiles.list({ page: 1, pageSize: 10, ...q }))).rows.map((x) => x.name);
    assert.deepEqual(await names(), ["Alpine Travel", "beta Hotels", "Alpha Foods"], "newest first");
    assert.deepEqual(await names({ words: ["zebra"] }), ["Alpha Foods"], "the contacts are searched too");
    assert.deepEqual(await names({ words: ["alp", "travel"] }), ["Alpine Travel"]);
    assert.deepEqual(await names({ words: ["100%"] }), ["beta Hotels"]);
    assert.deepEqual(await names({ words: ["%"] }), ["beta Hotels"]);
    assert.deepEqual((await run((r) => r.companyProfiles.list({ page: 2, pageSize: 2 }))).rows.length, 1);
    await run((r) => r.companyProfiles.softDelete(c.id, ACTOR));
    assert.deepEqual(await names({ deleted: "only" }), ["Alpine Travel"]);
    const stats = await run((r) => r.companyProfiles.stats(new Date(Date.now() - 3600_000)));
    assert.deepEqual(stats, { total: 2, withGst: 1, contacts: 2, month: 2 });
    assert.deepEqual((await run((r) => r.companyProfiles.byName({ limit: 10 }))).map((x) => x.name), ["Alpha Foods", "beta Hotels"], "by name, ignoring case");
    assert.deepEqual((await run((r) => r.companyProfiles.byName({ words: ["info@"], limit: 10 }))).map((x) => x.name), ["beta Hotels"]);
    assert.deepEqual((await run((r) => r.companyProfiles.lookup("AL", 5))).map((x) => [x.name, x.gstNumber]), [["Alpha Foods", "G1"]]);
    assert.deepEqual((await run((r) => r.companyProfiles.lookup("%", 5))), [], "a percent sign is not a wildcard");
    void a;
    void b;
  });
});

describe("customers", () => {
  test("create, unique mobile, update, delete; the list is newest first, searched in the visible fields only (never the ID number)", async () => {
    const asha = await run((r) => r.customers.create(customer({ name: "Asha Rao", mobile: "9876500001", email: "asha@x.test", city: "Surat", idProofNumber: "SECRET-ID-777", notes: "VIP" })));
    assert.deepEqual([asha.idProofNumber, asha.isActive, asha.source, asha.createdBy], ["SECRET-ID-777", true, "admin", ACTOR]);
    await assert.rejects(() => run((r) => r.customers.create(customer({ mobile: "9876500001" }))), (e) => e instanceof RepoError && e.kind === "unique");
    const bob = await run((r) => r.customers.create(customer({ name: "Bob Mehta", mobile: "9876500002", isActive: false, source: "self" })));
    assert.deepEqual((await run((r) => r.customers.list({ page: 1, pageSize: 10 }))).rows.map((x) => x.name), ["Bob Mehta", "Asha Rao"]);
    assert.deepEqual((await run((r) => r.customers.list({ page: 1, pageSize: 10, words: ["surat", "vip"] }))).rows.map((x) => x.name), ["Asha Rao"]);
    assert.deepEqual((await run((r) => r.customers.list({ page: 1, pageSize: 10, words: ["secret"] }))).rows, [], "the ID number is never searched");
    assert.deepEqual((await run((r) => r.customers.list({ page: 1, pageSize: 10, active: false }))).rows.map((x) => x.name), ["Bob Mehta"]);
    assert.deepEqual(await run((r) => r.customers.counts()), { all: 2, active: 1, off: 1 });
    assert.deepEqual(await run((r) => r.customers.stats(new Date(Date.now() - 3600_000))), { total: 2, selfSignup: 1, withEmail: 1, month: 2 });
    assert.equal((await run((r) => r.customers.byMobile("9876500002")))?.id, bob.id);
    assert.deepEqual((await run((r) => r.customers.lookup("98765000", 5))).map((x) => x.mobile).sort(), ["9876500001", "9876500002"]);
    assert.deepEqual((await run((r) => r.customers.lookup("ASH", 5))).map((x) => x.name), ["Asha Rao"]);
    const upd = await run((r) => r.customers.update(asha.id, { city: "Vadodara", isActive: false }, ACTOR));
    assert.deepEqual([upd?.city, upd?.isActive, upd?.updatedBy], ["Vadodara", false, ACTOR]);
    await assert.rejects(() => run((r) => r.customers.update(asha.id, { mobile: "9876500002" }, ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal(await run((r) => r.customers.update(newId(), { city: "x" }, ACTOR)), null);
    assert.equal((await run((r) => r.customers.getMany([asha.id, bob.id, newId()]))).size, 2);
    assert.equal(await run((r) => r.customers.delete(bob.id)), true);
    assert.equal(await run((r) => r.customers.delete(bob.id)), false);
  });
});

/* ---- the ledger's source ---- */
function billInput(over: Partial<BillFields> = {}): NewBill {
  const slot = (): DebitSlot => ({ date: null, hotelMode: null, foodMode: null, hotelPaise: null, foodPaise: null });
  return {
    billNumber: `B-${Math.random().toString(36).slice(2, 9)}`, billDate: "2026-03-04", companyId: null, guestName: "Guest", mobileNumber: null, roomNumber: null, grNumber: null, guestAddress: null, guestGstin: null,
    persons: 1, arrivalAt: null, departureAt: null, hotelPlan: null, hotelAmountPaise: Z, hotelPlanAmountPaise: Z, hotelExtraBedAmountPaise: Z, hotelLaundryAmountPaise: Z, hotelOtherAmountPaise: Z, hotelGstPaise: Z,
    hotelModeOfPayment: "Cash", foodAmountPaise: Z, foodPlanAmountPaise: Z, foodLaundryAmountPaise: Z, foodGstPaise: Z, foodModeOfPayment: null, totalHotelAmountPaise: Z, totalFoodAmountPaise: Z,
    balanceHotelAmountPaise: Z, balanceFoodAmountPaise: Z, referenceName: null, referenceMobileNumber: null, instruction: null, invoicePdfPath: null, foodInvoicePdfPath: null, staySegments: null,
    planFoodAmountPaise: Z, hotelGstPercent: null, foodGstPercent: null, hotelSac: "996311", foodSac: "996331", advanceId: null, advanceReceiptNumber: null, advanceGuestName: null, advanceHotelAmountSnapshot: null, advanceFoodAmountSnapshot: null,
    advanceDateSnapshot: null, advanceCompanySnapshot: null, advanceHotelAmountPaise: Z, advanceFoodAmountPaise: Z, advanceDeleteHotelAmountPaise: Z, advanceDeleteFoodAmountPaise: Z,
    debit: [slot(), slot(), slot(), slot(), slot()], debitHotelAdvance: null, debitFoodAdvance: null, debitReferenceName: null, debitReferenceMobileNumber: null, debitInstruction: null,
    formattedAdvanceReceiptNumber: null, createdBy: ACTOR, ...over,
  } as NewBill;
}

describe("the Company Ledger's source", () => {
  let seed = 20260306;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const day = (): string => `2026-0${3 + rnd(3)}-${String(1 + rnd(27)).padStart(2, "0")}`;
  const paise = (): bigint => BigInt((1 + rnd(900)) * 100);

  test("the overview summary (ONE aggregate query) equals the ledger built line by line, for every company, over generated bills, advances, debit settlements, refunds and advance use", async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".bill_master_bills`);
    await owner.query(`DELETE FROM "${hotel.schema}".bill_master_advances`);
    await owner.query(`DELETE FROM "${hotel.schema}".company_profiles`);
    const companies: string[] = [];
    for (let i = 0; i < 5; i++) companies.push((await run((r) => r.companyProfiles.create(company({ name: `Ledger Co ${i}` })))).id);
    const advances: string[] = [];
    for (let i = 0; i < 14; i++) {
      const hotelAmt = paise();
      const foodAmt = rnd(3) === 0 ? Z : paise();
      const refunded = rnd(4) === 0;
      const adv: NewAdvance = {
        receiptNumber: rnd(6) === 0 ? `Excessive / ${i}` : `2026 / ${i}`, guestName: "Guest", mobileNumber: null, roomNumber: null, companyId: rnd(5) === 0 ? null : companies[rnd(5)], reservationId: null,
        paymentDate: day(), hotelAmountPaise: hotelAmt, foodAmountPaise: foodAmt, hotelMode: "Cash", foodMode: foodAmt > Z ? "UPI" : null, referenceName: null, referenceMobileNumber: null, instruction: null,
        hotelBalancePaise: hotelAmt, foodBalancePaise: foodAmt, totalPaise: hotelAmt + foodAmt, hotelRefundAmountPaise: refunded ? hotelAmt : null, foodRefundAmountPaise: refunded ? foodAmt : null,
        hotelRefundMode: null, foodRefundMode: null, refundPaymentDate: refunded ? day() : null, refundGuestName: null, refundMobileNumber: null, refundInstruction: null, createdBy: ACTOR,
      };
      advances.push((await run((r) => r.advances.create(adv))).id);
    }
    for (let i = 0; i < 30; i++) {
      const hotelTotal = paise();
      const foodTotal = rnd(3) === 0 ? Z : paise();
      const debitSide = rnd(3) === 0;
      const useAdvance = rnd(2) === 0;
      const takenH = useAdvance ? BigInt(Math.min(Number(hotelTotal), (1 + rnd(5)) * 100)) : Z;
      const slots: DebitSlot[] = [0, 1, 2, 3, 4].map((k) => (debitSide && k < rnd(4) ? { date: day(), hotelMode: "Cash", foodMode: null, hotelPaise: paise(), foodPaise: rnd(2) === 0 ? paise() : null } : { date: null, hotelMode: null, foodMode: null, hotelPaise: null, foodPaise: null }));
      await run((r) =>
        r.bills.create(
          billInput({
            billNumber: `LB-${i}`, billDate: (rnd(10) === 0 ? null : day()) as string, companyId: rnd(6) === 0 ? null : companies[rnd(5)], hotelModeOfPayment: debitSide ? "Debit" : "Cash", foodModeOfPayment: foodTotal > Z ? (debitSide ? "Debit" : "UPI") : null,
            totalHotelAmountPaise: hotelTotal, totalFoodAmountPaise: foodTotal, balanceHotelAmountPaise: debitSide ? hotelTotal : Z, balanceFoodAmountPaise: debitSide ? foodTotal : Z,
            advanceId: useAdvance ? advances[rnd(advances.length)] : null, advanceHotelAmountPaise: takenH, debit: slots as BillFields["debit"],
          }),
        ),
      );
    }
    const monthFrom = "2026-04-01";
    const summary = new Map((await run((r) => r.ledgerSource.summaryByCompany(monthFrom))).map((s) => [s.companyId, s]));
    assert.ok(summary.size >= 3, "the generated data has several companies with lines");
    for (const id of companies) {
      const src = await run((r) => r.ledgerSource.forCompany(id));
      const built = buildLedger(id, src.bills, src.advances);
      const s = summary.get(id);
      if (!s) {
        assert.equal(built.length, 0, `${id}: no summary row means no lines`);
        continue;
      }
      const t = ledgerTotals(built);
      assert.deepEqual([s.billedPaise, s.receivedPaise, s.refundedPaise, s.balancePaise], [t.billedPaise, t.receivedPaise, t.refundedPaise, t.balancePaise], `${id} totals`);
      assert.equal(s.lines, built.length, `${id} line count`);
      assert.equal(s.lastDate, built.at(-1)?.date ?? null, `${id} last date`);
      assert.equal(s.bills, src.bills.length, `${id} bills`);
      assert.equal(s.openBills, src.bills.filter((b) => b.balanceHotelAmountPaise + b.balanceFoodAmountPaise > Z).length, `${id} open bills`);
      const monthLines = built.filter((l) => l.date >= monthFrom);
      assert.equal(s.monthBilledPaise, monthLines.filter((l) => l.kind === "bill").reduce((n, l) => n + l.debitPaise, Z), `${id} month billed`);
      assert.equal(s.monthReceivedPaise, monthLines.reduce((n, l) => n + l.creditPaise, Z), `${id} month received`);
    }
  });

  test("forCompany gives live bills (with the company of the advance each used) and live advances only", async () => {
    const co = (await run((r) => r.companyProfiles.create(company({ name: "Source Co" })))).id;
    const other = (await run((r) => r.companyProfiles.create(company({ name: "Other Co" })))).id;
    const adv = await run((r) => r.advances.create({ receiptNumber: "SRC-1", guestName: "G", mobileNumber: null, roomNumber: null, companyId: other, reservationId: null, paymentDate: "2026-03-01", hotelAmountPaise: BigInt(5000), foodAmountPaise: Z, hotelMode: "Cash", foodMode: null, referenceName: null, referenceMobileNumber: null, instruction: null, hotelBalancePaise: BigInt(5000), foodBalancePaise: Z, totalPaise: BigInt(5000), hotelRefundAmountPaise: null, foodRefundAmountPaise: null, hotelRefundMode: null, foodRefundMode: null, refundPaymentDate: null, refundGuestName: null, refundMobileNumber: null, refundInstruction: null, createdBy: ACTOR } as NewAdvance));
    const used = await run((r) => r.bills.create(billInput({ billNumber: "SRC-B1", companyId: co, advanceId: adv.id, advanceHotelAmountPaise: BigInt(1000), totalHotelAmountPaise: BigInt(1000) })));
    const gone = await run((r) => r.bills.create(billInput({ billNumber: "SRC-B2", companyId: co })));
    await run((r) => r.bills.softDelete(gone.id, 1, ACTOR));
    const src = await run((r) => r.ledgerSource.forCompany(co));
    assert.deepEqual(src.bills.map((b) => [b.billNumber, b.advanceCompanyId]), [["SRC-B1", other]]);
    assert.deepEqual(src.advances, []);
    assert.equal(src.bills[0].id, used.id);
    assert.deepEqual((await run((r) => r.ledgerSource.forCompany(other))).advances.map((a) => a.receiptNumber), ["SRC-1"]);
  });
});

after(async () => {
  await releaseTestLock?.();
});
