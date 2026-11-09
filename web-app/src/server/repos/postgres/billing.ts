import "server-only";
// The Billing repositories on PostgreSQL: guest advances (bill_master_advances), bills (bill_master_bills), and the read-only neighbours the
// billing services use in the same hotel schema (company names, meal plan rates, the hotel's profile, Master Data lists, accounting years, logs).
// The in-memory double (repos/memory/billing.ts) is the reference for every rule.
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import { nextEntryNo } from "../../data/entryNo";
import type {
  AdvanceFilter, AdvanceListQuery, AdvanceRecord, AdvanceRepo, AdvanceState, BillFields, BillFilter, BillListQuery, BillRecord, BillRepo, BillState, BillingRepos, DebitSlot,
  NewAdvance, NewBill, PricedStayPart,
} from "../billing";
import type { Unit } from "../types";
import { asDate, asText, companyWordsCondition, countTotal, guard, highestTyped, moneyIn, read as readFields, versionedUpdate, write as writeFields, type JsonCodec, type Kind, type Row } from "./shared";
import { pgCashSupport } from "./support";
import { createPgUnit } from "./unit";

const ADVANCE_SPEC: Record<string, Kind> = {
  receiptNumber: "text", guestName: "text", mobileNumber: "text", roomNumber: "text", companyId: "text", reservationId: "text", paymentDate: "date",
  hotelAmountPaise: "money", foodAmountPaise: "money", hotelMode: "text", foodMode: "text", referenceName: "text", referenceMobileNumber: "text", instruction: "text",
  hotelBalancePaise: "money", foodBalancePaise: "money", totalPaise: "money", hotelRefundAmountPaise: "moneyN", foodRefundAmountPaise: "moneyN",
  hotelRefundMode: "text", foodRefundMode: "text", refundPaymentDate: "date", refundGuestName: "text", refundMobileNumber: "text", refundInstruction: "text",
};

const BILL_SPEC: Record<string, Kind> = {
  billNumber: "text", billDate: "date", companyId: "text", guestName: "text", mobileNumber: "text", roomNumber: "text", grNumber: "text", guestAddress: "text", guestGstin: "text",
  persons: "int", arrivalAt: "ts", departureAt: "ts", hotelPlan: "text", hotelAmountPaise: "money", hotelPlanAmountPaise: "money", hotelExtraBedAmountPaise: "money",
  hotelLaundryAmountPaise: "money", hotelOtherAmountPaise: "money", hotelGstPaise: "money", hotelModeOfPayment: "text", foodAmountPaise: "money", foodPlanAmountPaise: "money",
  foodLaundryAmountPaise: "money", foodGstPaise: "money", foodModeOfPayment: "text", totalHotelAmountPaise: "money", totalFoodAmountPaise: "money",
  balanceHotelAmountPaise: "money", balanceFoodAmountPaise: "money", referenceName: "text", referenceMobileNumber: "text", instruction: "text", invoicePdfPath: "text",
  foodInvoicePdfPath: "text", staySegments: "json", planFoodAmountPaise: "money", hotelGstPercent: "pct", foodGstPercent: "pct", hotelSac: "text", foodSac: "text", advanceId: "text", advanceReceiptNumber: "text",
  advanceGuestName: "text", advanceHotelAmountSnapshot: "text", advanceFoodAmountSnapshot: "text", advanceDateSnapshot: "text", advanceCompanySnapshot: "text",
  advanceHotelAmountPaise: "money", advanceFoodAmountPaise: "money", advanceDeleteHotelAmountPaise: "money", advanceDeleteFoodAmountPaise: "money",
  debitHotelAdvance: "text", debitFoodAdvance: "text", debitReferenceName: "text", debitReferenceMobileNumber: "text", debitInstruction: "text", formattedAdvanceReceiptNumber: "text",
};

/** Stay parts hold bigint paise, which JSON cannot: they are stored as text and read back as bigint. */
const segmentsIn = (parts: readonly PricedStayPart[] | null): string | null => (parts === null ? null : JSON.stringify(parts, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
const segmentsOut = (raw: unknown): PricedStayPart[] | null =>
  raw === null || raw === undefined ? null : (raw as Record<string, unknown>[]).map((p) => ({ ...(p as unknown as PricedStayPart), ratePaise: p.ratePaise === null ? null : BigInt(String(p.ratePaise)), amountPaise: BigInt(String(p.amountPaise)) }));

const baseOf = (row: Row) => ({
  id: String(row.id),
  entryNo: Number(row.entry_no),
  createdBy: asText(row.created_by),
  updatedBy: asText(row.updated_by),
  deletedAt: asDate(row.deleted_at),
  deletedBy: asText(row.deleted_by),
  createdAt: asDate(row.created_at) as Date,
  updatedAt: asDate(row.updated_at) as Date,
  version: Number(row.version),
});

const stayJson: JsonCodec = { out: segmentsOut, in: (v) => segmentsIn(v as PricedStayPart[] | null) };
const read = (spec: Record<string, Kind>, row: Record<string, unknown>) => readFields(spec, row, stayJson);
const write = (spec: Record<string, Kind>, values: object) => writeFields(spec, values, stayJson);

export const advanceOf = (row: Row): AdvanceRecord => ({ ...baseOf(row), ...read(ADVANCE_SPEC, row) }) as unknown as AdvanceRecord;

/* ---- bills: the five debit-settlement slots live in columns debit_bill_date, debit_bill_date_1 ... _4 and so on ---- */
const slotColumn = (name: "date" | "hotel_mode" | "food_mode" | "hotel_amount" | "food_amount", i: number): string => {
  const suffix = i === 0 ? "" : `_${i}`;
  return name === "date" ? `debit_bill_date${suffix}` : name.endsWith("amount") ? `debit_${name}${suffix}_paise` : `debit_${name}${suffix}`;
};
const slotsOut = (row: Row): BillRecord["debit"] =>
  [0, 1, 2, 3, 4].map(
    (i): DebitSlot => ({
      date: asText(row[slotColumn("date", i)]),
      hotelMode: asText(row[slotColumn("hotel_mode", i)]),
      foodMode: asText(row[slotColumn("food_mode", i)]),
      hotelPaise: row[slotColumn("hotel_amount", i)] === null ? null : toBigInt(row[slotColumn("hotel_amount", i)]),
      foodPaise: row[slotColumn("food_amount", i)] === null ? null : toBigInt(row[slotColumn("food_amount", i)]),
    }),
  ) as BillRecord["debit"];
function slotsIn(debit: BillFields["debit"]): { columns: string[]; params: unknown[] } {
  const columns: string[] = [];
  const params: unknown[] = [];
  debit.forEach((s, i) => {
    columns.push(slotColumn("date", i), slotColumn("hotel_mode", i), slotColumn("food_mode", i), slotColumn("hotel_amount", i), slotColumn("food_amount", i));
    params.push(s.date, s.hotelMode, s.foodMode, moneyIn(s.hotelPaise), moneyIn(s.foodPaise));
  });
  return { columns, params };
}

export const billOf = (row: Row): BillRecord => ({ ...baseOf(row), ...read(BILL_SPEC, row), debit: slotsOut(row) }) as unknown as BillRecord;

/* ---- the filters, the same as the double's ---- */
const rupees = (a: string, b: string): string => `trim(to_char((${a} + ${b})::numeric / 100, 'FM999999999990.00'))`;
/** The text a list's search runs over (Pallav's order): the row's own columns, the company's name (or "walk-in"), the amount in rupees. */
const textOf = (own: string[], companyId: string, figure: string) => ({
  own,
  companyId,
  figure,
  fallback: `concat_ws(' ', ${[...own.slice(0, -2), "COALESCE(c.name, 'walk-in')", ...own.slice(-2), figure].join(", ")})`,
});
const ADVANCE_TEXT = textOf(["a.receipt_number", "a.guest_name", "a.mobile_number", "a.room_number", "a.hotel_mode", "a.food_mode"], "a.company_id", rupees("a.hotel_amount_paise", "a.food_amount_paise"));
const BILL_TEXT = textOf(["b.bill_number", "b.gr_number", "b.guest_name", "b.mobile_number", "b.room_number", "b.hotel_mode_of_payment", "b.food_mode_of_payment"], "b.company_id", rupees("b.total_hotel_amount_paise", "b.total_food_amount_paise"));

function advanceWhere(f: AdvanceFilter, params: unknown[], state?: AdvanceState): string {
  const parts: string[] = [f.deleted === "only" ? "a.deleted_at IS NOT NULL" : "a.deleted_at IS NULL"];
  if (f.from || f.to) {
    const win: string[] = [];
    if (f.from) { params.push(f.from); win.push(`a.payment_date >= $${params.length}`); }
    if (f.to) { params.push(f.to); win.push(`a.payment_date <= $${params.length}`); }
    const inWindow = win.join(" AND ");
    // older advances still holding money are carried forward into the years on screen (BillMasterController.php:105-123)
    const carried = f.from ? ` OR (a.payment_date < $${params.indexOf(f.from) + 1} AND a.refund_payment_date IS NULL AND a.hotel_balance_paise + a.food_balance_paise > 0)` : "";
    parts.push(`((${inWindow})${carried})`);
  }
  if (f.month) { params.push(`${f.month}%`); parts.push(`to_char(a.payment_date, 'YYYY-MM-DD') LIKE $${params.length}`); }
  if (f.mode) { params.push(f.mode.toLowerCase()); parts.push(`(lower(a.hotel_mode) = $${params.length} OR lower(a.food_mode) = $${params.length})`); }
  if (f.company === "walkin") parts.push("a.company_id IS NULL");
  else if (f.company !== undefined) { params.push(f.company); parts.push(`a.company_id = $${params.length}::uuid`); }
  if (f.side === "hotel") parts.push("a.hotel_amount_paise > 0");
  if (f.side === "food") parts.push("a.food_amount_paise > 0");
  parts.push(companyWordsCondition(ADVANCE_TEXT, f.words, params));
  if (state) parts.push(ADVANCE_STATE_SQL[state]);
  return parts.join(" AND ");
}
const ADVANCE_STATE_SQL: Record<AdvanceState, string> = {
  refunded: "a.refund_payment_date IS NOT NULL",
  unused: "(a.refund_payment_date IS NULL AND a.hotel_amount_paise = a.hotel_balance_paise AND a.food_amount_paise = a.food_balance_paise)",
  partly: "(a.refund_payment_date IS NULL AND NOT (a.hotel_amount_paise = a.hotel_balance_paise AND a.food_amount_paise = a.food_balance_paise) AND a.hotel_balance_paise + a.food_balance_paise > 0)",
  used: "(a.refund_payment_date IS NULL AND NOT (a.hotel_amount_paise = a.hotel_balance_paise AND a.food_amount_paise = a.food_balance_paise) AND a.hotel_balance_paise + a.food_balance_paise <= 0)",
};

const IS_DEBIT = "(COALESCE(lower(b.hotel_mode_of_payment) = 'debit', false) OR COALESCE(lower(b.food_mode_of_payment) = 'debit', false))";
const BILL_STATE_SQL: Record<BillState, string> = {
  paid: `(NOT ${IS_DEBIT})`,
  // H6 part payments: a bill with a settlement that still owes is "due" until it is cleared
  settled: `(${IS_DEBIT} AND b.debit_bill_date IS NOT NULL AND b.balance_hotel_amount_paise + b.balance_food_amount_paise <= 0)`,
  due: `(${IS_DEBIT} AND (b.debit_bill_date IS NULL OR b.balance_hotel_amount_paise + b.balance_food_amount_paise > 0))`,
};

function billWhere(f: BillFilter, params: unknown[], state?: BillState): string {
  const parts: string[] = [f.deleted === "only" ? "b.deleted_at IS NOT NULL" : "b.deleted_at IS NULL"];
  if (f.from || f.to) {
    const win: string[] = [];
    if (f.from) { params.push(f.from); win.push(`b.bill_date >= $${params.length}`); }
    if (f.to) { params.push(f.to); win.push(`b.bill_date <= $${params.length}`); }
    // older debit bills still owed are carried forward (BillMasterController.php:306-309)
    const carried = f.from ? ` OR (b.bill_date < $${params.indexOf(f.from) + 1} AND (b.debit_bill_date IS NULL OR b.balance_hotel_amount_paise + b.balance_food_amount_paise > 0) AND ${IS_DEBIT})` : "";
    parts.push(`((${win.join(" AND ")})${carried})`);
  }
  if (f.month) { params.push(`${f.month}%`); parts.push(`to_char(b.bill_date, 'YYYY-MM-DD') LIKE $${params.length}`); }
  if (f.mode) { params.push(f.mode.toLowerCase()); parts.push(`(lower(b.hotel_mode_of_payment) = $${params.length} OR lower(b.food_mode_of_payment) = $${params.length})`); }
  if (f.company === "walkin") parts.push("b.company_id IS NULL");
  else if (f.company !== undefined) { params.push(f.company); parts.push(`b.company_id = $${params.length}::uuid`); }
  if (f.side === "hotel") parts.push("(b.total_hotel_amount_paise > 0 OR b.balance_hotel_amount_paise > 0)");
  if (f.side === "food") parts.push("(b.total_food_amount_paise > 0 OR b.balance_food_amount_paise > 0)");
  parts.push(companyWordsCondition(BILL_TEXT, f.words, params));
  if (state) parts.push(BILL_STATE_SQL[state]);
  return parts.join(" AND ");
}

const ADVANCE_SORT: Record<string, string> = { paymentDate: "a.payment_date", receiptNumber: "COALESCE(a.receipt_number, '')", guestName: "COALESCE(a.guest_name, '')", totalAmountPaise: "(a.hotel_amount_paise + a.food_amount_paise)", balancePaise: "(a.hotel_balance_paise + a.food_balance_paise)" };
const BILL_SORT: Record<string, string> = { billDate: "b.bill_date", billNumber: "COALESCE(b.bill_number, '')", guestName: "COALESCE(b.guest_name, '')", totalPaise: "(b.total_hotel_amount_paise + b.total_food_amount_paise)", balancePaise: "(b.balance_hotel_amount_paise + b.balance_food_amount_paise)" };

function pgAdvances(tx: TxClient): AdvanceRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const FROM = "bill_master_advances a LEFT JOIN company_profiles c ON c.id = a.company_id";
  const advance: AdvanceRepo = {
    async get(id, options) {
      const r = await q(`SELECT * FROM bill_master_advances WHERE id = $1 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
      return r.rows[0] ? advanceOf(r.rows[0]) : null;
    },
    async byReceipt(receiptNumber) {
      const r = await q("SELECT * FROM bill_master_advances WHERE deleted_at IS NULL AND receipt_number = $1 LIMIT 1", [receiptNumber]);
      return r.rows[0] ? advanceOf(r.rows[0]) : null;
    },
    async allByReceipt(receiptNumber) {
      return (await q("SELECT * FROM bill_master_advances WHERE deleted_at IS NULL AND receipt_number = $1 ORDER BY entry_no", [receiptNumber])).rows.map(advanceOf);
    },
    async list(query: AdvanceListQuery) {
      const column = ADVANCE_SORT[query.sort];
      if (!column) throw new Error("Not a sort column");
      const dir = query.dir === "desc" ? "DESC" : "ASC";
      const params: unknown[] = [];
      const where = advanceWhere(query, params, query.state);
      const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM ${FROM} WHERE ${where}`, params);
      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const r = await q(`SELECT a.* FROM ${FROM} WHERE ${where} ORDER BY ${column} ${dir}, a.entry_no ${dir} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { rows: r.rows.map(advanceOf), total };
    },
    async countByState(filter) {
      const params: unknown[] = [];
      const where = advanceWhere(filter, params);
      const r = await q(
        `SELECT COUNT(*) FILTER (WHERE ${ADVANCE_STATE_SQL.unused}) AS unused, COUNT(*) FILTER (WHERE ${ADVANCE_STATE_SQL.partly}) AS partly, COUNT(*) FILTER (WHERE ${ADVANCE_STATE_SQL.used}) AS used, COUNT(*) FILTER (WHERE ${ADVANCE_STATE_SQL.refunded}) AS refunded FROM ${FROM} WHERE ${where}`,
        params,
      );
      const x = r.rows[0];
      return { unused: Number(x.unused), partly: Number(x.partly), used: Number(x.used), refunded: Number(x.refunded) };
    },
    async figures(monthFrom, monthTo) {
      const r = await q(
        `SELECT COALESCE(SUM(hotel_amount_paise + food_amount_paise) FILTER (WHERE payment_date >= $1 AND payment_date <= $2), 0) AS taken,
                COALESCE(SUM(hotel_balance_paise + food_balance_paise) FILTER (WHERE refund_payment_date IS NULL), 0) AS held,
                COUNT(*) FILTER (WHERE refund_payment_date IS NULL AND hotel_amount_paise = hotel_balance_paise AND food_amount_paise = food_balance_paise) AS unused,
                COALESCE(SUM(COALESCE(hotel_refund_amount_paise, 0) + COALESCE(food_refund_amount_paise, 0)) FILTER (WHERE refund_payment_date IS NOT NULL), 0) AS refunded,
                COUNT(*) AS n
           FROM bill_master_advances WHERE deleted_at IS NULL`,
        [monthFrom, monthTo],
      );
      const x = r.rows[0];
      return { monthTakenPaise: toBigInt(x.taken), heldPaise: toBigInt(x.held), unusedCount: Number(x.unused), refundedPaise: toBigInt(x.refunded), all: Number(x.n) };
    },
    async options() {
      const modes = await q("SELECT m FROM (SELECT hotel_mode AS m FROM bill_master_advances WHERE deleted_at IS NULL UNION SELECT food_mode FROM bill_master_advances WHERE deleted_at IS NULL) x WHERE m IS NOT NULL AND m <> '' ORDER BY m COLLATE \"C\"");
      const companies = await q("SELECT DISTINCT company_id FROM bill_master_advances WHERE deleted_at IS NULL AND company_id IS NOT NULL");
      const months = await q("SELECT DISTINCT to_char(payment_date, 'YYYY-MM') AS m FROM bill_master_advances WHERE deleted_at IS NULL AND payment_date IS NOT NULL ORDER BY m DESC");
      return { modes: modes.rows.map((r) => String(r.m)), companyIds: companies.rows.map((r) => String(r.company_id)), months: months.rows.map((r) => String(r.m)) };
    },
    async highestTyped(prefix) {
      return highestTyped(tx, "bill_master_advances", "receipt_number", prefix);
    },
    async byReservation(reservationIds) {
      const out = new Map<string, AdvanceRecord[]>(reservationIds.map((id) => [id, []]));
      if (reservationIds.length === 0) return out;
      const r = await q("SELECT * FROM bill_master_advances WHERE deleted_at IS NULL AND reservation_id = ANY($1::uuid[]) ORDER BY payment_date, entry_no", [reservationIds]);
      for (const row of r.rows) out.get(String(row.reservation_id))?.push(advanceOf(row));
      return out;
    },
    async open(limit) {
      return (await q("SELECT * FROM bill_master_advances WHERE deleted_at IS NULL AND hotel_balance_paise + food_balance_paise > 0 ORDER BY COALESCE(guest_name, '') COLLATE \"C\", entry_no LIMIT $1", [limit])).rows.map(advanceOf);
    },
    async create(input: NewAdvance) {
      const { createdBy, ...fields } = input;
      const w = write(ADVANCE_SPEC, fields);
      const columns = [...w.columns, "created_by", "entry_no"];
      const params = [...w.params, createdBy, await nextEntryNo(tx, "bill_master_advances")];
      const r = await guard(q(`INSERT INTO bill_master_advances (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
      return advanceOf(r.rows[0]);
    },
    async update(id, expectedVersion, patch, actorId) {
      const w = write(ADVANCE_SPEC, patch);
      const set = [...w.columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${w.columns.length + 3}`].join(", ");
      const res = await versionedUpdate(tx, "bill_master_advances", id, expectedVersion, set, [...w.params, actorId], false);
      return res.ok ? { ok: true, record: advanceOf(res.row) } : res;
    },
    async softDelete(id, expectedVersion, actorId) {
      const res = await versionedUpdate(tx, "bill_master_advances", id, expectedVersion, "deleted_at = now(), deleted_by = $3", [actorId], false);
      return res.ok ? { ok: true, record: advanceOf(res.row) } : res;
    },
    async restore(id, expectedVersion, actorId) {
      const res = await versionedUpdate(tx, "bill_master_advances", id, expectedVersion, "deleted_at = NULL, deleted_by = NULL, updated_by = $3", [actorId], true);
      return res.ok ? { ok: true, record: advanceOf(res.row) } : res;
    },
    async purge(id) {
      const r = await q("DELETE FROM bill_master_advances WHERE id = $1 AND deleted_at IS NOT NULL", [id]);
      return r.affectedRows > 0;
    },
  };
  return advance;
}

function pgBills(tx: TxClient): BillRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const FROM = "bill_master_bills b LEFT JOIN company_profiles c ON c.id = b.company_id";
  const bill: BillRepo = {
    async get(id, options) {
      const r = await q(`SELECT * FROM bill_master_bills WHERE id = $1 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}${options?.forUpdate ? " FOR UPDATE" : ""}`, [id]);
      return r.rows[0] ? billOf(r.rows[0]) : null;
    },
    async getMany(ids) {
      if (ids.length === 0) return new Map();
      const r = await q("SELECT * FROM bill_master_bills WHERE deleted_at IS NULL AND id = ANY($1::uuid[])", [ids]);
      return new Map(r.rows.map((row) => [String(row.id), billOf(row)]));
    },
    async guestsOf(billIds) {
      if (billIds.length === 0) return new Map();
      const r = await q("SELECT bill_id, guest_name, adults, children, guest_details FROM pms_stays WHERE bill_id = ANY($1::uuid[])", [billIds]);
      return new Map(
        r.rows.map((row) => {
          const members = ((row.guest_details as { members?: { fullName?: string }[] } | null)?.members ?? []).map((m) => String(m.fullName ?? "").trim());
          return [String(row.bill_id), { adults: Number(row.adults), children: Number(row.children), names: [String(row.guest_name ?? "").trim(), ...members].filter((x) => x !== "") }];
        }),
      );
    },
    async byNumber(billNumber) {
      const r = await q("SELECT * FROM bill_master_bills WHERE deleted_at IS NULL AND bill_number = $1 LIMIT 1", [billNumber]);
      return r.rows[0] ? billOf(r.rows[0]) : null;
    },
    async list(query: BillListQuery) {
      const column = BILL_SORT[query.sort];
      if (!column) throw new Error("Not a sort column");
      const dir = query.dir === "desc" ? "DESC" : "ASC";
      const params: unknown[] = [];
      const where = billWhere(query, params, query.state);
      const total = await countTotal(tx, query, `SELECT COUNT(*) AS n FROM ${FROM} WHERE ${where}`, params);
      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const r = await q(`SELECT b.* FROM ${FROM} WHERE ${where} ORDER BY ${column} ${dir}, b.entry_no ${dir} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { rows: r.rows.map(billOf), total };
    },
    async countByState(filter) {
      const params: unknown[] = [];
      const where = billWhere(filter, params);
      const r = await q(`SELECT COUNT(*) FILTER (WHERE ${BILL_STATE_SQL.paid}) AS paid, COUNT(*) FILTER (WHERE ${BILL_STATE_SQL.due}) AS due, COUNT(*) FILTER (WHERE ${BILL_STATE_SQL.settled}) AS settled FROM ${FROM} WHERE ${where}`, params);
      const x = r.rows[0];
      return { paid: Number(x.paid), due: Number(x.due), settled: Number(x.settled) };
    },
    async figures(monthFrom, monthTo) {
      const received = [0, 1, 2, 3, 4].map((i) => `COALESCE(${slotColumn("hotel_amount", i)}, 0) + COALESCE(${slotColumn("food_amount", i)}, 0)`).join(" + ");
      const r = await q(
        `SELECT COUNT(*) FILTER (WHERE bill_date >= $1 AND bill_date <= $2) AS month_count,
                COALESCE(SUM(total_hotel_amount_paise + total_food_amount_paise) FILTER (WHERE bill_date >= $1 AND bill_date <= $2), 0) AS billed,
                COALESCE(SUM(balance_hotel_amount_paise + balance_food_amount_paise), 0) AS owed,
                COUNT(*) FILTER (WHERE ${BILL_STATE_SQL.due.replaceAll("b.", "")}) AS due_count,
                COALESCE(SUM(${received}) FILTER (WHERE ${BILL_STATE_SQL.settled.replaceAll("b.", "")}), 0) AS settled,
                COUNT(*) AS n
           FROM bill_master_bills WHERE deleted_at IS NULL`,
        [monthFrom, monthTo],
      );
      const x = r.rows[0];
      return { monthCount: Number(x.month_count), monthBilledPaise: toBigInt(x.billed), owedPaise: toBigInt(x.owed), dueCount: Number(x.due_count), settledPaise: toBigInt(x.settled), all: Number(x.n) };
    },
    async options() {
      const modes = await q("SELECT m FROM (SELECT hotel_mode_of_payment AS m FROM bill_master_bills WHERE deleted_at IS NULL UNION SELECT food_mode_of_payment FROM bill_master_bills WHERE deleted_at IS NULL) x WHERE m IS NOT NULL AND m <> '' ORDER BY m COLLATE \"C\"");
      const companies = await q("SELECT DISTINCT company_id FROM bill_master_bills WHERE deleted_at IS NULL AND company_id IS NOT NULL");
      const months = await q("SELECT DISTINCT to_char(bill_date, 'YYYY-MM') AS m FROM bill_master_bills WHERE deleted_at IS NULL AND bill_date IS NOT NULL ORDER BY m DESC");
      return { modes: modes.rows.map((r) => String(r.m)), companyIds: companies.rows.map((r) => String(r.company_id)), months: months.rows.map((r) => String(r.m)) };
    },
    async highestTyped(prefix) {
      return highestTyped(tx, "bill_master_bills", "bill_number", prefix);
    },
    async numbersByAdvance(advanceIds) {
      const out = new Map<string, string[]>(advanceIds.map((id) => [id, []]));
      if (advanceIds.length === 0) return out;
      const r = await q("SELECT advance_id, bill_number FROM bill_master_bills WHERE deleted_at IS NULL AND advance_id = ANY($1::uuid[]) ORDER BY entry_no", [advanceIds]);
      for (const row of r.rows) out.get(String(row.advance_id))?.push(String(row.bill_number));
      return out;
    },
    async takenFromAdvance(advanceId) {
      const r = await q("SELECT COALESCE(SUM(advance_hotel_amount_paise), 0) AS h, COALESCE(SUM(advance_food_amount_paise), 0) AS f FROM bill_master_bills WHERE deleted_at IS NULL AND advance_id = $1", [advanceId]);
      return { hotelPaise: toBigInt(r.rows[0].h), foodPaise: toBigInt(r.rows[0].f) };
    },
    async create(input: NewBill) {
      const { createdBy, debit, ...fields } = input;
      const w = write(BILL_SPEC, fields);
      const slots = slotsIn(debit);
      const columns = [...w.columns, ...slots.columns, "created_by", "entry_no"];
      const params = [...w.params, ...slots.params, createdBy, await nextEntryNo(tx, "bill_master_bills")];
      const r = await guard(q(`INSERT INTO bill_master_bills (${columns.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params));
      return billOf(r.rows[0]);
    },
    async update(id, expectedVersion, patch, actorId) {
      const { debit, ...rest } = patch;
      const w = write(BILL_SPEC, rest);
      const slots = debit ? slotsIn(debit) : { columns: [], params: [] };
      const columns = [...w.columns, ...slots.columns];
      const set = [...columns.map((c, i) => `${c} = $${i + 3}`), `updated_by = $${columns.length + 3}`].join(", ");
      const res = await versionedUpdate(tx, "bill_master_bills", id, expectedVersion, set, [...w.params, ...slots.params, actorId], false);
      return res.ok ? { ok: true, record: billOf(res.row) } : res;
    },
    async softDelete(id, expectedVersion, actorId) {
      const res = await versionedUpdate(tx, "bill_master_bills", id, expectedVersion, "deleted_at = now(), deleted_by = $3", [actorId], false);
      return res.ok ? { ok: true, record: billOf(res.row) } : res;
    },
    async restore(id, expectedVersion, actorId) {
      const res = await versionedUpdate(tx, "bill_master_bills", id, expectedVersion, "deleted_at = NULL, deleted_by = NULL, updated_by = $3", [actorId], true);
      return res.ok ? { ok: true, record: billOf(res.row) } : res;
    },
    async purge(id) {
      const r = await q("DELETE FROM bill_master_bills WHERE id = $1 AND deleted_at IS NOT NULL", [id]);
      return r.affectedRows > 0;
    },
  };
  return bill;
}

export function pgBillingRepos(tx: TxClient): BillingRepos {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const support = pgCashSupport(tx);
  return {
    advances: pgAdvances(tx),
    bills: pgBills(tx),
    companies: {
      async exists(id) {
        return (await q("SELECT 1 AS x FROM company_profiles WHERE id = $1", [id])).rows.length > 0;
      },
      async names(ids) {
        if (ids.length === 0) return new Map();
        return new Map((await q("SELECT id, name FROM company_profiles WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => [String(r.id), String(r.name)]));
      },
      async list(limit) {
        return (await q("SELECT id, name FROM company_profiles WHERE deleted_at IS NULL ORDER BY name COLLATE \"C\", id LIMIT $1", [limit])).rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
      },
    },
    mealPlanRates: {
      async table() {
        return (await q("SELECT plan, effective_from, rate_per_person_paise FROM meal_plan_rates ORDER BY effective_from, created_at, id")).rows.map((r) => ({ plan: String(r.plan), effectiveFrom: String(r.effective_from), ratePaise: toBigInt(r.rate_per_person_paise) }));
      },
    },
    hotelProfile: {
      async header() {
        const settings = await q("SELECT key, value FROM app_settings WHERE key IN ('general.site_name', 'general.address', 'general.support_phone', 'billing.hotel_gstin', 'billing.food_gstin', 'general.food_name')");
        const by = new Map(settings.rows.map((r) => [String(r.key), r.value === null ? null : String(r.value)]));
        const names = await q("SELECT code, name FROM payroll_companies WHERE code IN ('HP01', 'PF01')");
        const company = new Map(names.rows.map((r) => [String(r.code), String(r.name)]));
        const blank = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === "" ? null : v);
        return {
          name: blank(by.get("general.site_name")) ?? company.get("HP01") ?? "Hotel",
          foodName: blank(by.get("general.food_name")) ?? company.get("PF01") ?? "Food",
          address: blank(by.get("general.address")),
          phone: blank(by.get("general.support_phone")),
          gstin: blank(by.get("billing.hotel_gstin")),
          foodGstin: blank(by.get("billing.food_gstin")),
        };
      },
      async gstDefaults() {
        const settings = await q("SELECT key, value FROM app_settings WHERE key IN ('checkout.hotel_gst_percent', 'checkout.food_gst_percent')");
        const by = new Map(settings.rows.map((r) => [String(r.key), r.value === null ? null : String(r.value)]));
        return { hotelPercent: by.get("checkout.hotel_gst_percent") ?? null, foodPercent: by.get("checkout.food_gst_percent") ?? null };
      },
    },
    optionLists: {
      async items(setKey) {
        const r = await q("SELECT i.value, i.label, i.is_default FROM option_items i JOIN option_sets s ON s.id = i.option_set_id WHERE s.key = $1 AND i.is_active ORDER BY i.sort_order, i.label", [setKey]);
        return r.rows.map((x) => ({ value: String(x.value), label: String(x.label), isDefault: x.is_default === true }));
      },
    },
    accountingYears: support.accountingYears,
    systemLogs: support.systemLogs,
    forceLogs: support.forceLogs,
  };
}

export function createPgBillingUnit(withHotel: WithHotel): Unit<BillingRepos> {
  return createPgUnit(withHotel, pgBillingRepos);
}
