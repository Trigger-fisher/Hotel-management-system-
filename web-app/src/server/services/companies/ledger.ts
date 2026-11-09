import "server-only";
import type { AdvanceRecord, BillRecord } from "../../repos/billing";

// THE company ledger: a port of Pallav's Support/CompanyLedger.php (build :114-224, totals :83-95, period :103-112, modes :244-251) and the
// account search (CompanyLedgerController::searchLines :134-158), golden-tested against verbatim PHP (db/scripts/php/fixtures/companies.json).
// The ledger has no table: every line is derived from live Bill Master bills and advances. Money is bigint paise (exact; Pallav adds floats
// and rounds the running balance to 2 places, which agrees wherever the float was not off by noise). Spec: docs/specs/companies.md.

export type LedgerKind = "bill" | "advance" | "checkout" | "adjusted" | "settlement" | "refund";

export interface Line {
  /** Unique per line: "{kind}:{record id}:{instalment}". */
  key: string;
  kind: LedgerKind;
  /** YYYY-MM-DD */
  date: string;
  recordId: string;
  entry: number;
  ref: string;
  guest: string | null;
  room: string | null;
  mode: string | null;
  note: string | null;
  debitPaise: bigint;
  creditPaise: bigint;
  /** The instalment of a settlement (0-4), else 0. */
  order: number;
  balancePaise: bigint;
}

export type LedgerBill = BillRecord & { advanceCompanyId: string | null };

const ZERO = BigInt(0);
/** Same-day lines in the order they happen at the desk (:30). */
const ORDER: Record<LedgerKind, number> = { advance: 1, bill: 2, adjusted: 3, checkout: 3, settlement: 4, refund: 5 };
const KIND_LABEL: Record<LedgerKind, string> = { bill: "Bill", advance: "Advance", checkout: "Paid at checkout", adjusted: "Advance used", settlement: "Payment", refund: "Refund" };

/** modes() :244-251: trimmed, "Cash" casing, "UPI" kept upper, each once, joined by ", "; null when none. */
export function modes(...values: (string | null | undefined)[]): string | null {
  const named: string[] = [];
  for (const raw of values) {
    const m = (raw ?? "").trim();
    if (m === "") continue;
    const lowered = m.toLowerCase();
    const word = lowered === "upi" ? "UPI" : lowered.charAt(0).toUpperCase() + lowered.slice(1);
    if (!named.includes(word)) named.push(word);
  }
  return named.length === 0 ? null : named.join(", ");
}

const isDebitMode = (mode: string | null): boolean => (mode ?? "").toLowerCase() === "debit";
const sum = (values: (bigint | null)[]): bigint => values.reduce<bigint>((t, v) => t + (v ?? ZERO), ZERO);

type Draft = Omit<Line, "balancePaise" | "key"> & { tie: string };

/** build() :114-224: every line for one company, oldest first, each with its running balance. */
export function buildLedger(companyId: string, bills: readonly LedgerBill[], advances: readonly AdvanceRecord[]): Line[] {
  const lines: Draft[] = [];
  const blank = { guest: null, room: null, mode: null, note: null, debitPaise: ZERO, creditPaise: ZERO, order: 0 };
  // Pallav breaks a tie by the record's auto-increment id; HMS ids are time-ordered, so creation time then id gives the same order
  const tie = (r: { createdAt: Date; id: string }): string => `${r.createdAt.toISOString()}|${r.id}`;

  for (const a of advances) {
    const paidIn = a.hotelAmountPaise + a.foodAmountPaise;
    // the "Excessive / ..." advance is the same money as the payment that made it: never counted again (:20-22, :121)
    if (!a.receiptNumber.startsWith("Excessive / ") && paidIn > ZERO && a.paymentDate) {
      lines.push({ ...blank, kind: "advance", date: a.paymentDate, recordId: a.id, entry: a.entryNo, tie: tie(a), ref: `Receipt ${a.receiptNumber}`, guest: a.guestName, room: a.roomNumber, mode: modes(a.hotelMode, a.foodMode), note: a.instruction, creditPaise: paidIn });
    }
    const refund = sum([a.hotelRefundAmountPaise, a.foodRefundAmountPaise]);
    if (a.refundPaymentDate && refund > ZERO) {
      lines.push({ ...blank, kind: "refund", date: a.refundPaymentDate, recordId: a.id, entry: a.entryNo, tie: tie(a), ref: `Receipt ${a.receiptNumber}`, guest: a.refundGuestName || a.guestName, room: a.roomNumber, mode: modes(a.hotelRefundMode, a.foodRefundMode), note: a.refundInstruction, debitPaise: refund });
    }
  }

  for (const b of bills) {
    if (!b.billDate) continue;
    const base = { ...blank, recordId: b.id, entry: b.entryNo, tie: tie(b), ref: `Bill ${b.billNumber}`, guest: b.guestName, room: b.roomNumber };
    const hotel = b.totalHotelAmountPaise;
    const food = b.totalFoodAmountPaise;
    lines.push({ ...base, kind: "bill", date: b.billDate, mode: modes(b.hotelModeOfPayment, b.foodModeOfPayment), note: b.instruction, debitPaise: hotel + food });

    // an advance this company paid is already its own line; one held under another name only reaches this account now (:160-170)
    const fromAdvance = b.advanceHotelAmountPaise + b.advanceFoodAmountPaise;
    const ownAdvance = b.advanceId !== null && b.advanceCompanyId === companyId;
    if (fromAdvance > ZERO && !ownAdvance) {
      lines.push({ ...base, kind: "adjusted", date: b.billDate, ref: `Receipt ${b.advanceReceiptNumber ?? ""}`, note: `Used on bill ${b.billNumber}`, creditPaise: fromAdvance });
    }

    // a side not left on account was settled at the desk, less any advance used on it (:172-191)
    let paid = ZERO;
    const paidModes: (string | null)[] = [];
    for (const [mode, total, taken] of [[b.hotelModeOfPayment, hotel, b.advanceHotelAmountPaise], [b.foodModeOfPayment, food, b.advanceFoodAmountPaise]] as const) {
      if (isDebitMode(mode)) continue;
      const due = total - taken;
      if (due > ZERO) {
        paid += due;
        paidModes.push(mode);
      }
    }
    if (paid > ZERO) lines.push({ ...base, kind: "checkout", date: b.billDate, mode: modes(...paidModes), creditPaise: paid });

    // payments later received against what was left on account (:193-207)
    b.debit.forEach((slot, i) => {
      const amount = sum([slot.hotelPaise, slot.foodPaise]);
      if (amount <= ZERO || !slot.date) return;
      lines.push({ ...base, kind: "settlement", date: slot.date, mode: modes(slot.hotelMode, slot.foodMode), note: i === 0 ? b.debitInstruction : null, creditPaise: amount, order: i });
    });
  }

  // stable sort: date, the desk's order, then the record, then the instalment (:212-218)
  const indexed = lines.map((l, i) => ({ l, i }));
  indexed.sort((x, y) => (x.l.date < y.l.date ? -1 : x.l.date > y.l.date ? 1 : ORDER[x.l.kind] - ORDER[y.l.kind] || (x.l.tie < y.l.tie ? -1 : x.l.tie > y.l.tie ? 1 : x.l.order - y.l.order || x.i - y.i)));
  let running = ZERO;
  return indexed.map(({ l }) => {
    running += l.debitPaise - l.creditPaise;
    const { tie: _tie, ...rest } = l;
    void _tie;
    return { ...rest, key: `${l.kind}:${l.recordId}:${l.order}`, balancePaise: running };
  });
}

/** totals() :83-95 */
export function ledgerTotals(lines: readonly Line[]): { billedPaise: bigint; receivedPaise: bigint; refundedPaise: bigint; balancePaise: bigint } {
  const billed = sum(lines.filter((l) => l.kind === "bill").map((l) => l.debitPaise));
  const refunded = sum(lines.filter((l) => l.kind === "refund").map((l) => l.debitPaise));
  const received = sum(lines.map((l) => l.creditPaise));
  return { billedPaise: billed, receivedPaise: received, refundedPaise: refunded, balancePaise: billed + refunded - received };
}

/** period() :103-112: what came before `from` is carried in as the opening balance, so the running balance still reads true. */
export function ledgerPeriod(lines: readonly Line[], from: string | null, to: string | null): { openingPaise: bigint; lines: Line[]; closingPaise: bigint } {
  const before = from ? lines.filter((l) => l.date < from) : [];
  const opening = before.length === 0 ? ZERO : before[before.length - 1].balancePaise;
  const inside = lines.filter((l) => (!from || l.date >= from) && (!to || l.date <= to));
  return { openingPaise: opening, lines: inside, closingPaise: inside.length === 0 ? opening : inside[inside.length - 1].balancePaise };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rupeesValue = (paise: bigint): number => Number(paise) / 100;

/** CompanyLedgerController::searchLines (:134-158): every word must match the line, an amount, or its entry number. */
export function searchLedger(lines: readonly Line[], text: string): Line[] {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [...lines];
  return lines.filter((line) => {
    const [y, m, d] = line.date.split("-");
    const haystack = [
      // the entry as Pallav shows it: #0001 (HasEntryNumber::entryNumber)
      line.guest, line.room ? `room ${line.room}` : "", line.ref, line.mode, line.note, KIND_LABEL[line.kind], `#${String(line.entry).padStart(4, "0")}`,
      `${d}-${m}-${y}`, `${d}/${m}/${y}`, line.date, `${d} ${MONTHS[Number(m) - 1]} ${y}`,
    ].map((x) => x ?? "").join(" ").toLowerCase();
    const amount = line.debitPaise !== ZERO ? line.debitPaise : line.creditPaise;
    return words.every((word) => {
      const number = word.replace(/[,₹#]/g, "");
      // PHP is_numeric: a plain decimal number
      const isAmount = /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(number) && Number(number) === rupeesValue(amount);
      const isEntry = /^\d+$/.test(number) && number === String(line.entry).replace(/^0+/, "");
      return haystack.includes(word) || isAmount || isEntry;
    });
  });
}
