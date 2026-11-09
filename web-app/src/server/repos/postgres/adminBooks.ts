import "server-only";
// The PostgreSQL implementation of the Books side of Admin (repos/adminBooks.ts), SQL over the hotel's schema. The years are plain rows; what a year
// holds, what it left open and the removal of the newest year reach every module's tables in ONE withHotel transaction, so a failure leaves nothing
// half done. The order of removeLatest is docs/specs/admin.md §8 (Pallav Support/Books.php removeLatest): each step gives back what the year did to
// OLDER records before anything dated in the year is deleted.
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import { DATED_TABLES, type AdminBooksRepos, type BookYear, type BooksRepo, type Carried } from "../adminBooks";
import { RepoError, type Unit } from "../types";
import { guard, moneyOut } from "./shared";
import { pgCashSupport } from "./support";
import { createPgUnit } from "./unit";

type Row = Record<string, unknown>;

/** The date a row of each dated table belongs to (Books::DATED): its own date, or the month a salary or attendance row is for. */
const IST = "Asia/Kolkata";
const DATE_OF: Record<(typeof DATED_TABLES)[number], string> = {
  hotel_cash_deposits: "date",
  food_cash_deposits: "date",
  hotel_cash_withdrawals: "date",
  food_cash_withdrawals: "date",
  hotel_misc_expenses: "date",
  food_misc_expenses: "date",
  shift_handovers: "date",
  bill_master_bills: "bill_date",
  bill_master_advances: "payment_date",
  staff_advances: "date",
  payroll_advances: `(advance_date AT TIME ZONE '${IST}')::date`,
  bonus_incentives: `(entry_date AT TIME ZONE '${IST}')::date`,
  employee_meal_periods: "starts_on",
  salary_processings: "make_date(year, month, 1)",
  attendance_months: "make_date(year, month, 1)",
};
const IN_YEAR = (table: (typeof DATED_TABLES)[number]): string => `${DATE_OF[table]} BETWEEN $1::date AND $2::date`;

const yearOf = (r: Row): BookYear => ({
  id: String(r.id), label: String(r.label), startsOn: String(r.starts_on), endsOn: String(r.ends_on), closedAt: r.closed_at instanceof Date ? r.closed_at : null,
  startedBy: r.started_by === null ? null : String(r.started_by), closedBy: r.closed_by === null ? null : String(r.closed_by),
});

const EMPTY_SLOTS = [0, 1, 2, 3, 4].flatMap((i) => {
  const s = i === 0 ? "" : `_${i}`;
  const n = i === 0 ? "" : `_${i}`;
  return [`debit_bill_date${s} = NULL`, `debit_hotel_mode${s} = NULL`, `debit_food_mode${s} = NULL`, `debit_hotel_amount${n}_paise = NULL`, `debit_food_amount${n}_paise = NULL`];
});
const SLOT_DATES = ["debit_bill_date", "debit_bill_date_1", "debit_bill_date_2", "debit_bill_date_3", "debit_bill_date_4"];

function pgBooksRepo(tx: TxClient): BooksRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);

  async function counts(year: BookYear): Promise<Record<string, number>> {
    const parts = DATED_TABLES.map((t) => `SELECT '${t}' AS t, COUNT(*) AS n FROM ${t} WHERE ${IN_YEAR(t)}`);
    const r = await q(parts.join(" UNION ALL "), [year.startsOn, year.endsOn]);
    return Object.fromEntries(r.rows.map((x) => [String(x.t), Number(x.n)]));
  }

  return {
    async years() {
      return (await q("SELECT * FROM accounting_years ORDER BY starts_on, id")).rows.map(yearOf);
    },
    counts,

    async carried(year): Promise<Carried> {
      const r = await q(
        `SELECT
           (SELECT COUNT(*) FROM bill_master_bills WHERE deleted_at IS NULL AND bill_date < $1::date AND balance_hotel_amount_paise + balance_food_amount_paise > 0) AS bills_n,
           (SELECT COALESCE(SUM(balance_hotel_amount_paise + balance_food_amount_paise), 0) FROM bill_master_bills WHERE deleted_at IS NULL AND bill_date < $1::date AND balance_hotel_amount_paise + balance_food_amount_paise > 0) AS bills_p,
           (SELECT COUNT(*) FROM bill_master_advances WHERE deleted_at IS NULL AND payment_date < $1::date AND refund_payment_date IS NULL AND hotel_balance_paise + food_balance_paise > 0) AS adv_n,
           (SELECT COALESCE(SUM(hotel_balance_paise + food_balance_paise), 0) FROM bill_master_advances WHERE deleted_at IS NULL AND payment_date < $1::date AND refund_payment_date IS NULL AND hotel_balance_paise + food_balance_paise > 0) AS adv_p,
           (SELECT COUNT(*) FROM payroll_advances WHERE deleted_at IS NULL AND NOT is_settled AND (advance_date AT TIME ZONE '${IST}')::date < $1::date) AS pay_n,
           (SELECT COALESCE(SUM(amount_paise - recovered_amount_paise), 0) FROM payroll_advances WHERE deleted_at IS NULL AND NOT is_settled AND (advance_date AT TIME ZONE '${IST}')::date < $1::date) AS pay_p,
           (SELECT COUNT(*) FROM salary_processings WHERE make_date(year, month, 1) < $1::date AND payment_status <> 'Paid' AND net_salary_paise > paid_amount_paise) AS sal_n,
           (SELECT COALESCE(SUM(net_salary_paise - paid_amount_paise), 0) FROM salary_processings WHERE make_date(year, month, 1) < $1::date AND payment_status <> 'Paid' AND net_salary_paise > paid_amount_paise) AS sal_p`,
        [year.startsOn],
      );
      const x = r.rows[0];
      const pair = (n: unknown, p: unknown) => ({ count: Number(n), amountPaise: Number(moneyOut(p)) });
      // the cash in hand is the daily sheet's opening figure; that sheet is not a table, so it cannot be worked out here
      return { cashPaise: null, bills: pair(x.bills_n, x.bills_p), advances: pair(x.adv_n, x.adv_p), payroll: pair(x.pay_n, x.pay_p), salaries: pair(x.sal_n, x.sal_p) };
    },

    async start(next, by, now) {
      await q("UPDATE accounting_years SET closed_at = $2, closed_by = $1 WHERE closed_at IS NULL", [by, now.toISOString()]);
      const r = await guard(q("INSERT INTO accounting_years (label, starts_on, ends_on, started_by) VALUES ($1, $2::date, $3::date, $4) RETURNING *", [next.label, next.startsOn, next.endsOn, by]));
      return yearOf(r.rows[0]);
    },

    async removeLatest(by, now) {
      const all = (await q("SELECT * FROM accounting_years ORDER BY starts_on, id FOR UPDATE")).rows.map(yearOf);
      const newest = all[all.length - 1];
      if (!newest || all.length < 2) throw new RepoError("check", "no earlier year");
      const previous = all[all.length - 2];
      const range = [newest.startsOn, newest.endsOn];
      const removed = await counts(newest);

      // (1) the salary run of every month of the year is reversed the way payroll itself reverses it (SalaryProcessor::reverse), and the months go
      const processings = (await q("SELECT id FROM salary_processings WHERE make_date(year, month, 1) BETWEEN $1::date AND $2::date FOR UPDATE", range)).rows.map((x) => String(x.id));
      if (processings.length > 0) {
        const lines = (await q("SELECT source_type, source_id, amount_paise FROM salary_processing_lines WHERE salary_processing_id = ANY($1::uuid[])", [processings])).rows;
        const carried = (await q("SELECT id, parent_advance_id, amount_paise FROM payroll_advances WHERE source_salary_processing_id = ANY($1::uuid[])", [processings])).rows;
        const back = new Map<string, bigint>();
        const add = (id: unknown, amount: unknown) => {
          if (typeof id === "string") back.set(id, (back.get(id) ?? BigInt(0)) + BigInt(String(amount)));
        };
        for (const c of carried) add(c.parent_advance_id, c.amount_paise);
        for (const l of lines) if (l.source_type === "advance") add(l.source_id, l.amount_paise);
        if (back.size > 0) {
          const ids = [...back.keys()];
          await q(
            `UPDATE payroll_advances a SET recovered_amount_paise = GREATEST(0, a.recovered_amount_paise - v.give), is_settled = (a.amount_paise - GREATEST(0, a.recovered_amount_paise - v.give) <= 0)
               FROM unnest($1::uuid[], $2::bigint[]) AS v(id, give) WHERE a.id = v.id`,
            [ids, ids.map((id) => String(back.get(id)))],
          );
        }
        await q("DELETE FROM payroll_advances WHERE id = ANY($1::uuid[])", [carried.map((c) => String(c.id))]);
        await q("UPDATE employee_deductions SET is_settled = false WHERE id = ANY($1::uuid[])", [lines.flatMap((l) => (l.source_type === "employee_deduction" && typeof l.source_id === "string" ? [l.source_id] : []))]);
        await q("DELETE FROM salary_processings WHERE id = ANY($1::uuid[])", [processings]);
      }

      // (2) older salaries paid in this year go back to Pending: paid amount 0, no date, no reference
      await q(
        `UPDATE salary_processings SET payment_status = 'Pending', paid_amount_paise = 0, paid_at = NULL, payment_reference = NULL, version = version + 1
          WHERE make_date(year, month, 1) < $1::date AND paid_at BETWEEN $1::date AND $2::date`,
        range,
      );

      // (3) this year's bills give back to an OLDER advance what they took from it (what deleting the bill would give back)
      await q(
        `UPDATE bill_master_advances a SET hotel_balance_paise = a.hotel_balance_paise + t.hotel, food_balance_paise = a.food_balance_paise + t.food, version = a.version + 1
           FROM (SELECT advance_id, SUM(advance_delete_hotel_amount_paise) AS hotel, SUM(advance_delete_food_amount_paise) AS food FROM bill_master_bills
                  WHERE advance_id IS NOT NULL AND bill_date BETWEEN $1::date AND $2::date GROUP BY advance_id) t
          WHERE a.id = t.advance_id AND a.payment_date < $1::date`,
        range,
      );

      // (4) older debit bills settled in this year are waiting again: the receipt of an overpayment is removed, the settlement cleared, the balance is the total
      const settled = `bill_date < $1::date AND (${SLOT_DATES.map((c) => `${c} BETWEEN $1::date AND $2::date`).join(" OR ")})`;
      await q(
        `DELETE FROM bill_master_advances WHERE receipt_number IN (SELECT formatted_advance_receipt_number FROM bill_master_bills WHERE formatted_advance_receipt_number IS NOT NULL AND ${settled})`,
        range,
      );
      await q(
        `UPDATE bill_master_bills SET ${EMPTY_SLOTS.join(", ")}, formatted_advance_receipt_number = NULL, debit_hotel_advance = NULL, debit_food_advance = NULL, debit_reference_name = NULL,
                debit_reference_mobile_number = NULL, debit_instruction = NULL, balance_hotel_amount_paise = GREATEST(total_hotel_amount_paise, 0), balance_food_amount_paise = GREATEST(total_food_amount_paise, 0),
                version = version + 1
          WHERE ${settled}`,
        range,
      );

      // (5) older advances refunded in this year are not refunded any more: the refund goes back onto the balances
      await q(
        `UPDATE bill_master_advances SET hotel_balance_paise = hotel_balance_paise + COALESCE(hotel_refund_amount_paise, 0), food_balance_paise = food_balance_paise + COALESCE(food_refund_amount_paise, 0),
                total_paise = hotel_balance_paise + COALESCE(hotel_refund_amount_paise, 0) + food_balance_paise + COALESCE(food_refund_amount_paise, 0),
                hotel_refund_amount_paise = NULL, food_refund_amount_paise = NULL, hotel_refund_mode = NULL, food_refund_mode = NULL, refund_payment_date = NULL, refund_guest_name = NULL,
                refund_mobile_number = NULL, refund_instruction = NULL, version = version + 1
          WHERE payment_date < $1::date AND refund_payment_date BETWEEN $1::date AND $2::date`,
        range,
      );

      // (6) children before parents (the expense lines; attendance entries and salary lines go with their months), then every dated row, bills before advances
      for (const [lines, expenses] of [["hotel", "hotel_misc_expenses"], ["food", "food_misc_expenses"]] as const) {
        await q(`DELETE FROM expense_lines WHERE business = '${lines}' AND expense_id IN (SELECT id FROM ${expenses} WHERE ${IN_YEAR(expenses)})`, range);
      }
      const order = [...DATED_TABLES].sort((a, b) => Number(b === "bill_master_bills") - Number(a === "bill_master_bills"));
      for (const table of order) {
        if (table === "salary_processings") continue; // already removed in step 1
        await q(`DELETE FROM ${table} WHERE ${IN_YEAR(table)}`, range);
      }

      // (7) the year itself goes and the previous one is open again
      await q("DELETE FROM accounting_years WHERE id = $1", [newest.id]);
      await q("UPDATE accounting_years SET closed_at = NULL, closed_by = NULL WHERE id = $1", [previous.id]);
      void by;
      void now;
      return removed;
    },
  };
}

function pgAdminBooksRepos(tx: TxClient): AdminBooksRepos {
  return { books: pgBooksRepo(tx), systemLogs: pgCashSupport(tx).systemLogs };
}

/** One withHotel transaction per run, like every hotel Unit (the hotel comes from the session). */
export function createPgAdminBooksUnit(withHotel: WithHotel): Unit<AdminBooksRepos> {
  return createPgUnit(withHotel, pgAdminBooksRepos);
}
