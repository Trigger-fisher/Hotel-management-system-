import "server-only";
// The PostgreSQL implementation of the Reports reads (repos/reports.ts): the day sheet, the food plan's stay bills, the dashboard's movements and
// figures, and the plan rates. Plain selects over the hotel's tables; the money rules (buckets, opening, nightly meal prices) are the services'.
// Every line is built the way repos/reports.ts and docs/specs/overview.md say; deleted rows (deleted_at set) are never read.
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { CashMovement, DaySheetRepo, FoodPlanRepo, GstRepo, HandoverFigures, OverviewRepo, PayrollFigures, ReportsRepos, ReportsUnit, SheetKind, SheetLine, StayBillRow } from "../reports";
import { asText, moneyOut, pctOut } from "./shared";
import { pgBillingRepos } from "./billing";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;
const IST = "Asia/Kolkata";

/** The text after the last "/" of a number, trimmed (the whole number when it has none). */
const short = (column: string): string => `NULLIF(BTRIM(substring(${column} FROM '[^/]*$')), '')`;
/** PHP number_format(x, 2): "1,500.00". */
const money = (column: string): string => `to_char((${column})::numeric / 100, 'FM999,999,999,990.00')`;
const blank = (column: string): string => `NULLIF(BTRIM(${column}), '')`;

interface Side {
  key: "hotel" | "food";
  total: string;
  taken: string;
  mode: string;
  amount: string;
  refund: string;
  refundMode: string;
  balance: string;
}
const SIDES: Side[] = [
  { key: "hotel", total: "total_hotel_amount_paise", taken: "advance_hotel_amount_paise", mode: "hotel_mode_of_payment", amount: "hotel_amount_paise", refund: "hotel_refund_amount_paise", refundMode: "hotel_refund_mode", balance: "hotel_balance_paise" },
  { key: "food", total: "total_food_amount_paise", taken: "advance_food_amount_paise", mode: "food_mode_of_payment", amount: "food_amount_paise", refund: "food_refund_amount_paise", refundMode: "food_refund_mode", balance: "food_balance_paise" },
];

const COLUMNS = "id::text AS id, kind, ref, room, particulars, note, mode, direction, amount, dt, party, unit, from_adv";

/** Every source of the day sheet as one set of lines (DailySheet::line without its bucket). */
function sheetSource(): string {
  const parts: string[] = [];
  for (const s of SIDES) {
    const food = s.key === "food";
    const planNote = food ? "'Pallav Food'" : "NULLIF(BTRIM(b.hotel_plan), '')";
    const advNote = `CASE WHEN b.${s.taken} > 0 THEN ${money(`b.${s.taken}`)} || ' from advance ' || COALESCE(${short("b.advance_receipt_number")}, '') END`;
    parts.push(
      `SELECT b.id, 'Bill' AS kind, ${short("b.bill_number")} AS ref, b.room_number AS room, COALESCE(${blank("b.guest_name")}, 'Walk-in guest') AS particulars,
              concat_ws(' - ', ${planNote}, ${advNote}) AS note, b.${s.mode} AS mode, 'in' AS direction, GREATEST(0, b.${s.total} - b.${s.taken}) AS amount, b.bill_date AS dt,
              c.name AS party, '${s.key}' AS unit, b.${s.taken} AS from_adv
         FROM bill_master_bills b LEFT JOIN company_profiles c ON c.id = b.company_id
        WHERE b.deleted_at IS NULL AND b.bill_date IS NOT NULL AND b.${s.total} > 0`,
    );
    parts.push(
      `SELECT a.id, 'Advance', ${short("a.receipt_number")}, a.room_number, COALESCE(${blank("a.guest_name")}, 'Advance'), 'Advance received'${food ? " || ' Pallav Food'" : ""}, a.${s.key}_mode, 'in', a.${s.amount}, a.payment_date,
              NULL, '${s.key}', 0
         FROM bill_master_advances a WHERE a.deleted_at IS NULL AND a.payment_date IS NOT NULL AND a.${s.amount} > 0`,
    );
    parts.push(
      `SELECT a.id, 'Refund', ${short("a.receipt_number")}, a.room_number, COALESCE(${blank("a.refund_guest_name")}, ${blank("a.guest_name")}, 'Advance refund'),
              'Advance refunded'${food ? " || ' Pallav Food'" : ""} || COALESCE(' - ' || ${blank("a.refund_instruction")}, ''), a.${s.refundMode}, 'out', a.${s.refund}, a.refund_payment_date, NULL, '${s.key}', 0
         FROM bill_master_advances a WHERE a.deleted_at IS NULL AND a.refund_payment_date IS NOT NULL AND a.${s.refund} > 0`,
    );
    for (const slot of ["", "_1", "_2", "_3", "_4"]) {
      parts.push(
        `SELECT b.id, 'Debit recovery', ${short("b.bill_number")}, b.room_number, COALESCE(c.name, ${blank("b.guest_name")}, 'Debit recovery'), 'Against an earlier debit bill'${food ? " || ' Pallav Food'" : ""},
                b.debit_${s.key}_mode${slot}, 'in', b.debit_${s.key}_amount${slot}_paise, b.debit_bill_date${slot}, NULL, '${s.key}', 0
           FROM bill_master_bills b LEFT JOIN company_profiles c ON c.id = b.company_id
          WHERE b.deleted_at IS NULL AND b.debit_bill_date${slot} IS NOT NULL AND b.debit_${s.key}_amount${slot}_paise > 0`,
      );
    }
  }
  for (const unit of ["hotel", "food"]) {
    const till = (table: string, kind: string, direction: string, who: string, note: string, label: string): string =>
      `SELECT t.id, '${kind}', '#' || t.entry_no, NULL, COALESCE(${blank(`t.${who}`)}, '${label}'), ${note}, 'Cash', '${direction}', t.amount_paise, t.date, NULL, '${unit}', 0
         FROM ${unit}_${table} t WHERE t.deleted_at IS NULL`;
    parts.push(till("cash_deposits", "Collection", "in", "depositor", blank("t.reason"), "Collection"));
    parts.push(till("cash_withdrawals", "Withdrawal", "out", "withdrawer", blank("t.instruction"), "Withdrawal"));
    parts.push(till("misc_expenses", "Expense", "out", "expense_name", `COALESCE(${blank("t.expense_head")}, ${blank("t.instruction")})`, "Expense"));
  }
  parts.push(
    `SELECT s.id, 'Staff advance', '#' || s.entry_no, NULL, COALESCE(e.name, 'Staff advance'), 'Salary advance' || COALESCE(' for ' || ${blank("s.year_month")}, ''), 'Cash', 'out', s.amount_paise, s.date, NULL, s.business, 0
       FROM staff_advances s LEFT JOIN employees e ON e.id = s.employee_id`,
  );
  return parts.join(" UNION ALL ");
}

const lineOf = (r: Row): SheetLine => ({
  id: String(r.id), kind: String(r.kind) as SheetKind, ref: asText(r.ref), room: asText(r.room), particulars: String(r.particulars), note: asText(r.note), mode: asText(r.mode),
  direction: r.direction === "out" ? "out" : "in", amountPaise: moneyOut(r.amount) as never, date: String(r.dt), party: asText(r.party), unit: r.unit === "food" ? "food" : "hotel", fromAdvancePaise: moneyOut(r.from_adv) as never,
});

/**
 * The cash a drawer holds from every line dated before a day, as ONE statement: each table is read once and the sums are taken in place, without
 * building the text columns of a line (no company join, no notes). It is the same set of lines as `sheetSource` (same conditions, same amounts, in
 * is plus, out is minus, only mode "cash" after trimming and lower-casing) and tests/db/reports.repo.test.ts holds the two equal.
 */
function cashNetBeforeSql(): string {
  const cash = (mode: string): string => `lower(BTRIM(COALESCE(${mode}, ''))) = 'cash'`;
  const sums: string[] = [];
  const bills: string[] = [];
  for (const s of SIDES) {
    bills.push(`COALESCE(SUM(GREATEST(0, b.${s.total} - b.${s.taken})) FILTER (WHERE b.bill_date IS NOT NULL AND b.bill_date < $1::date AND b.${s.total} > 0 AND ${cash(`b.${s.mode}`)}), 0)`);
    for (const slot of ["", "_1", "_2", "_3", "_4"]) {
      bills.push(`COALESCE(SUM(b.debit_${s.key}_amount${slot}_paise) FILTER (WHERE b.debit_bill_date${slot} IS NOT NULL AND b.debit_bill_date${slot} < $1::date AND b.debit_${s.key}_amount${slot}_paise > 0 AND ${cash(`b.debit_${s.key}_mode${slot}`)}), 0)`);
    }
  }
  sums.push(`(SELECT ${bills.join(" + ")} FROM bill_master_bills b WHERE b.deleted_at IS NULL)`);
  const advances: string[] = [];
  for (const s of SIDES) {
    advances.push(`COALESCE(SUM(a.${s.amount}) FILTER (WHERE a.payment_date IS NOT NULL AND a.payment_date < $1::date AND a.${s.amount} > 0 AND ${cash(`a.${s.key}_mode`)}), 0)`);
    advances.push(`-COALESCE(SUM(a.${s.refund}) FILTER (WHERE a.refund_payment_date IS NOT NULL AND a.refund_payment_date < $1::date AND a.${s.refund} > 0 AND ${cash(`a.${s.refundMode}`)}), 0)`);
  }
  sums.push(`(SELECT ${advances.join(" + ")} FROM bill_master_advances a WHERE a.deleted_at IS NULL)`);
  for (const unit of ["hotel", "food"]) {
    sums.push(`(SELECT COALESCE(SUM(t.amount_paise), 0) FROM ${unit}_cash_deposits t WHERE t.deleted_at IS NULL AND t.date < $1::date)`);
    sums.push(`(SELECT - COALESCE(SUM(t.amount_paise), 0) FROM ${unit}_cash_withdrawals t WHERE t.deleted_at IS NULL AND t.date < $1::date)`);
    sums.push(`(SELECT - COALESCE(SUM(t.amount_paise), 0) FROM ${unit}_misc_expenses t WHERE t.deleted_at IS NULL AND t.date < $1::date)`);
  }
  sums.push(`(SELECT - COALESCE(SUM(s.amount_paise), 0) FROM staff_advances s WHERE s.date < $1::date)`);
  return `SELECT ${sums.join(" + ")} AS net`;
}

function daySheet(tx: TxClient): DaySheetRepo {
  const source = `(${sheetSource()}) AS l(id, kind, ref, room, particulars, note, mode, direction, amount, dt, party, unit, from_adv)`;
  const netBefore = cashNetBeforeSql();
  return {
    async lines(range) {
      const r = await tx.query(`SELECT ${COLUMNS} FROM ${source} WHERE ($1::date IS NULL OR dt >= $1::date) AND dt <= $2::date ORDER BY dt, kind, id`, [range.from, range.to]);
      return r.rows.map(lineOf);
    },
    async cashNetBefore(day) {
      const r = await tx.query(netBefore, [day]);
      return moneyOut(r.rows[0].net) as never;
    },
  };
}

function foodPlan(tx: TxClient): FoodPlanRepo {
  return {
    async stayBills(window) {
      const r = await tx.query(
        `SELECT b.id, b.bill_number, b.bill_date, b.room_number, b.guest_name, c.name AS company_name, b.persons, b.hotel_plan, b.stay_segments,
                (b.arrival_at AT TIME ZONE '${IST}')::date AS arrival_date, (b.departure_at AT TIME ZONE '${IST}')::date AS departure_date
           FROM bill_master_bills b LEFT JOIN company_profiles c ON c.id = b.company_id
          WHERE b.deleted_at IS NULL AND b.bill_date BETWEEN $1::date AND $2::date
            AND ((b.stay_segments IS NOT NULL AND jsonb_typeof(b.stay_segments) = 'array' AND jsonb_array_length(b.stay_segments) > 0)
                 OR (b.arrival_at IS NOT NULL AND b.departure_at IS NOT NULL AND ($3::text[] IS NULL OR lower(COALESCE(b.hotel_plan, '')) = ANY($3::text[]))))
          ORDER BY b.bill_date, b.id`,
        [window.billDateFrom, window.billDateTo, window.mealPlans ? [...window.mealPlans] : null],
      );
      return r.rows.map((x): StayBillRow => {
        const parts = Array.isArray(x.stay_segments) ? (x.stay_segments as Row[]) : null;
        return {
          id: String(x.id), billNumber: String(x.bill_number ?? ""), billDate: String(x.bill_date), roomNumber: asText(x.room_number), guestName: String(x.guest_name ?? ""), companyName: asText(x.company_name),
          persons: x.persons === null ? null : Number(x.persons), hotelPlan: asText(x.hotel_plan), arrivalDate: x.arrival_date === null ? null : String(x.arrival_date),
          departureDate: x.departure_date === null ? null : String(x.departure_date),
          stay: parts && parts.length > 0 ? parts.map((p) => ({ from: String(p.from), to: String(p.to), plan: p.plan === null || p.plan === "" || p.plan === undefined ? null : String(p.plan), persons: Number(p.persons ?? 0) })) : null,
        };
      });
    },
  };
}

/** The cash movements of both businesses' books and the cash staff advances, as one set. */
function movementSource(): string {
  const parts: string[] = [];
  for (const unit of ["hotel", "food"]) {
    parts.push(
      `SELECT t.id, '${unit}' AS unit, 'in' AS direction, 'Deposit' AS kind, NULL::text AS head, COALESCE(${blank("t.depositor")}, '') AS who, t.entry_no::text AS entry_no, COALESCE(t.full_name, '') AS by_name, t.user_id::text AS user_id, t.amount_paise, t.date, t.time FROM ${unit}_cash_deposits t WHERE t.deleted_at IS NULL`,
      `SELECT t.id, '${unit}', 'out', 'Withdrawal', 'Cash withdrawals', COALESCE(${blank("t.withdrawer")}, ''), t.entry_no::text, COALESCE(t.full_name, ''), t.user_id::text, t.amount_paise, t.date, t.time FROM ${unit}_cash_withdrawals t WHERE t.deleted_at IS NULL`,
      `SELECT t.id, '${unit}', 'out', 'Expense', COALESCE(${blank("t.expense_head")}, 'Unsorted'), COALESCE(${blank("t.expense_name")}, ''), t.entry_no::text, COALESCE(t.full_name, ''), t.user_id::text, t.amount_paise, t.date, t.time FROM ${unit}_misc_expenses t WHERE t.deleted_at IS NULL`,
    );
  }
  parts.push(`SELECT s.id, s.business, 'out', 'Staff advance', 'Staff advances', COALESCE(e.name, ''), s.entry_no::text, COALESCE(s.full_name, ''), s.user_id::text, s.amount_paise, s.date, s.time FROM staff_advances s LEFT JOIN employees e ON e.id = s.employee_id`);
  return parts.join(" UNION ALL ");
}

const movementOf = (r: Row): CashMovement => ({
  id: String(r.id), unit: r.unit === "food" ? "food" : "hotel", direction: r.direction === "out" ? "out" : "in", kind: String(r.kind) as CashMovement["kind"], head: asText(r.head), who: String(r.who),
  entryNo: String(r.entry_no), byName: String(r.by_name), userId: asText(r.user_id), amountPaise: moneyOut(r.amount_paise) as never, date: String(r.date), time: String(r.hhmm),
});

function overview(tx: TxClient): OverviewRepo {
  const source = `(${movementSource()}) AS m(id, unit, direction, kind, head, who, entry_no, by_name, user_id, amount_paise, date, time)`;
  const cols = "id, unit, direction, kind, head, who, entry_no, by_name, user_id, amount_paise, date, to_char(time, 'HH24:MI') AS hhmm";
  return {
    async movements(range) {
      return (await tx.query(`SELECT ${cols} FROM ${source} WHERE date BETWEEN $1::date AND $2::date ORDER BY date, time, id`, [range.from, range.to])).rows.map(movementOf);
    },
    async movementCount(range) {
      return Number((await tx.query(`SELECT count(*) AS n FROM ${source} WHERE date BETWEEN $1::date AND $2::date`, [range.from, range.to])).rows[0].n);
    },
    async recent(limit) {
      return (await tx.query(`SELECT ${cols} FROM ${source} ORDER BY date DESC, time DESC, id DESC LIMIT $1`, [limit])).rows.map(movementOf);
    },
    async handovers(today, monthStart): Promise<HandoverFigures> {
      const r = await tx.query(
        `SELECT COUNT(*) FILTER (WHERE date = $1::date) AS today_n, COALESCE(SUM(total_paise) FILTER (WHERE date = $1::date), 0) AS today_p, COUNT(*) FILTER (WHERE date BETWEEN $2::date AND $1::date) AS month_n
           FROM shift_handovers WHERE deleted_at IS NULL`,
        [today, monthStart],
      );
      const last = await tx.query("SELECT shift, date, to_char(time, 'HH24:MI') AS hhmm, full_name, user_id::text AS user_id FROM shift_handovers WHERE deleted_at IS NULL AND date IS NOT NULL ORDER BY date DESC, time DESC NULLS LAST, id DESC LIMIT 1");
      const x = r.rows[0];
      const l = last.rows[0];
      return {
        todayCount: Number(x.today_n), todayCashPaise: moneyOut(x.today_p) as never, monthCount: Number(x.month_n),
        latest: l ? { shift: String(l.shift ?? ""), date: String(l.date), time: String(l.hhmm ?? ""), byName: String(l.full_name ?? ""), userId: asText(l.user_id) } : null,
      };
    },
    async payroll(monthStart, today): Promise<PayrollFigures> {
      const r = await tx.query(
        `SELECT (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND is_active) AS active,
                (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND is_active AND joining_date BETWEEN $1::date AND $2::date) AS joined,
                (SELECT COUNT(*) FROM salary_processings WHERE payment_status <> 'Paid') AS open_n,
                (SELECT COALESCE(SUM(GREATEST(0, net_salary_paise - paid_amount_paise)), 0) FROM salary_processings WHERE payment_status <> 'Paid') AS open_p,
                (SELECT to_char(MIN(make_date(year, month, 1)), 'YYYY-MM') FROM salary_processings WHERE payment_status <> 'Paid') AS since,
                (SELECT COUNT(*) FROM staff_advances WHERE date BETWEEN $1::date AND $2::date) AS adv_n,
                (SELECT COALESCE(SUM(amount_paise), 0) FROM staff_advances WHERE date BETWEEN $1::date AND $2::date) AS adv_p,
                (SELECT COUNT(*) FROM salary_processings WHERE paid_at BETWEEN $1::date AND $2::date) AS paid_n,
                (SELECT COALESCE(SUM(paid_amount_paise), 0) FROM salary_processings WHERE paid_at BETWEEN $1::date AND $2::date) AS paid_p`,
        [monthStart, today],
      );
      const x = r.rows[0];
      return {
        activeStaff: Number(x.active), joinedThisMonth: Number(x.joined), openCount: Number(x.open_n), openAmountPaise: moneyOut(x.open_p) as never, openSince: asText(x.since),
        advancesPaise: moneyOut(x.adv_p) as never, advanceCount: Number(x.adv_n), paidPaise: moneyOut(x.paid_p) as never, paidCount: Number(x.paid_n),
      };
    },
  };
}

export function pgReportsRepos(tx: TxClient): ReportsRepos {
  return {
    daySheet: daySheet(tx),
    foodPlan: foodPlan(tx),
    overview: overview(tx),
    mealPlanRates: pgBillingRepos(tx).mealPlanRates,
    reservations: {
      async arrivalsToday(date) {
        return Number((await tx.query("SELECT COUNT(*) AS n FROM pms_reservations WHERE status = 'confirmed' AND check_in = $1::date", [date])).rows[0].n);
      },
    },
    occupancy: {
      async nights(from, to) {
        // the stay's check-in and check-out DAYS in IST (the night of `d` is sold when check-in day <= d < check-out day; an in-house stay runs to its expected check-out)
        const r = await tx.query(
          `WITH nights AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d),
                stays AS (SELECT (check_in_at AT TIME ZONE 'Asia/Kolkata')::date AS cin, COALESCE((check_out_at AT TIME ZONE 'Asia/Kolkata')::date, expected_check_out) AS cout, rate_paise FROM pms_stays)
           SELECT n.d AS date,
                  COUNT(s.cin) FILTER (WHERE s.cin <= n.d AND n.d < s.cout) AS rooms_sold,
                  COALESCE(SUM(s.rate_paise) FILTER (WHERE s.cin <= n.d AND n.d < s.cout), 0) AS room_revenue_paise,
                  COUNT(s.cin) FILTER (WHERE s.cin = n.d) AS arrivals,
                  COUNT(s.cin) FILTER (WHERE s.cout = n.d) AS departures
           FROM nights n LEFT JOIN stays s ON s.cin <= n.d AND n.d <= s.cout
           GROUP BY n.d ORDER BY n.d`,
          [from, to],
        );
        return r.rows.map((x) => ({ date: String(x.date).slice(0, 10), roomsSold: Number(x.rooms_sold), roomRevenuePaise: BigInt(String(x.room_revenue_paise)), arrivals: Number(x.arrivals), departures: Number(x.departures) }));
      },
      async roomCount() {
        return Number((await tx.query("SELECT COUNT(*) AS n FROM pms_rooms WHERE NOT out_of_order")).rows[0].n);
      },
    },
    frontDesk: {
      async today(date) {
        // one statement: the front-office counts as scalar subqueries
        const r = await tx.query(
          `SELECT (SELECT COUNT(*) FROM pms_reservations WHERE status = 'confirmed' AND check_in = $1::date) AS arrivals,
                  (SELECT COUNT(*) FROM pms_stays WHERE status = 'in_house' AND expected_check_out <= $1::date) AS departures,
                  (SELECT COUNT(*) FROM pms_stays WHERE status = 'in_house') AS in_house,
                  (SELECT COUNT(*) FROM pms_rooms WHERE hk_status = 'dirty' AND NOT out_of_order) AS rooms_to_clean,
                  (SELECT COUNT(*) FROM pms_rooms r WHERE r.hk_status = 'clean' AND NOT r.out_of_order AND NOT EXISTS (SELECT 1 FROM pms_stays s WHERE s.room_id = r.id AND s.status = 'in_house')) AS rooms_ready`,
          [date],
        );
        const n = (k: string) => Number(r.rows[0]?.[k] ?? 0);
        return { arrivals: n("arrivals"), departures: n("departures"), inHouse: n("in_house"), roomsToClean: n("rooms_to_clean"), roomsReady: n("rooms_ready") };
      },
      async openGuestRequests() {
        // a hotel that has not run migration 0031 yet has no table: zero, never an error on the dashboard
        const there = await tx.query("SELECT to_regclass('guest_requests') IS NOT NULL AS there");
        if (!there.rows[0]?.there) return 0;
        return Number((await tx.query("SELECT COUNT(*) AS n FROM guest_requests WHERE status = 'open'")).rows[0]?.n ?? 0);
      },
    },
    gst: gst(tx),
  };
}

/** The GST summary's bills: one read of bill_master_bills with the company's name. */
function gst(tx: TxClient): GstRepo {
  return {
    async bills(from: string, to: string) {
      const r = await tx.query(
        `SELECT b.id, b.bill_date, b.bill_number, b.guest_name, b.guest_gstin, c.name AS company_name,
                b.total_hotel_amount_paise, b.hotel_gst_paise, b.hotel_gst_percent, b.total_food_amount_paise, b.food_gst_paise, b.food_gst_percent
           FROM bill_master_bills b LEFT JOIN company_profiles c ON c.id = b.company_id
          WHERE b.deleted_at IS NULL AND b.bill_date BETWEEN $1::date AND $2::date
          ORDER BY b.bill_date, b.entry_no`,
        [from, to],
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        billDate: String(x.bill_date).slice(0, 10),
        billNumber: String(x.bill_number),
        guestName: String(x.guest_name ?? ""),
        guestGstin: asText(x.guest_gstin),
        companyName: asText(x.company_name),
        totalHotelAmountPaise: moneyOut(x.total_hotel_amount_paise) as never,
        hotelGstPaise: moneyOut(x.hotel_gst_paise) as never,
        hotelGstPercent: pctOut(x.hotel_gst_percent),
        totalFoodAmountPaise: moneyOut(x.total_food_amount_paise) as never,
        foodGstPaise: moneyOut(x.food_gst_paise) as never,
        foodGstPercent: pctOut(x.food_gst_percent),
      }));
    },
  };
}

export function createPgReportsUnit(withHotel: WithHotel): ReportsUnit {
  return createPgUnit(withHotel, pgReportsRepos);
}
