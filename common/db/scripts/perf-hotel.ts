// DEV tool for the speed check (docs/plans/PLAN-SPEED.md): a throwaway hotel "PERF-Test Hotel" with a working year of data, so every list, dashboard,
// report and PDF is measured on volume, not on a handful of rows. Local database only (cli.ts refuses otherwise). Everything it makes is named PERF.
//   create: the hotel (normal create-hotel path), then in its schema: 20 companies, 800 customers, 1,500 advances, 2,000 bills (both 90% on a company,
//           so the company ledger has about 3,150 lines), 3,000 cash entries (1,000 hotel deposits, 1,000 food deposits, 1,000 hotel expenses with 2
//           lines each), 600 website enquiries, 400 staff with 12 months of attendance (one row per person per day) and 12 salary months.
//   remove: the PERF accounts are deleted, the hotel is recorded as deleted and its schema and role are dropped.
// Plain SQL with generate_series: one statement per table, deterministic values (no randomness), amounts in paise.
import type { DbClient } from "./pg-db";

export const PERF_SLUG = "perf-test-hotel";
export const PERF_NAME = "PERF-Test Hotel";

/** The data statements for a fresh PERF hotel schema; `userId` is the PERF admin (cash entries are written by them). */
export function perfDataStatements(userId: string): string[] {
  const days = (n: string) => `(DATE '2026-10-10' - ((${n}) % 365))`;
  return [
    `INSERT INTO company_profiles (name, gst_number, email, mobile_number, address)
     SELECT 'PERF Company ' || n, '24PERF' || lpad(n::text, 4, '0') || 'Z1Z', 'perf.company' || n || '@example.test', '98' || lpad(n::text, 8, '0'), n || ' Ring Road, Rajkot'
     FROM generate_series(1, 20) n`,
    `INSERT INTO customers (name, mobile, email, city, source)
     SELECT 'PERF Guest ' || n, '7' || lpad(n::text, 9, '0'), 'perf.guest' || n || '@example.test', 'Rajkot', 'admin'
     FROM generate_series(1, 800) n`,
    `CREATE TEMP TABLE perf_companies ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY name) - 1 AS k FROM company_profiles WHERE name LIKE 'PERF Company %'`,
    `INSERT INTO bill_master_advances (entry_no, receipt_number, guest_name, mobile_number, company_id, payment_date, hotel_amount_paise, food_amount_paise, hotel_mode, food_mode,
       hotel_balance_paise, food_balance_paise, total_paise, created_by)
     SELECT n, 'PERF-A' || n, 'PERF Guest ' || (n % 800 + 1), '7' || lpad((n % 800 + 1)::text, 9, '0'),
       CASE WHEN n % 10 = 0 THEN NULL ELSE (SELECT id FROM perf_companies WHERE k = n % 20) END,
       ${days("n * 7")}, 500000 + (n % 50) * 10000, 100000 + (n % 20) * 5000, 'cash', 'upi', 500000 + (n % 50) * 10000, 100000 + (n % 20) * 5000,
       600000 + (n % 50) * 10000 + (n % 20) * 5000, '${userId}'
     FROM generate_series(1, 1500) n`,
    `INSERT INTO bill_master_bills (entry_no, bill_number, bill_date, guest_name, mobile_number, company_id, hotel_plan, room_number, persons,
       hotel_amount_paise, hotel_plan_amount_paise, hotel_gst_paise, hotel_gst_percent, total_hotel_amount_paise, hotel_mode_of_payment,
       food_amount_paise, food_plan_amount_paise, food_gst_paise, food_gst_percent, total_food_amount_paise, food_mode_of_payment,
       balance_hotel_amount_paise, balance_food_amount_paise, created_by)
     SELECT n, 'PERF-B' || n, ${days("n * 3")}, 'PERF Guest ' || (n % 800 + 1), '7' || lpad((n % 800 + 1)::text, 9, '0'),
       CASE WHEN n % 10 = 0 THEN NULL ELSE (SELECT id FROM perf_companies WHERE k = n % 20) END, 'EP', (100 + n % 40)::text, 1 + n % 3,
       400000 + (n % 60) * 10000, 400000 + (n % 60) * 10000, (400000 + (n % 60) * 10000) / 20, 5, (400000 + (n % 60) * 10000) * 21 / 20, 'cash',
       80000 + (n % 25) * 4000, 80000 + (n % 25) * 4000, (80000 + (n % 25) * 4000) / 20, 5, (80000 + (n % 25) * 4000) * 21 / 20, 'upi',
       CASE WHEN n % 4 = 0 THEN 50000 ELSE 0 END, 0, '${userId}'
     FROM generate_series(1, 2000) n`,
    ...(["hotel_cash_deposits", "food_cash_deposits"] as const).map(
      (t) => `INSERT INTO ${t} (entry_no, date, time, user_id, full_name, depositor, amount_paise, reason, created_by)
       SELECT n, ${days("n")}, TIME '09:00' + (n % 600) * INTERVAL '1 minute', '${userId}', 'PERF Admin', 'PERF Depositor ' || (n % 12 + 1), 100000 + (n % 90) * 5000, 'PERF deposit', '${userId}'
       FROM generate_series(1, 1000) n`,
    ),
    `INSERT INTO hotel_misc_expenses (entry_no, date, time, user_id, full_name, expense_name, amount_paise, expense_head, created_by)
     SELECT n, ${days("n")}, TIME '10:00' + (n % 500) * INTERVAL '1 minute', '${userId}', 'PERF Admin', 'PERF expense ' || n, 2 * (5000 + (n % 40) * 500), 'Housekeeping', '${userId}'
     FROM generate_series(1, 1000) n`,
    `INSERT INTO expense_lines (business, expense_id, category, item, quantity, price_paise, total_paise, pricing)
     SELECT 'hotel', e.id, 'PERF Supplies', 'PERF item ' || s, 1, e.amount_paise / 2, e.amount_paise / 2, 'custom'
     FROM hotel_misc_expenses e CROSS JOIN generate_series(1, 2) s WHERE e.expense_name LIKE 'PERF expense %'`,
    `INSERT INTO site_enquiries (reference, name, phone, email, message, check_in, check_out, guests, status, created_at)
     SELECT 'PERF-E' || lpad(n::text, 4, '0'), 'PERF Visitor ' || n, '6' || lpad(n::text, 9, '0'), 'perf.visitor' || n || '@example.test', 'A room for the weekend, please.',
       ${days("n")} + 30, ${days("n")} + 32, 2, (ARRAY['pending', 'confirmed', 'declined'])[n % 3 + 1], ${days("n")}::timestamptz
     FROM generate_series(1, 600) n`,
    `CREATE TEMP TABLE perf_pc ON COMMIT DROP AS SELECT id, name FROM payroll_companies ORDER BY code LIMIT 1`,
    `INSERT INTO attendance_statuses (payroll_company_id, name, shortcut_key, color, attendance_percentage, status_type)
     SELECT (SELECT id FROM perf_pc), s.name, s.k, s.c, s.p, s.t FROM (VALUES ('Present', 'P', '#198754', 100, 'Paid'), ('Half day', 'H', '#ffc107', 50, 'Paid'), ('Absent', 'A', '#dc3545', 0, 'Unpaid')) s(name, k, c, p, t)
     WHERE NOT EXISTS (SELECT 1 FROM attendance_statuses a WHERE a.payroll_company_id = (SELECT id FROM perf_pc) AND a.shortcut_key = s.k)`,
    `INSERT INTO employees (payroll_company_id, employee_code, name, designation, department, joining_date, salary_paise, daily_working_hours, contact_number, payment_mode, is_active)
     SELECT (SELECT id FROM perf_pc), 'PERF' || lpad(n::text, 4, '0'), 'PERF Staff ' || n, (ARRAY['Waiter', 'Cook', 'Housekeeping', 'Front desk'])[n % 4 + 1],
       (ARRAY['Food', 'Kitchen', 'Rooms', 'Front office'])[n % 4 + 1], DATE '2024-04-01' + (n % 300), 1500000 + (n % 30) * 50000, 8, '9' || lpad(n::text, 9, '0'), 'bank', true
     FROM generate_series(1, 400) n`,
    `INSERT INTO attendance_months (payroll_company_id, year, month, is_locked, salary_generated_at, generation_count)
     SELECT (SELECT id FROM perf_pc), extract(year FROM m)::int, extract(month FROM m)::int, true, m + INTERVAL '1 month', 1
     FROM generate_series(DATE '2025-10-01', DATE '2026-09-01', INTERVAL '1 month') m`,
    `INSERT INTO attendance_entries (attendance_month_id, employee_id, day, attendance_status_id, shortcut_key, attendance_percentage)
     SELECT am.id, e.id, d, st.id, st.shortcut_key, st.attendance_percentage
     FROM attendance_months am
     JOIN employees e ON e.payroll_company_id = am.payroll_company_id AND e.employee_code LIKE 'PERF%'
     CROSS JOIN LATERAL generate_series(1, extract(day FROM (make_date(am.year, am.month, 1) + INTERVAL '1 month - 1 day'))::int) d
     JOIN attendance_statuses st ON st.payroll_company_id = am.payroll_company_id AND st.shortcut_key = CASE WHEN (d + substr(e.employee_code, 5)::int) % 15 = 0 THEN 'A' WHEN (d + substr(e.employee_code, 5)::int) % 11 = 0 THEN 'H' ELSE 'P' END
     WHERE am.payroll_company_id = (SELECT id FROM perf_pc)`,
    `INSERT INTO salary_processings (payroll_company_id, employee_id, year, month, company_name, employee_code, employee_name, designation, department, payment_mode,
       monthly_salary_paise, daily_working_hours, total_days_in_month, daily_salary_paise, days_100, total_payable_days, attendance_salary_paise, net_salary_paise,
       payment_status, generation_count, processed_at, paid_amount_paise, paid_at)
     SELECT am.payroll_company_id, e.id, am.year, am.month, (SELECT name FROM perf_pc), e.employee_code, e.name, e.designation, e.department, e.payment_mode,
       e.salary_paise, 8, 30, e.salary_paise / 30, 28, 28, e.salary_paise * 28 / 30, e.salary_paise * 28 / 30, 'paid', 1, am.salary_generated_at,
       e.salary_paise * 28 / 30, (am.salary_generated_at + INTERVAL '5 days')::date
     FROM attendance_months am JOIN employees e ON e.payroll_company_id = am.payroll_company_id AND e.employee_code LIKE 'PERF%'
     WHERE am.payroll_company_id = (SELECT id FROM perf_pc)`,
  ];
}

/** Row counts of the PERF data, for the report after create. */
export async function perfCounts(client: DbClient, schema: string): Promise<Record<string, number>> {
  const tables = ["company_profiles", "customers", "bill_master_advances", "bill_master_bills", "hotel_cash_deposits", "food_cash_deposits", "hotel_misc_expenses", "expense_lines", "site_enquiries", "employees", "attendance_entries", "salary_processings"];
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await client.query(`SELECT count(*) AS n FROM "${schema}".${t}`)).rows[0].n);
  return out;
}
