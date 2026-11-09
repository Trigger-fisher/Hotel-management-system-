// Golden tests for the Company Ledger: the expected lines, running balances, totals, periods, search and modes were produced by REAL PHP
// running verbatim copies of Pallav's CompanyLedger (db/scripts/php/generate-companies-fixtures.php -> fixtures/companies.json). Then a
// property test: the overview's summaryByCompany() (aggregated, no lines built) equals totals(buildLedger()) for every company over generated data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { AdvanceRecord, BillRecord, DebitSlot } from "../../src/server/repos/billing";
import { emptyHotelData, bindHotelRepos } from "../../src/server/repos/memory/frontOffice";
import { buildLedger, ledgerPeriod, ledgerTotals, modes, searchLedger, type LedgerBill } from "../../src/server/services/companies/ledger";

type Num = string | null;
interface Fixture {
  companyId: number;
  advances: { id: number; entry: number; company_id: number; receipt_number: string; guest_name: string; room_number: string | null; payment_date: string; hotel_amount: Num; food_amount: Num; hotel_mode: Num; food_mode: Num; instruction: Num; hotel_refund_amount: Num; food_refund_amount: Num; refund_payment_date: Num; refund_guest_name: Num; hotel_refund_mode: Num; food_refund_mode: Num; refund_instruction: Num }[];
  bills: { id: number; entry: number; company_id: number; bill_number: string; bill_date: string | null; guest_name: string; room_number: string | null; instruction: Num; total_hotel_amount: string; total_food_amount: string; hotel_mode_of_payment: Num; food_mode_of_payment: Num; advance_hotel_amount: string; advance_food_amount: string; advance_receipt_number: Num; advance_company_id: number | null; debit: [Num, Num, Num, Num, Num][]; debit_instruction: Num }[];
  lines: { kind: string; date: string; id: number; entry: number; ref: string; guest: string | null; room: string | null; mode: string | null; note: string | null; debitPaise: number; creditPaise: number; balancePaise: number }[];
  totals: { billed: number; received: number; refunded: number; balance: number };
  periods: { from: string | null; to: string | null; openingPaise: number; closingPaise: number; count: number; ids: string[]; totals: { billed: number; received: number; refunded: number; balance: number } }[];
  searches: { q: string; ids: string[] }[];
  modes: { in: (string | null)[]; out: string | null }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "companies.json"), "utf8")) as Fixture;
const p = (v: Num): bigint | null => (v === null || v === "" ? null : BigInt(Math.round(Number(v) * 100)));
const p0 = (v: Num): bigint => p(v) ?? BigInt(0);
const sid = (n: number): string => `id-${String(n).padStart(4, "0")}`;
// the fixture's ids are Pallav's auto-increment ids: created in that order
const at = (n: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
const company = String(fx.companyId);

const advances: AdvanceRecord[] = fx.advances.map((a) => ({
  id: sid(a.id), entryNo: a.entry, createdAt: at(a.id), receiptNumber: a.receipt_number, guestName: a.guest_name, roomNumber: a.room_number, companyId: String(a.company_id), paymentDate: a.payment_date,
  hotelAmountPaise: p0(a.hotel_amount), foodAmountPaise: p0(a.food_amount), hotelMode: a.hotel_mode, foodMode: a.food_mode, instruction: a.instruction,
  hotelRefundAmountPaise: p(a.hotel_refund_amount), foodRefundAmountPaise: p(a.food_refund_amount), refundPaymentDate: a.refund_payment_date, refundGuestName: a.refund_guest_name,
  hotelRefundMode: a.hotel_refund_mode, foodRefundMode: a.food_refund_mode, refundInstruction: a.refund_instruction,
})) as unknown as AdvanceRecord[];
const bills: LedgerBill[] = fx.bills.map((b) => ({
  id: sid(b.id), entryNo: b.entry, createdAt: at(b.id), companyId: String(b.company_id), billNumber: b.bill_number, billDate: b.bill_date as string, guestName: b.guest_name, roomNumber: b.room_number, instruction: b.instruction,
  totalHotelAmountPaise: p0(b.total_hotel_amount), totalFoodAmountPaise: p0(b.total_food_amount), hotelModeOfPayment: b.hotel_mode_of_payment, foodModeOfPayment: b.food_mode_of_payment,
  advanceHotelAmountPaise: p0(b.advance_hotel_amount), advanceFoodAmountPaise: p0(b.advance_food_amount), advanceReceiptNumber: b.advance_receipt_number,
  advanceId: b.advance_company_id === null ? null : sid(900 + b.id), advanceCompanyId: b.advance_company_id === null ? null : String(b.advance_company_id),
  debit: b.debit.map(([date, h, f, hm, fm]): DebitSlot => ({ date, hotelPaise: p(h), foodPaise: p(f), hotelMode: hm, foodMode: fm })),
  debitInstruction: b.debit_instruction, balanceHotelAmountPaise: BigInt(0), balanceFoodAmountPaise: BigInt(0),
})) as unknown as LedgerBill[];
const lines = buildLedger(company, bills, advances);
const tag = (l: { kind: string; recordId: string; order: number }) => `${l.kind}:${Number(l.recordId.slice(3))}:${l.order}`;

describe("the company ledger (CompanyLedger::build, verbatim PHP)", () => {
  test(`all ${fx.lines.length} lines: kinds, Pallav's same-day order, refs, modes, notes and the running balance`, () => {
    assert.equal(lines.length, fx.lines.length);
    lines.forEach((l, i) => {
      const e = fx.lines[i];
      assert.deepEqual(
        [l.kind, l.date, Number(l.recordId.slice(3)), l.entry, l.ref, l.guest, l.room, l.mode, l.note, Number(l.debitPaise), Number(l.creditPaise), Number(l.balancePaise)],
        [e.kind, e.date, e.id, e.entry, e.ref, e.guest, e.room, e.mode, e.note, e.debitPaise, e.creditPaise, e.balancePaise],
        `line ${i}`,
      );
    });
  });
  test("the fixture covers every kind, an overpayment's advance left out, a bill with no date left out", () => {
    assert.deepEqual(new Set(lines.map((l) => l.kind)), new Set(["advance", "bill", "adjusted", "checkout", "settlement", "refund"]));
    assert.ok(!lines.some((l) => l.kind === "advance" && l.ref.includes("Excessive")));
    assert.ok(!lines.some((l) => l.ref === "Bill 2026 / 1191"));
  });
  test("totals", () => {
    const t = ledgerTotals(lines);
    assert.deepEqual([t.billedPaise, t.receivedPaise, t.refundedPaise, t.balancePaise].map(Number), [fx.totals.billed, fx.totals.received, fx.totals.refunded, fx.totals.balance]);
  });
  test(`periods: opening carried in, closing, lines and totals (${fx.periods.length} cases)`, () => {
    for (const e of fx.periods) {
      const got = ledgerPeriod(lines, e.from, e.to);
      assert.deepEqual([Number(got.openingPaise), Number(got.closingPaise), got.lines.length], [e.openingPaise, e.closingPaise, e.count], JSON.stringify(e));
      assert.deepEqual(got.lines.map((l) => `${l.kind}:${Number(l.recordId.slice(3))}`), e.ids);
      const t = ledgerTotals(got.lines);
      assert.deepEqual([t.billedPaise, t.receivedPaise, t.refundedPaise, t.balancePaise].map(Number), [e.totals.billed, e.totals.received, e.totals.refunded, e.totals.balance]);
    }
  });
  test(`search: words, amounts, entry numbers and dates in four forms (${fx.searches.length} cases)`, () => {
    for (const e of fx.searches) assert.deepEqual(searchLedger(lines, e.q).map(tag), e.ids, e.q);
  });
  test("modes()", () => {
    for (const e of fx.modes) assert.equal(modes(...e.in), e.out, JSON.stringify(e.in));
  });
});

describe("summaryByCompany() equals totals(buildLedger()) for every company (property test, generated data)", () => {
  test("300 bills and 200 advances across 6 companies, every rule mixed", async () => {
    // a small deterministic generator (no Math.random: same data every run)
    let seed = 20261005;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      // the high bits: an LCG's low bits cycle quickly
      return Math.floor(seed / 65536) % n;
    };
    const data = emptyHotelData();
    const companies = ["c1", "c2", "c3", "c4", "c5", "c6"];
    const modesList = ["Cash", "Debit", "debit", "UPI", "Card", null];
    const day = (i: number): string => `2026-${String(1 + (i % 10)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`;
    for (let i = 0; i < 200; i++) {
      const amount = BigInt(rnd(500000));
      data.advances.push({
        id: `a${String(i).padStart(4, "0")}`, entryNo: i + 1, createdAt: at(i), receiptNumber: rnd(8) === 0 ? `Excessive / 2026 / ${i}` : `2026 / ${i}`, guestName: "G", roomNumber: null,
        companyId: companies[rnd(6)], reservationId: null, paymentDate: day(rnd(300)), hotelAmountPaise: amount, foodAmountPaise: BigInt(rnd(3) === 0 ? rnd(20000) : 0), hotelMode: modesList[rnd(6)], foodMode: null,
        referenceName: null, referenceMobileNumber: null, instruction: null, hotelBalancePaise: amount, foodBalancePaise: BigInt(0), totalPaise: amount,
        hotelRefundAmountPaise: rnd(5) === 0 ? BigInt(rnd(Number(amount) + 1)) : null, foodRefundAmountPaise: null, hotelRefundMode: null, foodRefundMode: null, refundPaymentDate: rnd(5) === 0 ? day(rnd(300)) : null,
        refundGuestName: null, refundMobileNumber: null, refundInstruction: null, createdBy: null, updatedBy: null, deletedAt: rnd(15) === 0 ? new Date() : null, deletedBy: null, updatedAt: at(i), version: 1,
      } as AdvanceRecord);
    }
    for (let i = 0; i < 300; i++) {
      const hotel = BigInt(rnd(900000) - 20000);
      const food = BigInt(rnd(200000));
      const adv = rnd(3) === 0 ? data.advances[rnd(200)] : null;
      const slot = (): DebitSlot => (rnd(3) === 0 ? { date: day(rnd(300)), hotelPaise: BigInt(rnd(300000)), foodPaise: rnd(2) ? BigInt(rnd(10000)) : null, hotelMode: "Cash", foodMode: null } : { date: null, hotelPaise: null, foodPaise: null, hotelMode: null, foodMode: null });
      data.bills.push({
        id: `b${String(i).padStart(4, "0")}`, entryNo: i + 1, createdAt: at(1000 + i), companyId: companies[rnd(6)], billNumber: `2026 / ${i}`, billDate: rnd(20) === 0 ? (null as unknown as string) : day(rnd(300)), guestName: "G", roomNumber: null,
        instruction: null, totalHotelAmountPaise: hotel, totalFoodAmountPaise: food, hotelModeOfPayment: modesList[rnd(6)], foodModeOfPayment: modesList[rnd(6)],
        advanceId: adv?.id ?? null, advanceReceiptNumber: adv?.receiptNumber ?? null, advanceHotelAmountPaise: adv ? BigInt(rnd(200000)) : BigInt(0), advanceFoodAmountPaise: adv ? BigInt(rnd(5000)) : BigInt(0),
        debit: [slot(), slot(), slot(), slot(), slot()], debitInstruction: null, balanceHotelAmountPaise: BigInt(rnd(3) === 0 ? rnd(5000) : 0), balanceFoodAmountPaise: BigInt(0),
        deletedAt: rnd(15) === 0 ? new Date() : null,
      } as unknown as BillRecord);
    }
    const repos = bindHotelRepos(data);
    const monthFrom = "2026-08-01";
    const summary = new Map((await repos.ledgerSource.summaryByCompany(monthFrom)).map((r) => [r.companyId, r]));
    assert.ok(summary.size >= 5, `the data reached most companies (${summary.size})`);
    for (const c of companies) {
      const src = await repos.ledgerSource.forCompany(c);
      const built = buildLedger(c, src.bills, src.advances);
      const t = ledgerTotals(built);
      const s = summary.get(c);
      if (!s) {
        assert.equal(built.length, 0, `${c}: no summary row means no lines`);
        continue;
      }
      assert.deepEqual([s.billedPaise, s.receivedPaise, s.refundedPaise, s.balancePaise], [t.billedPaise, t.receivedPaise, t.refundedPaise, t.balancePaise], c);
      assert.equal(s.lines, built.length, `${c} line count`);
      assert.equal(s.lastDate, built.at(-1)?.date ?? null, `${c} last date`);
      const month = built.filter((l) => l.date >= monthFrom);
      assert.equal(s.monthBilledPaise, month.filter((l) => l.kind === "bill").reduce((n, l) => n + l.debitPaise, BigInt(0)), `${c} month billed`);
      assert.equal(s.monthReceivedPaise, month.reduce((n, l) => n + l.creditPaise, BigInt(0)), `${c} month received`);
      assert.equal(s.bills, src.bills.length, `${c} bills`);
    }
  });
});
